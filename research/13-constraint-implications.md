## SUMMARY
The requirement "all tests of the original project pass" is satisfiable, trivially and completely, by exactly one route: E (server-side xtb). I measured the real cost — a from-scratch Docker build-and-test of xtb 6.7.1 is 205 s (configure 20 s, compile 178 s, test 7 s); the test step alone on a warm image is 7 seconds. Route A (full wasm cross-compile) can satisfy it too, but only in the operational sense: I built and ran the exact wasm-shaped configuration (`-Dopenmp=false -Dtblite=disabled -Dcpcmx=disabled`) natively and got 34 OK / 1 expected-fail / 0 fail from meson — green — while 15 of 119 subtests silently skipped via xtb's built-in `skip_test` protocol. That skipping is blessed by upstream's own `xtb-lightweight-meson-build` CI job, so it is defensible. Route B (trimmed build) is the important negative result: it is strictly dominated by A and should be dropped. There are no per-feature build options in xtb (only tblite/cpcmx/openmp/gpu/nvtx), 81% of the source (229/348 files, 143.7k/177.4k LOC) is inside the `use`-closure of the IR/Hessian entry points, `src/hessian.F90:55` unconditionally imports the PTB calculator and `src/type/data.F90:25` imports the docking force field — my trim experiment died on the first file with `Fatal Error: Cannot open module file 'xtb_iff_data.mod'`. Trimming buys ~19% less Fortran and costs you the requirement, because it forces edits to `test/unit/main.f90` and deleting a test is not passing it. Routes C and D run zero of xtb's 136 tests; C additionally has no Hessian to lean on (tblite's C API stops at `hamiltonian_matrix`). Recommendation: run the native upstream suite in CI as the day-one YES answer, and treat the wasm build as a second job with a visible, honest skip list.

## BLOCKERS
None

## DETAILS
## What the requirement actually does to the design space

The user's requirement — *"All the tests of the original project should pass"* — is not a quality bar. It is a **structural constraint that eliminates three of the five candidate routes outright and collapses a fourth into another.** Here is the evidence, measured rather than argued.

All measurements below come from real builds and test runs of xtb 6.7.1 (commit `a45f05d`) in a clean `ubuntu:24.04` container with gfortran, meson 1.7.0 and netlib LAPACK, on Apple Silicon arm64, 8 cores.

---

## 1. First: what "the test suite" actually is

| Layer | Count | Source |
|---|---|---|
| meson test targets | **35** | 29 test-drive suites + 4 `Argparser` + 1 `Info` + 1 `C API` |
| test-drive suites | **29** | `test/unit/meson.build:37-66` (28) + `ptb` (`:90`) |
| `new_unittest(` registrations | **136** static | across `test/unit/test_*.f90` + `test_ptb.F90` |
| registered at runtime, tblite OFF | **119** | `test_ptb.F90`'s collector is `#if WITH_TBLITE`-switched (18 → 1) |

Full-suite wall clock, measured:

| Configuration | configure | compile | test | total |
|---|---|---|---|---|
| default (OpenMP on, 8 cores) | 20 s | 178 s | **7 s** | 205 s |
| `-Dopenmp=false -Dtblite=disabled -Dcpcmx=disabled` | ~20 s | 103 s | **33 s** | ~156 s |

**This is not a compute-heavy suite.** 33 seconds single-threaded, native. That number matters for every route.

---

## 2. The decisive finding: xtb's suite goes green while silently skipping

I ran every suite individually and tallied the per-subtest results:

| Configuration | PASSED | SKIPPED | FAILED | meson verdict |
|---|---|---|---|---|
| default (tblite auto-off on arm64, cpcmx on) | 105 | 14 | 0 | `Ok: 34, Expected Fail: 1, Fail: 0, Skipped: 0` |
| `-Dopenmp=false -Dtblite=disabled -Dcpcmx=disabled` | 104 | **15** | 0 | `Ok: 34, Expected Fail: 1, Fail: 0, Skipped: 0` |

The 15 skips in the wasm-shaped configuration:

```
eeq    hbond                      dipro  J_ab,eff
ptb    ptb_not_present            cpx    solvation
tblite gfn1, gfn2, gfn1-mindless, gfn2-mindless, gfn1-mindless-gbsa,
       gfn2-mindless-alpb, gfn1-mindless-gb, gfn2-mindless-gbe,
       gfn1-mindless-cosmo, gfn2-mindless-cosmo, mindless-efield
```

