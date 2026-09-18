# GFN2-xTB IR cost model — native reference for the wasm port

**Question.** How long does a full GFN2-xTB IR calculation (geometry optimisation +
numerical Hessian + dipole derivatives) take, and what does that become in the
browser under WebAssembly?

**Answer in one line.** On one Apple-M1 core, native xtb 6.7.1 does the whole
optimisation+Hessian for a 60-atom drug-like molecule in **~44 s**; under the
established 2.4–5.5× wasm penalty that is **105–240 s**, i.e. already past
interactive. The realistic in-browser sweet spot is **N ≤ 30–40 atoms** for an
interactive (<30 s) result and **N ≤ 50–60** for a "go and get a coffee" result.
An independent GFN2 implementation already shipping as wasm (OCC / `occjs`)
measures **0.8–1.7× native xtb** (median 1.1×) on the same molecules, which suggests the low end
of that band — or better — is reachable if the port is done well.

---

## 1. What was measured

| | |
|---|---|
| Code | xtb **6.7.1** (`a45f05d`), built from source with gfortran 13.3, `-O2`, OpenBLAS |
| Container | `xtbnat:bench` (ubuntu 24.04, **arm64 native**, no emulation) |
| Host | Apple **M1**, 8 cores, 16 GB, macOS 26.5.2, Docker Desktop |
| Threading | `OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1` |
| Metric | **CPU time** (`user+sys` from `/usr/bin/time`, min over reps), plus xtb's own per-section `cpu-time` |
| Reps | 5 × single-point, 2 × opt, 2 × Hessian, in two independent runs (run 1 + run 2), best taken |
| wasm cross-check | `@peterspackman/occjs` **0.9.3** under **node v26.0.0** |

**Why CPU time, not wall time.** The machine was shared with a concurrent wasm
cross-compile. Wall time was inflated by up to 60 % (xtb's own `ratio c/w` fell to
0.60 in run 1); single-threaded CPU time is essentially immune to that. Run 1 is
kept in `raw_run1/` as an independent replicate; run 2 (quieter machine) supplies
most of the minima. Where the two runs disagree the spread is ≤ 35 % and always in
the direction of run 1 being slower.

### Stages

| stage | command | what it is |
|---|---|---|
| `sp` | `xtb in.xyz --gfn 2 --grad` | one SCF energy + analytic gradient |
| `opt` | `xtb in.xyz --gfn 2 --opt` | ANC geometry optimisation (1 gradient per cycle) |
| `hess` | `xtb opt.xyz --gfn 2 --hess` | two-sided numerical Hessian on the optimised geometry |

The Hessian is the IR calculation: `src/type/calculator.f90:151-186` loops
`atom × {x,y,z} × {+step,−step}` = **exactly 6N gradient evaluations** after the
one reference single point, and fills `dipgrad` from the SCF dipole at each
displaced point in the same loop. IR intensities therefore cost **nothing extra**
on top of the Hessian — confirmed by reading the source, and consistent with the
timings below.

---

## 2. Native results (23 molecules, N = 3 … 98)

Full table: `results/native_summary.csv`. Selected rows, all times in **CPU
seconds on one M1 core**:

| molecule | N | nao | SCC it | 1 gradient (cold) | opt (cycles) | Hessian | Hessian / 1 sp |
|---|---:|---:|---:|---:|---:|---:|---:|
| water | 3 | 6 | 8 | 0.002 | 0.001 (4) | **0.009** | 19 |
| benzene | 12 | 30 | 7 | 0.005 | 0.021 (4) | **0.30** | 73 |
| aspirin | 21 | 60 | 12 | 0.032 | 0.224 (10) | **3.10** | 88 |
| caffeine | 24 | 66 | 12 | 0.050 | 0.185 (7) | **3.70** | 88 |
| ibuprofen | 33 | 78 | 12 | 0.055 | 0.525 (16) | **6.01** | 122 |
| estradiol | 44 | 104 | 11 | 0.131 | 0.764 (12) | **16.8** | 160 |
| sucrose | 45 | 114 | 10 | 0.138 | 4.36 (60) | **18.2** | 167 |
| alkane C16H34 | 50 | 98 | 8 | 0.080 | 0.314 (5) | **12.9** | 183 |
| sildenafil | 63 | 168 | 14 | 0.307 | 9.42 (51) | **57.9** | 192 |
| cholesterol | 74 | 158 | 11 | 0.222 | 3.31 (20) | **57.9** | 264 |
| betacarotene | 96 | 216 | 12 | 0.444 | 25.3 (83) | **158.7** | 349 |
| alkane C32H66 | 98 | 194 | 8 | 0.264 | 2.15 (10) | **105.3** | 423 |

