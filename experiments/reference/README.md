# Native xtb 6.7.1 reference: test-suite baseline and IR validation fixtures

This directory is the **native reference** that the wasm build of xtb is judged
against. It answers two questions:

1. **What does "all the tests of the original project pass" actually mean?**
   Which meson targets exist, which pass, which self-skip and why — for the
   default build and for the wasm-shaped build.
2. **What must a wasm GFN2 IR calculation reproduce, and to what tolerance?**
   Ten molecules from 3 to 74 atoms with full frequency and IR-intensity data,
   plus a measured justification for every tolerance.

**Where the data lives.** The fixtures and `tolerances.json` are the ones the
package ships, and `src/reference/` is their single canonical copy — it is what
`xtb-wasm/reference` exports, what the unit tests read and what `validate.py`
runs against. This directory holds the provenance instead: the container and the
scripts that produced them, the raw geometries, the run logs, the test-suite
baseline and the three spread studies behind every tolerance. Regenerating the
data means writing into `src/reference/`.

Everything here was produced from `grimme-lab/xtb` at commit **`a45f05d`**
(v6.7.1) inside the `xtbnat:base` Docker image.

## Build environment

| | |
|---|---|
| Image | `xtbnat:base` (see `scripts/Dockerfile.xtbnat`) |
| Base | `ubuntu:24.04` (Ubuntu 24.04.4 LTS) |
| Arch | `aarch64` — Docker Desktop on Apple Silicon |
| Kernel | `Linux 6.12.76-linuxkit-aarch64`, glibc 2.39 |
| Compiler | GNU Fortran 13.3.0 |
| Build | meson 1.3.2, ninja 1.11.1 |
| LAPACK | OpenBLAS (`libopenblas.so.0`, openblas-pthread) |
| Threads | `OMP_NUM_THREADS=1` everywhere |

Four configurations were built. A and B are the two the task asked for; C and D
exist only to measure numerical spread.

| id | purpose | `meson setup` options |
|---|---|---|
| **A** | default | `--buildtype=release -Dlapack=openblas` |
| **B** | wasm-shaped | `--buildtype=release -Dlapack=openblas -Dopenmp=false -Dtblite=disabled -Dcpcmx=disabled` |
| C | LAPACK swap | as B but `-Dlapack=netlib`, run with `LD_LIBRARY_PATH` forcing reference LAPACK 3.12 + reference BLAS |
| D | FP perturbation | as C plus `-Doptimization=1 -Dfortran_args="-ffp-contract=off -fno-unsafe-math-optimizations"` |

---

## 1. Test-suite baseline

Machine-readable: **`testsuite/baseline.json`**. Raw meson logs (text, JSON-lines
and JUnit) are in `testsuite/`, gzipped where large.

### 1.1 The number that matters: xtb's own tests

Every target outside the `xtb` and `xtb:unit` meson suites belongs to a bundled
third-party subproject (tblite, dftd4, multicharge, mctc-lib, toml-f, s-dftd3,
numsa, cpx, test-drive, jonquil). Disabling tblite and cpcmx removes most of
them from the build entirely, which is why the two configurations have wildly
different target counts. **xtb's own suite is identical in both:**

```
OMP_NUM_THREADS=1 meson test -C <builddir> --suite xtb
```

| configuration | targets | OK | expected fail | fail | skip | repeats | deterministic |
|---|---|---|---|---|---|---|---|
| A default | 35 | 34 | 1 | 0 | 0 | 3 | yes |
| B wasm-shaped | 35 | 34 | 1 | 0 | 0 | 3 | yes |

The single expected failure is `xtb / Argparser no arguments` — xtb exits 1 when
called with no arguments, and the test is declared `should_fail` in
`test/meson.build`. It is not a defect.

**Turning off OpenMP, tblite and CPCM-X costs xtb nothing at the target level.**
That is the headline result for the wasm port.

### 1.2 Full suite, configuration A (default)