**Meson reported `Skipped: 0`.** The skips are invisible at the level the requirement is normally checked at. The mechanism is xtb's own:

- `skip_test(error, "...")` sets `error%stat = 77`
- `test/unit/main.f90:237` — `is_skipped = error%stat == 77`
- `main.f90:153` `run_unittest` does not increment the failure counter for a skipped test

**And upstream itself ships CI jobs that run exactly this configuration.** `.github/workflows/fortran-build.yml` defines `xtb-lightweight-meson-build` (`-Dtblite=disabled -Dcpcmx=disabled`) and `xtb-lightweight-cmake-build` (`-DWITH_TBLITE=false -DWITH_CPCMX=false`), both gated on the same `meson test --suite xtb` / `ctest -R 'xtb/*'`.

So there are two readings of the requirement, and they give different answers:

- **Operational reading** ("`meson test --suite xtb` exits 0"): satisfied by the lightweight config. Blessed by the maintainers.
- **Literal reading** ("every one of the 136 tests executed and passed"): not satisfied — 15 never ran.

The user needs to pick. It materially changes the answer for route A.

There is also a hard constraint that removes the choice: on aarch64 meson reported `tblite : NO — C shared or static library 'quadmath' not found`. `libquadmath` is an x86-only GCC runtime. wasm32 has no `__float128` either, so **tblite is very likely forced off in any wasm build** — the 15 skips are a constraint, not a decision.

---

## 3. Route-by-route assessment against the requirement

### A — Full cross-compile of xtb + subprojects to wasm

**Can it satisfy the requirement? Yes — in the operational sense, and it is the only in-browser route that can.**

The test artifacts are ordinary executables: `test/unit/tester` (Fortran) and `test/api/xtb_c_test` (C). Under Emscripten they become `node tester.js gfn2`. Everything the suite needs is available:

- **Filesystem**: only one test touches it — `test/unit/test_gfn2.f90:607` `open(newunit=tmp_unit, Status="Scratch")`. MEMFS handles it. Parameter files (171 KB total) are found via `XTBPATH` and preload trivially.
- **No shell-outs on any test path**: all 26 `execute_command_line` hits live in `src/extern/{driver,mopac,orca,turbomole}.f90` and `src/screening.f90:300,303`. Zero test coverage of those files, so the browser-hostile code is dead weight, not a blocker.
- **OpenMP is optional**: I measured `-Dopenmp=false` → 0 failures. No SharedArrayBuffer / COOP-COEP requirement.
- **Process model**: the suite must be driven one suite per process. Running `./tester` with no arguments aborts (`ERROR STOP`, backtrace through `subprojects/test-drive/src/testdrive.F90:1937` from `test/unit/test_docking.f90:119`). Meson/ctest already do one-per-process; a wasm harness just does 29 module instantiations of a ~15 MB binary.
- **Memory**: wasm32's 4 GB ceiling is irrelevant here — the test molecules are ≤ ~30 atoms except `taxol.xyz` (113 atoms), which only appears in the `Info` CLI test that parses and prints.

**The real risk is not compiling — it is numerics.** The suite asserts to 1e-10…1e-7 (histogram: 1e-10 ×32, 1e-8 ×21, 1e-7 ×13, 1e-9 ×12), and it needs 40+ BLAS/LAPACK routines (`dsyev`, `dsygvd`, `dsytrf`/`dsytri`, `dpotrf`, `dgemm`, `dtrsm`, plus the `s*` family). Netlib LAPACK is itself Fortran, so it inherits the same compiler problem. A different eigensolver gives different rounding, and `test_hessian` asserts second derivatives at 1e-7.

**Mitigating evidence, and it is strong**: upstream CI already passes this suite across gfortran 10–15, ifort 2022.1, ifx 2024.1/2025.2, on x86_64 / arm64 / macOS / MinGW, against netlib **and** OpenBLAS **and** MKL. My arm64 run adds another point. The tolerances are demonstrably not knife-edge.