Two facts stand out.

**(a) The 6N+1 count is confirmed, with a warm-start discount.** Dividing the
Hessian kernel time by 6N gives the cost of one *displaced* gradient. It is
consistently **0.5–0.7 ×** the cost of a cold single point, because each displaced
point restarts from the converged reference wavefunction (`chk0` is passed into
`hessian_point`) and so needs fewer SCC iterations. The measured
`Hessian / single-point` ratio is therefore ≈ 0.6 × (6N+1), not (6N+1) — e.g.
betacarotene 349 vs 577, estradiol 160 vs 265, alkane C32 423 vs 589. The *count*
model is exactly right; the *per-gradient price* is 40 % off the sticker.

**(b) The optimisation is almost free compared with the Hessian**, but its cost is
dominated by cycle count, which is a property of the input geometry, not of N.
Measured drug-like cycle counts: median **7**, range **4 – 83** (sucrose 60,
sildenafil 51, betacarotene 83 — floppy molecules with many rotatable bonds; the
idealised alkane inputs converge in 4–10). Per cycle the cost is the same
warm-started gradient as in the Hessian.

---

## 3. Empirical scaling — it is **not** N⁴ in this size range

Log–log least squares (`results/scaling_fits.csv`), fitted on N ≥ 20 so the
sub-10-ms points do not dominate:

| quantity | vs N | r² | vs nao | r² |
|---|---|---|---|---|
| one cold SCF + gradient | N<sup>1.93</sup> | 0.83 | **nao<sup>2.15</sup>** | 0.97 |
| one warm displaced gradient | N<sup>1.78</sup> | 0.89 | **nao<sup>1.93</sup>** | 0.99 |
| numerical Hessian (kernel) | N<sup>2.78</sup> | 0.95 | **nao<sup>2.93</sup>** | 0.99 |
| optimisation (kernel) | N<sup>2.71</sup> | 0.64 | nao<sup>3.17</sup> | 0.82 |

Fitting all 23 molecules instead gives the same picture (gradient N<sup>1.81</sup>,
Hessian N<sup>2.89</sup>).

**The fitted exponent for a single GFN2 energy+gradient is ≈ 2, not 3.** Up to
nao ≈ 220 the O(nao³) dense diagonalisation (`dsygst`+`dsyevd`+`dtrsm`,
`src/mctc/lapack/eigensolve.f90:230-244`) is *not* the dominant term — its
prefactor is small enough that the O(nao²) Fock build / integral work still wins.
A direct microbenchmark of exactly that LAPACK triple (`scripts/lapack_micro.f90`,
`raw/lapack_micro.csv`) puts the diagonalisation at **16 % of a cold SCF at
nao = 104, 26 % at nao = 168, 42 % at nao = 216** (`results/diag_share.csv`).

So the total IR cost is **6N × nao<sup>1.9</sup> ≈ N<sup>2.9</sup>**, and it will
drift towards N⁴ only above roughly nao ≈ 250–300 (N ≳ 110 drug-like), where the
cubic diagonalisation takes over. **Do not model this workload as N⁴ at the sizes
ir.cheminfo.org cares about — that over-predicts by a large factor.**

### The cost model

Because nao/N varies from 1.75 (saturated hydrocarbon) to 2.86 (aromatic,
heteroatom-rich), nao is a far better predictor than N. The model used below is

