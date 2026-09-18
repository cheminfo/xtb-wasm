# "All the tests of the original project should pass"

*What the requirement entails, whether it is achievable, and what it eliminates.*

All line references are to xtb at commit **`a45f05d397268fd683b5f9f824ed59912c5490b5`** (2026-08-09). CI figures are from GitHub Actions run **31314350756** on that commit.

---

## 1. What "all tests pass" concretely means for xtb

### 1.1 The suite is two suites, and neither is a superset of the other

| | Meson (`meson test --suite xtb`) | CMake (`ctest -R 'xtb/*'`) |
|---|---|---|
| `tester <suite>` invocations | 29 | 29 |
| CLI argparser targets | 4 (`--version`, `--help`, `--license`, **no-args, `should_fail: true`**) | 3 |
| `Info` (reads 4 structure files) | 1, **guarded off on Windows** (`test/unit/meson.build:96`) | 1 |
| End-to-end `--coffee` SCF runs | **0** | **6** |
| C API | 1 | 1 (only under `WITH_OBJECT`) |
| **xtb-owned total** | **35** (34 on Windows) | **40** |
| what CI actually reports | `Ok: 34 / Expected Fail: 1 / Fail: 0` | `100% tests passed out of 45` |

The CTest number is 45, not 40, because `-R 'xtb/*'` is a *regex* (literal `xtb` then zero-or-more slashes), i.e. a substring match. It sweeps in five tblite-subproject tests whose names contain "xtb" (`tblite/gfn2-xtb`, `tblite/ipea1-xtb`, `tblite/xtb-param`, `tblite/xtb-external`, `tblite/xtbml`); a sixth is explicitly excluded by `-E 'tblite/gfn1-xtb'` (`.github/workflows/fortran-build.yml:92`).

**Meson has one target CMake lacks** (`Argparser no arguments`, the sole expected-fail). **CMake has seven meson lacks** (six `--coffee` SCF regressions at `test/unit/CMakeLists.txt:120-125`, plus `xtb/CAPI` under a different link mode). Union = **41 distinct xtb-owned targets**. Neither command alone is "the test suite".

Also note: `ninja -C build test` / `make -C build test` with no filter runs **131 CTest targets** including every subproject's own suite. Upstream CI has never run that configuration on any platform.

### 1.2 Inside the tester binary

`test/unit/main.f90:61-91` builds 29 test-drive suites unconditionally and dispatches on `argv[1]`.

- **136** `new_unittest("…")` literals across `test/unit/test_*.f90` + `test_ptb.F90`
- **135** registered when `WITH_TBLITE` is on, **119** when off — `test_ptb.F90` is the *only* preprocessed test file, wrapping 17 cases in `#if WITH_TBLITE` (`:54-71`) and 1 (`ptb_not_present`) in the `#else` (`:72-73`). Verified: `cpp -P -traditional-cpp -DWITH_TBLITE=1 test/unit/test_ptb.F90 | grep -c 'new_unittest("'` → 17; with `=0` → 1.
- **133 distinct names**, not 135: `test_coordinationnumber.f90:32-33` registers `"lp-pbc3d"` twice and `test_dftd4.f90:34-35` registers `"3b-nl-pbc3d"` twice. All 135 run under `tester <suite>`; `run_selected` (per-test invocation) reaches only the first of each pair. **Drive suites whole, as both build systems do.**
- **1184** `call check(` / `call check_(` sites in the 29 compiled test sources (13 files alias `check_ => check` to dodge the clash with `env%check`, so a naive `grep 'call check('` sees only 558). Plus **40** `check(...)` in `test/api/c_api_example.c`.
- Runtime comparisons are far more than 1184 — many sites sit in loops. `test_hessian.f90` has **4** `call check` sites that expand to **216** float comparisons.
- `test/unit/relaxation_engine.f90` is referenced by neither build system — dead file, 0 assertions.

### 1.3 Runtime — there is no single number, and the commonly quoted one is not the worst case

| configuration | job | test step (wall) | serial sum |
|---|---|---|---|
| gfortran-14, meson `--buildtype=debug -Db_coverage=true -Dlapack=netlib` | 93247066106 | 36 s | 132.12 s |
| gfortran-13, **identical flags** | 93247066111 | **66 s** | **211.03 s** |
| gfortran-11, ubuntu-22.04 (run 31312922270) | 93243438047 | **80 s** | **234.47 s** |
| meson lightweight (`-Dtblite=disabled -Dcpcmx=disabled`) | 93247066018 | 12 s | 36.01 s |
| **ifort + MKL, `--num-processes 1` (serial, optimized)** | 93247066030 | **14 s** | 14 s |
| CMake **Release**, `ctest --parallel`, 45 tests | 93247066047 | 18 s | 69.02 s |
| CMake **Debug**, 45 tests | 93247066031 | 35 s | — |