Two semantics-changing build flags to watch (`meson/meson.build:29-36`): `-fdefault-real-8 -fdefault-double-8`. These promote default `REAL` to 8 bytes, which silently redirects every single-precision LAPACK call (`ssyev`, `ssyevr`, `sspgv`, `ssytrf`…) to double semantics. A compiler without an equivalent produces different answers, not a compile error. Also fixed-form F77 sources: `src/david.f`, `src/drsp.f`, `src/esp.f`, `src/stm.f`, `src/surfac.f`.

**Honest restatement for A:** *"All 35 meson test targets are green under wasm — 34 OK, 1 expected-fail — with 15 subtests skipped, exactly as in upstream's own `xtb-lightweight-meson-build` job."*

---

### B — Reduced/trimmed build (GFN2 + gradient + Hessian only)

**Cannot satisfy the requirement, and — more importantly — it is strictly dominated by A. Drop it.**

Three measured reasons:

**(i) There are no per-feature build options.** `grep get_option src/meson.build src/*/meson.build` returns nothing. `src/meson.build:18-37` unconditionally `subdir()`s `docking`, `iff`, `dipro`, `extern`, `ptb`. `meson_options.txt` offers only `lapack`, `custom_libraries`, `tblite`, `cpcmx`, `openmp`, `install_modules`, `build_name`, `gpu`, `gpu_arch`, `cusolver`, `nvtx`. **There is no "drop docking/MD/ONIOM" switch to throw.**

**(ii) 81% of the source is inside the IR dependency closure.** I computed the transitive Fortran `use` closure from the IR/Hessian entry points (`xtb_hessian`, `xtb_freq_io`, `xtb_freq_project`, `xtb_freq_utils`, `xtb_thermo`, `xtb_optimizer`, `xtb_xtb_calculator`, `xtb_main_setup`, `xtb_detrotra`, `xtb_intmodes`, …):

| | files | LOC |
|---|---|---|
| total in `src/` | 348 | 177,448 |
| **reachable from IR seeds** | **229** | **143,664 (81%)** |
| not reachable | 119 | 33,784 |

And every subsystem you hoped to drop is *inside* the closure:

| module | file | reachable from IR? |
|---|---|---|
| `xtb_iff_data` | `src/iff/data.f90` | **yes** |
| `xtb_ptb_calculator` | `src/ptb/calculator.F90` | **yes** |
| `xtb_docking_param` | `src/docking/param.f90` | **yes** |
| `xtb_extern_turbomole` | `src/extern/turbomole.f90` | **yes** |
| `xtb_oniom` | `src/oniom.f90` | **yes** |
| `xtb_dipro` | `src/dipro.F90` | no |

The concrete edges:

```
src/hessian.F90:55          use xtb_ptb_calculator, only: TPTBCalculator, newPTBcalculator
src/type/data.F90:25        use xtb_iff_data, only : TIFFData
src/local.f90:33            use xtb_docking_param, only : dipol, ehomo, elumo
src/optimizer.f90:23        use xtb_extern_turbomole, only : TTMCalculator
src/main/setup.f90          use xtb_extern_{driver,mopac,orca,turbomole}, xtb_oniom,
                            xtb_iff_calculator, xtb_ptb_calculator
```

**The IR Hessian driver imports the PTB calculator. The core result type imports the docking force field.** You cannot compile the thing you want without the things you want to drop.

**(iii) The trim experiment fails on the first file.** I deleted `docking`, `iff`, `dipro`, `extern`, `ptb` from `src/meson.build` plus the obvious top-level sources, and dropped the matching test suites. Result:

```
Fatal Error: Cannot open module file 'xtb_iff_data.mod' for reading — No such file or directory
```

Fortran's `use` chain fails hard and fails early. You fix `src/type/data.F90`, hit the next one, and so on — through `hessian.F90`, `local.f90`, `optimizer.f90`, `relaxation_engine.f90`, `main/setup.f90`.

**And that is the requirement-killer**: every fix is an edit to xtb's own source. You must additionally edit `test/unit/main.f90`, which hard-codes all 29 `new_testsuite(...)` entries at lines 60-91 and `use`s all 29 collectors at :25-51. Deleting `test_docking` (4 tests), `test_iff` (1), `test_oniom` (3), `test_dipro` (1) is **deleting tests, not passing them.**