```
t_gradient(nao) = 7.397e-6 · nao^1.934      [CPU s, one M1 core]
t_hessian(nao)  = 2.057e-5 · nao^2.928      [CPU s]  (= 6N warm gradients + assembly)
t_opt(nao)      = n_cycles · t_gradient(nao),   n_cycles: median 7, p90 51
nao             ≈ 2.0·N (aliphatic) / 2.4·N (drug-like) / 2.8·N (aromatic-rich)
```

Validation against every measured molecule is in `results/model_check.csv`:
**within ±20 % for all N ≥ 18**, ±10 % for most.

---

## 4. Extrapolation to the browser

Applying the established **2.4–5.5× wasm penalty** (single-threaded, no SIMD,
identical code) to the native model, for a drug-like composition (nao = 2.4 N):

| N | nao | native opt+Hess | wasm **low** (2.4×) | wasm **high** (5.5×) | verdict |
|---:|---:|---:|---:|---:|---|
| 10 | 24 | 0.25 s | 0.6 s | 1.4 s | interactive |
| 20 | 48 | 1.8 s | 4.4 s | 10 s | interactive |
| 30 | 72 | 5.8 s | 14 s | **32 s** | interactive → borderline |
| 40 | 96 | 13.4 s | **32 s** | **74 s** | past interactive |
| 50 | 120 | 25.7 s | 62 s | 141 s | slow |
| 60 | 144 | 43.7 s | 105 s | 240 s | slow |
| 80 | 192 | 101 s | 242 s | **556 s** | impractical at the high end |
| 100 | 240 | 194 s | 465 s | **1064 s** | impractical |

Thresholds: **>30 s = no longer interactive**, **>300 s (5 min) = impractical**.

* **Interactive boundary (30 s):** N ≈ **29** pessimistic (5.5×), N ≈ **39**
  optimistic (2.4×).
* **Impractical boundary (5 min):** N ≈ **65** pessimistic, N ≈ **86** optimistic.
* The optimisation is a rounding error for a typical molecule (**<5 s wasm at
  N=60**) but can add 25–60 s of wasm time for a floppy 60–100-atom molecule with
  50–80 optimisation cycles — see `opt_p90_cycles` rows in
  `results/extrapolation.csv`.
* Aliphatic (nao=2.0 N) is ~1.7× cheaper than the drug-like row, aromatic-rich
  (nao=2.8 N) ~1.6× more expensive. All three are tabulated.

### An extra risk factor the 2.4–5.5× band does not cover: BLAS

The native reference above links **OpenBLAS**. A wasm build will almost certainly
link **reference netlib LAPACK/BLAS** instead. Measured on the exact
`dsygst`+`dsyevd`+`dtrsm` sequence xtb runs per SCC iteration (arm64, 1 thread):

| n | OpenBLAS | reference netlib | ratio |
|---:|---:|---:|---:|
| 100 | 1.70 ms | 3.38 ms | 1.99× |
| 150 | 4.07 ms | 10.19 ms | 2.51× |
| 200 | 8.73 ms | 22.31 ms | 2.56× |
| 300 | 58.99 ms | 68.01 ms | 1.15× |

Folded through the measured diagonalisation share, that is an **extra 1.15–1.40×
on the whole calculation** at nao 60–216 (`results/diag_share.csv`), on top of the
wasm penalty — *unless* the wasm-penalty figure was itself derived against a
reference-LAPACK native baseline, in which case it is already included. Worth
pinning down before quoting a single number.

---

## 5. Cross-check with a real wasm GFN2 today: `@peterspackman/occjs`

`@peterspackman/occjs` 0.9.3 is OCC's **independent C++17 reimplementation** of
GFN2-xTB compiled to WebAssembly. This is an **implementation-to-implementation**
comparison, **not** a port-to-port one: it does not tell us what *xtb* compiled to
wasm will cost, only what *a* competent GFN2 in wasm costs today.

