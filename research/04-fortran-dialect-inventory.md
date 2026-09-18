## SUMMARY
xtb + its mandatory dependency tree is ~368k lines of Fortran across 10 repos, and it is uniformly modern Fortran: heavy F2003 OOP (1,000+ `class(...)` declarations, 800+ type-bound procedures, `select type`, deferred bindings, allocatable deferred-length strings) sitting on an F2008 baseline (`contiguous`, `block`, `do concurrent`, `norm2`, `newunit=`, `error stop`). Crucially, it uses none of the genuinely hard features: zero coarrays, zero parameterized derived types, zero submodules in any `src/` tree (the single `submodule` in the whole corpus is in a tblite unit test), zero `impure elemental`, and no `equivalence`/`entry`/assigned-goto. That puts f2c and LFortran out of reach for different reasons (f2c is F77-only against a 99%-free-form F2003/F2008 codebase; LFortran is still alpha at 9/10 beta codes, self-describes as reliable at 500–1,000 LOC, and has no `-fdefault-real-8`, which xtb hard-requires), while gfortran is the reference compiler and LLVM Flang is the only realistic wasm route. The decisive practical facts are: (1) xtb — unlike every one of its dependencies — is built with `-fdefault-real-8 -fdefault-double-8` and genuinely depends on it (526 `real*8` declarations, 128 unsuffixed literals with ≥9 decimals, 41 bare `double precision`); (2) grimme-lab/xtb PR #1207 "Add initial support of LLVMFlang" was merged 2025-03-05 with only 5 files touched and the author reporting all tests passing without OpenMP; and (3) r-wasm/flang-wasm already ships a patched flang plus an Emscripten-built `libFortranRuntime.a` and successfully builds reference BLAS/LAPACK 3.12.0 for wasm32. OS coupling is small and well-localized: 21 live `execute_command_line` calls, all in `src/extern/` (Turbomole/ORCA/MOPAC drivers) plus `screening.f90`; a `signal()` handler in `src/mctc/signal.c`; 3 `get_environment_variable`; and GFN1/GFN2 parameters are compiled into the binary as a fallback (`use_parameterset`), so the IR path needs no parameter files.

## BLOCKERS
None

## DETAILS
## 1. Scope: what actually has to be compiled

Pinned dependency graph, resolved from `xtb/subprojects/*.wrap` and each dependency's own wraps (all shallow-cloned at the pinned tag into `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/deps/`):

```
xtb (main @ a45f05d, 2026-08-09)
├── mctc-lib v0.5.1            (always required)
│   ├── toml-f v0.4.3
│   └── jonquil v0.3.0
├── tblite v0.6.0              (WITH_TBLITE, default ON)
│   ├── mctc-lib v0.5.1, multicharge v0.5.0, dftd4 v4.2.0
│   ├── s-dftd3 v1.4.0         (required by tblite/config/meson.build)
│   └── toml-f v0.5.0
├── dftd4 v4.2.0               (required with tblite)
├── multicharge v0.5.0         (required with tblite)
├── CPCM-X v1.1.0 "cpx"        (WITH_CPCMX, default ON)
│   ├── mctc-lib v0.3.2, toml-f v0.4.2, numsa v0.2.0
└── test-drive v0.5.0          (tests only)
```

### Source census (src trees only, tests/apps excluded)

| project | .f90 | .F90 | fixed `.f` | Fortran LOC | C |
|---|---|---|---|---|---|
| **xtb** (src+symmetry) | 290 | 50 | 8 | **177,447** | 2 |
| s-dftd3 v1.4.0 | 24 | 0 | 0 | 78,707 | 2 |
| tblite v0.6.0 | 160 | 2 | 0 | 52,442 | 1 |
| toml-f v0.5.0 | 35 | 0 | 0 | 12,520 | 0 |
| mctc-lib v0.5.1 | 52 | 5 | 0 | 12,335 | 0 |
| dftd4 v4.2.0 | 27 | 1 | 0 | 11,836 | 1 |
| CPCM-X v1.1.0 | 23 | 0 | 0 | 8,793 | 1 |
| numsa v0.2.0 | 13 | 0 | 0 | 7,577 | 0 |
| multicharge v0.5.0 | 13 | 3 | 0 | 5,243 | 0 |
| jonquil v0.3.0 | 5 | 0 | 0 | 1,305 | 0 |
| test-drive v0.5.0 | 1 | 1 | 0 | 2,051 | 0 |
| **total** | | | | **≈368,000** | |