```
meson setup _build_default --buildtype=release --prefix=/opt/install-A -Dlapack=openblas
ninja -C _build_default
OMP_NUM_THREADS=1 meson test -C _build_default --print-errorlogs
```

**216 targets — 195 OK, 10 expected fail, 1 fail, 10 skip. Wall clock 97.2 s.**

| project | targets | OK | expected fail | fail | skip | seconds |
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

**The one failure is not xtb's.** `multicharge / pbc` fails its
`eeqbc-sigma-ice` subtest: the analytic strain derivative is compared against a
numerical gradient and the largest element disagrees by `1.6e-8` on values of
order `24`, i.e. a relative `6e-10` against a tolerance the upstream subproject
set too tightly for this compiler and architecture. It is deterministic, it is
in a bundled dependency, and it is absent from the wasm-shaped build. Full
output is in `testsuite/A_testlog.txt.gz`.

**The 10 skips are a missing Python module, not a build limitation.** All ten are
dftd4 `app-*` tests driven by `subprojects/dftd4/app/tester.py`, whose first
statement is `try: import ... pytest / except ImportError: exit(77)`. Exit 77 is
meson's skip code. Installing `python3-pytest` turns all ten into passes:

```
216 targets — 204 OK, 10 expected fail, 2 fail, 0 skip. Wall clock 64.7 s.
(meson test --num-processes 1, python3-pytest installed)
```

**That serial re-run exposes a second, order-dependent failure**, recorded in
`testsuite/A2_test.log`. `numsa / cds` fails there but passed in the parallel
run. The cause is cross-subproject pollution of the shared build directory: an
earlier xtb CPCM-X test writes a solvent-parameter file named `smd_h2o` into the
build directory, and numsa's `cds` test then reads that stale file instead of its
own data. Verified directly — the numsa tester exits 0 in a pristine directory
and exits 1 in a directory that contains nothing but a copy of `smd_h2o`. It is a
test-harness artifact, it depends only on execution order, and numsa is not built
in the wasm-shaped configuration.

The 10 expected failures are all `noargs`-style CLI tests in dftd4, s-dftd3 and
tblite, plus xtb's own, all declared `should_fail`.

### 1.3 Full suite, configuration B (wasm-shaped)

```
meson setup _build_wasmshape --buildtype=release --prefix=/opt/install-B \
  -Dlapack=openblas -Dopenmp=false -Dtblite=disabled -Dcpcmx=disabled
ninja -C _build_wasmshape
OMP_NUM_THREADS=1 meson test -C _build_wasmshape --print-errorlogs
```

**81 targets — 80 OK, 1 expected fail, 0 fail, 0 skip. Wall clock 47.4 s**
(26.5 s with `--num-processes 1`).

| project | targets | OK | expected fail | seconds |
|---|---|---|---|---|
| xtb | 6 | 5 | 1 | 0.5 |
| xtb:unit | 29 | 29 | | 40.8 |
| mctc-lib | 32 | 32 | | 3.0 |
| toml-f | 10 | 10 | | 0.3 |
| test-drive | 3 | 3 | | 0.1 |
| jonquil:unit | 1 | 1 | | 0.0 |

**This configuration is clean: zero failures, zero skips.** It is the better CI
gate for the wasm port — no bundled-dependency noise.

### 1.4 Subtest-level self-skips

A meson *target* runs many *subtests* through the `test-drive` harness, and a
subtest can self-skip at run time via xtb's `skip_test`. Counts come from parsing
the harness output (`testsuite/{A,B}_subtests.tsv`).

| configuration | subtests | passed | skipped |
|---|---|---|---|
| A default | 135 | 134 | 1 |
| B wasm-shaped | 119 | 104 | 15 |

Configuration A skips exactly one, for a genuine upstream gap:

| suite | subtest | reason |
|---|---|---|
| eeq | hbond | `Not implemented` |

Configuration B skips 15 — the same one plus 14 that are **skipped by
construction**, because the code path they test was compiled out. Every one names
its own reason:

