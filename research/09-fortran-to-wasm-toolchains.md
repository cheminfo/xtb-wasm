## SUMMARY
Compiling xtb to WebAssembly has exactly one route with hard evidence behind it: LLVM Flang patched for wasm32, plus Emscripten. I verified this first-hand rather than from documentation. Upstream LLVM 23.1.0 (released 2026-08-25) still has no wasm32 case in `flang/lib/Optimizer/CodeGen/Target.cpp` and dies on `TODO(..., "target not implemented")`, so a patch is still mandatory in 2026 — but the patch is astonishingly small: the r-wasm/llvm-project `wasm` branch is only 3 commits / 59 changed lines on top of LLVM 21.1.8. I ran an A/B test of two prebuilt toolchains on identical modern-Fortran sources. `ghcr.io/r-wasm/flang-wasm:main` compiled, linked and ran all four tests correctly in Node. The other prebuilt (`miinso/flang-releases` v21.1.8, the only one with a macOS-arm64 host binary and a `libflang_rt.runtime.wasm32.a`) compiled and linked cleanly with zero warnings and then aborted at runtime on all four — a silent trap worth knowing about. I traced the root cause to the emitted IR: flang builds the array-descriptor model from *host* `sizeof(long)`, so on macOS arm64 it emits `{ptr, i64, i32, ..., [3 x i64]}` while the wasm32 runtime expects 32-bit index fields. Separately, Emscripten gained real OpenMP only very recently — PR #27073 merged 2026-07-08, first shipping in 6.0.3 (07/13/26); the local toolchain here is 5.0.7, which has no `omp.h` (verified). Every other route is dead or unusable for a code this size: LFortran is self-described alpha targeting 500–1000-line programs, the GCC wasm backend is an unmerged May-2026 RFC with no Fortran, f2c is F77-only and Pyodide is actively abandoning it, and Dragonegg is stuck on LLVM 3.3 which predates wasm entirely. The largest unquantified risk is not wasm at all: xtb's CI tests only gfortran/ifort/ifx, so flang has never been shown to compile xtb even natively.

## BLOCKERS
["Could not verify Fortran + OpenMP end-to-end on wasm: installing emsdk 6.0.8 inside the flang-wasm container failed when the machine's disk filled (466Gi volume at 100%, 362Mi free). The evidence that it should work is strong (Emscripten libomp includes kmp_ftn_cdecl.cpp/kmp_ftn_extra.cpp; llvm#95169 merged 2024-08-07) but it is inference, not a passing test.", 'Could not test flang against real xtb source. This is the decisive unknown — xtb has zero flang coverage in CI — but a full xtb+tblite+mctc-lib+dftd4 build needs meson/ninja (not installed) or a long CMake run, plus disk headroom that was not available.', 'Did not rebase the 3-commit wasm patch onto LLVM 22.1.8 or 23.1.0 to confirm it still applies. The CodeGenSpecifics::get signature gained a targetABI parameter after 21.x, so a mechanical edit is required and its difficulty is unverified.', "gcc.gnu.org/wiki/WebAssemblyBackend is behind an Anubis anti-bot wall, so the GCC backend's per-feature status table could not be read directly; the assessment rests on the RFC message and Phoronix coverage.", 'Disk exhaustion forced deletion of the downloaded flang toolchain and the Docker image mid-session, preventing follow-up experiments (e.g. building Netlib LAPACK to wasm, or measuring a realistic xtb-sized binary).']

## DETAILS
## Bottom line

There is exactly **one** route that compiles a 400k-line modern-Fortran scientific code to WebAssembly in 2026: **patched LLVM Flang targeting `wasm32-unknown-emscripten`, linked with Emscripten.** Everything else is either dead, F77-only, or explicitly not ready for code this size.