It is a fair workload comparison, though: `calc.vibrationalModes(0.005, true)` is
also a 6N central-difference numerical Hessian — the measured
`hess / singlePoint` ratio tracks 6N+1 to within ~±30 % for every molecule above
N=20. And the energies agree with xtb: **1×10⁻⁶ to 5×10⁻⁵ Eh** on identical
geometries (water −5.070544 vs −5.070544; estradiol −58.975724 vs −58.975775).

Full numerical Hessian, `results/occjs_compare.csv`:

| molecule | N | nao | occjs **wasm** | xtb **native** | ratio |
|---|---:|---:|---:|---:|---:|
| caffeine | 24 | 66 | 3.48 s | 3.70 s | **0.94×** |
| ibuprofen | 33 | 78 | 7.87 s | 6.01 s | 1.31× |
| estradiol | 44 | 104 | 17.8 s | 16.8 s | 1.06× |
| sucrose | 45 | 114 | 22.2 s | 18.2 s | 1.21× |
| alkane C16 | 50 | 98 | 16.4 s | 12.9 s | 1.28× |
| alkane C20 | 62 | 122 | 32.1 s | 28.6 s | 1.12× |
| sildenafil | 63 | 168 | 91.6 s | 57.9 s | **1.58×** |
| cholesterol | 74 | 158 | 88.5 s | 57.9 s | **1.53×** |
| alkane C32 | 98 | 194 | 136.3 s | 105.3 s | 1.30× |
| betacarotene | 96 | 216 | 264.4 s | 158.7 s | **1.67×** |

Median **1.12×** over the 15 molecules with N ≥ 20 (range 0.79–1.67), and
**1.1–1.7×** for the six cases with N ≥ 60. Every
molecule in the set completed, up to 98 atoms, inside node 26 on one thread.

**This is much better than the 2.4–5.5× band.** Read it as an existence proof, not
as a prediction for xtb-wasm: OCC is C++ with Eigen (which emscripten vectorises
and inlines well) against xtb's Fortran through flang-wasm, and OCC's own native
build may well be slower than xtb's. The honest reading is that **a browser GFN2
Hessian at 1.5–2× native is demonstrably achievable**; whether the *xtb port* lands
there or at 5× is exactly what the cross-compile workflow has to settle.

### Does occjs expose IR intensities? **No.**

Exhaustively probed all 229 embind classes for `/dipol|intens|infrar|polariz|raman/i`
(`scratchpad/occjs-bench/probe_ir.mjs`). Complete result:

* `XtbCalculator` — `singlePoint, singlePointEnergy, totalEnergy, energyAndGradient,
  gradient, gradientNumerical, hessian, vibrationalModes, charges, bondOrders,
  atomicMagnetization, dispersionEnergy, repulsionEnergy, sccEnergy, spinEnergy,
  setSolvent, updateStructure, toWavefunction, toMolecule, toCrystal, printSummary,
  maxIterations, mixerDamping, temperature, …` — **no dipole, no dipole gradient.**
* `XtbResult` — `totalEnergy, sccEnergy, repulsionEnergy, dispersionEnergy,
  electronicEntropyEnergy, spinEnergy, atomicCharges, shellCharges, densityMatrix,
  orbitalCoefficients, orbitalEnergies, orbitalOccupations, overlapMatrix,
  nIterations, converged, …` — **no dipole moment.**
* `VibrationalModes` — `frequenciesCm, frequenciesHartree, frequenciesString,
  getAllFrequencies, normalModes, normalModesString, hessian, massWeightedHessian,
  nAtoms, nModes, summaryString` — **frequencies and normal modes only, no
  intensities.**
* The only `intensity` symbols in the whole module are `PowderPeak.intensity` and
  `PowderPattern.normalizedIntensities` — **X-ray powder diffraction**, unrelated.
  `Operator.Dipole` exists as an integral-operator enum on the ab-initio (HF/DFT)
  side and is not reachable from the xTB path.

