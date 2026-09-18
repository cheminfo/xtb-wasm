## 1. Build environment

| | |
|---|---|
| Image | `xtbnat:base` (Dockerfile saved as `scripts/Dockerfile.xtbnat`) |
| Base | `ubuntu:24.04` (24.04.4 LTS), aarch64 (Docker Desktop / Apple Silicon) |
| Toolchain | gfortran 13.3.0, meson 1.3.2, ninja 1.11.1 |
| LAPACK | OpenBLAS (`libopenblas.so.0`, openblas-pthread) |
| Sources | `/…/scratchpad/xtb` @ `a45f05d` (v6.7.1), deps from `/…/scratchpad/deps` |
| Threads | `OMP_NUM_THREADS=1` throughout |

Four configurations. A and B are the two requested; C and D exist only to measure numerical spread.

| id | purpose | `meson setup` options | configure+compile |
|---|---|---|---|
| **A** | default | `--buildtype=release -Dlapack=openblas` | ~8 min |
| **B** | wasm-shaped | `--buildtype=release -Dlapack=openblas -Dopenmp=false -Dtblite=disabled -Dcpcmx=disabled` | ~6 min |
| C | LAPACK swap | as B but `-Dlapack=netlib`, run with `LD_LIBRARY_PATH=/usr/lib/aarch64-linux-gnu/lapack:/usr/lib/aarch64-linux-gnu/blas` forcing reference LAPACK 3.12 + reference BLAS | — |
| D | FP perturbation | as C plus `-Doptimization=1 -Dfortran_args="-ffp-contract=off -fno-unsafe-math-optimizations"` | — |

Note: Ubuntu's `liblapack.so.3` alternative points at OpenBLAS, so `-Dlapack=netlib` alone does **not** give you netlib. The genuine reference implementation had to be forced via `LD_LIBRARY_PATH` (plus installing `libblas3`); verified with `LD_DEBUG=libs`.

## 2. Test-suite baseline

Machine-readable in `testsuite/baseline.json`; raw meson text/JSON-lines/JUnit logs in `testsuite/`.

### 2.1 The number that matters — xtb's own tests

Command: `OMP_NUM_THREADS=1 meson test -C <builddir> --suite xtb`

| configuration | targets | OK | expected fail | fail | skip | repeats | deterministic |
|---|---|---|---|---|---|---|---|
| A default | 35 | 34 | 1 | 0 | 0 | 3 | yes |
| B wasm-shaped | 35 | 34 | 1 | 0 | 0 | 3 | yes |

The expected failure is `xtb / Argparser no arguments` (declared `should_fail` in `test/meson.build`; xtb exits 1 with no args). Every other target in the build belongs to a bundled third-party subproject.

### 2.2 Configuration A — default

```
meson setup _build_default --buildtype=release --prefix=/opt/install-A -Dlapack=openblas
ninja -C _build_default
OMP_NUM_THREADS=1 meson test -C _build_default --print-errorlogs
```
**216 targets — 195 OK, 10 expected fail, 1 fail, 10 skip. Wall clock 97.2 s.**

| project | targets | OK | xfail | fail | skip | s |
|---|---|---|---|---|---|---|
| xtb | 6 | 5 | 1 | | | 0.4 |
| xtb:unit | 29 | 29 | | | | 27.0 |
| tblite:cli | 57 | 50 | 7 | | | 6.6 |
| tblite:unit | 32 | 32 | | | | 17.9 |
| mctc-lib | 32 | 32 | | | | 1.7 |
| dftd4 | 23 | 12 | 1 | | 10 | 10.8 |
| toml-f | 10 | 10 | | | | 0.1 |
| s-dftd3:app | 7 | 6 | 1 | | | 0.2 |
| s-dftd3:unit | 7 | 7 | | | | 24.1 |
| multicharge | 3 | 2 | | **1** | | 5.1 |
| test-drive | 3 | 3 | | | | 0.1 |
| cpx | 2 | 2 | | | | 1.2 |
| cpx:unit | 2 | 2 | | | | 0.1 |
| numsa | 2 | 2 | | | | 0.0 |
| jonquil:unit | 1 | 1 | | | | 0.1 |

Two findings that matter for "all tests must pass":