| suite | subtest | reason |
|---|---|---|
| eeq | hbond | Not implemented |
| tblite | gfn1, gfn2, gfn1-mindless, gfn2-mindless, gfn1-mindless-gbsa, gfn2-mindless-alpb, gfn1-mindless-gb, gfn2-mindless-gbe, gfn1-mindless-cosmo, gfn2-mindless-cosmo, mindless-efield (11) | `xtb not compiled with tblite support` |
| dipro | J_ab,eff | `tblite libary not available.` |
| cpx | solvation | `CPCM-X libary not available.` |
| ptb | ptb_not_present | `xtb not compiled with tblite support` |

The subtest *inventory* also changes: PTB is implemented on top of tblite, so
configuration A runs 17 real `ptb` subtests (`basis`, `overlap`, `hamiltonian_h0`,
`v_xc`, `polarizability`, …) which configuration B replaces with the single
`ptb/ptb_not_present` guard. That accounts for the whole difference:
135 − 17 + 1 = 119.

**None of the 15 skips touches the GFN2 IR path.** GFN2 through xtb's own
`xtb_calculators` (not tblite) is fully exercised by `xtb:unit / gfn2` and
`xtb:unit / hessian`, both of which pass in configuration B.

---

## 2. Reference IR data set

One JSON file per molecule in **`../../src/reference/fixtures/`**, indexed by
`index.json` beside them.
Produced with configuration **B** (the wasm-shaped build), `OMP_NUM_THREADS=1`.

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

ν in cm⁻¹, I in km/mol. `6N+1` is the number of single-point energy+gradient
evaluations the two-sided finite-difference Hessian requires. **All ten are true
minima — zero imaginary modes.**

`ohess s` for toluene and caffeine includes the extra rounds (see below); the
single-Hessian cost is 1.33 s and 5.98 s respectively, recorded as
`timings_seconds.xtb_internal` in each fixture.

### 2.1 How it was produced

1. **Geometry** — SMILES (`scripts/molecules.tsv`) → `obabel --gen3d` (Open Babel
   3.1.1, in the image). The raw 3D structures are kept in `geometries/`.
2. **Pre-optimization** — `xtb input.xyz --opt --gfn 2 --chrg 0 --uhf 0`.
3. **Hessian** — `xtb optimized.xyz --ohess --gfn 2 --chrg 0 --uhf 0`.
4. **Minimum enforcement** — if the Hessian came back with an imaginary mode, the
   geometry was displaced along it (xtb writes `xtbhess.xyz` for exactly this),
   re-optimized, and the Hessian recomputed. Repeated until all modes are real.

Toluene needed 3 rounds and caffeine 4 (both methyl-rotor saddle points).
Caffeine did not clear in 4, so `scripts/escape_saddle.py` scanned displacements
of ±0.6, ±1.0 and ±1.5 along the imaginary mode and kept the lowest-energy result
that had no imaginary mode (`−42.154507372066`, lowest real mode 39.6 cm⁻¹). Each
fixture records `provenance.hessian_rounds` and
`provenance.saddle_escape_applied` so this is never invisible.

Full transcript: `logs/reference_run.log` (3 min 57 s for all ten).

### 2.2 Fixture contents

Each file is schema `xtb-wasm/ir-reference/1` and is self-describing:

| key | contents |
|---|---|
| `molecule` | name, formula, SMILES, atom count, charge, uhf |
| `provenance` | xtb version, method, build label, exact meson options, exact commands, geometry source, Hessian rounds, environment |
| `input_geometry_xyz` | the Open Babel structure, as parsed atoms |
| `optimized_geometry_xyz` | the converged minimum — **this is the anchor for tier-1 validation** |
| `energies_hartree` | total energy, enthalpy, free energy, gradient norm, ZPVE, G(RRHO) |
| `homo_lumo_gap_ev`, `dipole` | SCF properties, dipole in Debye |
| `vibrations` | `frequencies` and `ir_intensities` (3N−6 real modes, trans/rot removed), plus `all_modes_including_trans_rot` |
| `hessian_invariants` | dimension, Frobenius norm and trace of the full Cartesian Hessian |
| `timings_seconds` | external wall clock for both invocations plus xtb's own SCF / optimizer / Hessian breakdown |
| `tier1_hess_at_optimized_geometry` | **the tier-1 reference**: energy, frequencies, IR intensities and Hessian invariants from `--hess` run at exactly `optimized_geometry_xyz` (see §3.5) |
| `validation` | whether the molecule is usable for tier 1 and for tier 2, with the reason |