So occjs gives **frequencies but no IR spectrum**. The only thing it exposes that
could stand in is `XtbResult.atomicCharges` — a Mulliken point-charge dipole
differentiated numerically. That is not GFN2's true SCF dipole (it drops the
atomic-dipole and quadrupole terms of GFN2's anisotropic electrostatics), so
intensities from it would be qualitatively wrong. **occjs cannot replace xtb for
ir.cheminfo.org**; that is the whole reason the xtb port matters.

---

## 6. Memory

Peak RSS, native xtb, `/usr/bin/time -f %M`:

| molecule | N | nao | single point | Hessian |
|---|---:|---:|---:|---:|
| water | 3 | 6 | 20.4 MB | 20.7 MB |
| estradiol | 44 | 104 | 24.5 MB | 25.7 MB |
| sildenafil | 63 | 168 | 28.6 MB | 31.0 MB |
| cholesterol | 74 | 158 | 28.9 MB | 32.1 MB |
| betacarotene | 96 | 216 | 34.6 MB | **39.2 MB** |

**Memory is a non-issue.** Peak is under 40 MB at 96 atoms, and the growth above
the ~20 MB floor of xtb's static parameter tables is only ~200 kB per atom. The dominant arrays are nao² (216² × 8 B = 373 kB) and the
(3N)² Hessian (288² × 8 B = 663 kB); everything else is xtb's static parameter
tables. `occjs` in node peaks at 122 MB RSS for the same 96-atom Hessian, but most
of that is node itself plus the 21 MB wasm module.

