## SUMMARY
xtb (repo HEAD a45f05d, 2026-08-09, version 6.7.1) ships two parallel build systems — meson (primary, used by most CI jobs) and CMake — and neither has ever been cross-compiled: there is not one cross file, toolchain file, `--cross-file`, or `CMAKE_TOOLCHAIN_FILE` mention in the repo, and zero issues mentioning wasm/WebAssembly/emscripten in the tracker. For a wasm target CMake is the better base, decisively: `cmake/CMakeLists.txt:57-58` already carries an `LLVMFlang` compiler branch supplying `-fdefault-real-8 -fdefault-double-8`, whereas `meson/meson.build:28-98` has branches only for gcc/intel/intel-cl/pgi/nvidia_hpc — meson id `llvm-flang` falls through to an empty flag list, silently building with 4-byte default reals. CMake also lets you turn off tests, the shared library, OpenMP, tblite and CPCM-X with plain options; meson has no tests option, unconditionally pulls `dependency('threads')` (`meson/meson.build:128`), and injects a glibc-only `-D_Float128=__float128` C flag (`meson/meson.build:102`). LAPACK/BLAS is the hard blocker on both sides: there is no source-built fallback anywhere — no lapack/blas wrap in `subprojects/`, and CMake just does `find_package(LAPACK REQUIRED)`/`find_package(BLAS REQUIRED)`. The runtime-file picture is unexpectedly good for a browser: GFN2-xTB, GFN1-xTB and GFN-FF parameters are all compiled into the binary (`src/gfn_paramset.f90:59-82`, `src/gfnff/gfnff_param.f90:526-553`), the D4 reference data and all 40 GBSA/ALPB solvent parameter sets are compile-time `.fh` includes (981 KB across 44 files in `include/`), so a GFN2 hessian through the C API needs **zero** files on disk. The C API exposes 43 `bind(C)` entry points including `xtb_hessian` (`include/xtb.h:243-252`, `src/api/interface.f90:310-454`) which returns the Cartesian Hessian *and* the dipole gradient — everything needed for an IR spectrum — but there is no API for frequencies or IR intensities themselves; the mass-weighting/diagonalisation/`autokmmol` conversion lives CLI-side in `src/hessian.F90:499-533` and would have to be reimplemented by the caller. The C header's `xtb_hessian` prototype also disagrees with the Fortran implementation on argument order and type.

## BLOCKERS
None

## DETAILS
## 0. What was inspected

Working tree: `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/xtb`
HEAD `a45f05d397268fd683b5f9f824ed59912c5490b5`, 2026-08-09, `git describe --tags` = `bleed`. `meson.build` and `CMakeLists.txt` both declare **version 6.7.1**.

There is no `config/` directory in this repo (the task brief assumed one); the equivalents are `meson/`, `cmake/`, `assets/templates/` and `.github/workflows/`.

Scale to cross-compile: **177,447 lines** of Fortran across **348 files** in `src/` + `symmetry/` — 290 free-form `.f90`, 50 preprocessed `.F90`, 8 fixed-form `.f` (`src/david.f`, `src/drsp.f`, `src/esp.f`, `src/stm.f`, `src/surfac.f`, `src/disp/dftd3.f`, `src/gfnff/gfnff_rab.f`, `src/gfnff/math.f`) — plus exactly two C files (`src/mctc/signal.c`, `symmetry/symmetry_i.c`, 2009 lines) and one public header (`include/xtb.h`).

---

## 1. meson vs CMake, and which suits a wasm cross-build

### 1.1 What each build system actually does

| | meson | CMake |
|---|---|---|
| entry | `meson.build` (219 lines) + `meson/meson.build` (256 lines) + `meson_options.txt` | `CMakeLists.txt` (354 lines) + `cmake/CMakeLists.txt` (83 lines) + `cmake/modules/*.cmake` |
| min version | `>=0.62.0`, with an explicit `error()` on exactly 1.8.0 / 1.8.1 (`meson.build:33-35`) | `cmake_minimum_required(VERSION 3.17)` (`CMakeLists.txt:17`) |
| library | one `library()` with `default_library=both` from `default_options` (`meson.build:26`) → static **and** shared | `xtb-object` OBJECT lib → `lib-xtb-static` **and** `lib-xtb-shared`, both unconditional when `WITH_OBJECT=TRUE` (default) |
| dep resolution | meson wrap subprojects, `dependency(..., fallback: [...])` | `cmake/modules/Find*.cmake` → `xtb_find_package()` macro trying `cmake` → `pkgconf` → `subproject` → `FetchContent` (`cmake/modules/xtb-utils.cmake:26-143`) |
| tests | **unconditional** `subdir('test')` (`meson.build:219`); no option to disable | `option(WITH_TESTS ... TRUE)` (`cmake/CMakeLists.txt:21`), gated at `CMakeLists.txt:351` |
| pinned dep revisions | `subprojects/*.wrap` | duplicated as `set(_rev "v0.5.1")` etc. in each `cmake/modules/Find*.cmake` |

Both pin the same versions: mctc-lib v0.5.1, tblite v0.6.0, dftd4 v4.2.0, multicharge v0.5.0, CPCM-X v1.1.0, test-drive v0.5.0.

### 1.2 Why CMake is the better wasm base — five concrete reasons