**Honest restatement for B:** *"N of xtb's 35 targets pass; M suites were deleted from the build and the test driver was modified."* That is not "all tests pass" under any reading.

**The dominance argument, which is the actionable conclusion**: B's promised benefit was "much less Fortran to port". It buys you ~19% (33.8k of 177.4k LOC) — and none of that 19% is docking, ONIOM, IFF, PTB or the external drivers, because they're all in the closure. Meanwhile it costs a fork of the build system, edits to core source, edits to the test driver, and the requirement. **A gives you a green suite for the same porting work. There is no configuration in which B is the right choice.**

The one trim that *is* defensible — `-Dtblite=disabled -Dcpcmx=disabled` — is not route B at all. It's route A's build line, it's upstream-supported, it drops the tblite/CPCM-X/numsa *subprojects* (a real reduction), and I measured it green.

---

### C — tblite alone + TS/C Hessian, optimizer, frequencies, intensities

**Cannot satisfy the requirement at all. Zero of xtb's 136 tests run** — you are not building xtb.

Worse, the substitute suite doesn't cover the part you wrote. **tblite's C API has no Hessian and no dipole gradient**: `include/tblite/result.h` getters run from `tblite_get_result_number_of_atoms` (`:64`) through `tblite_get_result_hamiltonian_matrix` (`:234`) — energy, gradient, virial, charges, bond orders, dipole, quadrupole, orbitals, density/overlap/Hamiltonian matrices. Nothing else. `grep -rn hessian tblite/include tblite/src/tblite/api` → nothing.

So you write, with no upstream test coverage:
- the numerical Hessian (6N gradient evaluations)
- the numerical dipole derivatives for IR intensities (another 6N)
- rotation/translation projection (`src/freq/project.f90`, 322 lines in xtb)
- mass-weighting and the frequency eigenproblem
- thermochemistry (`src/thermo.f90`)
- the ANC/L-BFGS optimizer (`src/lbfgs_anc/`)

**Honest restatement for C:** *"tblite's 527 unit tests (35 files) pass"* — a different project's suite, testing code you did not write. Your actual IR code has **no** upstream coverage. This is the biggest gap between what the requirement says and what the route delivers.

One redeeming move: xtb's `test/unit/test_hessian.f90` contains the full `hessian_ref(9,9)` and `dipgrad_ref(3,9)` reference arrays for H₂O under GFN1 and GFN2 at `step = 1.0e-6` (`:104`), asserted at `thr = 1.0e-7` (`:53`). **Lift those two arrays verbatim into your TS test suite.** That is two of xtb's own tests, running against your code, at xtb's own tolerance. Free, and maximally on-point for IR.

---

### D — Clean-room reimplementation of GFN2-xTB

**Cannot satisfy the requirement, and is further from it than C.** Zero xtb tests run, and no borrowed suite covers anything.

The tolerance analysis kills it. xtb asserts 1e-10…1e-7. A from-scratch GFN2 must reproduce, exactly: every parameter in `param_gfn2-xtb.txt` (35,849 bytes), the anisotropic electrostatics (`src/aespot.F90`), shell-resolved third-order, D4 dispersion (the `dftd4` v4.2.0 subproject), ALPB/GBSA solvation, Fermi smearing, and every integral screening threshold. Matching *energies* to 1e-8 is a long shot; matching **second derivatives** to 1e-7 amplifies every one of those discrepancies and is not reachable.

**Honest restatement for D:** *"a new validation suite reproduces xtb reference outputs to X tolerance"* — where X will realistically be ~1 cm⁻¹ on frequencies after person-years, not 1e-7 on Hessian elements.

---

### E — Server-side xtb behind an API

**Yes — the requirement is trivially and completely satisfied. This is the only route where that is true, and it is worth stating plainly.**

You ship unmodified upstream xtb in a container. The CI job is literally:

```dockerfile
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y gfortran gcc python3 python3-pip \
    pkg-config git libopenblas-dev liblapack-dev ninja-build
RUN pip3 install --break-system-packages meson==1.7.0
```
```sh
meson setup _build --buildtype=debugoptimized -Dlapack=netlib
meson compile -C _build
OMP_NUM_THREADS=2,1 meson test -C _build --print-errorlogs -t 120 --suite xtb
```