---

## 3. Tolerances, and the measurements behind them

Machine-readable: **`../../src/reference/tolerances.json`**. Three independent
studies, all in this directory as JSON plus a log.

### 3.1 Build, thread and LAPACK variation — `tolerance_study.json`

All ten molecules through `--ohess` under six variants: the reference build; the
same binary rerun; 4 BLAS threads; the OpenMP build at 1 thread; the OpenMP build
at 4 OpenMP + 4 BLAS threads; and the netlib build with reference LAPACK 3.12 and
reference BLAS forced in via `LD_LIBRARY_PATH`.

**Every delta is exactly zero** — energy, frequency, IR intensity, absolute and
relative, on all ten molecules.

The LAPACK axis really is active. A `--grad` run on caffeine under the two
backends produces gradient files whose components differ in the last two or three
printed digits (≈1e-16 Eh/a₀ absolute), while the energy agrees to all 11 printed
decimals and the Mulliken charges are bit-identical. The noise exists; it never
reaches a digit xtb prints. The reason is structural: the SCF is a converged
fixed point, so the diagonalizer's rounding is iterated away rather than
accumulated.

### 3.2 Floating-point reassociation — `fp_perturbation_study.json`

A native LAPACK swap is a weak proxy for a different toolchain, so configuration
**D** changes the arithmetic itself: `-O1` instead of `-O3`, `-ffp-contract=off`
(gfortran contracts to FMA by default), `-fno-unsafe-math-optimizations`, and
reference LAPACK/BLAS. Different vectorisation, different FMA usage, different
backend, one binary.

Against configuration B on all ten molecules: energy, frequency and IR intensity
deltas are **all exactly zero**. The Cartesian Hessian is bit-identical for the
eight smallest molecules; for ibuprofen (9801 elements) and cholesterol (49 284)
the largest element difference is `1e-10`, one unit in the last printed digit.

A fixed-geometry cross-check (`--hess`, optimizer excluded) on benzene,
paracetamol, caffeine and ibuprofen agrees: the Hessian is bit-identical for the
first three and differs in 2 of 9801 elements for ibuprofen. The **only** textual
difference in `vibspectrum` is the sign of the numerical-zero translation and
rotation rows — `-0.00` versus `0.00`. Hence the first comparison rule below.

### 3.3 What actually moves the numbers — `input_sensitivity.json`

The first two studies give a floor of zero and therefore no guidance on headroom.
The third measures the other end: perturb the input geometry by a known ε and run
the full `--ohess` pipeline (benzene, acetic acid, paracetamol, caffeine; two
seeds each).

| ε (Å) | max ΔE (Eh) | max Δν (cm⁻¹) | max relative ΔI (peaks > 1 km/mol) |
|---|---|---|---|
| 1e−8 | 1.6e−11 | 0.00 | 1.1e−4 |
| 1e−6 | 1.6e−9 | 0.04 | 1.1e−2 |
| 1e−4 | 1.9e−6 | **19.34** | **0.53** |

**The geometry, not the arithmetic, is the risk.** The ANC optimizer stops around
`gnorm ≈ 2e-4`, so two builds taking slightly different optimizer paths can land
on geometries differing at the 1e−4 Å level — worth up to ~20 cm⁻¹ on a soft
torsion and tens of percent on IR intensities. IR intensities are consistently
the most sensitive quantity: at ε = 1e−6 Å they have already moved by 1 % while
the frequencies have moved by 0.04 cm⁻¹.