Two things follow. First, run-to-run and compiler-to-compiler spread on *identical flags* is ~1.8x, so quoting "132.12 s" to four significant figures as a baseline is false precision. Second, and more useful: **the right extrapolation base for a single-threaded wasm run is the ifort/MKL serial job at ~14 s**, not the `-O0 -Db_coverage=true` debug job. Even at a 5-10x wasm slowdown the full suite is 1-3 minutes. **This is not a compute-heavy suite, and runtime is not a risk.** The `-t 120` in CI is a timeout *multiplier* for slow debug builds, not a measurement.

### 1.4 What the suite covers — and what it does not

Of the 135 cases in a full build, roughly **67 (50%)** sit on the molecular-IR path (gfn0/1/2, gfnff, hessian, detrotra, thermo, symmetry, molecule, plus the cluster subsets of coulomb/eeq/repulsion and the atomlist container). **17** are periodic-boundary-only. **51** cover features irrelevant to IR (ptb 17, tblite 11, docking 4, random 3, oniom 3, peeq 3, wsc 2, pbc-tools 2, vertical 2, iff 1, dipro 1, cpx 1, latticepoint 1).

The IR-critical test is tiny: **`test_hessian.f90`, 2 cases, H₂O only**, `thr = 1.0e-7_wp` absolute (`:54`, `:150`), `step = 1.0e-6`, comparing all 27 dipole-gradient and 81 Hessian elements per method (`:129-141`). That is the entire upstream coverage of the numerical Hessian and dipole gradient. It runs in 0.08 s. **Passing xtb's suite is a weak IR guarantee** — a point that matters in §4.

---

## 2. The trap that makes the naive metric worthless

**xtb's green summary is invariant to whole subsystems being skipped.** This is the single most important finding in this section, and it must be designed around before any acceptance criterion is written.

test-drive skips (`skip_test` → `error%stat == 77`) are consumed *inside* the tester process. `test/unit/main.f90:171` — `if (.not.test_skipped(error) .and. …) stat = stat + 1` — so a skipped test does not increment the failure counter, the target exits 0, and meson reports it as `OK`. Meson's own `Skipped:` counter counts only meson-level skips and stays at zero.

Verified against the two jobs in the same CI run:

```
job 93247066106  (full: tblite + CPCM-X)      job 93247066018  (-Dtblite=disabled -Dcpcmx=disabled)
26/35 xtb:unit / cpb     OK    1.78s          26/35 xtb:unit / cpx      OK    0.02s
27/35 xtb:unit / ptb     OK    5.31s          27/35 xtb:unit / ptb      OK    0.02s
35/35 xtb:unit / tblite  OK   17.32s          22/35 xtb:unit / tblite   OK    0.01s
Ok: 34  Expected Fail: 1  Fail: 0             Ok: 34  Expected Fail: 1  Fail: 0
Skipped: 0  Timeout: 0                        Skipped: 0  Timeout: 0
```

Byte-identical summaries. Actual executed cases: **134 of 135** in the full build (only `eeq/hbond` skips, `test_eeq.f90:505` "Not implemented"), versus **104 of 119** in the lightweight one. **Thirty test cases silently disappear** — 11 tblite (`test_tblite.f90:89,147,211,290,363,437,509,581,653,725,797`), 16 ptb never registered, 1 cpx (`test_cpx.f90:74`), 1 dipro (`test_dipro.f90:100`), 1 `ptb_not_present` (`test_ptb.F90:1768`) — with no visible signal whatsoever.

A wasm build that fails to bring up tblite and CPCM-X would print exactly the numbers upstream prints and **prove nothing**. Any contract written as "`meson test --suite xtb` exits 0" is therefore not a test of the port; it is a test of nothing.

There is a second reason this matters and not just a hypothetical one: **tblite is very likely forced off in a wasm build regardless**. On aarch64 meson already reports `tblite : NO — C shared or static library 'quadmath' not found`; `libquadmath` is an x86-only GCC runtime and wasm32 has no `__float128`. The 15 skips are a constraint, not a choice.

**Consequence for the contract**: the acceptance criterion must assert per-suite *executed* counts, not the summary line. See §4.1.

---

## 3. The three hurdles, separately

### Hurdle (a) — Compiling the test executables. Risk: HIGH, but wholly inherited.

The test binaries add these problems *on top of* compiling xtb itself:

- **A fourth Fortran subproject.** test-drive v0.5.0 must cross-compile too. `test/unit/meson.build:19-32`: if test-drive is not found and xtb is a subproject, `subdir_done()` fires and **no unit tests exist at all** — a silent zero-test build.
- **A C↔Fortran mixed link.** `test/api/c_api_example.c` (426 lines) links against the Fortran static lib. Under CMake it links `lib-xtb-shared` (`test/api/CMakeLists.txt:21-25`) — Emscripten SIDE_MODULEs are a separate ordeal; this must be switched to the static target, which is an edit to xtb's build files.
- **`default_library=both` (`meson.build:27`)** builds a shared library by default. `-Ddefault_library=static` is mandatory.
- **Link-time symbol resolution for code no test executes.** xtb's own `src/` has **21 live `execute_command_line` call sites** (22 grep hits; `src/dipro.F90:341` is a mangled comment): `src/extern/turbomole.f90` ×14, `src/extern/orca.f90` ×3, `src/extern/mopac.f90:216`, `src/extern/driver.f90:195`, `src/screening.f90:300,303`. Add **16 more** from CPCM-X v1.1.0's `src/cpcmx/qc_calc.f90` (lines 64, 89, 123, 184, 282, 312, 329, 480, 528, 612, 619, 660, 694, 711, 712, 723) — including `xtb --version` at `:64` and `xtb coord --gfn N --cosmo <solv>` at `:89`/`:123`, i.e. CPCM-X shells out to the xtb CLI. `qc_calc.f90` is part of the CPCM-X *library* target and `cpcmx` defaults to `auto` (`meson_options.txt:43-49`), so it links into the tester. None of it is *reached* at runtime by any test, but all of it must **link**. Emscripten resolves `system()` (lowered to `node:child_process.spawnSync`); a pure-WASI link fails outright.
- **`src/mctc/signal.c:16`** is on the critical path of every unit test (`main.f90:57` → `mctc_init` → `src/mctc/mctc_init.F90:52-53`). It compiles under emcc; it does **not** compile for `wasm32-wasip1` ("call to undeclared function 'signal'").
- **Semantics-changing flags**: `meson/meson.build:29-36` passes `-fdefault-real-8 -fdefault-double-8`, which silently redirects every single-precision LAPACK call (`ssyev` ×6, `sdot` ×7, `sgemv` ×4, `sspgv`…) to double semantics. A compiler without an exact equivalent produces *different answers*, not a compile error.

This hurdle is the toolchain study's subject and is not re-argued here. It is the dominant risk.

### Hurdle (b) — Executing foreign-target binaries. Risk: LOW. Solved, and demonstrated.

Both build systems already support this with **configuration only, no source edits**.

- **Meson** prepends `exe_wrapper` to every cross-built test command (`mesonbuild/mtest.py:1537-1549`), and meson *ships* `cross/wasm32-emscripten.txt` with `exe_wrapper = 'node'` verbatim. `mesonbuild/build.py:2227-2228` names emscripten output `.js`, which is what makes `node` work.
- **CTest** prepends `CMAKE_CROSSCOMPILING_EMULATOR`, which `emcmake` sets to node automatically (`emcmake.py:37-40`), alongside `CMAKE_EXECUTABLE_SUFFIX=".js"` (`Platform/Emscripten.cmake:275`).
- Verified end-to-end on this machine with a C stand-in reproducing the tester's contract (argv dispatch, `getenv("XTBPATH")`, parameter-file open, `tmpfile()`, exit codes): `meson test` green under emcc+node **and** under wasi-sdk 34 + wasmtime 48; `ctest` green under emcmake+node.
- xtb never uses meson's `.run()` compiler checks (LAPACK detection is link-only, `meson/meson.build:169,191,193`), so cross-configuration does not stall.

The runtime facilities the suite actually needs, and where they come from:

| need | used by | emscripten + NODERAWFS + node |
|---|---|---|
| argv | 29 tester runs + all CLI targets | yes |
| `getenv("XTBPATH")` | `src/mctc/systools.F90:145,166` via `rdpath`; set at `meson.build:216` and `test/unit/CMakeLists.txt:97` | yes, transparently |
| absolute-path file reads | `Info` reads `assets/inputs/xyz/taxol.xyz` (113 atoms), `coord/caffeine.coord`, `coord/quartz.3d.coord`, `vasp/ammonia.vasp` — three format readers; parameter files total ~171 KB (`param_gfn0-xtb.txt` 39,220 B, `param_gfn2-xtb.txt` 35,849 B, `param_gfn1-xtb.txt` 27,800 B, `param_ipea-xtb.txt` 27,805 B, `param_gfn1-si-xtb.txt` 28,007 B, `.param_gfnff.xtb` 12,875 B, `.xtbrc` 2,495 B) | yes, real host paths |
| writable CWD | `test_oniom.f90:293-295` writes `w.coord`; `test_gfn2.f90:607` opens a `STATUS='SCRATCH'` unit; the 6 CMake `--coffee` targets write into `test1/`…`test6/` namespaces | yes |
| exit codes | `should_fail: true` and every pass/fail signal — requires `-sEXIT_RUNTIME=1` | yes |
| `signal()` | every tester run, before the first assertion | yes |
| `system()` | link-only (see hurdle a) | yes under node; `-ENOSYS` in a browser |
| OpenMP | 43 source files, 757 `!$omp` lines | **no** — `-Dopenmp=false` is mandatory (harmless: CI already runs green at `OMP_NUM_THREADS=1`) |

