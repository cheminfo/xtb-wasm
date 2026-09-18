## SUMMARY
xtb's test suite (at HEAD a45f05d3, 2026-08-09) is small, self-contained, and much more portable than the codebase suggests. It is **one Fortran binary + one C binary + a handful of CLI invocations**: meson registers **35 test targets** (34 OK + 1 EXPECTEDFAIL), CMake registers **40 xtb-owned ctest targets** (CI's loose `-R 'xtb/*'` regex sweeps in 5 tblite-subproject tests for 45). Inside the Fortran `tester` binary there are **29 test-drive suites containing 135 individual `new_unittest` cases** in a full build (136 `new_unittest(` literals, one of which is `#else`-only), 1 of which (`eeq/hbond`) is permanently skipped. Assertions: **1184 `call check` sites in Fortran + 40 in C**, with the real comparison count far higher because many sit inside do-loops (test_hessian alone does 216 float comparisons from 4 sites). Total measured CI runtime: **36 s wall / 132 s serial** for the full debug+coverage meson build, **17.6 s wall** for CMake Release. Crucially for a WASM port: **no test spawns a subprocess** (all 26 `execute_command_line` sites live in `src/extern/*` + `src/screening.f90`, unreachable from any test), **no test reads a molecular structure from disk** (all geometries are hard-coded in `test/unit/molstock.f90`), and only 3 lines in the whole suite write files. Disk dependency is limited to 5 parameter text files resolved via `$XTBPATH` (with compiled-in fallbacks), and the CLI-only tests. Tolerances are **absolute** (test-drive default `rel=.false.`), mostly 1e-7…1e-10, and are demonstrably portable: the identical numbers pass on gfortran 10–15, ifort, ifx, x86_64 and aarch64, with netlib-reference LAPACK, OpenBLAS and MKL, and at OMP_NUM_THREADS 1 and 2. About 50% of the test cases (67/135) are relevant to a molecular IR calculation; 51 cover features irrelevant to IR (ptb, tblite backend, docking, oniom, dipro, cpx, random) and 17 are periodic-boundary-only.

## BLOCKERS
None

## DETAILS
## Scope and provenance

All findings are from the shallow clone at `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/xtb`, HEAD = **`a45f05d397268fd683b5f9f824ed59912c5490b5`** ("Fix L-ANC with fragmented Hessians and fixed atoms (#1429)", 2026-08-09). Timings are the real CI numbers for **that exact commit**, pulled from GitHub Actions run **31314350756**.

Test sources total **16,521 lines**: `test/unit/*.f90|.F90` (16,095) + `test/api/c_api_example.c` (426).

---

## 1. Every test target the build systems define

### 1.1 Meson — 35 targets

`meson.build:219` → `subdir('test')` → `test/meson.build:17-18` → `subdir('api')`, `subdir('unit')`.

| # | target | defined at | how invoked | suite |
|---|---|---|---|---|
| 1 | `C API` | `test/api/meson.build:17-28` | runs the `xtb_c_test` executable, no args | `xtb` |
| 2–30 | 29 test-drive suites | `test/unit/meson.build:86-89` | `tester <suite-name>` — one process per suite | `xtb:unit` |
| 31 | `Argparser print version` | `test/unit/meson.build:92` | `xtb --version` | `xtb` |
| 32 | `Argparser print help` | `:93` | `xtb --help` | `xtb` |
| 33 | `Argparser print license` | `:94` | `xtb --license` | `xtb` |
| 34 | `Argparser no arguments` | `:95` | `xtb` with **`should_fail: true`** | `xtb` |
| 35 | `Info` | `:97-103` | `xtb info assets/inputs/xyz/taxol.xyz assets/inputs/coord/caffeine.coord assets/inputs/coord/quartz.3d.coord assets/inputs/vasp/ammonia.vasp` (skipped on Windows) | `xtb` |

The 29 suite names come from the `tests` array at `test/unit/meson.build:34-63` (28 entries) plus `ptb` added explicitly at `:89` (its source has a `.F90` extension so it is listed separately, see `:68-70`).

Every target gets `env: xtbenv`, defined at `meson.build:213-216`:
```
LD_LIBRARY_PATH ← build dir
PYTHONPATH      ← <src>/python
XTBPATH         ← <src>          ← this one matters
```

If `test-drive` is not found *and* xtb is being built as a subproject, `test/unit/meson.build:30-32` calls `subdir_done()` and **no unit tests exist at all**.