**Budget for the wasm build: 256 MB of linear memory is generous, 128 MB is
probably enough for N ≤ 100.** Do not use `-sALLOW_MEMORY_GROWTH` as a substitute
for sizing — pre-size the heap, because growth reallocates and copies. The binary
size (xtb's parameter data + LAPACK) will matter more than the runtime heap.

---

## 7. Verdict for ir.cheminfo.org

Today's service (`cheminfo-py/xtbservice`) caps GFN2 at
**`MAX_ATOMS_XTB = 60`** with **`TIMEOUT = 100`** seconds
(`xtbservice/settings.py`), and gets there through ASE's `Infrared`, i.e. 6N+1
separate xtb-python single points from Python — strictly more overhead than xtb's
own internal loop.

Native xtb on one M1 core does opt+Hessian for a 60-atom drug-like molecule in
**~44 s**, which is why a 100 s server timeout at 60 atoms is a sane cap. In the
browser, single-threaded:

| N | what the user experiences (wasm, 2.4–5.5×) |
|---|---|
| **≤ 20** | 4–10 s. Genuinely interactive. Type a SMILES, get a spectrum. |
| **20–30** | 8–32 s. Still interactive at the optimistic end; needs a progress bar at the pessimistic end. |
| **30–40** | 14–74 s. "Submit and wait" territory. Needs a web worker, a cancel button, and a progress indicator driven by displacement count (i / 6N — the loop is trivially instrumentable). |
| **40–60** | 32–240 s. At the pessimistic end this is worse than the current server. Only worth offering because it costs cheminfo nothing to run. |
| **> 60** | 105 s – 18 min. Do not offer; keep the existing 60-atom cap. |

**Recommendation.**

1. **Ship the browser path with the same 60-atom cap the server already has.** The
   cap is defensible on physics, not just on server budget, and it means no user-
   visible regression.
2. **Set the "instant" expectation at 30 atoms** — that covers most of what a
   teaching app throws at an IR tool (benzene, phenol, aspirin, caffeine,
   ibuprofen all land under 10 s wasm).
3. **Always report progress as `i / 6N` displacements.** The work is a flat loop of
   6N identical steps, so a truthful progress bar and a cancel button are nearly
   free, and they change the perceived cost of the 35–60 atom band completely.
4. **Optimise on the client only when the input geometry is poor.** Optimisation is
   <5 s wasm for a typical 60-atom molecule but can be 25–60 s for a floppy one;
   accepting a pre-optimised geometry (or capping `--opt` cycles) removes the worst
   tail.
5. **The single biggest lever is threading, not the compiler.** The Hessian loop is
   `!$omp do collapse(2)` over independent displacements — embarrassingly parallel.
   With 4 wasm threads (SharedArrayBuffer + cross-origin isolation) the 60-atom case
   drops from 105–240 s to roughly **26–60 s**, and the interactive boundary moves
   from N≈29–39 to N≈47–63. If cross-origin isolation is achievable on
   ir.cheminfo.org, that is worth more than any amount of scalar tuning.
6. **Second lever: SIMD.** These numbers assume no SIMD. `-msimd128` typically buys
   1.3–2× on dense linear algebra and would move the same boundary by ~10 atoms.
7. **Do not spend effort on a faster eigensolver below nao ≈ 150.** The measured
   diagonalisation share is only 16–26 % there. Above nao ≈ 200 (N ≳ 85) it becomes
   the dominant term and a good BLAS starts to matter — but that is already outside
   the range worth serving.

---

## 8. Files

```
mol/                     23 input geometries (.xyz) + their xtb-optimised counterparts (*_opt.xyz)
scripts/native_bench.sh  runs sp/opt/hess in the container, one CSV row per (molecule, stage, rep)
scripts/run_all.sh       driver: 3 passes (sp ×5, opt ×2, hess ×2) so reps are spread in time
scripts/occjs_bench.mjs  the same molecules through @peterspackman/occjs in node
scripts/lapack_micro.f90 dsygst+dsyevd+dtrsm microbenchmark, OpenBLAS vs reference netlib
scripts/analyse.py       builds results/ from raw/ — run it before reading the tables
                         cited above; only results/diag_share.csv is committed

results/diag_share.csv   share of the time spent in diagonalization, per basis size

raw/native_raw.csv       run 2, one row per (molecule, stage, rep)   <- primary
raw_run1/native_raw.csv  run 1, independent replicate (noisier machine)
raw/<mol>.<stage>.log    full xtb output, including its own per-section cpu-time
raw/occjs_raw.csv        occjs timings
raw/occjs_run.log        occjs console log
raw/lapack_micro.csv     BLAS microbenchmark
raw/run2.driver.log      console log of the native sweep

results/native_summary.csv   per molecule: nao, nshell, nel, times per stage, cost per gradient, RSS
results/scaling_fits.csv     80 log-log power-law fits (5 subsets × 8 series × {N, nao})
results/model_check.csv      model vs measured Hessian time for all 23 molecules
results/extrapolation.csv    N = 10..100 × 3 compositions × 6 stages, native + wasm low/high
results/diag_share.csv       diagonalisation share of the SCF, and the reference-LAPACK penalty
results/occjs_compare.csv    occjs wasm vs xtb native, same geometries
results/cost_model.json      everything above in one JSON
```

Reproduce:

```sh
docker run --rm -v "$PWD":/work -w /work xtbnat:bench bash /work/scripts/run_all.sh
node scripts/occjs_bench.mjs water methanol ... > raw/occjs_raw.csv   # needs @peterspackman/occjs
python3 scripts/analyse.py
```

## 9. Caveats

* Single machine, single architecture (Apple M1 / arm64). Absolute times on an
  x86-64 server or a low-end laptop will differ; the **exponents and ratios** are
  the transferable part.
* The machine was shared during run 1. CPU time was used throughout for exactly
  this reason, and both runs are kept so the spread is visible.
* Optimisation cycle counts depend entirely on input geometry quality. The
  alkane inputs were generated near-ideal and converge in 4–10 cycles; the
  drug-like inputs range 5–83. Treat the median-7 and p90-51 rows as a band, not
  a prediction for a specific molecule.
* The 2.4–5.5× wasm penalty is taken as given from the other workflow; nothing
  here measures it. What is measured here is the native baseline it multiplies,
  and one independent wasm GFN2 datapoint (occjs, 0.8–1.7×) that suggests the band
  may be pessimistic for this workload.
* `occjs` is a different program. Its numbers bound what wasm GFN2 *can* do; they
  do not predict what `xtb` compiled to wasm *will* do.