**Measured cost, end to end: 205 seconds cold** (configure 20 s, compile 178 s, test 7 s). On a warm image with the build cached, **the test step alone is 7 seconds.**

"The tests pass" here means exactly what upstream means: `meson test --suite xtb` exits 0, 34 OK / 1 expected-fail / 0 fail, with the *same* 14–15 skips upstream gets in any configuration where tblite/CPCM-X aren't built — and you can trivially make it zero skips by installing on x86_64 with quadmath present.

The requirement is satisfied not by cleverness but by **not changing anything**. That is the honest headline: E's compliance is free precisely because E does no porting, which is also exactly why it does not deliver the product goal (in-browser IR at ir.cheminfo.org).

---

## 4. Answers to the practical questions

### "Can a trimmed build keep the suite green by not building the tests for dropped features, and is that defensible?"

**Mechanically yes; defensibly only for the two features upstream already gates.**

- **Defensible**: `-Dtblite=disabled -Dcpcmx=disabled`. The skip protocol is xtb's own (`skip_test` → `stat=77` → `main.f90:237`), the build option is xtb's own, and upstream runs this exact configuration in `xtb-lightweight-meson-build` / `xtb-lightweight-cmake-build`. Measured green: 104 passed, 15 skipped, 0 failed. You are matching a maintainer-blessed config, and you can say so with a link.
- **Not defensible**: dropping docking / ONIOM / IFF / MD. There is no option for it; it requires editing `src/meson.build`, `test/unit/meson.build` **and** `test/unit/main.f90:25-51,60-91`; and it removes tests from the driver.

**The line to hold: skipping is defensible when the upstream build system does the skipping for you. Deleting is never defensible.** Route B requires deleting.

### "For route E, what would 'the tests pass' mean and how cheap is CI?"

It means the literal upstream gate, unmodified. Cost measured above: **~3.5 min cold, 7 s warm.** Yes — **this is the only route where the requirement is trivially satisfied**, and by a margin of roughly three orders of magnitude in engineering effort versus route A.

### Minimum credible acceptance suite for IR, as a relaxation the user could accept

Propose this in three tiers. Tiers 0 and 1 together are a genuinely rigorous bar — arguably a *better* IR bar than xtb's own suite, which has only 2 Hessian tests.

**Tier 0 — free, do this on every route including A.** Port xtb's own numeric fixtures directly:

| source | content | tolerance |
|---|---|---|
| `test/unit/test_hessian.f90` | H₂O `hessian_ref(9,9)` + `dipgrad_ref(3,9)`, GFN1 **and** GFN2, `step=1e-6` | **1e-7** (xtb's own `thr`) |
| `test/unit/test_thermo.f90` | `axis`, `calc`, `print` (3 tests) | as written |
| `test/unit/test_detrotra.f90` | 4 tests — rot/trans mode removal, low-mode candidates | as written |
| `test/unit/test_gfn2.f90` | `scc`, `api`, `wbo`, `mindless-basic` | as written |

That is ~11 of xtb's real tests, all of them on the IR path, all pure numerics with no build-system dependency. Cheap on any route.

**Tier 1 — the acceptance suite proper. 20 reference molecules, fixtures frozen from native xtb 6.7.1.**

Generate with `xtb <mol> --gfn 2 --hess` on the unmodified upstream binary and freeze as JSON.

Molecule set (spans the IR use case and the failure modes):
`water, methane, benzene, acetone, ethanol, acetic acid, toluene, aniline, phenol, chloroform, DMSO, acetonitrile, pyridine, cyclohexane, ethyl acetate, nitrobenzene, benzaldehyde, caffeine, taxol, + one 3d-metal complex`

Two are already in the repo: `assets/inputs/coord/caffeine.coord` and `assets/inputs/xyz/taxol.xyz` (113 atoms — the size stress case). The metal complex catches d-block parameterization, which no small organic will.

Assertions, tightest first:

| quantity | tolerance | rationale |
|---|---|---|
| total energy | **1e-8 Eh** | xtb's gfn2 tests use 1e-10…1e-7 |
| gradient, per component | **1e-8 Eh/a₀** | same code path |
| dipole moment | **1e-7 e·a₀** | feeds IR intensities |
| Hessian elements | **1e-7 Eh/a₀²** at `step=1e-6` | xtb's own `test_hessian` threshold |
| harmonic frequencies > 500 cm⁻¹ | **0.1 cm⁻¹** | well-conditioned modes |
| harmonic frequencies < 500 cm⁻¹ | **1 cm⁻¹** | low modes are ill-conditioned — that is why `test_detrotra` exists |
| IR intensities, bands > 1 km/mol | **1 % relative** | weaker bands are numerically noisy and invisible when plotted |
| optimized geometry | **1e-4 Å** RMSD after Kabsch alignment | if the port also optimizes |
| ZPVE | **1e-6 Eh** | |
| entropy S at 298.15 K | **0.01 cal/mol/K** | |

**Tier 2 — the gate that protects the actual product.** Broaden each spectrum onto a 400–4000 cm⁻¹ grid at 1 cm⁻¹ spacing with a Lorentzian of FWHM 20 cm⁻¹, and require **cosine similarity ≥ 0.9999** against native xtb's spectrum on the same grid. This is the assertion that maps onto what a user of ir.cheminfo.org actually sees, and it is the one to make the headline CI gate.

Frame the tolerances correctly when you present them: **1 cm⁻¹ is a code-fidelity test, not a physics test.** GFN2-xTB's own systematic error against experimental IR is ~30–50 cm⁻¹. Asking for 1 cm⁻¹ agreement *with native xtb* is asking "did the port change the answer", which is the right question. Runtime budget: my full 136-test suite ran in 33 s serial native; 20 molecules with Hessians should be well under a minute native, ~2–4 min in wasm. Comfortable for CI.

---

## 5. Ranking by distance from a green test suite

| rank | route | tests of xtb that run | distance | verdict |
|---|---|---|---|---|
| **1** | **E — server-side** | **136 / 136** | **zero** — 7 s warm, 205 s cold, measured | requirement is free |
| **2** | **A — full wasm cross-compile** (`-Dopenmp=false -Dtblite=disabled -Dcpcmx=disabled`) | 104 run + 15 skipped, 0 failed | one working Fortran→wasm compiler + wasm LAPACK; everything else is routine Emscripten work | only route satisfying **both** requirements |
| 3 | B — trimmed build | fewer than A, with suites **deleted** | strictly **greater** than A: same compiler problem **plus** source edits **plus** test-driver edits | **dominated by A — eliminate** |
| 4 | C — tblite + own numerics | **0 / 136** | borrows tblite's 527 tests, none covering the Hessian/IR code you write | best effort-to-working-IR ratio; worst requirement compliance |
| 5 | D — clean-room | **0 / 136** | 1e-7 Hessian fidelity not reachable in any realistic timeframe | not viable under this requirement |

### Which single route makes the requirement cheapest to satisfy

**E, unambiguously** — and it is worth being blunt about *why*: E satisfies the requirement perfectly because it does no porting, and it therefore fails the product goal entirely. That tension is the real decision the user has to make, and it should be put to them directly rather than buried.

If both constraints are genuinely non-negotiable — *"all original tests pass"* **and** *"runs in the browser"* — then **A is the only route that can satisfy both**, and the whole project reduces to the Fortran→WebAssembly compiler question the companion study covers. B, C and D cannot satisfy the requirement and should only be reconsidered if the user relaxes it to the Tier 0/1/2 suite above.

### The practical recommendation

Run **both**:

1. **CI job 1 (native, route E's build):** vendor upstream xtb unmodified and run `meson test --suite xtb` on every commit. Cost 7 s warm. This makes *"do all the tests of the original project pass?"* answerable **YES** from day one, and keeps answering it as you rebase onto new upstream releases.
2. **CI job 2 (wasm, route A):** the same suite cross-compiled, with the 15-item skip list checked in as an explicit, reviewed allowlist so a *new* skip is a CI failure rather than a silent regression.

That structure gives an honest green from the first day of the project, isolates all the porting risk in a job whose skips are visible, and — should the wasm work stall — leaves a working server-side product behind (route E) rather than nothing.

**One caveat I could not measure**: peak RSS per test suite. The container ran out of host disk before I could instrument it. wasm32's 4 GB ceiling is very unlikely to bind for ≤ 30-atom test molecules, but confirm it before committing to route A.