### 1.2 CMake — 40 xtb-owned targets (of 131 registered)

`test/CMakeLists.txt:17-21` adds `api` only when `WITH_OBJECT`, and always adds `unit`.

| targets | defined at | invocation |
|---|---|---|
| `xtb/CAPI` (1) | `test/api/CMakeLists.txt:27-35` | `xtb_tests_capi` linked against the **shared** lib |
| `xtb/<suite>` (29) | `test/unit/CMakeLists.txt:92-106` | `xtb-tester <suite>` |
| `xtb/Argparser_print_version|help|license` (3) | `:111-113` | CLI |
| `xtb/Info` (1) | `:114-119` | CLI with the 4 asset files |
| `xtb/Singlepoint` | `:120` | `xtb --coffee --strict --norestart --namespace test1` |
| `xtb/IP/EA` | `:121` | `xtb --coffee --gfn 2 --vipea --strict --norestart --namespace test2` |
| `xtb/GFN0-xTB` | `:122` | `xtb --coffee --gfn 0 --strict --norestart --namespace test3` |
| `xtb/GFN1-xTB` | `:123` | `xtb --coffee --gfn 1 --strict --norestart --namespace test4` |
| `xtb/GFN2-xTB/GBSA` | `:124` | `xtb --coffee --gfn 2 --strict --gbsa h2o --norestart --namespace test5` |
| `xtb/GFN2-FF` | `:125` | `xtb --coffee --gfnff --strict --norestart --namespace test6` |

All carry `ENVIRONMENT XTBPATH=${PROJECT_SOURCE_DIR}` (`:96-98`, `:102-106`, `:127-136`, `test/api/CMakeLists.txt:31-35`) — note the **4 argparser/Info targets do NOT** get XTBPATH.

**The two build systems are not equivalent.** Meson has `Argparser no arguments` (expected-fail); CMake does not. CMake has the 6 `--coffee` CLI regression tests; Meson does not. Union = **41 distinct xtb-owned targets**.