- **The one FAIL is not xtb's.** `multicharge / pbc` → subtest `eeqbc-sigma-ice`: an analytic strain derivative vs numerical gradient, largest element off by `1.6e-8` on values of order 24 (relative `6e-10`) against an upstream tolerance set too tightly for this compiler/arch. Deterministic, in a bundled dependency, and **absent from the wasm-shaped build**.
- **The 10 SKIPs are a missing Python module.** All ten are dftd4 `app-*` tests driven by `subprojects/dftd4/app/tester.py`, whose first statement is `try: import … pytest / except ImportError: exit(77)` (77 = meson's skip code). Installing `python3-pytest` converts all ten to passes: **216 targets — 204 OK, 10 xfail, 2 fail, 0 skip, 64.7 s** (serial).

That serial re-run exposed a **second, order-dependent failure**: `numsa / cds`. Root-caused precisely — an earlier xtb CPCM-X test writes a solvent-parameter file `smd_h2o` into the shared build directory, and numsa's `cds` test then reads that stale file instead of its own data. Verified directly: the numsa tester exits 0 in a pristine directory and exits 1 in a directory containing nothing but a copy of `smd_h2o`. Test-harness pollution, order-dependent, and numsa is not built in the wasm-shaped configuration.

### 2.3 Configuration B — wasm-shaped

```
meson setup _build_wasmshape --buildtype=release --prefix=/opt/install-B \
  -Dlapack=openblas -Dopenmp=false -Dtblite=disabled -Dcpcmx=disabled
ninja -C _build_wasmshape
OMP_NUM_THREADS=1 meson test -C _build_wasmshape --print-errorlogs
```
**81 targets — 80 OK, 1 expected fail, 0 fail, 0 skip. Wall clock 47.4 s** (26.5 s with `--num-processes 1`).

| project | targets | OK | xfail | s |
|---|---|---|---|---|
| xtb | 6 | 5 | 1 | 0.5 |
| xtb:unit | 29 | 29 | | 40.8 |
| mctc-lib | 32 | 32 | | 3.0 |
| toml-f | 10 | 10 | | 0.3 |
| test-drive | 3 | 3 | | 0.1 |
| jonquil:unit | 1 | 1 | | 0.0 |

**Zero failures, zero skips — this is the better CI gate for the port.**

### 2.4 Subtest-level self-skips

| configuration | subtests | passed | skipped |
|---|---|---|---|
| A default | 135 | 134 | 1 |
| B wasm-shaped | 119 | 104 | 15 |

A skips exactly one: `eeq / hbond` — `Not implemented` (genuine upstream gap).

B skips 15 — that one plus 14 skipped **by construction**, each naming its own reason: 11 × `tblite/*` and `ptb/ptb_not_present` (`xtb not compiled with tblite support`), `dipro / J_ab,eff` (`tblite libary not available.`), `cpx / solvation` (`CPCM-X libary not available.`).

The inventory also shifts: PTB is built on tblite, so A runs 17 real `ptb` subtests which B replaces with a single guard — 135 − 17 + 1 = 119, exactly. **None of the 15 skips touches the GFN2 IR path**; GFN2 through xtb's own calculators is covered by `xtb:unit / gfn2` and `xtb:unit / hessian`, both passing in B.

## 3. Reference IR data set

Produced with configuration B, `OMP_NUM_THREADS=1`. Geometries: SMILES → `obabel --gen3d` (3.1.1) → `xtb --opt --gfn 2` → `xtb --ohess --gfn 2`.

| molecule | formula | N | E (Eh) | modes | imag | ν min | ν max | I max | opt s | ohess s | rounds | 6N+1 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| water | H2O | 3 | −5.070544 | 3 | 0 | 1538.90 | 3651.64 | 133.3 | 0.06 | 0.02 | 1 | 19 |
| methanol | CH4O | 6 | −8.226118 | 12 | 0 | 373.53 | 3558.03 | 152.3 | 0.14 | 0.10 | 1 | 37 |
| acetic acid | C2H4O2 | 8 | −14.450261 | 18 | 0 | 113.00 | 3501.57 | 578.2 | 0.04 | 0.35 | 1 | 49 |
| benzene | C6H6 | 12 | −15.879641 | 30 | 0 | 368.35 | 3092.47 | 123.6 | 0.12 | 1.01 | 1 | 73 |
| toluene | C7H8 | 15 | −19.050405 | 39 | 0 | 7.72 | 3090.12 | 124.3 | 0.08 | 3.98 | 3 | 91 |
| paracetamol | C8H9NO2 | 20 | −32.783628 | 54 | 0 | 44.39 | 3522.81 | 487.1 | 0.85 | 3.63 | 1 | 121 |
| aspirin | C9H8O4 | 21 | −39.623040 | 57 | 0 | 38.62 | 3382.96 | 676.8 | 0.68 | 5.77 | 1 | 127 |
| caffeine | C8H10N4O2 | 24 | −42.154507 | 66 | 0 | 39.60 | 3174.87 | 1002.3 | 0.35 | 29.37 | 4 | 145 |
| ibuprofen | C13H18O2 | 33 | −45.163317 | 93 | 0 | 24.15 | 3450.43 | 532.6 | 1.87 | 10.86 | 1 | 199 |
| cholesterol | C27H46O | 74 | −85.431013 | 216 | 0 | 15.51 | 3532.73 | 128.2 | 10.57 | 121.14 | 1 | 445 |

ν in cm⁻¹, I in km/mol. `6N+1` = the number of energy+gradient evaluations the two-sided FD Hessian needs. **All ten are true minima.** Toluene needed 3 `--ohess` rounds and caffeine 4 plus a displacement scan (methyl-rotor saddle points); each fixture records `provenance.hessian_rounds` and `saddle_escape_applied`. Total generation time 3 min 57 s.

At the 60-atom size class that matters to ir.cheminfo.org, cholesterol (74 atoms, 445 gradient evaluations) takes **121 s single-threaded** — the native floor the wasm build will be measured against.

Each fixture (schema `xtb-wasm/ir-reference/1`) carries: molecule identity, full provenance (version, exact meson options, exact commands, environment), input and optimized geometries, energies/enthalpy/free energy/ZPVE/G(RRHO), HOMO-LUMO gap, dipole, the 3N−6 frequencies and IR intensities (plus the unfiltered list), **Hessian invariants (Frobenius norm + trace of the full 3N×3N matrix)**, timings, a `tier1_hess_at_optimized_geometry` block, and a `validation` block.

## 4. Tolerances — three measured studies

### 4.1 Build / thread / LAPACK spread (`tolerance_study.json`)
All 10 molecules, 6 variants: reference; identical rerun; 4 BLAS threads; OpenMP build 1 thread; OpenMP build 4+4 threads; netlib reference LAPACK+BLAS. **Every delta exactly zero** — energy, frequency, intensity, absolute and relative.

The LAPACK axis is genuinely active: a `--grad` run on caffeine under the two backends gives gradient components differing at ≈1e-16 Eh/a₀, while the energy agrees to all 11 printed decimals and Mulliken charges are bit-identical. The noise exists; it never reaches a printed digit, because the SCF is a converged fixed point.

### 4.2 Floating-point reassociation (`fp_perturbation_study.json`)
Configuration D changes `-O3`→`-O1`, disables FMA contraction, and swaps LAPACK — different vectorisation, different FMA, different backend. Against B on all ten: energy, frequency and intensity deltas **all exactly zero**; Cartesian Hessian bit-identical for the eight smallest molecules, max element difference `1e-10` (one ULP of the printed value) for ibuprofen (9801 elements) and cholesterol (49 284).

Fixed-geometry `--hess` cross-check on 4 molecules: Hessian bit-identical for 3, 2-of-9801 elements differ for ibuprofen. **The only textual `vibspectrum` difference is the sign of the numerical-zero trans/rot rows (`-0.00` vs `0.00`).**

### 4.3 What actually moves the numbers (`input_sensitivity.json`)
Since the first two studies give a floor of zero and therefore no headroom guidance, this perturbs the input geometry by ε and runs the full pipeline (4 molecules × 2 seeds):

| ε (Å) | max ΔE (Eh) | max Δν (cm⁻¹) | max relative ΔI (peaks > 1 km/mol) |
|---|---|---|---|
| 1e−8 | 1.6e−11 | 0.00 | 1.1e−4 |
| 1e−6 | 1.6e−9 | 0.04 | 1.1e−2 |
| 1e−4 | 1.9e−6 | **19.34** | **0.53** |

**The geometry, not the arithmetic, is the risk.** The ANC optimizer stops around gnorm ≈ 2e-4, so builds taking different optimizer paths can land on geometries differing at 1e−4 Å — worth ~20 cm⁻¹ on a soft torsion and tens of percent on IR intensities. IR intensities are consistently the most sensitive quantity.

### 4.4 Recommended assertions (`tolerances.json`)

**Tier 1 — fixed geometry (the real test).** Run `--hess` (not `--ohess`) from `fixtures[*].optimized_geometry_xyz`, compare against `fixtures[*].tier1_hess_at_optimized_geometry`.

| quantity | tolerance | basis |
|---|---|---|
| total energy | 1e−8 Eh abs | native spread 0 at 1e−12 print precision; still 1e5× tighter than chemical accuracy |
| frequencies | 0.5 cm⁻¹ abs | native spread 0.00; 50× print precision, 12× the 1e−6 Å response, ~60× tighter than GFN2's error vs experiment |
| IR intensities > 1 km/mol | 2 % relative | most sensitive quantity; smallest value not dominated by geometry noise |
| IR intensities ≤ 1 km/mol | 0.05 km/mol abs | relative tests on near-zero intensities are meaningless |
| Hessian Frobenius norm, trace | 1e−6 relative | rotation-invariant, catches IR-silent modes; per-element agreement measured at 1e−10 |
| imaginary mode count | exact (0) | all fixtures are true minima |
| mode count | exact (3N−6) | mismatch means the trans/rot projection differs |

**Tier 2 — full `--ohess` pipeline** (what ir.cheminfo.org does): energy 1e−5 Eh; frequencies ≥500 cm⁻¹ within 5 cm⁻¹; frequencies <500 cm⁻¹ within 25 cm⁻¹; intensities >5 km/mol within 50 % relative; imaginary count exact. Only for molecules with `validation.tier2_single_ohess_reaches_minimum: true`.

**Comparison rules:** never byte-compare `vibspectrum`; drop |ν| < 0.01 cm⁻¹; sort frequencies ascending before element-wise comparison (benzene has near-degenerate modes); match intensities by sorted frequency index; fixtures are aarch64-only.

## 5. Validation harness and two protocol findings

`scripts/validate.py` implements both tiers.
```
python3 scripts/validate.py /path/to/xtb            # tier 1, all 10 fixtures
python3 scripts/validate.py /path/to/xtb --tier 2
```

| build | tier | result |
|---|---|---|
| B (produced the fixtures) | 1 | **PASS 10/10** — every delta exactly 0 |
| D (−O1, no FMA, netlib LAPACK) | 1 | **PASS 10/10** — every delta exactly 0 |
| B | 2 | **PASS 8/8**, 2 skipped |
| D | 2 | **PASS 8/8**, 2 skipped |

That D — differing from B in optimization level, FMA contraction *and* linear-algebra backend — reproduces the fixtures exactly is the strongest available evidence the tolerances are neither unmeetable nor toothless.

Two findings the harness surfaced, both now encoded in the fixtures:

1. **`--ohess` does not build its Hessian at the geometry it writes out.** The first harness version failed on ibuprofen and cholesterol *with the binary that produced the fixtures*. Running `--hess` at the stored coordinates moves the energy by ≤3.2e−11 Eh and frequencies by ≤0.06 cm⁻¹ but **IR intensities by up to 16 %** (cholesterol mode 204: 12.96 vs 11.17 km/mol). Fixed by adding a `tier1_hess_at_optimized_geometry` block to every fixture, generated by the exact tier-1 protocol.
2. **Toluene and caffeine cannot be used for tier 2.** A single `--ohess` from the raw geometry stops at a methyl-rotor saddle (ν₁ = −25.67 and −64.99 cm⁻¹). A property of the GFN2 surface, not of any build — flagged as `validation.tier2_single_ohess_reaches_minimum: false` and skipped with an explicit message.

## 6. Where the fixtures live

`/Users/lpatiny/git/cheminfo/xtb-wasm/experiments/reference/` — 61 files, 1.9 MB.

```
README.md                    full write-up (all tables above, reproduction instructions)
fixtures/                    10 molecule JSONs + index.json   <- the validation fixtures
geometries/                  raw Open Babel structures (tier-2 inputs)
tolerances.json              recommended assertions with justifications
tolerance_study.json         build/thread/LAPACK spread
fp_perturbation_study.json   -O1 / no-FMA / netlib vs reference
input_sensitivity.json       geometry-perturbation response
testsuite/baseline.json      machine-readable suite table for both configurations
testsuite/{A,A2,B}_*         meson console + full logs (gz) + subtest TSVs
testsuite/{A,B,C,D}_configure.log
logs/                        4 data-generation + 4 validation transcripts
scripts/                     validate.py + every generation script + Dockerfile.xtbnat
```

Docker state left intact: `xtbnat:base`, `xtbnat:bench`, container `xtbnat-run` still running (with builds A/B/C/D under `/opt/work` and fixtures at `/ref`). The concurrent `xtbwasm` container and flang-wasm images were not touched.