1. **CMake already knows LLVM Flang; meson does not.**
   `cmake/CMakeLists.txt:57-58`:
   ```cmake
   elseif(CMAKE_Fortran_COMPILER_ID MATCHES "LLVMFlang")
     set(dialects "-fdefault-real-8 -fdefault-double-8")
   ```
   `meson/meson.build:28-98` branches only on `gcc`, `intel`, `intel-llvm`, `intel-cl`, `pgi`, `nvidia_hpc`. Meson's compiler id for LLVM Flang is `llvm-flang` (`mesonbuild/compilers/fortran.py:599-601`, `class LlvmFlangFortranCompiler`, added in meson 1.6). With flang, `fopts` stays `[]` and `add_project_arguments(fopts, language: 'fortran')` at `meson/meson.build:99` adds nothing — **no `-fdefault-real-8`**. That is a silent numerical corruption, not a build failure: `src/mctc/accuracy.f90` sets `wp = selected_real_kind(15)` so most code is fine, but the 8 fixed-form files and scattered plain `real ::` declarations (e.g. `src/iff/iff_energy.f90:980`, `src/mctc/namegen.f90:67`) would become 4-byte.

2. **Emscripten's official integration is a CMake toolchain file.** `emcmake cmake` is exactly the workflow cheminfo already uses for `openbabel-wasm`. Meson would need a hand-written cross file and meson's emscripten support is C/C++-shaped.

3. **CMake can be reduced to exactly what you need with options.** `-DWITH_OBJECT=FALSE -DWITH_TESTS=FALSE -DWITH_TBLITE=FALSE -DWITH_CPCMX=FALSE -DWITH_OpenMP=FALSE` gives a static-library-only build with no shared object (Emscripten "side modules" are a headache), no test-drive, no tblite/dftd4/multicharge/CPCM-X. Meson cannot skip the testsuite at all and needs `-Ddefault_library=static` to avoid the shared lib.

4. **meson pulls a hard `dependency('threads')`.** `meson/meson.build:128` is unconditional — `lib_deps += dependency('threads')`. Under emcc that resolves to `-pthread`, which forces SharedArrayBuffer + COOP/COEP headers on the deployed site. CMake never asks for Threads.

5. **meson injects a glibc-only C hack.** `meson/meson.build:101-102`:
   ```meson
   # fix compiliation problems with of symmetry/symmetry_i.c
   add_project_arguments('-D_Float128=__float128', language: 'c')
   ```
   This is a gcc/glibc `math.h` workaround. Against emscripten's musl headers on wasm32 it is at best inert and at worst breaks the build (clang has no `__float128` on wasm32). CMake does not do this; `symmetry/symmetry_i.c` only includes `stdio.h`, `stdlib.h`, `string.h`, `math.h`.

**The one thing meson does better** is LAPACK vendor selection (`-Dlapack=custom -Dcustom_libraries=['-L…','lapack','blas']`, `meson/meson.build:177-196`). CMake just calls `find_package(LAPACK REQUIRED)`, but you can force it with `-DLAPACK_LIBRARIES=… -DBLAS_LIBRARIES=…` or `-DBLA_VENDOR=Generic` (the CI already uses `-DBLA_VENDOR=Intel10_64lp` at `.github/workflows/fortran-build.yml:310`).

---

## 2. LAPACK/BLAS resolution — exact logic

### 2.1 meson (`meson/meson.build:131-209`)

```
lapack_vendor = get_option('lapack')            # default 'auto'
if 'auto' and fc_id in (intel, intel-llvm): lapack_vendor = 'mkl'
```
Then a five-way branch:

- **`mkl`** (`:138-158`) — `cc.find_library('mkl_intel_lp64')` (intel) or `mkl_gf_lp64` (gcc), plus `mkl_intel_thread`/`mkl_gnu_thread` if OpenMP else `mkl_tbb_thread`, plus `mkl_core`. `error('MKL not supported for this compiler')` for any other compiler.
- **`mkl-rt`** (`:159-161`) — `fc.find_library('mkl_rt')`.
- **`openblas`** (`:163-176`) — `dependency('openblas')` then `fc.find_library('openblas')`; then a **link probe** `fc.links('external dsytrs; call dsytrs(); end', …)` and, if it fails, additionally pulls `lapack`.
- **`custom`** (`:177-196`) — takes `custom_libraries` (array option). If the first element starts with `-L`, the rest are looked up in that directory via `cc.find_library(lib, dirs: …)`. Then **two link probes** (`dsytrs` for LAPACK, `dgemm` for BLAS) and `error()` if either fails.
- **`netlib` / anything else** (`:197-208`) — `dependency('lapack')` else `fc.find_library('lapack')`, plus `dependency('blas')` else `fc.find_library('blas')`.

**There is no source-built fallback.** `subprojects/` contains only `cpx.wrap`, `dftd4.wrap`, `mctc-lib.wrap`, `multicharge.wrap`, `tblite.wrap`, `test-drive.wrap`. `subprojects/.gitignore` lists the transitively-fetched wraps (`json-fortran-8.2.5`, `jonquil`, `mstore`, `numsa`, `s-dftd3`, `toml-f`) — still no LAPACK.

The `custom` route is the one you'd use for wasm. Its link probes only *link* (they don't run), so they work under emcc without an `exe_wrapper`, but they do produce a `.js`/`.wasm` per probe.