In a full CMake build the subprojects (mctc-lib, tblite, dftd4, multicharge, CPCM-X, test-drive) register their own tests, bringing the ctest total to **131**. CI's `-R 'xtb/*'` is a regex meaning "xtb followed by zero or more slashes" — i.e. a substring match — so it also picks up 5 tblite tests (`tblite/gfn2-xtb`, `tblite/ipea1-xtb`, `tblite/xtb-param`, `tblite/xtb-external`, `tblite/xtbml`), giving **45**. `.github/workflows/fortran-build.yml:92` adds `-E 'tblite/gfn1-xtb'` to drop a sixth.

---

## 2. Fortran unit tests (test-drive v0.5.0)

**29 suites, 135 individual test cases in a full build** (136 `new_unittest("…")` literals; `test_ptb.F90` declares 17 under `#if WITH_TBLITE` and 1 under `#else`, `:54-74`).

Driver: `test/unit/main.f90` — a single `program tester` that builds `testsuites` at `:61-91`, takes `suite_name` as argv[1] and optional `test_name` as argv[2] (`:93-94`), and `error stop 1` if any test fails (`:123-126`).

| suite | cases | physics / area | IR-relevant? |
|---|---|---|---|
| `gfn2` | 11 | GFN2-xTB SCC, api, GBSA, salt, pcem, pcem_io, mindless-basic/-solvation/-cosmo, dmetal, wbo | **core** |
| `gfnff` | 11 | GFN-FF sp, harmonic, hb, gbsa, mindless, mindless-solvation, scaleup, pdb, sdf, pbc, Ln_An | **core** |
| `gfn1` | 10 | GFN1-xTB scc, api, gbsa, pcem, xb, pbc3d, mindless-basic/-solvation/-cosmo, ipea-indole | **core** |
| `gfn0` | 5 | GFN0-xTB sp, api, api-srb, mindless-basic, mindless-solvation | **core** |
| `hessian` | 2 | **numerical Hessian + dipole gradient** for H₂O, GFN1 and GFN2 | **core (the IR test)** |
| `detrotra` | 4 | projecting translations/rotations out of the Hessian; low-mode & adaptive-mode selection | **core** |
| `thermo` | 3 | axis (moments of inertia), calc (partition functions / free energy), print | **core** |
| `symmetry` | 4 | point groups: water→c2v, li8→td, pcl3→c3v, c20→c2 | **core** (σ-number, mode labels) |
| `molecule` | 2 | mic-distances, axis-trafo (mol mass 80303.05 au, moments 57768.74 / 361019.52) | **core** |
| `atomlist` | 7 | TAtomList container: defaults, constr1–4, manip1–2 | infra |
| `coulomb` | 8 | point-charge, GFN1-Mataga, GFN2-Klopman, Gaussian kernels × {cluster, pbc3d} | 4 cluster core / 4 PBC |
| `eeq` | 5 | electronegativity-equilibration charges: water, ewald, gbsa, **hbond (permanently skipped)**, salt | 3 core / 2 PBC-or-skip |
| `repulsion` | 2 | cluster, pbc3d | 1 core / 1 PBC |
| `dftd3` | 4 | 2-body & 3-body × {neighbourlist, latticepoints}, all pbc3d | PBC |
| `dftd4` | 4 | same, all pbc3d | PBC |
| `coordinationnumber` | 2 | CN via latticepoints and neighbourlist, both pbc3d | PBC |
| `ptb` | 17 | PTB method: basis, eeq, overlap, overlap_h0, overlap_sx, v_ecp, selfenergies, hamiltonian_h0, v_xc, hubbard, coulomb_pot, plus_U_pot, mb16-43-01(+charged,+efield), dipole_moment, polarizability | **not IR** |
| `tblite` | 11 | alternative tblite backend: gfn1/gfn2, ×mindless, ×gbsa/alpb/gb/gbe/cosmo, mindless-efield | **not IR** |
| `docking` | 4 | xtb-IFF docking: gfn2 eth/wat, wat/wat wall, wat/wat attpot, gfnff wat/wat | **not IR** |
| `peeq` | 3 | periodic GFN0 (sp, api, srb) | PBC |
| `oniom` | 3 | ONIOM QM/QM: calculateCharge, cutbond, singlepoint | **not IR** |
| `random` | 3 | RNG reproducibility: explicit seed replay, automatic seed replay, samerand alias | **not IR** |
| `wsc` | 2 | Wigner-Seitz cell (0d, 3d) | PBC |
| `pbc-tools` | 2 | cutoff, convert | PBC |
| `vertical` | 2 | Fukui functions / vertical IP-EA, gfn1 + gfn2 | **not IR** |
| `latticepoint` | 1 | pbc3d lattice-point generation | PBC |
| `iff` | 1 | intermolecular force field single point | **not IR** |
| `dipro` | 1 | dimer-projection charge-transfer integral J_ab,eff | **not IR** |
| `cpx` | 1 | CPCM-X solvation free energy | **not IR** |

**Two upstream cosmetic bugs**: `test_coordinationnumber.f90:32-33` registers `"lp-pbc3d"` twice, and `test_dftd4.f90:34-35` registers `"3b-nl-pbc3d"` twice. `tester <suite> <name>` can therefore only reach the first of each pair.

### The Hessian test in detail (`test/unit/test_hessian.f90`)

This is the one that matters for `ir.cheminfo.org`. Both cases:
1. build H₂O from `sym = ["O","H","H"]` + hard-coded `xyz` (`:54-59`),
2. `newXTBCalculator(env, mol, calc, method=1|2)` → `calc%singlepoint(...)`,
3. `calc%hessian(env, mol, chk, list, step=1.0e-6_wp, hessian, dipgrad)` (`:129`),
4. compare **all 27 dipole-gradient elements and all 81 Hessian elements** against literal reference arrays, `thr = 1.0e-7_wp` absolute (`:54`, `:131-141`).

So 4 `call check` sites expand to **216 float comparisons**. Reference magnitudes span 0.65 down to 3.5e-11; the smallest *non-noise* entries are ~9.6e-05 and ~4.0e-06, so 1e-7 absolute is ~0.1% and ~2.5% relative on those — comfortable. Runtime: 0.08 s.

---

## 3. C API tests

**One file, one binary, one target**: `test/api/c_api_example.c`, 426 lines, **40 `check(...)` assertions**, two functions called from `main` (`:421-425`).

`testFirst()` — propyne C₃H₄, 7 atoms:
- `xtb_getAPIVersion()` vs `XTB_API_VERSION` (`:67`)
- `xtb_newEnvironment/newCalculator/newResults/newMolecule`, error-path check that `xtb_getEnergy` on an unset calculator raises (`:70-82`)
- `xtb_setVerbosity/setAccuracy/setElectronicTemp/setMaxIter` (`:83-91`)
- `xtb_singlepoint` → `getEnergy/getCharges/getDipole/getBondOrders` in gas phase (`:94-102`)
- repeat under **GBSA** (`:115-127`), **ALPB** (`:141-153`), **COSMO** (`:180-192`), **CPCM-X** (`:214-227`, guarded by `-DWITH_CPCMX`, `test/api/meson.build:23-25`)
- **`xtb_hessian(env, mol, calc, res, hess, NULL, NULL, NULL, NULL)`** (`:250`) checking `hess[0]=0.4790088649`, `hess[3]=-0.0528761190`, symmetry `hess[3]==hess[63]`, `hess[440]=0.3636571159`, all at `tol=1.0e-9` (`:253-262`)

`testSecond()` — water dimer with 6 external point charges: `xtb_setExternalCharges`, `xtb_singlepoint`, `xtb_getEnergy`, `xtb_getGradient`, `xtb_getPCGradient`, `xtb_releaseExternalCharges` (`:344-387`).

Tolerance helper at `:19-26`: `check_double` uses `fabs(expected - actual) < tol` — again **absolute**.

Note the build-system divergence: meson links `xtb_dep_static`, CMake links `lib-xtb-shared` (`test/api/CMakeLists.txt:21-25`) and only builds it under `WITH_OBJECT` (`test/CMakeLists.txt:17`).

---

## 4. Python / shell / CLI regression tests

- **Python: none.** `python/` contains a single `README.md` saying the Python API moved to `grimme-lab/xtb-python`. Meson still prepends `<src>/python` to `PYTHONPATH` (`meson.build:215`) — vestigial.
- **Shell scripts: none.** `scripts/` holds `xtb-gaussian`, `otool_xtb`, `install-hooks.py`, `commit-msg` — none referenced by any test target.
- **CLI regression tests**: the 5 meson argparser/Info targets and the 6 CMake `--coffee` targets. External tooling needed: only a runnable `xtb` executable that accepts argv and returns an exit status. `--coffee` (`src/prog/main.F90:391-393` → `get_coffee(mol)`) builds caffeine in memory — no input file. `asciidoctor` is optional and only affects man-page generation (`meson.build:162`), never tests.

---

## 5. Per-file external dependencies

| dependency | which tests | detail |
|---|---|---|
| **reads data files from disk** | none of the 135 unit cases read a structure | all geometries hard-coded inline or via `test/unit/molstock.f90` (28 molecules, `:33-60`). The 5 `Info`-style CLI targets read `assets/inputs/{xyz/taxol.xyz, coord/caffeine.coord, coord/quartz.3d.coord, vasp/ammonia.vasp}` |
| **reads parameter files** | `gfn0/gfn1/gfn2/gfnff` (+ derived) suites and all CLI targets, when `XTBPATH` is set | `src/xtb/calculator.f90:120-158` resolves `param_gfn{0,1,2}-xtb.txt` on `$XTBPATH`, else falls back to `use_parameterset` (compiled-in). `src/gfnff/calculator.f90:124-138` same for `.param_gfnff.xtb` → `gfnff_load_param`. `src/solv/model.f90:570-602` resolves solvation parameter files. `src/prog/main.F90:362` reads `.xtbrc` from `$XTBPATH` (the repo root ships one). Total on-disk parameter payload ≈ 164 KB across `param_gfn0-xtb.txt` (39,220 B), `param_gfn2-xtb.txt` (35,849 B), `param_gfn1-xtb.txt` (27,800 B), `param_ipea-xtb.txt` (27,805 B), `param_gfn1-si-xtb.txt` (28,007 B), `.param_gfnff.xtb` (12,875 B) |
| **writes scratch files** | 3 lines total | `test_gfn2.f90:607` `open(newunit=tmp_unit, Status="Scratch")` + `:617` delete (the `pcem_io` case); `test_oniom.f90:294` `open_file(io,"w.coord","w")`. The 6 CMake CLI targets write namespaced outputs into CWD (`test1.charges`, `test1.wbo`, …) via `get_namespace` (`src/setparam.f90:578-596`); `--norestart` suppresses `xtbrestart` |
| **environment variables** | `XTBPATH` set by both build systems; `OMP_NUM_THREADS` set by CI only | `meson.build:216`, `test/unit/CMakeLists.txt:97`. `XTBHOME` is read (`src/type/environment.f90:140-148`) but falls back to `$HOME`, then to `''` — never required |
| **spawns subprocesses** | **none** | all 26 `execute_command_line` sites are in `src/extern/{turbomole,orca,mopac,driver}.f90` and `src/screening.f90` — unreachable without `--input` external-runtype flags no test sets |
| **needs the CLI executable** | 5 meson targets + 10 CMake targets | the other 30 need only the static/shared library |
| **installs signal handlers** | every run of `tester` | `test/unit/main.f90:57` `mctc_init` → `src/mctc/mctc_init.F90:52-53` → `src/mctc/signal.c:16` `signal(SIGINT/SIGTERM, …)` |
| **OpenMP** | no `!$omp` in test code except the output-serialising `critical` in `main.f90:149,178` | 43 source files use OpenMP; CI runs at `OMP_NUM_THREADS=2,1` and (MinGW) `1`, both green |

---

## 6. Measured wall-clock runtime

From run **31314350756** (commit a45f05d3):

| configuration | job | build | test wall | test serial sum |
|---|---|---|---|---|
| gfortran-14, meson, `--buildtype=debug -Db_coverage=true`, tblite+CPCM-X | 93247066106 | 2 m 41 s | **36 s** | **132.12 s** |
| gcc-14, CMake **Release**, tblite+CPCM-X, `ctest --parallel` | 93247066047 | 2 m 39 s | **17.59 s** | — |
| gfortran-14, meson debug, tblite+CPCM-X **disabled** | 93247066018 | 1 m 16 s | **12 s** | **36.01 s** |
| ifort + MKL static, meson, `--num-processes 1` (serial) | 93247066030 | 5 m 24 s | **14 s** | 14 s |

Slowest suites in the debug+coverage build: `gfn2` 29.85 s, `gfnff` 24.76 s, `gfn1` 18.87 s, `tblite` 17.32 s, `docking` 12.62 s, `ptb` 5.31 s, `gfn0` 4.35 s, `dftd3` 4.11 s, `dftd4` 3.94 s, `coulomb` 2.45 s, `cpx` 1.78 s, `C API` 1.69 s. Those 12 = 127.05 s of 132.12 s (96%). Everything else is ≤ 0.8 s.

The `-t 120` in CI is a **timeout multiplier** (120 × meson's 30 s default = 1 h/test), not a measurement — it exists purely for the slow debug+coverage builds, not because anything takes an hour.

CI never runs a bare `meson test -C build`; it always filters `--suite xtb`, which excludes the subproject suites. `README.md:51` and `:95` document `ninja -C build test` / `make -C build test`, which run **everything**, subprojects included (131 ctest targets in the CMake case).

---

## 7. Numerical tolerances

**All absolute.** test-drive v0.5.0 `src/testdrive.F90:641-657`:
```fortran
if (present(thr)) then; threshold = thr; else; threshold = epsilon(expected); end if
if (present(rel)) then; relative = rel; else; relative = .false.; end if
if (relative) then; diff = abs(actual-expected)/abs(expected)
else;              diff = abs(actual-expected); end if
```
`grep 'rel=' test/unit/*.f90` → **zero hits**. A missing `thr` therefore means **2.22e-16 absolute**.

Assertion inventory: **1184 `call check`/`check_` sites** in Fortran (+ 40 `check()` in C). 969 pass an explicit `thr=`; 215 do not — and those 215 are almost entirely integer/logical/string overloads (`check(error, basis%nao, 8)`, `check(error, res%converged)`, `check(error, pgroup, "c2v")`, `check(error, latp%nTrans, 389)`). The real number of *evaluated* comparisons is far higher because many sites are inside `do` loops (test_hessian: 4 sites → 216 comparisons).

| threshold | where | quantity compared, typical magnitude |
|---|---|---|
| `1.0e-10` | `test_coulomb.f90:52,374,835,1291`; `test_dftd3.f90:58,433,609`; `test_dftd4.f90:60,490,673`; `test_coordinationnumber.f90:48,165`; `test_eeq.f90:53,392,525`; `test_gfn2.f90:400,541`; `test_gfnff.f90:67,202,284`; `test_iff.f90:53`; `test_molecule.f90:47,89`; `test_pbc_tools.f90:43,90`; `test_peeq.f90:214`; `test_repulsion.f90:166`; `test_wsc.f90:47,78` | energies (Eh, O(1–100)), gradient components (Eh/a₀, O(1e-3–1e-1)), CNs (O(1–6)), σ tensor elements |
| `1.0e-9` | `test_coulomb.f90:202,634,1091,1444`; `test_eeq.f90:152`; `test_gfn1.f90:313,448,517`; `test_gfn2.f90:187`; `test_peeq.f90:296`; `test_repulsion.f90:49`; C API `hess[…]` | GBSA/salt energies, partial charges (|q| < 1), Hessian elements (O(0.05–0.65)) |
| `1.0e-8` | `test_gfn0.f90:343,424`; `test_gfn1.f90:595,676,764,857`; `test_gfn2.f90:682,763,849,921,1006`; `test_gfnff.f90:371,446,526,600,671,738,946`; `test_thermo.f90:51,155,210` | mindless-molecule total energies (O(10–60 Eh)), gradient norms, thermo quantities |
| `1.0e-7` | `test_gfn0.f90:67,183,252`; `test_gfn1.f90:71,246`; `test_gfn2.f90:73`; `test_hessian.f90:54,150`; `test_oniom.f90:61,160,257`; `test_peeq.f90:68`; `test_ptb.F90:35` | **Hessian + dipole gradient**, SCC energies |
| `5.0e-7` | `test_gfn2.f90:255,329` | GBSA / salt SCC |
| `5.0e-8` / `1.0e-6` | `test_tblite.f90:29` (`thr`, `thrg`) | tblite energies / gradients |
| `1.0e-6` | `test_eeq.f90:153` (thr2); `test_docking.f90:60,212,363,515` | dq/dr derivatives, docking energies |
| `1.0e-5` | `test_gfn0.f90:68`, `test_gfn1.f90:72`, `test_gfn2.f90:74` (thr2 = gradients); `test_thermo.f90:52,211`; `test_molecule.f90:120,129,130` | gradient components, molmass 80303.05 au, moments of inertia 5.8e4 / 3.6e5 |
| `1.0e-4` | `test_gfn0.f90:152`, `test_gfn1.f90:140,288`, `test_gfn2.f90:143`, `test_peeq.f90:156,180`, `test_ptb.F90:37`, `test_gfnff.f90:947` (`qthr`) | HOMO–LUMO gaps in eV (O(2–14 eV)) |
| `1.0e-3` | `test_docking.f90:142,288,439,600`; `test_ptb.F90:38` | docking internal coordinates (−4.5265, 0.0) |
| `3.0e-3` | `test_gfnff.f90:739` (thr2) | GFN-FF gradients on large systems |
| `2.0e-3` | `test_dipro.f90:64` | J_ab,eff coupling in eV |
| `1.0e-2` | `test_vertical.f90:53,104` | Fukui function values (O(0.1–1)) |
| `1.0e-1` | `test_ptb.F90:42` (`thr_alpha`) | polarizability (a.u., O(10–100)) |
| `1000·ε` = `2.22e-13` | `test_gfnff.f90:154` | harmonic-potential energy |
| `ε(0.0_wp)` = `2.22e-16` (`ε(0.0_sp)` = `1.19e-7`) | `test_detrotra.f90:64,88,111,…` | eigenvalues *passed through unchanged* (40.6, 3.0), plus `count(eig == 0.0)` exact equality — structural, not numerical |

**Portability evidence — this is the key de-risking datum.** The identical literals and identical absolute tolerances pass across every axis of `.github/workflows/fortran-build.yml`: gfortran 10/11/12/13/14/15, ifort 2022.1, ifx 2024.1/2025.1/2025.2; x86_64 Linux, aarch64 Linux (`ubuntu-24.04-arm`), arm64 macOS, Intel macOS, MinGW64 Windows; **netlib reference LAPACK** (`-Dlapack=netlib`, line 52/124/196), OpenBLAS (line 36/43), and MKL (line 247/310); and at `OMP_NUM_THREADS=2,1` (line 58) *and* `OMP_NUM_THREADS=1` (line 205). The tolerances are therefore not bit-exactness traps — they were chosen to survive exactly the kind of BLAS/compiler substitution a WASM build forces.

The two things a WASM build must still supply: a LAPACK/BLAS implementation (`ddot` 46 call sites, `dgemm` 19, `dgemv` 14, `dsytrf` 11, `dsymm` 7, `sdot` 7, `ssyev` 6, `dsyev` 5, `dsygvd` 4, `dsytri` 3, `dpotrf` 3, plus `z*` variants), and the `signal()` stub at `src/mctc/signal.c`.

---

## 8. IR-relevant vs. irrelevant

Of the **135** cases in a full build:

| bucket | cases | % | suites |
|---|---|---|---|
| **Directly in the IR path** (SCF energy → gradient → numerical Hessian → dipole gradient → rot/trans projection → frequencies → thermo) | **52** | 39% | gfn0 5, gfn1 10, gfn2 11, gfnff 11, hessian 2, detrotra 4, thermo 3, symmetry 4, molecule 2 |
| **Molecular Hamiltonian components** consumed by the above | **15** | 11% | atomlist 7, coulomb (4 cluster), eeq (water/gbsa/salt = 3), repulsion (cluster = 1) |
| **Periodic-boundary-only** (irrelevant for molecular IR) | **17** | 13% | coordinationnumber 2, coulomb-pbc3d 4, dftd3 4, dftd4 4, eeq-ewald 1, eeq-hbond 1 (permanently skipped), repulsion-pbc3d 1 |
| **Features unrelated to IR** | **51** | 38% | ptb 17, tblite 11, docking 4, random 3, oniom 3, peeq 3, wsc 2, pbc-tools 2, vertical 2, iff 1, dipro 1, cpx 1, latticepoint 1 |

**Molecular-IR-relevant total: 67 / 135 (50%).** At target granularity: 17 of the 35 meson targets.

Dropping the "unrelated" bucket would remove **39.79 s of the 132.12 s** serial runtime (30%) *and* the two hardest subprojects to port — tblite (17.32 s) and CPCM-X (1.78 s), both of which are already optional via `-Dtblite=disabled -Dcpcmx=disabled` / `-DWITH_TBLITE=false -DWITH_CPCMX=false`. In that lightweight configuration, `tblite`, `cpx`, `dipro` and `ptb` all still run as targets but skip internally in 0.01–0.02 s (job 93247066018), and 104 of 119 cases actually execute.

---

## 9. What "all tests pass" means operationally

Three defensible readings, in increasing strictness. Pin one before starting the port.

**(a) The bar upstream CI actually holds itself to — recommended acceptance criterion.**
```
meson setup _build --buildtype=debug --warnlevel=0 -Dlapack=netlib
meson compile -C _build
OMP_NUM_THREADS=1 meson test -C _build --print-errorlogs --no-rebuild -t 120 --suite xtb
```
Must produce: `Ok: 34 / Expected Fail: 1 / Fail: 0 / Unexpected Pass: 0 / Skipped: 0 / Timeout: 0` over **35 targets**, which internally execute **134 of 135 test cases** (`eeq/hbond` is permanently skipped by `test_eeq.f90:505`) and evaluate well over 1200 individual `check` comparisons. **Reference runtime: 36 s wall on a 4-vCPU GitHub runner (132 s serial) in debug+coverage; 17.6 s wall in Release.** Under a single-threaded Node/WASM runtime with no test-level parallelism, budget the serial figure plus WASM's slowdown factor.

**(b) The CMake equivalent**, which additionally proves the CLI driver works end-to-end:
```
cmake -B _build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build _build
cd _build && OMP_NUM_THREADS=1 ctest --parallel --output-on-failure -R 'xtb/*' -E 'tblite/gfn1-xtb'
```
Must report `100% tests passed out of 45` in ~18 s. This adds the 6 `xtb --coffee` CLI targets that meson lacks — meaning the WASM artifact must be invokable as a program with argv, a working CWD it can write namespaced output files into, and `XTBPATH` pointing at a virtual FS holding the parameter files and `.xtbrc`.

**(c) The literal reading of "all tests of the original project"** — `ninja -C build test` / `make -C build test` with no filter, i.e. **131 ctest targets** including every subproject's own suite (mctc-lib, tblite, dftd4, multicharge, CPCM-X, test-drive). Upstream CI has never run this configuration on any platform. I would not accept it as the contract: it multiplies the port surface by five subprojects for zero IR-relevant coverage, and 96 of those 131 targets test code the browser will never execute.

**The genuinely good news for the port**, in one line: the acceptance criterion requires **31 process launches of 2 binaries** (`tester` × 29 + `xtb_c_test` + `xtb` × 5), **zero subprocess spawning**, **zero structure-file reads**, **3 lines of file writing**, and tolerances that already survive a swap from MKL to reference LAPACK and from 2 threads to 1 — which is exactly the substitution a WebAssembly build represents.