Two corrections to a widespread misreading worth stating explicitly, because they change the shape of the work:

1. **The suite is not subprocess-free.** Six of meson's 35 targets and **ten of CMake's 40** are separate process launches of the `xtb` executable (`test/unit/CMakeLists.txt:111-125`). Under Emscripten there is no executable to `exec` — these require the node launcher above. That is a build *configuration*, not a source edit, so it is still compatible with "unmodified tests"; but it is not free, and the C API test is a second binary.
2. **The suite does read structures from disk.** The 29 in-process unit tests take every geometry from hard-coded arrays or `test/unit/molstock.f90` (1643 lines, 28 molecules, 3 to 270 atoms — note `pdb_4qxx` is 76 atoms, not 270; the 270-atom entry is `Th_1519394` at `:1269-1563`). But `Info` reads four real files, and every SCF suite resolves parameter files through `XTBPATH`. **A wasm port must provision a virtual filesystem** (`assets/inputs/**` plus the root parameter files and `.xtbrc`), set `XTBPATH` inside the sandbox, and supply a writable CWD.

Settings that are not optional for a Fortran port: `-sSTACK_SIZE=8MB` or larger (emscripten's default is **64 KB**, `src/settings.js:113`, and it "will fail silently" — Fortran automatic arrays blow through it immediately), `-sALLOW_MEMORY_GROWTH=1`, `-sEXIT_RUNTIME=1`, `-sNODERAWFS=1`.

**WASI is ruled out on mechanical grounds** — not performance, not maturity. wasi-sdk 34's `libc.a` has no `signal`, `raise`, `mkstemp`, `tmpfile`, `system`, `fork`, or `execl`. `src/mctc/signal.c` does not compile; `STATUS='SCRATCH'` cannot link (`wasm32-wasip1/stdio.h:153` marks `tmpfile` deprecated-not-defined); and meson's `env:` silently fails to reach a WASI guest without an explicit `--env XTBPATH`, which would break all 29 unit tests invisibly. Fixing any of that means patching xtb to satisfy the runtime — exactly what the requirement forbids.

### Hurdle (c) — The numbers matching. Risk: MODERATE, and narrower than the prior suggests.

**All comparisons are absolute.** test-drive v0.5.0 `src/testdrive.F90:641-657`: `threshold = epsilon(expected)` when `thr` is absent, `relative = .false.` when `rel` is absent, `diff = abs(actual-expected)`. Case-insensitive search for `\brel\s*=` across all 373 xtb `.f90`/`.F90` files: **zero hits**; no `call check` anywhere passes seven or more positional arguments; the five subproject suites are likewise clean. No hand-rolled relative comparison exists — every `thr` is a `parameter` constant, never scaled by the expected magnitude.

Threshold distribution (of 1184 sites, 942 pass an explicit `thr=`; the 213 that do not are almost entirely integer/logical/string overloads):

| thr | typical quantity |
|---|---|
| `1.0e-10` (×32) | analytic-vs-finite-difference gradients and σ of classical terms |
| `1.0e-9` (×12) | SCF total energies, HL gaps, gradient norms, C API Hessian elements |
| `1.0e-8` (×21) | mindless-molecule energies (O(10-60 Eh)), thermo |
| **`1.0e-7`** (×13) | **Hessian and dipole gradients**, SCC component energies, ONIOM, PTB |
| `1.0e-5`…`1.0e-1` | charges, moments of inertia, gaps in eV, docking, Fukui, PTB polarizability |
| `1000*epsilon` = 2.22e-13 | `test_gfnff.f90:154` — **tightest in the suite** |
| `epsilon` / exact `==` | `test_detrotra.f90:63,86,112,135-137` — nine bit-exact assertions on synthetic eigenvalues that `src/detrotra.f90:71-143` passes through untouched. Structural, not numerical. |

Converted to relative headroom, **no assertion in the suite is tighter than ~2×10⁴ ULP** (`test_gfnff.f90:154`: 2.22e-13 on `norm2(gradient)` = 0.0478776). Against that:

- **WebAssembly is strictly more constrained than any native xtb CI already covers.** Round-to-nearest-ties-to-even only; no directed rounding; no x87 extended precision; **no scalar FMA in the core spec** (verified locally: native arm64 emits 8 `fmla` in a dot loop where wasm emits none, and gfortran defaults to `-ffp-contract=fast`); no FP-reduction reassociation even under `-msimd128` (verified bit-identical). The only wasm nondeterminism is NaN payload bits, and xtb never inspects them (`ieee_is_finite` ×3, `ieee_value` ×2, no `transfer()` bit tricks).
- **Measured libm divergence, emscripten musl vs macOS arm64 libm, 200k points**: `sqrt` 0.000% (IEEE-exact by mandate — and xtb's most-used math function, 691 sites), `log` 0.034% (≤1 ULP), `pow` 0.178% (≤1), `exp` 0.190% (≤1), `sin` 4.29% (≤1), `erf` 20.7% (**≤3**), `erfc` 31.8% (**≤6**). Worst case ~1.3×10⁻¹⁵ relative against a 2×10⁴ ULP budget.
- **The tolerances are demonstrably portable.** The identical literals pass on gfortran 10/11/12/13/14/15, ifort 2022.1, ifx 2024.1/2025.1/2025.2; x86-64, aarch64 Linux, Apple Silicon, MinGW; **netlib reference LAPACK, OpenBLAS and MKL**; at `OMP_NUM_THREADS` 2 and 1. They were chosen to survive exactly the BLAS/compiler substitution a wasm build forces.

Where the residual risk actually is:

1. **`xtb/hessian`, the IR-critical test.** Central differences with `step = 1e-6` amplify gradient noise by 5×10⁵, and `src/scf_module.F90:271-272` says so out loud (`scfconv=1.d-6*acc`, `! Hessian sensitive to this`). The shipped reference data reveals the native noise floor: symmetry-zero elements are stored as `-5.18e-12` and `1.27e-11`, and one dipole-gradient entry is `-4.44e-10` = exactly 2ε/step. So ~2×10⁻¹¹ observed noise against a 10⁻⁷ threshold — **~5000x margin, conditional on the SCF taking the same path**.
2. **SCF iteration-count divergence at a discrete threshold.** This, not rounding, is the realistic mechanism by which an energy moves by more than 10⁻⁹.
3. **Latent uninitialized-variable UB.** The historical record is unambiguous: [xtb issue #1109](https://github.com/grimme-lab/xtb/issues/1109) ("xTB + GCC 14.1: multiple test fails") broke **7 tests** — `param`, `EXE_Argparser_print_help`, `xtb/CAPI`, `xtb/gfn1`, `xtb/gfn2`, `xtb/hessian`, `xtb/oniom` — and PR #1121 fixed it by *"remov[ing] uninitialised but used `stmp`"*. **No tolerance was changed.** [Issue #276](https://github.com/grimme-lab/xtb/issues/276) has GFN-FF halogen-bond energy varying 1.39×10⁻⁸ Eh run-to-run on ~25% of runs. Wasm's deterministically-zeroed linear memory is a *third* initialisation behaviour.
4. **LAPACK backend.** `dsygvd` (×6) on the first SCF iteration, `dsyev` (×6) on the mass-weighted Hessian, plus `ddot` ×46, `dgemm` ×19, `dgemv` ×14, `dsytrf` ×13, `dsytri` ×5, `dpotrf` ×5. Divide-and-conquer deflation is the most implementation-sensitive routine in LAPACK — but **no xtb test asserts on an eigenvector component**, only on energies, charges and eigenvalues, all sign- and phase-invariant. Compile **netlib reference LAPACK/BLAS 3.12 to wasm**; that reduces the delta to codegen and matches the `-Dlapack=netlib` CI job exactly. Do not substitute a JS BLAS or a hand-rolled `dsygvd`.

**Calibrated estimate: 0-4 of 135 cases (<3%) at real risk of failing on numerics alone**, concentrated in `xtb/hessian`, the `xtb/gfnff` harmonic case, and `ptb/polarizability`. Probability the suite is green on the first *successful compile*: ~40%. After clearing latent UB natively and pinning netlib LAPACK: ~80%.

---

## 4. What the requirement rules out

| route | xtb's own tests that run | literally satisfiable? | honest restatement of "all tests pass" |
|---|---|---|---|
| **E — server-side xtb behind an API** | **135 / 135** | **Yes, trivially** | *"Unmodified upstream xtb; `meson test --suite xtb` and `ctest -R 'xtb/*'` both green, at full feature parity."* |
| **A — full wasm cross-compile** (`-Dopenmp=false -Dtblite=disabled -Dcpcmx=disabled`) | 104 executed + 15 skipped, 0 failed | **Operationally yes; literally no** | *"All 35 meson targets green (34 OK, 1 expected-fail), with 15 subtests skipped and 16 ptb cases not registered — exactly the skip set of upstream's own `xtb-lightweight-meson-build` job."* |
| **B — trimmed build** (GFN2 + gradient + Hessian only) | fewer than A, with **suites deleted** | **No** | *"N of 35 targets pass; M suites were removed from the build and `test/unit/main.f90` was edited."* |
| **C — tblite + TypeScript Hessian/frequencies** | **0 / 135** | **No** | *"tblite's own 527 unit tests pass"* — a different project's suite, covering none of the code you wrote. |
| **D — clean-room GFN2 reimplementation** | **0 / 135** | **No** | *"A new validation suite reproduces xtb reference output to ~1 cm⁻¹"* — not to 1e-7 on Hessian elements, not in any realistic timeframe. |

### Route B is not merely non-compliant — it is strictly dominated by A. Eliminate it.

Measured, not argued:

- **There are no per-feature build options.** `grep get_option src/meson.build src/*/meson.build` returns nothing. `src/meson.build:18-37` unconditionally `subdir()`s `docking`, `iff`, `dipro`, `extern`, `ptb`. `meson_options.txt` offers only `lapack`, `custom_libraries`, `tblite`, `cpcmx`, `openmp`, `install_modules`, `build_name`, `gpu`, `gpu_arch`, `cusolver`, `nvtx`. There is no switch to throw.
- **81% of the source is inside the IR dependency closure.** Transitive Fortran `use`-closure from the IR/Hessian entry points: **229 of 348 files, 143,664 of 177,448 lines**. And the subsystems you hoped to drop are *inside* it: `src/hessian.F90:55` `use xtb_ptb_calculator`; `src/type/data.F90:25` `use xtb_iff_data`; `src/local.f90:33` `use xtb_docking_param`; `src/optimizer.f90:23` `use xtb_extern_turbomole`. **The IR Hessian driver imports the PTB calculator. The core result type imports the docking force field.**
- **The trim experiment dies on the first file**: `Fatal Error: Cannot open module file 'xtb_iff_data.mod'`.
- Every fix is an edit to xtb's source, plus edits to `test/unit/main.f90:25-51,60-91`, which hard-codes all 29 collectors. **Deleting `test_docking` (4 cases), `test_iff` (1), `test_oniom` (3), `test_dipro` (1) is deleting tests, not passing them.**

B's promised benefit was less Fortran to port. It buys 19% — none of it docking, ONIOM, IFF, PTB or the external drivers — and costs a build-system fork, core source edits, test-driver edits, and the requirement. **A gives a green suite for the same porting work.**

The one trim that *is* defensible — `-Dtblite=disabled -Dcpcmx=disabled` — is not route B. It is route A's build line, it is upstream-supported (`xtb-lightweight-meson-build` / `xtb-lightweight-cmake-build` in `fortran-build.yml`), and it is measured green.

**The general rule, and the line to hold in review: skipping is defensible when xtb's own build system does the skipping. Deleting never is.**

### Route C's specific gap is worth naming

tblite's C API has **no Hessian and no dipole gradient**. `include/tblite/result.h` runs from `tblite_get_result_number_of_atoms` (`:64`) to `tblite_get_result_hamiltonian_matrix` (`:234`) — energy, gradient, virial, charges, bond orders, dipole, quadrupole, orbitals, matrices. `grep -rn hessian tblite/include tblite/src/tblite/api` → nothing. So under C you write the numerical Hessian, the numerical dipole derivatives, rot/trans projection (`src/freq/project.f90`, 322 lines in xtb), mass-weighting, the frequency eigenproblem, thermochemistry, and the ANC/L-BFGS optimizer — **all with zero upstream test coverage**. That is the largest gap between what the requirement says and what a route delivers.

### The tension the user has to resolve

**E satisfies the requirement perfectly because it does no porting, and therefore fails the product goal entirely.** That is the real decision, and it should be put to cheminfo directly rather than buried. If both constraints are genuinely non-negotiable — *all original tests pass* **and** *runs in the browser* — then **A is the only route that can satisfy both**, and the project reduces to the Fortran→wasm compiler question the companion study covers.

---

## 5. The cheapest way to satisfy it, and a fallback

### 5.1 Run both. Two CI jobs, from day one.

**Job 1 — native, unmodified upstream (route E's build).** Vendor xtb at a pinned commit, build, run the suite. Measured cost: **205 s cold** (configure 20 s, compile 178 s, test 7 s at 8 cores); **7 s warm** on a cached image. This makes *"do all the tests of the original project pass?"* answerable **YES** on day one, keeps answering it across upstream rebases, and — if the wasm work stalls — leaves a working server-side product rather than nothing.

**Job 2 — wasm, route A.** Same suite, cross-compiled, with a checked-in skip allowlist so a *new* skip fails CI.

### 5.2 Write the criterion so it cannot be satisfied vacuously

Do not accept a summary line. The contract should read:

> Under `meson setup --cross-file cross/wasm32-emscripten-fortran.ini -Dopenmp=false -Ddefault_library=static -Dlapack=netlib -Dtblite=disabled -Dcpcmx=disabled`, the command
> `meson test -C build-wasm --print-errorlogs --no-rebuild -t 600 --num-processes 1 --suite xtb`
> reports **Ok: 34 / Expected Fail: 1 / Fail: 0 / Unexpected Pass: 0 / Timeout: 0** over 35 targets **and** the parsed tester stdout shows exactly **104 tests PASSED, 15 SKIPPED, 0 FAILED**, with the skip list matching this allowlist byte-for-byte:
> `eeq/hbond`, `dipro/J_ab,eff`, `cpx/solvation`, `ptb/ptb_not_present`, and the 11 `tblite/*` cases.
> The same must hold for `ctest --output-on-failure -R 'xtb/*'` (40 xtb-owned targets, including the six `--coffee` end-to-end runs meson never exercises).
> The identical native build at the identical feature flags must produce the identical per-suite counts.

That last clause is what makes it a test of the *port* rather than of the flags.

### 5.3 The fallback acceptance suite, if the user will relax

Three tiers. **Tiers 0 and 1 together are a stronger IR bar than xtb's own suite**, which has exactly 2 Hessian tests on one molecule.

**Tier 0 — free, do it on every route including A and C.** Lift xtb's own numeric fixtures verbatim:

| source | content | tolerance |
|---|---|---|
| `test/unit/test_hessian.f90` | H₂O `hessian_ref(9,9)` + `dipgrad_ref(3,9)`, GFN1 **and** GFN2, `step=1e-6` | **1e-7** (xtb's own `thr`) |
| `test/unit/test_thermo.f90` | `axis`, `calc`, `print` | as written |
| `test/unit/test_detrotra.f90` | 4 cases — rot/trans projection, low-mode selection | as written |
| `test/unit/test_gfn2.f90` | `scc`, `api`, `wbo`, `mindless-basic` | as written |

~11 of xtb's real tests, all on the IR path, all pure numerics with no build-system dependency.

**Tier 1 — the acceptance suite proper.** 20 molecules, fixtures frozen from `xtb <mol> --gfn 2 --hess` on the unmodified upstream binary:

`water, methane, benzene, acetone, ethanol, acetic acid, toluene, aniline, phenol, chloroform, DMSO, acetonitrile, pyridine, cyclohexane, ethyl acetate, nitrobenzene, benzaldehyde, caffeine, taxol, + one 3d-metal complex`

Two are already in the repo (`assets/inputs/coord/caffeine.coord`, `assets/inputs/xyz/taxol.xyz` — 113 atoms, the size stress case). The metal complex catches d-block parameterisation, which no small organic will.

| quantity | tolerance | rationale |
|---|---|---|
| total energy | 1e-8 Eh | xtb's gfn2 tests use 1e-10…1e-7 |
| gradient, per component | 1e-8 Eh/a₀ | same code path |
| dipole moment | 1e-7 e·a₀ | feeds IR intensities |
| Hessian elements | **1e-7 Eh/a₀²** at `step=1e-6` | xtb's own `test_hessian` threshold |
| frequencies > 500 cm⁻¹ | 0.1 cm⁻¹ | well-conditioned modes |
| frequencies < 500 cm⁻¹ | 1 cm⁻¹ | low modes are ill-conditioned — that is why `test_detrotra` exists |
| IR intensities, bands > 1 km/mol | 1% relative | weaker bands are noise and invisible when plotted |
| ZPVE | 1e-6 Eh | |
| S at 298.15 K | 0.01 cal/mol/K | |

**Tier 2 — the gate that protects the product.** Broaden each spectrum onto 400-4000 cm⁻¹ at 1 cm⁻¹ with a Lorentzian FWHM 20 cm⁻¹; require **cosine similarity ≥ 0.9999** against native xtb on the same grid. This is the assertion that maps onto what a user of ir.cheminfo.org sees, and it should be the headline CI gate.

Frame the tolerances correctly: **1 cm⁻¹ is a code-fidelity test, not a physics test.** GFN2-xTB's own systematic error against experimental IR is 30-50 cm⁻¹. Asking for 1 cm⁻¹ agreement *with native xtb* asks "did the port change the answer" — the right question. Budget: the full 135-case suite runs in 33 s serial natively, so 20 molecules with Hessians is well under a minute native, ~2-4 min in wasm.

### 5.4 De-risking order

1. **Before any wasm work**, run the native suite with `gfortran -finit-real=snan -finit-integer=-99999999 -finit-logical=true -ffpe-trap=invalid,zero,overflow`. Fix everything it finds. This is where every historical cross-compiler failure lived.
2. Pin the numerical environment: netlib reference LAPACK/BLAS 3.12 to wasm, `-Dopenmp=false`, no `-ffast-math`, no relaxed SIMD.
3. Instrument SCF iteration counts — dump the per-iteration `eel`, `eel-eold`, `rmsq` sequence (`src/scc_core.f90:555,568,622`) and diff native vs wasm. Matching iteration counts imply matching energies to ~10⁻¹² and everything downstream passes. Diverging counts are the root cause, not rounding.
4. Run `xtb/hessian` first — it is both the IR-relevant test and the canary.
5. Treat `xtb/symmetry` failures as pre-existing flake until proven otherwise (see below).

---

## 6. Open risks — what remains unverified

- **No wasm build of xtb was ever produced.** This machine has emcc, cmake and node but **no Fortran compiler of any kind** (no gfortran, flang, lfortran) and no meson/ninja. Hurdles (b) and (c) were tested with C stand-ins and native builds; hurdle (a) is inference from the toolchain study. Everything above is conditional on a Fortran→wasm compiler existing and working.
- **The libm measurement is toolchain-bound.** The ≤6 ULP figures are emscripten's musl libm via clang. If the Fortran front end routes `exp`/`erf` through its own runtime rather than emcc's C libm, the measurement must be redone against the actual toolchain.
- **flang-rt's Fortran I/O layer is unvalidated on wasm.** emscripten-forge's `flang_emscripten-wasm32` v22.1.6 builds with `-DFLANG_RT_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_TESTS=OFF`; its entire validation is one `hello.f90` `PRINT *`. Nothing exercises `OPEN`/`READ`/`WRITE`/`INQUIRE`/formatted edit descriptors/scratch files. xtb's suite would be the first workload to drive it. Note `flang-rt/lib/runtime/file.cpp:33-58` hard-codes `/tmp/Fortran-Scratch-XXXXXX` + `mkstemp` — fine under NODERAWFS, impossible under WASI. Exercised by `test_gfn2.f90:607`.
- **`xtb/symmetry` (4 cases) can never be a reliable gate.** `rattle()` at `test_symmetry.f90:234-250` uses unseeded `random_number`, so upstream CI already tests a different geometry every run. The C20 case (`:222-230`) is knife-edge: the same rattled geometry must classify `c2` at desy=0.1 and `c2v` at desy=0.2. Making it deterministic requires editing the test.
- **`xtb/random` (3 cases)** requires the wasm Fortran runtime to implement `random_seed(size=/get=/put=)` correctly. If it stubs them, those tests fail for a non-numerical reason.
- **Peak RSS per suite was not measured** (the container ran out of host disk). wasm32's 4 GB ceiling is very unlikely to bind for ≤30-atom test molecules, but confirm before committing to route A. The one large input is `taxol.xyz` at 113 atoms, and it appears only in `Info`, which parses and prints.
- **Quad precision is patched out** of the emscripten flang-rt build (`FLANG_RUNTIME_F128_MATH_LIB=""`). Grep for `real128` / `selected_real_kind(33` before relying on that being harmless. Relatedly, `libquadmath` absence is what disables tblite on aarch64 today and will do so on wasm32.
- **The acceptance scope is genuinely ambiguous and must be pinned with cheminfo/EPFL.** "All the tests of the original project" is not what upstream runs: meson filters `--suite xtb` (excluding all six subprojects' suites), CTest's `-R 'xtb/*'` is a substring regex, and CI explicitly excludes `tblite/gfn1-xtb`. The literal reading — `ninja test` with no filter, 131 CTest targets across six subprojects — has never been run by upstream on any platform, multiplies the port surface fivefold, and covers code the browser will never execute. Do not let it become the contract by default.