### 2.2 CMake

`CMakeLists.txt:83-84`:
```cmake
find_package("LAPACK" REQUIRED)
find_package("BLAS" REQUIRED)
```
Plain upstream FindLAPACK/FindBLAS — honours `BLA_VENDOR`, `BLA_STATIC`, and the `LAPACK_LIBRARIES`/`BLAS_LIBRARIES` overrides. Consumed at `CMakeLists.txt:156-157` and `:196-197`. Also re-found by consumers via `cmake/config.cmake.in`. No source fallback either.

### 2.3 Which routines actually matter

`src/mctc/lapack/` (`eigensolve.F90`, `geneigval.f90`, `gst.f90`, `stdeigval.f90`, `trf.f90`, `tri.f90`, `trs.f90`, `wrap.f90`) and `src/mctc/blas/` (`level1.F90`, `level2.F90`, `level3.F90`, `wrap1-3.f90`) declare **interfaces to the whole of BLAS/LAPACK in all four precisions** — those generate no symbols. The double-precision routines actually referenced by the interfaces are:

BLAS: `daxpy dcopy dgemm dgemv dger dscal dspmv dsymm dsymv dsyr2k dsyrk dtrsm`
LAPACK: `dgetrf dgetri dpotrf dpptrf dspev dspevd dspevx dspgst dspgvd dsptrf dsptri dsptrs dsyev dsyevd dsyevr dsyevx dsygvd dsygvx dsytrf dsytri dsytrs`

That is a modest subset — a reference netlib LAPACK compiled with the same wasm flang, or an f2c'd CLAPACK compiled with emcc, covers it. Note `dsygvd`/`dsyevd` (divide-and-conquer) pull in a large chunk of LAPACK's internals.

---

## 3. OpenMP

- meson: `option('openmp', type:'boolean', value:true, yield:true)`. Gate at `meson/meson.build:108-125`: `dependency('openmp')`, with hand-rolled `-qopenmp` / `-mp` fallbacks for Intel/NVHPC. `yield: true` means `-Dopenmp=false` propagates into mctc-lib/tblite/dftd4 subprojects too.
- CMake: `option(WITH_OpenMP ... TRUE)` (`cmake/CMakeLists.txt:18`), `find_package("OpenMP" REQUIRED)` at `CMakeLists.txt:80-82`, linked through generator expressions `$<$<BOOL:${WITH_OpenMP}>:OpenMP::OpenMP_Fortran>` at `:119`, `:158`, `:198`.

**A serial build is fully supported.** All 730 `!$omp` directives across 48 files are sentinel comments, and the 77 `!$` conditional-compilation lines (e.g. `src/hessian.F90:35 !$ use omp_lib`, `src/solv/gbsa.f90:861 !$ nproc=omp_get_max_threads()`) likewise vanish without `-fopenmp`. Nothing calls `omp_*` outside a sentinel.

Two caveats:
- **No CI job builds serially.** Every job in `.github/workflows/fortran-build.yml` leaves OpenMP on, so "supported" is by construction, not by test.
- The numerical-Hessian driver's parallel region (`src/type/calculator.f90:146-198`) is guarded by `if(self%threadsafe)` anyway; the loop degrades cleanly.

For a browser build you want `-DWITH_OpenMP=FALSE`: emscripten only supports OpenMP via pthreads, and flang-wasm ships no OpenMP runtime.

---

## 4. Build artifacts

| Artifact | meson | CMake |
|---|---|---|
| `xtb` CLI executable | `meson.build:141-152` (`xtb_exe`, sources = `prog`, linked against `xtb_dep_static`) | `CMakeLists.txt:227-244` (`xtb-exe`, OUTPUT_NAME `xtb`) |
| `libxtb` shared | from `default_library=both` at `meson.build:26` | `lib-xtb-shared`, `CMakeLists.txt:186-221`, VERSION 6.7.1 / SOVERSION 6 |
| `libxtb` static | idem, retrieved via `xtb_lib.get_static_lib()` at `meson.build:135` | `lib-xtb-static`, `CMakeLists.txt:138-171` |
| C API header | `install_headers(files('include/xtb.h'))`, `meson.build:154-160` | `CMakeLists.txt:257-262` |
| Fortran `.mod` files | `install_modules` option (default false), `meson.build:192-200` | `INSTALL_MODULES` option (default FALSE), `CMakeLists.txt:264-271` |
| symmetry C/Fortran | `srcs += 'symmetry/symmetry.f90'` and `'symmetry/symmetry_i.c'`, `meson.build:100-101` | `add_subdirectory("symmetry")`, `symmetry/CMakeLists.txt` appends both to `srcs` |
| parameter files | `install_data(xtb_parameter_files)`, `meson.build:180-190` | `CMakeLists.txt:274-284` → `${CMAKE_INSTALL_DATADIR}/xtb` |
| man pages | `asciidoctor`, optional, `meson.build:162-176` | not built |
| env scripts / pkg-config / tcl module | `assets/meson.build` (`config_env.bash`, `config_env.csh`, `xtb.pc`, `env-module.tcl`) | not built |
| CMake package config | — | `xtb-config.cmake`, `xtb-config-version.cmake`, `xtb-targets.cmake`, `CMakeLists.txt:311-348` |
| tests | `test/api/c_api_example.c` → `xtb_c_test`; `test/unit/*` → test-drive suite | same, gated on `WITH_TESTS` |