### 3.4 Recommended assertions

Two tiers. **Tier 1 is the real test.**

**Tier 1 — fixed geometry.** Run the wasm build with `--hess` (*not* `--ohess`)
starting from `fixtures[*].optimized_geometry_xyz`. The optimizer is excluded, so
this compares only the SCF, the finite-difference Hessian and the dipole
gradients — which is what the port can actually break.

| quantity | tolerance | basis |
|---|---|---|
| total energy | 1e−8 Eh absolute | native spread 0 at 1e−12 print precision; 1e−8 Eh is still 1e5× tighter than chemical accuracy |
| frequencies | 0.5 cm⁻¹ absolute | native spread 0.00; 50× the print precision, 12× the 1e−6 Å response, ~60× tighter than GFN2's own error vs experiment |
| IR intensities > 1 km/mol | 2 % relative | most sensitive quantity; smallest value not dominated by geometry noise |
| IR intensities ≤ 1 km/mol | 0.05 km/mol absolute | a relative test on a near-zero intensity is meaningless |
| Hessian Frobenius norm, trace | 1e−6 relative | rotation-invariant, so it catches errors in IR-silent modes too; per-element agreement measured at 1e−10 |
| imaginary mode count | exact (0) | all ten fixtures are true minima |
| mode count | exact (3N−6) | a mismatch means the trans/rot projection differs |

**Tier 2 — full pipeline.** `--ohess` from the raw `geometries/*.xyz`, matching
what ir.cheminfo.org does. It exercises the optimizer, so it must be much looser
and must never be the only check.

| quantity | tolerance | basis |
|---|---|---|
| total energy | 1e−5 Eh absolute | 1e−4 Å probe moved it by ≤1.9e−6 Eh |
| frequencies ≥ 500 cm⁻¹ | 5 cm⁻¹ absolute | stiff modes moved 0.3–3.9 cm⁻¹ under the 1e−4 Å probe |
| frequencies < 500 cm⁻¹ | 25 cm⁻¹ absolute | soft torsions moved up to 19.3 cm⁻¹; tighter produces false failures |
| IR intensities > 5 km/mol | 50 % relative | 1e−4 Å probe produced up to 53 % change; still catches a grossly wrong dipole gradient |
| imaginary mode count | exact (0) | |

### 3.5 A protocol mismatch worth knowing about

The first version of the harness compared a `--hess` run against the top-level
`vibrations` block and **failed on ibuprofen and cholesterol with the very binary
that produced the fixtures.** The cause is not numerical: `--ohess` relaxes the
geometry a little further before building the Hessian, so its Hessian is not
taken at the coordinates it writes out. Running `--hess` at those coordinates
instead moves the energy by ≤ 3.2e−11 Eh and the frequencies by ≤ 0.06 cm⁻¹ — but
the **IR intensities by up to 16 %** (cholesterol mode 204: 12.96 vs
11.17 km/mol; ibuprofen mode 43: 5.11 vs 4.77 km/mol).

This is the same lesson as §3.3 from the other direction: IR intensities are far
more geometry-sensitive than frequencies. Every fixture therefore carries a
**`tier1_hess_at_optimized_geometry`** block, generated by `--hess` at exactly
the stored coordinates. **Tier-1 validation must compare against that block**,
not the top-level `vibrations` block (which remains the `--ohess` result, and is
what tier 2 uses).

### 3.6 Comparison rules

- **Never byte-compare `vibspectrum`.** The numerical-zero translation/rotation
  rows print as `-0.00` or `0.00` depending on the last bit, and this differs
  between builds whose Hessians are bit-identical.
- **Drop modes with |ν| < 0.01 cm⁻¹** before comparing — those are the projected
  translations and rotations. `vibrations.frequencies` is already filtered;
  `vibrations.all_modes_including_trans_rot` keeps the raw list.
- **Sort both frequency lists ascending** before comparing element-wise.
  Near-degenerate modes (benzene has several) can be emitted in a different order.