Two mitigations on the raw size: 66,222 of s-dftd3's 78,707 lines are a single generated parameter table (`deps/s-dftd3/src/dftd3/reference.f90`) with no interesting language features, and the whole tblite/dftd4/multicharge/s-dftd3/toml-f/CPCM-X sub-tree disappears under `-DWITH_TBLITE=FALSE -DWITH_CPCMX=FALSE`.

---

## 2. Fortran standard level

**Every component requires Fortran 2008. None requires Fortran 2018.** The build systems never pass a `-std=` flag, so the evidence is the feature set itself.

Src-only counts (`/tmp/feat2.sh`, ripgrep over `src/` trees):

| feature | std | xtb | mctc-lib | tblite | dftd4 | multichg | cpx | toml-f | s-dftd3 |
|---|---|---|---|---|---|---|---|---|---|
| `class(...)` polymorphic decl | F2003 | 354 | 31 | 388 | 82 | 42 | 26 | 326 | 107 |
| type-bound `procedure ::` | F2003 | 278 | 24 | 313 | 24 | 22 | 22 | 73 | 30 |
| `generic ::` binding | F2003 | 18 | 0 | 42 | 4 | 0 | 5 | 4 | 4 |
| `abstract interface` | F2003 | 12 | 4 | 14 | 2 | 2 | 0 | 5 | 1 |
| deferred binding | F2003 | 10 | 2 | 26 | 7 | 5 | 0 | 21 | 4 |
| `extends(` | F2003 | 23 | 5 | 57 | 3 | 4 | 0 | 12 | 5 |
| `select type` | F2003 | 46 | 0 | 21 | 2 | 2 | 0 | 23 | 2 |
| `class(*)` unlimited poly | F2003 | 1 | 0 | 5 | 0 | 1 | 0 | 0 | 0 |
| `final ::` finalizer | F2003 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `interface operator/assignment` | F2003 | 5 | 0 | 2 | 0 | 0 | 0 | 3 | 0 |
| named generic `interface` | F95 | 254 | 22 | 80 | 19 | 25 | 11 | 41 | 4 |
| procedure pointer component | F2003 | 3 | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| `allocatable` (all uses) | F90/03 | 1862 | 212 | 950 | 107 | 94 | 160 | 193 | 138 |
| `move_alloc` | F2003 | 59 | 20 | 89 | 10 | 5 | 3 | 26 | 11 |
| `allocate(source=)` | F2003 | 466 | 27 | 61 | 15 | 24 | 0 | 7 | 41 |
| `allocate(mold=)` | F2008 | 11 | 0 | 2 | 0 | 5 | 0 | 0 | 0 |
| deferred-len alloc `character(:)` | F2003 | 271 | 65 | 154 | 9 | 3 | 24 | 35 | 21 |
| `associate` | F2003 | 13 | 6 | 65 | 0 | 0 | 3 | 1 | 0 |
| `block` construct | **F2008** | 8 | 9 | 25 | 2 | 2 | 0 | 2 | 0 |
| `contiguous` attribute | **F2008** | 90 | 0 | 165 | 11 | 49 | 3 | 0 | 4 |
| `do concurrent` | **F2008** | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `norm2` | **F2008** | 111 | 12 | 24 | 7 | 10 | 2 | 0 | 11 |
| `newunit=` | **F2008** | 23 | 2 | 19 | 4 | 0 | 1 | 2 | 4 |
| `error stop` | **F2008** | 14 | 1 | 25 | 9 | 7 | 9 | 2 | 2 |
| `iso_c_binding` | F2003 | 30 | 0 | 13 | 1 | 0 | 3 | 0 | 1 |
| `bind(c` | F2003 | 65 | 0 | 97 | 23 | 0 | 10 | 0 | 34 |
| `c_f_pointer` | F2003 | 76 | 0 | 109 | 40 | 0 | 8 | 0 | 44 |
| `iso_fortran_env` | F2003/08 | 23 | 1 | 3 | 5 | 0 | 7 | 1 | 1 |
| `ieee_arithmetic` | F2003 | 1 | 0 | 0 | 3 | 0 | 1 | 0 | 1 |
| `elemental` | F95 | 112 | 34 | 32 | 22 | 26 | 2 | 3 | 11 |
| `pure` procedure | F95 | 685 | 53 | 282 | 28 | 22 | 13 | 62 | 17 |
| `recursive` | F90 | 10 | 0 | 0 | 0 | 0 | 1 | 11 | 0 |
| `!$omp` directive | OpenMP | 759 | 32 | 232 | 119 | 157 | 0 | 0 | 252 |
| cpp `#if/#include` | ext | 211 | 20 | 3 | 2 | 6 | 0 | 0 | 0 |