**Python bindings: gone.** `python/` contains only `README.md`: *"The Python API for `xtb` has been migrated to its own repository at https://github.com/grimme-lab/xtb-python."* Neither build system references it. `xtbenv.prepend('PYTHONPATH', …)` at `meson.build:212` is dead.

**Generated file**: exactly one — `xtb_version.fh`, from `assets/templates/version.f90` (`character(len=*),parameter :: version/date/author`), consumed by `src/header.f90:46`. meson writes it to the build root (`meson.build:78-82`); CMake to `${PROJECT_BINARY_DIR}/include/` (`cmake/CMakeLists.txt:79-83`). Both builds shell out to `git` for the commit hash; meson additionally runs `python3` three times at configure time for date/user/hostname (`meson.build:64-72`).

Note the split: `xtb_lib` is built from `srcs`, `xtb_exe` from `prog`. `src/prog/` (argparser, main.F90, dock, irmod, thermo, topology, info, primary, submodules) is **not** in the library. `src/extern/` **is** (`src/extern/meson.build` appends to `srcs`).

---

## 5. Runtime file and environment access — quantified

This is the part that turns out well for the browser.

### 5.1 Environment variables — one place

`src/type/environment.f90:136-149`:
```fortran
call rdarg(0, self%whoami, err)
call rdvar('HOSTNAME', self%hostname, err)
call rdvar('HOME', self%home, err)
call rdvar('PATH', self%path, err)
call rdvar('XTBHOME', self%xtbhome, err)
if (.not.allocated(self%xtbhome)) self%xtbhome = ''
if (err /= 0 .or. len(self%xtbhome) <= 0) self%xtbhome = self%home
call rdvar('XTBPATH', self%xtbpath, err)
if (.not.allocated(self%xtbpath)) self%xtbpath = ''
if (err /= 0 .or. len(self%xtbpath) <= 0) self%xtbpath = self%xtbhome
```
`rdvar` is `get_environment_variable` (`src/mctc/systools.F90:139-177`). Under emscripten `getenv` returns NULL, so `XTBPATH` ends up empty and every path search degrades to the bare filename — which is exactly the behaviour that triggers the compiled-in fallback. Other reads of `HOME`/`PATH` are in `src/extern/mopac.f90:72,85`, `src/extern/turbomole.f90:229`, `src/extern/driver.f90:300,317` (external-QM only).

### 5.2 `.xtbrc` — CLI only

`src/prog/main.F90:145` (`p_fname_rc = '.xtbrc'`) and `:362` `call rdpath(env%xtbpath, p_fname_rc, xrc, exist)`; also `src/prog/dock.f90:144`. Both are in `prog`, i.e. **not in libxtb**. The C API never reads `.xtbrc`.

### 5.3 The path-search primitive

`src/mctc/systools.F90:66-101` (`rdpath`) splits `XTBPATH` on the delimiter and `inquire(file=…)` each candidate. `src/readin.f90:54-69` wraps it as `xfind`, which **returns the bare name on failure** — a deliberate design note in the source: *"xfind succeeds if fname.ne.name, but if you inquire for fname in case of failure, you might hit a local file […] This is intended as a feature."*

### 5.4 Compiled-in vs on-disk parameters — the numbers

**Compiled in (zero runtime I/O):**

| Data | Where | Size |
|---|---|---|
| GFN1-xTB full parameter set | `src/xtb/gfn1.f90` (884 lines), reached via `use_parameterset` `src/gfn_paramset.f90:72-74` | part of 138 KB of `src/xtb/gfn*.f90` |
| GFN2-xTB full parameter set | `src/xtb/gfn2.f90` (970 lines), `src/gfn_paramset.f90:75-77`; `maxElem = 86` | idem |
| GFN-FF (AngewChem2020, 103 elements) | `src/gfnff/gfnff_param.f90:526-570` (`gfnff_load_param` → `loadGFNFFAngewChem2020`) | — |
| D4 reference polarizabilities | `include/param_ref.fh` via `src/disp/dftd4_parameters.f90:71` | **406,405 B** |
| Lebedev grids | `include/grida38.fh`, `include/grida86.fh` via `src/surfac.f:36` | 13,952 B |
| 14 GBSA + 26 ALPB solvent parameter sets | `include/param_gbsa_*.fh`, `include/param_alpb_*.fh` via `src/solv/model.f90:108-147` | — |
| **total `include/*.fh`** | 44 files | **981,559 B** |

**On disk at runtime:**

| File | Size | Compiled-in fallback? |
|---|---|---|
| `param_gfn2-xtb.txt` | 35,849 | **yes** |
| `param_gfn1-xtb.txt` | 27,800 | **yes** |
| `.param_gfnff.xtb` | 12,875 | **yes** |
| `param_gfn0-xtb.txt` | 39,220 | **no** — `src/gfn_paramset.f90:68-69` has `case('param_gfn0-xtb.txt') / return` before the assignment, deliberately disabling it |
| `param_ipea-xtb.txt` | 27,805 | no (not in the `select case`) |
| `param_gfn1-si-xtb.txt` | 28,007 | no |
| `param_ptb.txt` | — | no, and **the file is not even in the repo** (`src/ptb/calculator.F90:135-136`, `src/prog/main.F90:151`) |
| **total shipped** | **171,556 B** | |