- **Match IR intensities by sorted frequency index**, never by intensity value.
- **Set `OMP_NUM_THREADS=1`** on the native side. Not needed for reproducibility —
  thread count was measured to change nothing — but it keeps timings comparable.
- **These fixtures are aarch64.** No x86-64 variant was measured, so an x86-64
  native reference may differ by more than the tolerances above. Regenerate on
  the target architecture if that matters.

---

## 4. Validation harness

`scripts/validate.py` implements both tiers and the comparison rules.

```
python3 scripts/validate.py /path/to/xtb                 # tier 1, all 10 fixtures
python3 scripts/validate.py /path/to/xtb --tier 2
python3 scripts/validate.py /path/to/xtb --only water benzene
```

It exits 0 only if every checked molecule is within tolerance. Results against
the native builds:

| build | tier | result |
|---|---|---|
| B (reference, produced the fixtures) | 1 | **PASS 10/10** — every delta exactly 0 |
| D (−O1, no FMA, netlib LAPACK) | 1 | **PASS 10/10** — every delta exactly 0 |
| B (reference) | 2 | **PASS 8/8**, 2 skipped |
| D (−O1, no FMA, netlib LAPACK) | 2 | **PASS 8/8**, 2 skipped |

That configuration D — which differs from B in optimization level, FMA
contraction *and* linear-algebra backend — reproduces the fixtures exactly under
tier-1 tolerances is the strongest available evidence that these tolerances are
neither too tight to be met by a differently-compiled build, nor so loose that
they would miss a regression.

### Tier-2 eligibility

Two molecules are excluded from tier 2, flagged in each fixture as
`validation.tier2_single_ohess_reaches_minimum: false`:

| molecule | first `--ohess` from the raw geometry | rounds needed |
|---|---|---|
| toluene | stops at a saddle, ν₁ = −25.67 cm⁻¹ | 3 |
| caffeine | stops at a saddle, ν₁ = −64.99 cm⁻¹ | 4 + displacement scan |

Both are methyl-rotor saddle points. This is a property of the GFN2 potential
energy surface, not of any build — the reference build itself reproduces it — so
tier 2 skips them rather than pretending it is a tolerance question.

---

## 5. Caveat on the spread studies

The three studies in section 3 start from `optimized.xyz` as written by the
*first* `--ohess` round. For toluene and caffeine that is the methyl-rotor saddle
point, not the final escaped minimum stored in the fixtures — which is why the
caffeine energy in `tolerance_study.json` (−42.153938) differs from the fixture
(−42.154507). This does not affect any conclusion: every variant in a given study
starts from the same geometry, and the studies measure differences *between*
variants. The fixtures themselves are all true minima.

---

## 6. Layout

```
geometries/         raw Open Babel 3D structures (--ohess inputs for tier 2)
tolerance_study.json      build / thread / LAPACK spread, 10 molecules, 6 variants
fp_perturbation_study.json  -O1 / no-FMA / netlib vs reference build
input_sensitivity.json      geometry-perturbation response
testsuite/
  baseline.json     machine-readable suite table for both configurations
  {A,A2,B}_test.log meson console output (A2 = serial re-run with pytest)
  {A,A2,B}_testlog.{txt,json}.gz  full meson logs
  {A,B}_subtests.tsv   subtest-level pass/skip with reasons
  {A,B,C,D}_configure.log
logs/               transcripts of the data-generation runs and the four validation runs
scripts/
  validate.py       the validation harness (tier 1 and tier 2)
  make_reference.py, escape_saddle.py, formula.py   fixture generation
  tolerance_study.py, fp_study.py, sensitivity.py   the three spread studies
  add_tier1.py      generates the tier1_hess_at_optimized_geometry blocks
  subtests.sh, molecules.tsv, Dockerfile.xtbnat
```

The two files the studies above judge, and which every script reads and writes,
sit outside this directory because they are published:

```
../../src/reference/fixtures/     one JSON per molecule + index.json
../../src/reference/tolerances.json   recommended assertions with justifications
```