### What is conspicuously absent — this is the good news

| feature | count anywhere |
|---|---|
| **coarrays** (`codimension`, `[*]`, `sync all`, `this_image`, `co_sum`) | **0** |
| **parameterized derived types** | **0** |
| **submodules** in any `src/` | **0** (one in `deps/tblite/test/unit/test_coulomb_multipole.f90:1253`) |
| `impure elemental` | 0 |
| `findloc` (F2008) | 0 |
| `implicit none (type, external)` (F2018) | 0 |
| `error stop` with non-constant code (F2018) | 0 |
| `EQUIVALENCE`, `ENTRY`, assigned `GOTO`, Cray pointers | 0 |
| statement functions | **0** (the last one was deleted by PR #1207) |

The 83 apparent "coarray" matches in xtb are all `!$omp critical` (e.g. `xtb/src/extern/orca.f90:516`). Coarrays and PDTs are precisely the two features LFortran says it has not implemented — so their absence removes that particular objection, though other LFortran objections remain (§6).

---

## 3. The `-fdefault-real-8` problem — the single biggest portability fact

`xtb/cmake/CMakeLists.txt:50`

```cmake
if(CMAKE_Fortran_COMPILER_ID MATCHES "GNU")
  set(dialects "-fdefault-real-8 -fdefault-double-8 -ffree-line-length-none -fbacktrace")
...
elseif(CMAKE_Fortran_COMPILER_ID MATCHES "LLVMFlang")
  set(dialects "-fdefault-real-8 -fdefault-double-8")
endif()
```

Mirrored in `xtb/meson/meson.build:32-36` (gcc), `-r8` for Intel, `/4R8` for Intel-cl, `-r8` for PGI/NVHPC.

**No dependency uses it.** `grep -rn fdefault-real deps/*/config` → zero hits; tblite/mctc-lib/dftd4/multicharge/toml-f/s-dftd3 declare `real(wp)` explicitly everywhere.

xtb genuinely needs it:

- 526 `real*8`-style declarations in `xtb/src` (top file: `src/gfnff/gfnff_eg.f90` with 257)
- 41 bare `double precision`
- **128 unsuffixed real literals with ≥9 decimal digits** that would silently truncate to single precision — e.g. `xtb/src/iff/iff_ini.f90:510`
  ```fortran
  ALLC(1, 4, 4) = 0.05902730589/1.063832358490576**0.5
  ```
  The same query returns **0** for tblite, dftd4 and mctc-lib.

Implications:

- **f2c / LFortran**: no equivalent flag. LFortran: GitHub code search `fdefault-real-8 repo:lfortran/lfortran` → 0 hits.
- **LLVM Flang**: fully supported, gfortran-compatible. `flang/lib/Frontend/CompilerInvocation.cpp:1195-1236` sets `defaultRealKind(8)` + `doublePrecisionKind(16)`, then `-fdefault-double-8` brings double back to 8 and errors out if used alone. **Gotcha: passing `-fdefault-real-8` without `-fdefault-double-8` silently makes `DOUBLE PRECISION` 16 bytes (quad), which under wasm would need a libquadmath equivalent and would be catastrophic.** Always pass the pair.
- Residual risk: PR #1207 still needed four literal-kind fixes under flang (`0.5` → `0.5_wp`, `0.01` → `0.01_wp` in `src/scc_core.f90`), which suggests some divergence remains. Budget for a numerical regression comparison against a native gfortran build before trusting wasm results.

---

## 4. Runtime / OS coupling a browser cannot provide

| coupling | where | count | how hard to stub |
|---|---|---|---|
| `execute_command_line` | `xtb/src/extern/turbomole.f90` (14), `extern/orca.f90` (3), `screening.f90` (2), `extern/mopac.f90` (1), `extern/driver.f90` (1) | **21 live** | **Trivial to ignore.** All are external-QM-program drivers (Turbomole/ORCA/MOPAC/qmdff) and none is on any GFN2 or Hessian code path. They still link, so Emscripten's `system()` (returns -1) satisfies the symbol. If you want them gone, delete `src/extern` from the source list. Example: `extern/turbomole.f90:274 call execute_command_line('exec ridft > job.last 2>> /dev/null',exitstat=err)` |
| `execute_command_line` in **CPCM-X** | `deps/cpx/src/cpcmx/qc_calc.f90:64,89,123,184,282,312` | **16 live, in library code** | Shells out to `xtb`, `ridft`, `gtb`. Not stubbable in spirit — but the whole component is off with `-DWITH_CPCMX=FALSE`. Also `deps/cpx/app/main.f90:283-284 Call System("paste ...")` |
| `call system(` | `xtb/src/modef.f90:90,435,518` | **0 live** (all commented out) | nothing to do |
| POSIX `signal()` | `xtb/src/mctc/signal.c` + `xtb/src/mctc/mctc_init.F90:52-53` (SIGINT=2, SIGTERM=15), handlers in `xtb/src/mctc/error.f90:69-85` | 1 shim | **Easy.** Either replace `signal.c` with an empty function or simply never call `mctc_init` — the C API entry points do not require it (only the CLI in `src/prog/` does). Emscripten also provides a no-op `signal()`. |
| libc syscalls via `bind(c)` | `xtb/src/mctc/mctc_linux.f90:23-158` — `mkdir`, `rmdir`, `link`, `unlink`, `symlink`, `chdir`, `umask`, `chmod` | 8 interfaces | **Easy.** Emscripten's MEMFS provides all of them. Dead weight on the C-API path. |
| `get_environment_variable` | `xtb/src/mctc/systools.F90:145,166` (`rdvar`/`rdpath`), `deps/mctc-lib/src/mctc/env/system.f90:70,81`, `deps/cpx/src/cpcmx/initialize.f90:65,480` (CPXHOME/CSMHOME) | 3 + 2 + 2 | **Easy.** Emscripten returns "not present"; xtb then falls back to the compiled-in parameter set. `env%xtbpath` lookups (e.g. `xtb/src/solv/model.f90:581`) degrade gracefully. |
| command-line parsing | `xtb/src/prog/*`, 5 `get_command_argument` / `command_argument_count` sites | 5 | **Easy.** Only the CLI driver; not reached from the C API. |
| `isatty` | `xtb/src/features.F90:65` | 1 | Already guarded by `#if defined __GFORTRAN__ \|\| defined __INTEL_COMPILER` — inert under flang. |
| parameter **file** I/O | GFN params: `xtb/src/xtb/calculator.f90:149` | — | **Not needed.** `use_parameterset` (`xtb/src/gfn_paramset.f90:59-82`) compiles GFN1/GFN2 in as a fallback; tblite likewise (`deps/tblite/src/tblite/xtb/gfn2.f90`). Solvation params are `include '*.fh'` compile-time (44 `.fh` files in `xtb/include`, 48 `include` statements). **Note GFN0 is effectively broken in `use_parameterset` — line 68-69 is `case('param_gfn0-xtb.txt') / return`, so GFN0 *does* need `param_gfn0-xtb.txt` on disk.** |
| `open(` / `inquire(` file I/O | 47 / 56 sites in xtb/src, concentrated in `src/type/iohandler.f90` (8), `src/docking/param.f90` (7), `src/extern/turbomole.f90` (5), `src/lbfgs_anc/driver.f90` (4) | — | Emscripten MEMFS handles these fine; the IR path writes `vibspectrum`/`g98.out` only from `src/freq/io.f90`, `src/main/property.F90`, `src/wrmodef.f90` — bypassable via the C API. |
| stdout | 716 `write(*`/`output_unit` in xtb | — | Emscripten routes to console; harmless. No `read(*` at all in xtb (30 in CPCM-X, disabled). |
| `error stop` / `stop` | 14 + 9 in xtb/src, 25 in tblite/src, 9 in cpx/src | — | Under Emscripten these become `abort()` and kill the wasm instance. Not fatal for a one-shot calculation but worth knowing: a bad input can terminate the module rather than return an error code. |
| `signal`-free timing | `system_clock` 4, `date_and_time` 8, `cpu_time` 4 | — | all fine under Emscripten |

**The key structural finding**: `xtb/src/api/interface.f90:310` already exposes

```fortran
subroutine hessian_api(venv, vmol, vcalc, vres, c_hess, &
                     & c_step, c_list, c_dipgrad, c_polgrad) &
      & bind(C, name="xtb_hessian")
```

returning the Hessian **plus the dipole gradient and polarizability gradient** — i.e. everything needed for IR (and Raman) intensities — with no file, no environment variable, no subprocess, and no CLI code on the path. That is the correct wasm entry point.

---

## 5. Non-standard / compiler-extension usage

| item | count | verdict |
|---|---|---|
| `-fdefault-real-8 -fdefault-double-8` | build-wide | §3 — the real blocker for non-GNU/non-flang compilers |
| `real*8` / `integer*4` star-kind | 557 in xtb, **0** in every dependency | universally supported extension (gfortran, flang, ifx, LFortran) |
| `COMMON /abfunc/` | 3 (`xtb/src/esp.f:316`, `xtb/src/intpack.f90:304`, `:1036`) | standard F77, supported everywhere |
| `GOTO` | 264 in xtb, 49 in tblite (40 of them in the translated `deps/tblite/src/tblite/fit/newuoa.f90`) | standard |
| fixed-form `.f` | 8 files / 4,159 lines | handled by extension; flang `-ffixed-form` exists |
| `!DEC$ ATTRIBUTES DLLEXPORT` | 43 xtb + 60 dftd4 | plain comments to non-Intel compilers — harmless |
| `-ffree-line-length-none` | 39 lines >132 cols in xtb/src (longest 172, `src/prog/main.F90:621`); **0** in every dependency | flang has no free-form line limit and no such flag; if it ever bites, wrapping 39 lines is a 30-minute fix |
| cpp preprocessing of `.F90` | 50 files in xtb | flang `-cpp` |
| `-Mbackslash -Mallocatable=03` (PGI only) | all projects | `-Mallocatable=03` confirms reliance on **F2003 automatic reallocation on assignment**; `-Mbackslash` restores the standard (non-escape) backslash that `deps/toml-f/src/tomlf/utils.f90:59-66` depends on. Both are gfortran/flang defaults. |
| `-D_Float128=__float128` | `xtb/meson/meson.build` | a C-side workaround for `symmetry/symmetry_i.c`; watch for it under clang/wasm |
| `HAS_GCC_BUG_84412` | `xtb/src/type/reader.F90:20` | unconditional `#define` — a gfortran-bug workaround left permanently on |
| GPU macros `XTB_GPU`, `USE_CUBLAS`, `USE_CUSOLVER` | 60 sites | off by default |

---

## 6. Verdicts

### (a) f2c — **impossible.** Not a close call.

f2c accepts FORTRAN 77 only. 373 of xtb's 381 Fortran files are free-form F90+, and the corpus contains 1,392 `class(...)` declarations, 796 type-bound procedures, 101 `select type`, 807 deferred-length allocatable strings and 225 `move_alloc` calls — none of which exist in F77. The only F77-shaped material is the 8 fixed-form files (4,159 lines, 2.3% of xtb: `david.f`, `drsp.f`, `esp.f`, `stm.f`, `surfac.f`, `disp/dftd3.f`, `gfnff/gfnff_rab.f`, `gfnff/math.f`), and even those are called from F90 modules. Rewriting 368k LOC of F2003/F2008 into F77 is not an engineering option.

### (b) LFortran — **not viable today; possibly in 2–3 years.**

The *language* side is now plausible: LFortran states "all Fortran features are implemented, except coarrays and parametrized derived types" ([lfortran.org, 2026-02](https://lfortran.org/blog/2026/02/lfortran-compiles-fpm/), v0.60.0), and this corpus uses **neither** — so the two known gaps do not apply. LFortran compiled LAPACK and fpm in February 2026, and the latest release is v0.65.0 (2026-08-27).

But three concrete facts block it:

1. **No `-fdefault-real-8`.** GitHub code search over `lfortran/lfortran` returns 0 hits; the same query against `llvm/llvm-project path:flang` returns 6. Without it, xtb's 526 `real*8` sites plus 128 high-precision unsuffixed literals mean either wrong numbers or a source-wide kind audit of 177k lines.
2. **Scale.** The LFortran team's own definition: "Beta quality to us means that when you use LFortran on your code of N lines (say N=10,000), it will compile and run it correctly in about 90% of the cases. Currently this works for codes around 500-1000 lines." They are at 9/10 beta codes. xtb alone is 177,447 lines; the full tree is ~368,000.
3. **Legacy tail.** 3 COMMON blocks, 264 GOTOs, 8 fixed-form files, 50 cpp-preprocessed `.F90` files with 15 distinct gating macros — the exact long tail an alpha compiler has not been hardened against.

Revisit when LFortran declares beta *and* ships `-fdefault-real-8`.

### (c) LLVM Flang — **the only realistic route, and it is already half-paved.**

Three independent pieces of evidence:

1. **xtb upstream already supports it.** [PR #1207 "Add initial support of LLVMFlang"](https://github.com/grimme-lab/xtb/pull/1207), merged **2025-03-05**, touched only 5 files (`cmake/CMakeLists.txt +2/-0`, `src/gfnff/gfnff_eg.f90 +1/-2`, `src/main/json.F90 +19/-19`, `src/scc_core.f90 +3/-3`, `test/unit/test_docking.f90 +2/-2`). The author: *"This patch adds support of LLVMFlang (tested with flang-trunk). With some extra patches of 3rd-party deps, all tests are passing without OpenMP."* The three substantive changes were removing one statement function, four literal-kind `_wp` suffixes, and JSON formatting.
2. **Flang has every flag xtb needs**: `-fdefault-real-8`, `-fdefault-double-8` (gfortran-compatible per `flang/lib/Frontend/CompilerInvocation.cpp:1195-1236`), `-ffixed-form`, `-ffree-form`, `-cpp`, `-fopenmp` ([FlangCommandLineReference](https://flang.llvm.org/docs/FlangCommandLineReference.html)).
3. **The wasm target exists as a maintained patch set.** [r-wasm/flang-wasm](https://github.com/r-wasm/flang-wasm) builds flang from `r-wasm/llvm-project` branch `wasm` with `-DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-emscripten` and ships a pre-built `libFortranRuntime.a` compiled with `em++`. Per [George Stagg's write-up](https://gws.phd/posts/fortran_wasm/) (2024-03-12, LLVM 18.1.1) the patches are small and specific: add a `TargetWasm32` struct to `flang/lib/Optimizer/CodeGen/Target.cpp`, and hard-code `long`/`unsigned long` to 4 bytes in `RTBuilder.h` plus `malloc`'s arg to i32 in `CodeGen.cpp` (flang assumes build==host==target `sizeof`). Critically: **reference BLAS 3.12.0 and LAPACK 3.12.0 build successfully with it**, which is exactly xtb's `-Dlapack=netlib` configuration — the same one xtb's own Linux CI uses.

Known caveats for this route: the flang-wasm runtime is built with IEEE FP exceptions disabled (`FE_UNDERFLOW/OVERFLOW/INEXACT/INVALID/DIVBYZERO`) — acceptable here because IEEE use is 6 trivial `ieee_is_nan`/`ieee_value` sites; OpenMP is untested (build serial, `-Dopenmp=false`); the patches are not upstream, so you pin a fork; and the four literal-kind fixes in PR #1207 hint at residual `-fdefault-real-8` semantic drift that must be validated numerically.

### (d) gfortran — **the reference compiler for the source, but it cannot produce wasm.**

gfortran is what xtb is developed and tested against: `xtb/.github/workflows/fortran-build.yml` runs gfortran 10, 11, 12, 13, 14, 15 across ubuntu-22.04/24.04/latest, ubuntu-24.04-arm, macos-15-intel, macos-latest and MinGW, plus Intel ifort/ifx. Every feature in §2 is squarely inside gfortran's support envelope. So *language-wise* the answer is trivially yes.

For **wasm**, no. GCC has no shipping WebAssembly backend; the [RFC patch series posted 2026-05-05](https://gcc.gnu.org/pipermail/gcc-patches/2026-May/715824.html) is early-stage, C/C++-focused, and lacks reference types, tables, exceptions, debug info and data sections. There is no gfortran→wasm path, and `libgfortran` has never been built for wasm32. Use gfortran as the **numerical reference oracle** for validating the flang-wasm build, not as the wasm compiler.

---

## 7. Recommended build shape

```
-DWITH_TBLITE=FALSE      # drops tblite + dftd4 + multicharge + s-dftd3 + toml-f (~161k LOC)
-DWITH_CPCMX=FALSE       # drops CPCM-X + numsa — and all 16 library-level execute_command_line calls
-DWITH_OpenMP=FALSE      # serial; every !$omp and `!$ use omp_lib` becomes a comment
-DWITH_TESTS=FALSE       # drops test-drive
lapack=netlib            # reference BLAS/LAPACK 3.12.0, proven to build under flang-wasm
FFLAGS="-fdefault-real-8 -fdefault-double-8"   # both, always
```

This reduces the port to **xtb (177k LOC) + mctc-lib (12k LOC) + netlib BLAS/LAPACK** and eliminates every library-level subprocess spawn. Caveat worth checking before committing: with `WITH_TBLITE=FALSE`, GFN2 runs through xtb's own SCC implementation rather than the tblite backend — I have not verified that the two produce identical Hessians/dipole gradients, and that should be measured against a native gfortran build.

Then: build against the `r-wasm/flang-wasm` toolchain, stub `xtb/src/mctc/signal.c` to a no-op, skip `mctc_init`, and drive everything through `xtb_hessian` (`xtb/include/xtb.h`) — which already hands back Hessian + dipole gradient + polarizability gradient, i.e. the complete IR spectrum input, with zero filesystem dependency.