The fallback machinery, `src/xtb/calculator.f90:147-160`:
```fortran
call open_file(ich, filename, 'r')
exist = ich /= -1
if (exist) then
   call readParam(env, ich, globpar, calc%xtbData, .true.)
   call close_file(ich)
else ! no parameter file, check if we have one compiled into the code
   call use_parameterset(filename, globpar, calc%xtbData, exist)
   if (.not.exist) then
      call env%error('Parameter file '//filename//' not found!', source)
```

**Consequence for ir.cheminfo.org: a GFN2-xTB Hessian driven through `xtb_loadGFN2xTB(env, mol, calc, NULL)` needs 0 bytes of MEMFS data.** The `NULL` path sets `filename = 'param_gfn2-xtb.txt'` (`src/api/calculator.f90:311-313`), `open_file` fails, `use_parameterset` matches, done. Same for GFN1 and GFN-FF. Only if you want GFN0 or ipea-xTB do you need to preload ~39 KB / ~28 KB.

### 5.5 Files written at runtime

The one to watch: **GFN-FF unconditionally writes `gfnff_topo` into the cwd**, `src/gfnff/gfnff_setup.f90:85-87`:
```fortran
if (.not.mol%info%two_dimensional) then
   call write_restart_gff(env,'gfnff_topo',mol%n,version,topo,neigh)
end if
```
The C API path passes `restart=.false.` (`src/api/calculator.f90:136`) so it never *reads* it, but it always writes. MEMFS with a writable cwd handles this. The CLI additionally reads `.CHRG`, `.UHF`, `.EFIELD` (`src/prog/main.F90:305-350`) and writes ~40 output files (`xtbopt.log`, `vibspectrum`, `xtbout.json`, `hessian`, `charges`, `wbo`, `g98.out`, …) — all CLI-side.

### 5.6 `execute_command_line` — 26 sites, all in the library, all inert

`src/extern/turbomole.f90` (13 sites), `src/extern/orca.f90` (3), `src/extern/mopac.f90:216`, `src/extern/driver.f90:195`, `src/screening.f90:300,303`. Because `src/extern/meson.build` appends to `srcs`, they land in `libxtb`. They are reachable only via `--orca`/`--turbomole`/`--mopac`/`--driver`, which the C API cannot select. Emscripten's `system()` returns failure; it links.

### 5.7 Signal handlers — CLI only

`src/mctc/mctc_init.F90:52-53` installs SIGINT/SIGTERM handlers through `src/mctc/signal.c`. Its **only** caller is `src/prog/primary.f90:42`. The C API instead uses `checkGlobalEnv` (`src/api/utils.f90:75-81`), which just allocates `persistentEnv`. So a library-only wasm build never touches `signal()`.

`src/mctc/mctc_linux.f90` declares raw `bind(c)` interfaces to `mkdir`/`rmdir`/`link`/`unlink`/`symlink`/`chdir`/`umask`/`chmod`. All exist in emscripten's musl; `symlink`/`link` are the shaky ones under MEMFS but are only used by scratch-directory helpers.

---

## 6. What a cross file / toolchain file would have to specify

### 6.1 The hard prerequisite

Emscripten's CMake toolchain has **no Fortran support at all** — `grep -i fortran /opt/homebrew/Cellar/emscripten/5.0.7/libexec/cmake/Modules/Platform/Emscripten.cmake` returns nothing across its 375 lines. It sets `CMAKE_SYSTEM_NAME Emscripten` (:17), `CMAKE_C_COMPILER=emcc` (:81), `CMAKE_CXX_COMPILER=em++` (:82), `CMAKE_AR=emar` (:84), `CMAKE_RANLIB=emranlib` (:85), forces `CMAKE_C_COMPILER_ID Clang` (:153), `CMAKE_EXECUTABLE_SUFFIX ".js"` (:275), `CMAKE_FIND_ROOT_PATH += EMSCRIPTEN_SYSROOT` (:219), `CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER` (:241), `CMAKE_CROSSCOMPILING_EMULATOR=node` (:365-368). CMake 4.3.2's own `Platform/Emscripten.cmake` adds `CMAKE_SHARED_LIBRARY_SUFFIX ".wasm"`.

CMake 4.3.2 *does* ship `Compiler/LLVMFlang-Fortran.cmake`, but there is no `Emscripten-LLVMFlang-Fortran.cmake`, so the Fortran side has to be wired manually.

The only working Fortran→wasm path today is **r-wasm/flang-wasm** (last push 2026-06-08, 24 stars, no tagged releases). Its `Makefile` builds LLVM from `github.com/r-wasm/llvm-project` branch `wasm` (head `7ca73ca1ab12`, 2026-05-18, *"Use i32 for index type in flang runtime"*) with:
```
-DLLVM_DEFAULT_TARGET_TRIPLE="wasm32-unknown-emscripten"
-DLLVM_TARGETS_TO_BUILD="WebAssembly"
-DLLVM_ENABLE_PROJECTS="clang;flang;mlir"
-DFLANG_ENABLE_FLANG_RT=OFF
```
then hand-compiles `flang-rt/lib/runtime/*.cpp` + `flang/lib/Decimal/*.cpp` with `em++` (`-DFLANG_LITTLE_ENDIAN -fPIC -fvisibility=hidden -DFE_UNDERFLOW=0 -DFE_OVERFLOW=0 -DFE_INEXACT=0 -DFE_INVALID=0 -DFE_DIVBYZERO=0 -DFE_ALL_EXCEPT=0`) and archives with `emar` into `libFortranRuntime.a`. Note: **no OpenMP runtime**, and the `-DFE_*=0` defines mean floating-point exception flags are stubbed.