The good news is that this route is much less exotic than it sounds — the patch is 59 lines, it is used in production by webR, and I verified it working first-hand in this session. The bad news is that the *specific artifact* that looks most convenient (a prebuilt macOS-arm64 flang shipping a wasm32 Fortran runtime) is silently broken, and a big risk sits upstream of wasm entirely: nobody has ever shown flang compiling xtb at all.

---

## Route 1 — LLVM Flang + Emscripten (the only viable route)

### Upstream status: still unsupported, still trivially patchable

I checked the actual source of the newest LLVM release rather than relying on release notes. In **LLVM 23.1.0 (published 2026-08-25)**, `flang/lib/Optimizer/CodeGen/Target.cpp` dispatches on `trp.getArch()` across exactly twelve architectures — x86, x86_64, aarch64, ppc, ppc64, ppc64le, sparc, sparcv9, riscv64, amdgpu, nvptx64, loongarch64 — and then falls through to:

```cpp
  }
  TODO(mlir::UnknownLoc::get(ctx), "target not implemented");
}
```

So the 2022 error report ([llvm/llvm-project#54832](https://github.com/llvm/llvm-project/issues/54832), opened 2022-04-10) still reproduces on today's release. On the [LLVM Discourse thread](https://discourse.llvm.org/t/flang-web-assembly/61607) (2022-04-11), maintainer `banach-space` said there were "no specific plans for WebAssembly," citing no manpower and no wasm buildbots. Four years later that is still literally true in the source tree. **Treat "wasm32 flang is upstream" as false, and expect to keep carrying a patch.**

### The patch is 59 lines

The [r-wasm/llvm-project](https://github.com/r-wasm/llvm-project) `wasm` branch (default branch, head `7ca73ca1`, pushed 2026-05-27) sits on LLVM 21.1.8 and contains **three** non-upstream commits:

| Commit | Date | Size | Files |
|---|---|---|---|
| `4079ec3f` Add wasm32 target to flang | 2025-05-12 | +41/-0 | `Target.cpp` |
| `e3da0a87` Use i32 for long in MLIR | 2026-05-11 | +2/-2 | `RTBuilder.h` |
| `7ca73ca1` Use i32 for index type in flang runtime | 2026-05-18 | +7/-7 | `ISO_Fortran_binding.h`, `DescriptorModel.h`, `TypeConverter.h`, `descriptor-consts.h`, `TypeConverter.cpp` |

The first adds a `TargetWasm32 : GenericTarget<TargetWasm32>` struct implementing only `complexArgumentType` (byval `{t,t}`, align 4) and `complexReturnType` (sret), plus one `case llvm::Triple::ArchType::wasm32:` in the switch. That is the entire "wasm32 code generation" story — Fortran's `COMPLEX` ABI is the only thing flang needs told.

Note the patch was written against the older `CodeGenSpecifics::get` signature; LLVM 22/23 added a `targetABI` parameter, so rebasing onto 23.1.0 is a mechanical but non-zero edit.

### Verified working: `ghcr.io/r-wasm/flang-wasm:main`

I pulled the image and ran four Fortran programs exercising the constructs xtb depends on. All four compiled, linked with `emcc`, and produced **numerically correct** output under Node 26:

```
flang version 21.1.8 (https://github.com/r-wasm/llvm-project 7ca73ca1...)
Target: wasm32-unknown-emscripten

t1    matmul sum= 12.          # diag(2,2,2)·(1,2,3) → sum 12  ✓
t2    s=hello len= 5           # character(len=:), allocatable  ✓
t3    alloc array sum= 5.      # allocatable real(8) array      ✓
hello name=base / sum= 12.     # class() + type-bound procedure ✓
```

The image is built by `r-wasm/flang-wasm` (last commit **2026-06-08**, "Upgrade base image to Ubuntu 26.04"; updated to LLVM 21.1.8 on 2026-05-11). Widely-repeated claims that this project is abandoned trace to a [fortran-lang Discourse thread](https://fortran-lang.discourse.group/t/flang-wasm-compiler/7589) from **March–May 2024** and are simply out of date.

Build shape, from its `Makefile`: LLVM configured with `-DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-emscripten -DLLVM_TARGETS_TO_BUILD=WebAssembly -DLLVM_ENABLE_PROJECTS="clang;flang;mlir" -DFLANG_ENABLE_FLANG_RT=OFF`, then the runtime is compiled **separately and manually** with `em++` from `flang-rt/lib/runtime/*.cpp` and archived with `emar` into `libFortranRuntime.a`. Bypassing flang-rt's own CMake is the trick that makes the runtime build at all.

Two consequences of that runtime build worth recording: all FP-exception macros are stubbed (`-DFE_INVALID=0`, `-DFE_ALL_EXCEPT=0`, …) and `HAVE_BACKTRACE` is undefined. For xtb this is harmless — exactly one file touches IEEE facilities, and only for `ieee_value` / `ieee_positive_inf`, never `ieee_exceptions`.

### The trap: `miinso/flang-releases` looks perfect and is broken

This is the single most useful negative result from this study, because the artifact is genuinely attractive: it is the *only* prebuilt flang with an **arm64-apple-darwin** host binary (matching this machine) that also ships `lib/clang/21/lib/wasm32-unknown-emscripten/libflang_rt.runtime.wasm32.a`. It is consumed by the new [`rules_fortran`](https://github.com/miinso/rules_fortran) Bazel ruleset.

I downloaded it (sha256 matched the published `release-metadata.json`) and it **compiles and links with zero diagnostics** — `flang --target=wasm32-unknown-emscripten -c` exits 0, `emcc` exits 0, and you get a valid `WebAssembly (wasm) binary module`. Then every one of the same four tests aborts inside the Fortran runtime:

```
t1  RUNTIME_CHECK(xCatKind.has_value() && yCatKind.has_value()) failed at .../flang-rt/lib/runtime/matmul.cpp(435)
t2  Assign: left-hand side variable is neither allocated nor allocatable
t3  RUNTIME_CHECK(TypeCode(CAT, KIND) == x.type() || ...) failed at reduction-templates.h(90)
```

**Root cause**, confirmed from the emitted IR — flang derives its descriptor model from *host* `sizeof(long)`:

```llvm
target datalayout = "e-m:e-p:32:32-p10:8:8-..."
target triple = "wasm32-unknown-emscripten"
@_QFEx = internal global { ptr, i64, i32, i8, i8, i8, i8, [1 x [3 x i64]] } ...
```

Under a 32-bit data layout it still emits an `i64` element-length field and `[3 x i64]` dimension triples, because on the macOS arm64 *host* `sizeof(long) == 8`. The wasm32 `flang-rt`, compiled by clang for wasm32, reads those fields as 32-bit. Every field after the first is at the wrong offset, so type codes and allocation flags come back as garbage. That is precisely what r-wasm's commits `e3da0a87` and `7ca73ca1` fix, by replacing `sizeof(long)*8` with a hardcoded `8*4` and changing `LLVMTypeConverter::indexType()` from a hardcoded `64` to `getIndexTypeBitwidth()`.

The practical rule: **a wasm32 flang build that lacks the descriptor patches fails silently at runtime, never at build time.** If you evaluate any flang-wasm toolchain, run a deferred-length-character and an allocatable-array test before trusting it.

### Prior art de-risks LAPACK

xtb leans hard on LAPACK — `ddot` ×46, `dgemm` ×19, `dsysv` ×17, `dgemv` ×14, `dsytrf` ×11, plus the eigensolvers `dsyev`, `dsygvd`, `dspgvd`, `dspev`, `dsyevd` that the Hessian/IR path needs. This is already solved territory: George Stagg's [Fortran on WebAssembly](https://gws.phd/posts/fortran_wasm/) (2024-03-12) built **BLAS 3.12.0 and LAPACK 3.12.0** for `wasm32-unknown-emscripten` with this toolchain, and webR ships the result in production ([webR 0.6.0](https://opensource.posit.co/blog/2026-06-18_webr-0-6-0/), 2026-06-18, R 4.6.0). Four of the enabling fixes went **upstream** and are permanent: llvm/llvm-project [#99465](https://github.com/llvm/llvm-project/pull/99465) (merged 2024-07-21), [#99822](https://github.com/llvm/llvm-project/pull/99822), [#101242](https://github.com/llvm/llvm-project/pull/101242), [#105589](https://github.com/llvm/llvm-project/pull/105589) (2024-08-22).

### OpenMP: newly possible, but not in the ready-made image

This changed **seven weeks ago**. Emscripten PR [#27073](https://github.com/emscripten-core/emscripten/pull/27073) "Add openmp library from llvm" (115 files, +113,167 lines) merged **2026-07-08**, closing the five-year-old issue #13892 and #17637. I confirmed by HTTP-probing release tags that `system/lib/openmp/include/omp.h` is **absent in 6.0.2 and present from 6.0.3** (released 07/13/26). The library is real LLVM libomp (`kmp_runtime.cpp`, `kmp_barrier.cpp`, `z_Linux_util.cpp`, …) built with `-pthread`, and critically it includes **`kmp_ftn_cdecl.cpp` and `kmp_ftn_extra.cpp`** — the Fortran-callable OpenMP entry points. Upstream groundwork: llvm/llvm-project [#95169](https://github.com/llvm/llvm-project/pull/95169) (merged 2024-08-07) made libomp build and run under Emscripten.

Caveats, in order of importance:

1. **The r-wasm image cannot use it.** Its Dockerfile pins `ARG EMSCRIPTEN_VERSION=5.0.7`. You would rebuild the image with 6.0.3+.
2. **This machine cannot use it either** — local `emcc` is 5.0.7-git and `emcc -fopenmp` fails with `'omp.h' file not found` (verified).
3. **I did not verify Fortran+OpenMP end-to-end on wasm.** My attempt to install emsdk 6.0.8 inside the container was killed by a full disk. Treat "flang `-fopenmp` → wasm works" as *plausible and well-supported*, not proven.
4. OpenMP on wasm means pthreads → Web Workers → `SharedArrayBuffer`, which requires COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) on ir.cheminfo.org. That constrains deployment and breaks naive CDN embedding.

**Recommendation: build serial first.** xtb makes OpenMP optional — `-DWITH_OpenMP=OFF` (CMake, guarded at `CMakeLists.txt:80,119,158,198`) or `-Dopenmp=false` (meson). The ~600 `!$omp` directive lines become comments. Get a correct serial `xtb.wasm`, then treat threading as a separate performance project.

---

## Route 2 — LFortran

**Status: alpha, and disqualified by its own roadmap.** Latest release **v0.65.0, published 2026-08-27** (yesterday); 1,226 stars, **2,367 open issues**.

lfortran.org states plainly: *"LFortran is in alpha (it is expected to not work on third-party codes and users enthusiastically participate in bug reporting and fixing)."*

The decisive quote is from their own [fpm milestone post](https://lfortran.org/blog/2026/02/lfortran-compiles-fpm/) (2026-02-25, v0.60.0): beta means code *"will compile and run it correctly in about 90% of the cases,"* currently achievable for **"~500-1,000 line programs but not yet for larger codebases."** They are at 9/10 third-party codes (Minpack, fastGPT, dftatom, SciPy, stdlib, SNAP, PRIMA, POT3D, fpm; LAPACK compiled Feb 2026), and coarrays and PDTs are deferred until *after* beta.

xtb alone is 173,207 lines; the full stack is ~425,000. That is two to three orders of magnitude beyond the stated beta target.

Two further points: LFortran's **native `--backend wasm`** is documented as secondary to LLVM ("the most advanced and default backend"), and the practical wasm path is LLVM+Emscripten anyway. And webR **evaluated LFortran first**, contributed fixes for Netlib LAPACK, and still chose flang "with its ability to compile a wider variety of Fortran projects." That is the most relevant head-to-head comparison available, made by the team that has actually shipped Fortran-on-wasm.

Worth watching for 2027+. Not a candidate now.

---

## Route 3 — f2c (and the Pyodide/SciPy fork)

**Status: dead for xtb, and being abandoned by its own flagship user.**

f2c handles **Fortran 77 only**. xtb is F2003/F2008 OOP throughout: `class(` in 90 files, `select type` in 11, `abstract interface` in 12, `deferred` bindings in 6, `associate` in 20, and **270 occurrences of `character(len=:), allocatable`**. There is no mechanical path from that to f2c's input language.

Even for F77-era code the fork is buckling. [scipy/scipy#15290](https://github.com/scipy/scipy/issues/15290) records that LAPACK has used post-F77 features since 2008 and that f2c output "is slightly wrong and requires extensive patching." Pyodide is now **removing** the dependency: [pyodide-recipes#604](https://github.com/pyodide/pyodide-recipes/issues/604) targets **SciPy v1.19.0 (Dec 2026/Jan 2027)** as the first Fortran-free release, switching to **BLIS** (C BLAS) + **semicolon-lapack**, currently at **57%** of the test suite running without signature-mismatch crashes and ~1,000 remaining numerical failures.

One idea worth stealing though: if the LAPACK build ever fights you, **BLIS + semicolon-lapack are pure C** and sidestep Fortran linear algebra entirely.

---

## Route 4 — gfortran / GCC to wasm

**Status: no viable path in 2026.**

- **Dragonegg** — permanently dead. Last supported gcc-4.6 (maybe 4.8) and **LLVM 3.3**, which predates the WebAssembly backend entirely and whose IR format is incompatible with wasm-capable LLVM. webR's older docs mention "gfortran and Dragonegg" as a fallback; that is legacy text, not a 2026 recommendation.
- **gfortran → LLVM IR** — no supported mechanism exists outside Dragonegg.
- **New GCC wasm backend** — genuinely new, genuinely not ready. RFC posted to gcc-patches **2026-05-05** by "feedable": *"I would like some feedback on the overall code, before merging it."* ~3,000 LOC, **unmerged**, no Steering Committee approval, and per Phoronix (2026-05-07) it lacks reference types, tables, **exceptions**, debug info and data sections. **Fortran is not mentioned anywhere.** Even on an optimistic trajectory, gfortran-to-wasm is years out.
- **`wasm32-unknown-emscripten` gcc** — does not exist; Emscripten is a clang/LLVM toolchain.

---

## Route 5 — Transpilation (FABLE, f18 semantic-only, AI)

**Status: not viable at this scale.**

**FABLE** (LBNL, part of cctbx) converts Fortran to C++ but its reader supports "a nearly complete subset of Fortran 77 and a very small subset of Fortran 90." It does not link external functions and has no OOP, no modules-with-generics, no allocatable-component derived types. It is the wrong tool for a code whose central abstraction is `class(TCalculator)`.

**f18 semantic-only** is not a code generator; flang's frontend produces FIR, which is exactly what Route 1 already uses. There is no separate "semantic-only" product to exploit.

**AI transpilation** of ~425,000 lines of numerically sensitive quantum chemistry is not a serious proposal for this project. The failure mode is not compile errors — it is silent numerical drift in a semiempirical Hamiltonian, discovered months later as wrong vibrational frequencies. There is no test oracle strong enough to certify it: xtb's own validation is against reference energies and geometries, and a transpiler that gets 99.9% of lines right still corrupts the result. Compare the effort honestly against Route 1, where the delta is 59 lines of C++.

---

## Route 6 — Other routes considered

- **WASI SDK + flang (`wasm32-wasi`)** — the `TargetWasm32` patch keys on `ArchType::wasm32`, so it covers `wasm32-wasi` as well as `-emscripten`. But you would need a WASI-built `flang-rt`, nobody ships one, and WASI gives you none of Emscripten's JS interop — which is the whole point for a browser app. **Emscripten is the right target; WASI is a detour.**
- **Cranelift** — a codegen backend with no Fortran frontend. Not applicable.
- **ClangIR** — a C/C++ MLIR dialect. Fortran uses FIR/HLFIR. Irrelevant.
- **Rust rewrite tooling** — same objection as AI transpilation, at greater cost.
- **Running a Fortran compiler inside wasm** — LFortran does this at dev.lfortran.org (alpha, "many bugs"). It solves compile-in-browser, not compile-xtb, and inherits every LFortran limitation above.
- **`rules_fortran`** (Bazel) — created 2025-10-17, active through 2026-08-23, but only 5 stars, and it depends on the broken `miinso/flang-releases` toolchain. Not a foundation to build on today.

---

## Ranking by likelihood of compiling xtb

| # | Route | Verdict |
|---|---|---|
| **1** | **flang @ r-wasm patches + Emscripten ≥6.0.3, serial** | **Only credible route.** Verified working here; LAPACK precedent in production |
| 2 | Same, rebased onto LLVM 22/23 | Same route, more work (signature rebase), better long-term |
| 3 | Same + OpenMP | Newly possible (Emscripten ≥6.0.3); needs image rebuild + COOP/COEP; defer |
| 4 | LFortran | Alpha; own beta target is 500–1000 LOC. Revisit 2027+ |
| 5 | f2c / FABLE | Dead — F77 only vs. xtb's pervasive F2003 OOP |
| 6 | GCC wasm backend | Unmerged RFC, no Fortran. Years out |
| 7 | Dragonegg / gfortran→LLVM | Permanently dead (LLVM 3.3) |
| 8 | AI / manual transpilation | Not credible at 425k LOC of numerical code |

---

## What actually breaks first — and it isn't wasm

Ordered by how likely each is to stop the project:

1. **flang has never compiled xtb, on any platform.** xtb's CI (`fortran-build.yml`) tests gfortran ×8, ifx ×3, ifort ×1, **flang ×0**, and the README lists only ifort/gfortran/ifx. There are effectively zero flang issues across grimme-lab/xtb, tblite, mctc-lib and dftd4. **Do this test first, natively, before writing a single line of wasm build config:** install flang 21.x and run `FC=flang cmake` on xtb + tblite + mctc-lib + dftd4. It costs a day and it is the real go/no-go. (The one mctc-lib flang issue, [#84](https://github.com/grimme-lab/mctc-lib/issues/84), was *classic* flang 18.0.0 — the PGI-derived compiler with `F90-S-0152` error codes — not LLVM flang, and was closed as not planned. Do not read it as evidence either way.)

2. **The feature audit is encouraging.** Flang's only two major gaps are **coarrays** and **PDTs with length type parameters**. xtb uses neither — I confirmed 0 hits for both across xtb/src, mctc-lib, tblite and dftd4. No real Fortran submodules in library code either (the sole `submodule(` is in a tblite *test* file). This is an unusually clean match.

3. **Scope is bigger than it looks.** Not 176k lines — ~425k across the stack: xtb 173,207 · s-dftd3 85,614 · tblite 78,100 · mctc-lib 28,871 · dftd4 16,824 · mstore 14,696 · cpx 9,135 · multicharge 8,511 · numsa 8,274 · jonquil 1,800.

4. **Build system.** Neither meson nor ninja is installed here, and meson's wrap/subproject machinery does not cross-compile to Emscripten cleanly. Use the **CMake** path with an Emscripten toolchain file and vendor the subprojects.

5. **`execute_command_line` — 22 call sites.** Emscripten cannot spawn processes. They live in optional paths (`src/extern/driver.f90:195` external QM driver, `src/screening.f90:300,303` qmdff) rather than the Hessian path, so stub them. Likewise `src/mctc/signal.c`. Configure the build to exclude the external-driver features.

6. **File I/O and the CLI.** xtb is CLI/file-oriented; a browser build should not be. **Use the C API and skip the CLI entirely** — `include/xtb.h:244` declares `xtb_hessian(env, mol, calc, res, double* hessian, int* atom_index_list, int* step_size, double* dipole_gradient, double* polarizability_gradient)`, bound at `src/api/interface.f90:310-312`. The dipole gradient is exactly what IR intensities need (and the polarizability gradient gives you Raman for free). Export those five `xtb_*` entry points with `EXPORTED_FUNCTIONS` and drive them from JS — this eliminates most file I/O and all command execution in one move.

7. **Binary size.** A trivial Fortran program already links to **938 KB** of wasm with the Fortran runtime attached (the runtime archive is 43.5 MB but dead-code-eliminates well). xtb + tblite + LAPACK will be multiple MB; budget for `-Os`, `-flto`, and streaming/caching the module.

8. **Numerical validation.** Once it links, verify against native xtb on a reference set before trusting any spectrum — flang's FP behavior differs from gfortran/ifort, `-ffast-math` must stay off, and the wasm runtime has FP exceptions stubbed out.

---

## Concrete next step

```bash
# 1. Does flang compile xtb at all? (native, 1 day, the real go/no-go)
FC=flang cmake -B build-flang -DWITH_OpenMP=OFF && cmake --build build-flang

# 2. Only if (1) passes — cross-compile with the verified toolchain:
docker pull ghcr.io/r-wasm/flang-wasm:main   # flang 21.1.8 + libFortranRuntime.a
# inside: emsdk 5.0.7 bundled; upgrade to >=6.0.3 only when you want OpenMP
```

Before trusting any *other* flang-wasm toolchain you find, run this three-line smoke test — it is what separated the working toolchain from the broken one:

```fortran
program t
  character(len=:), allocatable :: s
  real(8), allocatable :: x(:)
  s = "hello"; allocate(x(5)); x = 1d0
  print *, s, len(s), sum(x)
end program
```

If it compiles, links, and then aborts with `Assign: left-hand side variable is neither allocated nor allocatable`, the toolchain is missing the descriptor patches and is unusable — no matter how clean the build log looked.

---

**Sources:** [llvm/llvm-project#54832](https://github.com/llvm/llvm-project/issues/54832) · [Flang & Web Assembly (LLVM Discourse)](https://discourse.llvm.org/t/flang-web-assembly/61607) · [r-wasm/flang-wasm](https://github.com/r-wasm/flang-wasm) · [r-wasm/llvm-project](https://github.com/r-wasm/llvm-project) · [Fortran on WebAssembly — G. Stagg](https://gws.phd/posts/fortran_wasm/) · [webR 0.6.0](https://opensource.posit.co/blog/2026-06-18_webr-0-6-0/) · [emscripten#27073](https://github.com/emscripten-core/emscripten/pull/27073) · [emscripten#13892](https://github.com/emscripten-core/emscripten/issues/13892) · [llvm#95169](https://github.com/llvm/llvm-project/pull/95169) · [LFortran](https://lfortran.org/) · [LFortran compiles fpm](https://lfortran.org/blog/2026/02/lfortran-compiles-fpm/) · [Flang Fortran Standards Support](https://flang.llvm.org/docs/FortranStandardsSupport.html) · [GCC wasm RFC](https://gcc.gnu.org/pipermail/gcc-patches/2026-May/715824.html) · [Phoronix: New GCC Back-End For WebAssembly](https://www.phoronix.com/news/GCC-WASM-WebAssembly) · [DragonEgg](https://dragonegg.llvm.org/) · [pyodide-recipes#604](https://github.com/pyodide/pyodide-recipes/issues/604) · [scipy#15290](https://github.com/scipy/scipy/issues/15290) · [FABLE](https://cci.lbl.gov/fable/) · [miinso/flang-releases](https://github.com/miinso/flang-releases) · [miinso/rules_fortran](https://github.com/miinso/rules_fortran)