Upstream LLVM has no wasm32 flang target — [llvm/llvm-project#54832](https://github.com/llvm/llvm-project/issues/54832) is the tracking issue; the root problem is that the flang runtime assumes host `sizeof()` equals target `sizeof()`, which breaks on wasm32 (hence r-wasm's "use i32 for index type" patch).

### 6.2 A CMake toolchain file would have to set

```cmake
# chain into emscripten's toolchain first
include($ENV{EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake)

set(CMAKE_Fortran_COMPILER        "<flang-wasm>/host/bin/flang")
set(CMAKE_Fortran_COMPILER_ID     "LLVMFlang")     # so cmake/CMakeLists.txt:57 fires
set(CMAKE_Fortran_COMPILER_FORCED TRUE)            # skip the try-compile, which cannot run
set(CMAKE_Fortran_COMPILER_WORKS  TRUE)
set(CMAKE_Fortran_COMPILER_TARGET "wasm32-unknown-emscripten")
set(CMAKE_Fortran_FLAGS_INIT
    "--target=wasm32-unknown-emscripten --sysroot=${EMSCRIPTEN_SYSROOT} -fno-strict-aliasing")
# Fortran link rule must go through emcc, not flang
set(CMAKE_Fortran_LINK_EXECUTABLE  "<emcc line> <OBJECTS> -o <TARGET> <LINK_LIBRARIES> -lFortranRuntime")
set(CMAKE_Fortran_CREATE_STATIC_LIBRARY "emar rcs <TARGET> <OBJECTS>")
set(CMAKE_Fortran_MODDIR_FLAG "-J")
```
plus, for a browser IR build:
`-DWITH_OBJECT=FALSE -DWITH_TESTS=FALSE -DWITH_OpenMP=FALSE -DWITH_TBLITE=FALSE -DWITH_CPCMX=FALSE`
`-DLAPACK_LIBRARIES=<wasm liblapack.a> -DBLAS_LIBRARIES=<wasm libblas.a>`
and link flags `-sEXPORTED_FUNCTIONS=[_xtb_newEnvironment,_xtb_newMolecule,_xtb_newCalculator,_xtb_loadGFN2xTB,_xtb_newResults,_xtb_hessian,…] -sALLOW_MEMORY_GROWTH=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sFORCE_FILESYSTEM=1`.

### 6.3 A meson cross file would have to specify

```ini
[binaries]
c       = 'emcc'
cpp     = 'em++'
fortran = '<flang-wasm>/host/bin/flang'
ar      = 'emar'
ranlib  = 'emranlib'
exe_wrapper = 'node'          # required: meson runs fc.links()/find_library() probes

[host_machine]
system     = 'emscripten'
cpu_family = 'wasm32'
cpu        = 'wasm32'
endian     = 'little'

[built-in options]
c_args           = ['-sUSE_PTHREADS=0']
fortran_args     = ['--target=wasm32-unknown-emscripten', '-fdefault-real-8', '-fdefault-double-8']
fortran_link_args = ['-lFortranRuntime']
default_library  = 'static'

[properties]
exe_suffix = 'js'
```
plus `-Dopenmp=false -Dtblite=disabled -Dcpcmx=disabled -Dlapack=custom -Dcustom_libraries=['-L…','lapack','blas']`. But you would still have to patch `meson/meson.build` to add an `llvm-flang` branch (otherwise `-fdefault-real-8` only arrives via the cross file's `fortran_args`, which is workable but fragile), drop the `dependency('threads')` at :128, drop the `-D_Float128` at :102, and add a `tests` option — four upstream patches versus zero for CMake.

---

## 7. Does the build support cross-compilation today? No.

Evidence:
- No `cross/`, no `*.cross`, no `*.ini` cross file, no `CMAKE_TOOLCHAIN_FILE` reference anywhere in the tree.
- `grep -i 'cross|toolchain|--cross-file|CMAKE_TOOLCHAIN'` over `README.md`, `meson/README.adoc` (208 lines) and `cmake/README.adoc` (172 lines) → nothing.
- `.github/workflows/fortran-build.yml` has 8 build jobs — gcc-meson (7 OS/compiler combos), gcc-cmake, two "lightweight" (`-Dtblite=disabled -Dcpcmx=disabled` / `-DWITH_CPCMX=false -DWITH_TBLITE=false`), mingw-meson, mingw-meson-static, intel-meson, intel-ifx-cmake, intel-ifx-meson — **every one is host == target**. The MinGW jobs run natively under MSYS2, not as a cross-build.
- `README.md` "**Compilers**: 1. ifort(<=2021.10.0), icc(<=2021.10.0) 2. gfortran, gcc 3. ifx, icx" — flang is not listed as supported despite the `LLVMFlang` branch in `cmake/CMakeLists.txt:57`.
- GitHub issue search on `grimme-lab/xtb` for `wasm`, `webassembly`, `emscripten` → **0 results each**. The only `cross-compile` hit is #1315 "Single precision computations to improve speed" (open), which is unrelated.

The one silver lining: `xtb-lightweight-meson-build` (`.github/workflows/fortran-build.yml:97-130`) proves that `-Dlapack=netlib -Dtblite=disabled -Dcpcmx=disabled` builds and passes the xtb test suite — i.e. the minimal dependency configuration you want for wasm is CI-verified on x86.

---

## 8. The C API surface — all 43 functions

`include/xtb.h` is 344 lines and declares **43** functions; `grep -n 'bind(C' src/api/*.f90` finds exactly **43** matching implementations (environment 8, calculator 13, results 15, interface 3, molecule 3, version 1). Full list with file:line of the Fortran implementation:

**Version** — `xtb_getAPIVersion` (`src/api/version.f90:35`; `XTB_API_VERSION 20000`, `xtb.h:25`)

**Environment** — `xtb_newEnvironment` (`environment.f90:47`), `xtb_delEnvironment` (:64), `xtb_checkEnvironment` (:83), `xtb_showEnvironment` (:107), `xtb_setOutput` (:132), `xtb_releaseOutput` (:167), `xtb_setVerbosity` (:192), `xtb_getError` (:215)

**Molecule** — `xtb_newMolecule` (`molecule.f90:47`), `xtb_delMolecule` (:98), `xtb_updateMolecule` (:115)

**Calculator** — `xtb_newCalculator` (`calculator.f90:58`), `xtb_delCalculator` (:72), `xtb_loadGFNFF` (:89), `xtb_loadGFN0xTB` (:152), `xtb_loadGFN1xTB` (:215), `xtb_loadGFN2xTB` (:278), `xtb_setSolvent` (:342), `xtb_releaseSolvent` (:451), `xtb_setExternalCharges` (:483), `xtb_releaseExternalCharges` (:546), `xtb_setAccuracy` (:579), `xtb_setMaxIter` (:622), `xtb_setElectronicTemp` (:661)

**Calculation** — `xtb_singlepoint` (`interface.f90:41`), `xtb_cpcmx_calc` (:159), **`xtb_hessian` (:312)**

**Results** — `xtb_newResults` (`results.f90:54`), `xtb_delResults` (:69), `xtb_copyResults` (:87), `xtb_getEnergy` (:109), `xtb_getSolvationEnergy` (:141), `xtb_getGradient` (:174), `xtb_getPCGradient` (:207), `xtb_getVirial` (:240), `xtb_getDipole` (:273), `xtb_getCharges` (:306), `xtb_getBondOrders` (:339), `xtb_getNao` (:372), `xtb_getOrbitalEigenvalues` (:404), `xtb_getOrbitalOccupations` (:438), `xtb_getOrbitalCoefficients` (:472)

### 8.1 Is a Hessian / vibrational-frequency / IR-intensity calculation reachable through the C API?

**Hessian: yes. Dipole gradient: yes. Frequencies and IR intensities: no — you get the raw ingredients and must do the last step yourself.**

`include/xtb.h:242-252`:
```c
/// Perform hessian calculation
extern XTB_API_ENTRY void XTB_API_CALL
xtb_hessian(xtb_TEnvironment /* env */,
            xtb_TMolecule /* mol */,
            xtb_TCalculator /* calc */,
            xtb_TResults /* res */,
            double* /* hessian */,
            int* /* atom_index_list */,
            int* /* step_size */,
            double* /* dipole_gradient */,
            double* /* polarizability_gradient */) XTB_API_SUFFIX__VERSION_2_0_0;
```

`src/api/interface.f90:310-312`:
```fortran
subroutine hessian_api(venv, vmol, vcalc, vres, c_hess, &
                     & c_step, c_list, c_dipgrad, c_polgrad) &
      & bind(C, name="xtb_hessian")
```
It calls the generic finite-difference driver `calc%ptr%hessian(...)` at `src/api/interface.f90:429-434`, symmetrises the Hessian (`:437-442`), and copies back `c_hess`, `c_dipgrad`, `c_polgrad`. The dipole gradient is **always** computed: `src/api/interface.f90:411-419`
```fortran
! Dipole gradient is required by the hessian method,
! so we have to allocate it
has_dipgrad = present(c_dipgrad)
if (.not. has_dipgrad) then
   allocate(dipgrad(3, 3*natom))
```
The underlying driver is `src/type/calculator.f90:116-199` (`subroutine hessian`), a central-difference over every Cartesian coordinate of every atom in `list`, filling `dipgrad(:, ii) = (dr - dl) * step2` at `:176` and `polgrad` at `:167-174`.

**What is missing.** The chain (Hessian, dipole gradient) → frequencies + IR intensities happens only in `src/hessian.F90` inside `numhess` (public at `src/hessian.F90:26`, body :31-552), which is **not** `bind(C)`. The intensity formula, `src/hessian.F90:524-533`:
```fortran
do i = 1, n3
   do k = 1, 3
      sum2 = 0.0_wp
      do j = 1, n3
         sum2 = sum2 + dipd(k,j)*(res%hess(j,i)*amass_au(j))
      end do
      trdip(k) = sum2
   end do
   res%dipt(i) = autokmmol*(trdip(1)**2+trdip(2)**2+trdip(3)**2)
end do
```
with the reduced masses computed just above (`:480-497`) and Raman activities at `:534-545`. `src/hessian.F90:499-523` carries a long comment explaining the mass-weighting, which is a good spec to port.

So the wasm wrapper has two options:
- **(a) Do the last step in JS/TS.** From `xtb_hessian` you get the 3N×3N Cartesian Hessian and the 3×3N dipole gradient. Mass-weight, diagonalise (there is already `dsyev` in the wasm LAPACK you must ship anyway, or use `ml-matrix`), project out translations/rotations (`trproj`, `src/hessian.F90:27`, also non-`bind(C)`), convert eigenvalues to cm⁻¹ and apply the formula above with `autokmmol` from `src/mctc/convert.f90`. ~60 lines.
- **(b) Add one Fortran export.** A new `bind(C, name="xtb_vibspectrum")` in `src/api/interface.f90` wrapping `numhess` would give frequencies + IR intensities + normal modes directly. This is a small, upstreamable patch and the cleaner long-run answer for ir.cheminfo.org.

### 8.2 Two defects in `xtb_hessian` you will hit

1. **Argument order and type mismatch between header and implementation.** C says `(…, double* hessian, int* atom_index_list, int* step_size, double* dipole_gradient, double* polarizability_gradient)`; Fortran says `(…, c_hess, c_step, c_list, c_dipgrad, c_polgrad)` with `real(c_double), intent(in), optional :: c_step` at `src/api/interface.f90:331`. Positions 6 and 7 are swapped **and** the step size is `int*` in C but a double in Fortran. This is undetected because the only consumer, `test/api/c_api_example.c:250`, is `xtb_hessian(env, mol, calc, res, hess, NULL, NULL, NULL, NULL);`.

2. **`c_list` is an assumed-shape array in a `BIND(C)` procedure** — `src/api/interface.f90:328`: `integer(c_int), intent(in), optional :: c_list(:)`. Under F2018/TS29113 that makes the C-side parameter a `CFI_cdesc_t*`, not the `int*` the header advertises. In practice: **pass NULL** and get all atoms (`src/api/interface.f90:405-409` builds `list = [(i, i=1, natom)]`). A partial-Hessian optimisation ("only displace the heavy atoms") is not safely reachable from C without fixing this.

Both are worth an upstream PR; neither blocks a full-molecule IR calculation.

---

## 9. Suggested minimal wasm configuration (summary)

```
cmake -B build -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE=<emscripten+flang chain file> \
  -DCMAKE_BUILD_TYPE=Release \
  -DWITH_OBJECT=FALSE      # static lib only, no Emscripten SIDE_MODULE
  -DWITH_TESTS=FALSE       # no test-drive subproject
  -DWITH_OpenMP=FALSE      # no OpenMP runtime exists for flang-wasm
  -DWITH_TBLITE=FALSE      # also drops dftd4 + multicharge subprojects
  -DWITH_CPCMX=FALSE       # CPCM-X reads xtb.cosmo at runtime (src/solv/cpx.F90:70)
  -DLAPACK_LIBRARIES=… -DBLAS_LIBRARIES=…
```
Remaining hard dependency: **mctc-lib v0.5.1** (unconditional at `CMakeLists.txt:42-44` / `meson/meson.build:216-222`), which itself pulls **jonquil → toml-f** (verified: `mctc-lib/config/meson.build` shows only `dependency('openmp')` and `jonquil_dep` — no LAPACK). All pure Fortran, so they cross-compile with the same flang.

Data to ship into MEMFS for a GFN2-xTB IR workflow: **nothing**. Add `param_gfn0-xtb.txt` (39 KB) only if GFN0 is wanted.

---

**Sources**
- [grimme-lab/xtb](https://github.com/grimme-lab/xtb) (local clone at HEAD `a45f05d`, 2026-08-09)
- [r-wasm/flang-wasm](https://github.com/r-wasm/flang-wasm) — last push 2026-06-08; `r-wasm/llvm-project` branch `wasm` head `7ca73ca1ab12`, 2026-05-18
- [llvm/llvm-project#54832 — WebAssembly (wasm32-wasi) target for flang](https://github.com/llvm/llvm-project/issues/54832)
- [Flang command line reference](https://flang.llvm.org/docs/FlangCommandLineReference.html)
- [meson `mesonbuild/compilers/fortran.py`](https://github.com/mesonbuild/meson/blob/master/mesonbuild/compilers/fortran.py) — `LlvmFlangFortranCompiler.id = 'llvm-flang'`
- [mesonbuild/meson#10102 — how to write meson.build when crosscompiling with emscripten](https://github.com/mesonbuild/meson/issues/10102), [#4101](https://github.com/mesonbuild/meson/issues/4101), [meson `cross/wasm.txt`](https://fossies.org/linux/meson/cross/wasm.txt)
- [Fortran on WebAssembly — George Stagg](https://gws.phd/posts/fortran_wasm/)
- Local: `/opt/homebrew/Cellar/emscripten/5.0.7/libexec/cmake/Modules/Platform/Emscripten.cmake`, `/opt/homebrew/Cellar/cmake/4.3.2/share/cmake/Modules/Platform/Emscripten.cmake`
