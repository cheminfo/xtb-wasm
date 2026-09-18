## Empirical build spike

The spike stopped at **Milestone 1 (toolchain)** and never compiled a single line of xtb itself. A working Fortran→wasm32-emscripten toolchain was obtained and verified end-to-end for F77-class Fortran, but it was then proven — on *unmodified xtb dependency source* — to be unusable for xtb, because `ALLOCATE` of any derived type carrying an allocatable or pointer component aborts at runtime and derived-type default initialization is silently dropped.

Milestones 2–4 (LAPACK/BLAS, xtb build, test suite + IR run) were not attempted: there was no point pointing a compiler at 1000+ `class(...)` declarations when a 12-line driver over `mctc-lib/src/mctc/env/error.f90` already aborts.

Disk discipline held: 242 GiB free at start, **242 GiB free at end** (the brief's "98% full / ~9 GiB free" was stale — `/System/Volumes/Data` is 466 GiB at 45% used). Net docker image footprint went *down* (16.08 GB → 14 GB) because two unused flang images were deleted.

### Milestone table

| # | Milestone | Outcome | Evidence | Blocker |
|---|---|---|---|---|
| 1 | Fortran→wasm toolchain | **Partial — works, but not for xtb** | `ghcr.io/r-wasm/flang-wasm:main` (flang 21.1.8, default target already `wasm32-unknown-emscripten`, emcc 5.0.7, node 22.16). Hello-world, modules, formatted/list I/O, real file I/O round-trip, `argv`, `getenv`, and `error stop 3` → node exit code 3 all pass. `-fdefault-real-8 -fdefault-double-8` verifiably flips `kind(1.0)` 4→8. | Derived types with allocatable/pointer components abort at runtime; default init silently no-ops. |
| 1b | Alternative toolchain (emscripten-forge) | **Refuted** | `flang_emscripten-wasm32` exists only at 19.1.7 / 20.1.7 (not 22.1.6), built from the *different* `serge-sans-paille/llvm-project@feature/flang-wasm` series. Fails strictly more probes than r-wasm, including two r-wasm passes. | Same class of bug, worse. Removed (freed 4.3 GB). |
| 1c | Newest r-wasm tag | **Confirmed `:main` is newest** | Tag list = `dev, main, v18.1.1, v20.1.4, v21.1.8`; `dev` created 2024-10-22, `main` 2026-06-08. | — |
| 2 | LAPACK/BLAS → wasm | **Not attempted** | — | Milestone 1 blocker. |
| 3 | xtb → wasm | **Not attempted** | — | Milestone 1 blocker. |
| 4 | xtb test suite + IR calculation | **Not attempted** | — | Milestone 1 blocker. |

### What DID work — exact reproducible recipe

Everything below was run on this machine and can be re-run this afternoon.

**Environment.** The host is arm64; the image is amd64-only, and Rosetta emulation is verified working (`docker run --rm --platform linux/amd64 alpine:latest uname -m` → `x86_64`).

```bash
# One-time (already present on this machine — costs 0 bytes if so)
docker pull --platform linux/amd64 ghcr.io/r-wasm/flang-wasm:main   # 0.77 GB compressed / 2.22 GB on disk
# The derived image xtb-wasm/flang-wasm:m1 = base + meson 1.10.1 + gfortran 15.2.0 + flang-21 21.1.8
#   (inside a container: apt-get update && apt-get install -y meson gfortran flang-21)
```

**Canonical wrapper** (the `fwasm-emcache` volume holds the warmed 35 MB emscripten sysroot; without it the *first* `emcc` link costs ~4 minutes rebuilding `libc-debug.a` from 1066 inputs, with it a full compile+link+run is **5.4 s**):

```bash
docker run --rm --platform linux/amd64 \
  -v /private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad:/work \
  -v fwasm-emcache:/opt/emsdk/upstream/emscripten/cache \
  -w /work xtb-wasm/flang-wasm:m1 bash -lc '
source /opt/emsdk/emsdk_env.sh >/dev/null 2>&1
export PATH=/opt/flang/host/bin:$PATH
<commands>'
```

**Compile + link + run** (no `--target` needed; wasm32-unknown-emscripten is the compiler default):

```bash
flang -fdefault-real-8 -fdefault-double-8 -c foo.f90 -o foo.o
emcc foo.o -L/opt/flang/wasm/lib -lFortranRuntime -sNODERAWFS -o foo.js
node foo.js            # argv, getenv, real host file I/O and exit codes all work
```

Add `-sNODERAWFS` whenever the program needs real host files (the xtb tests will).

**Verified results**, verbatim:

```
$ node hello.js
 Hello from Fortran on WebAssembly
 kind(1.0) =  4
 kind(1.0d0) =  8

# with -fdefault-real-8 -fdefault-double-8:
 kind(1.0)=8   kind(1.0d0)=8   1/3 = 3.33333333333333315E-01
# without:
 kind(1.0)=4   kind(1.0d0)=8   1/3 = 3.33333343267440796E-01

$ XTBTESTVAR=hello-env node ec.js myarg
argv1=myarg
env XTBTESTVAR=hello-env
Fortran ERROR STOP: code 3
NODE EXIT CODE = 3
```

That last one matters beyond hello-world: it is the exact mechanism meson's `exe_wrapper = 'node'` and `emcmake`'s `CMAKE_CROSSCOMPILING_EMULATOR=node` rely on, so **the cross-compiled-test-running mechanism is measured-good** even though there is nothing to run through it yet.

Gotcha worth recording: `-fdefault-real-8` **alone** promotes `kind(1.0d0)` to 16 (quad). Both flags are required together — which is exactly what `xtb/cmake/CMakeLists.txt:57-58` already supplies for `LLVMFlang`.

**Native A/B controls in the same image** — the single most valuable thing built here, because it lets any future failure be classified as wasm-specific vs a general flang bug in one command:

```bash
gfortran  probe.f90 -o probe.gnu   && ./probe.gnu     # gfortran 15.2.0
flang-21  probe.f90 -o probe.nat   && ./probe.nat     # x86_64 flang, upstream 1:21.1.8-6ubuntu1
```

Ubuntu 26.04 ships the *identical upstream version* (21.1.8) to the wasm build, which makes it a perfect control rather than an approximate one.

**Artifacts left on the machine** (~2.0 GiB in scratchpad + one 880 MB new docker layer):

- `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/m1wasm/probes/` — the 10-probe suite `p1_alloc_char.f90` … `p10_nodefinit.f90` with `.js`/`.nat` builds. This is a 30-line-per-file regression suite that answers "is this candidate toolchain fit for xtb?" in minutes.
- `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/m1wasm/realcode/` — unmodified `error.f90` from mctc-lib + `driver.f90`, built three ways (`d.nat`, `d.flang`, `d.js`/`d.wasm`).
- `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/m1wasm/{sizes,layout}.{f90,c}` — the ABI measurement probes.
- Docker image `xtb-wasm/flang-wasm:m1` (3.1 GB virtual, 880 MB new writable layer over the 2.22 GB base) and volume `fwasm-emcache`.

### Failures, with exact errors and classification

**F1 — `ALLOCATE` of a derived type with an allocatable/pointer component aborts. `needs-an-upstream-patch`.**

```
$ node d.js                       # unmodified mctc-lib error.f90 + 12-line driver
step 1: calling mctc-lib fatal_error()
fatal Fortran runtime error(/work/m1wasm/realcode/error.f90:75): Assign: left-hand side
    variable is neither allocated nor allocatable
Aborted(native code called abort())          exit=1
```

`error.f90:75` is `error%message = message` inside `fatal_error()`. The same source under the two controls:

```
gfortran 15.2.0 native   → MCTC-ERROR-ROUNDTRIP-OK   exit=0
flang-21 native x86_64   → MCTC-ERROR-ROUNDTRIP-OK   exit=0     (identical version 21.1.8)
```

This is not a corner case: `type(error_type), allocatable` with a `character(len=:), allocatable :: message` component is the shared error channel of mctc-lib, toml-f, tblite, dftd4, s-dftd3, multicharge **and** xtb, so it is on the critical path of every code path and every test.

**F2 — derived-type default initialization is silently dropped, with no diagnostic. `needs-an-upstream-patch`. This is the more dangerous of the two.**

Probe `p9_definit`: `allocate(b)` then read `integer :: n = 42` / `real :: r = 3.5`. gfortran and native flang both print `42 / 3.50`; flang-wasm prints `0 / 0.00` and exits 0. Probe `p10_nodefinit` shows the same on a type with **no** allocatable components at all. A wrong-answer bug that does not raise is far worse for a quantum-chemistry port than an abort.

Full probe matrix (all three columns from the same source files):

| probe | construct | gfortran 15.2 | flang-21 native | flang-wasm → node |
|---|---|---|---|---|
| p1_alloc_char | `type(t),allocatable` + `character(:),allocatable` comp | OK | OK | **abort** |
| p2_alloc_arr | `type(t),allocatable` + `real,allocatable(:)` comp | OK | OK | **abort** |
| p3_static_char | plain `type(t)` local + deferred-char comp | OK | OK | OK |
| p4_poly_char | `class(t),allocatable` + deferred-char comp | OK | OK | **abort** |
| p5_alloc_char_2comp | == mctc `error_type` shape | OK | OK | **abort** |
| p6_alloc_fixedchar | `type(t),allocatable`, `character(16)` fixed comp | OK | OK | OK |
| p7_ptr_char | `type(t),pointer` + deferred-char comp | OK | OK | **abort** |
| p8_arrayoft | `type(t),allocatable :: b(:)` + deferred-char comp | OK | OK | **abort** |
| p9_definit | default init `n=42`, `r=3.5` after `allocate` | 42 / 3.50 | 42 / 3.50 | **0 / 0.00, silent** |
| p10_nodefinit | same, type has no allocatable comps | 42 | 42 | **0, silent** |

**Root cause — measured, not inferred.** The compiler and the C toolchain disagree about pointer width *on the same target*:

```
### FLANG-WASM, target wasm32-unknown-emscripten
c_size_t = 8   c_intptr_t = 8   c_long = 8   c_int = 4   storage_size(c_ptr)/8 = 8
### EMCC C compiler, SAME wasm32 target
sizeof(size_t)=4  sizeof(intptr_t)=4  sizeof(long)=4  sizeof(void*)=4
### derived-type layout, flang-wasm vs native x86_64 — byte-identical (LP64)
type with character(:),allocatable comp : 24 bytes  (both)
type with real,allocatable(:)     comp : 48 bytes  (both)   <- LP64 descriptor
```

The shipped `/opt/flang/host/include/flang/iso_c_binding.mod` literally contains `c_size_t=8_4`, `c_intptr_t=8_4`, `c_long=8_4`.

The r-wasm patch is exactly 3 commits on branch `wasm` (`7ca73ca1a`, `e3da0a873`, `4079ec3f3`), touching only `Optimizer/CodeGen/Target.cpp`, `Builder/Runtime/RTBuilder.h`, `CodeGen/DescriptorModel.h`, `CodeGen/TypeConverter.{h,cpp}`, `ISO_Fortran_binding.h`, `Runtime/descriptor-consts.h` — i.e. **only the FIR→LLVM codegen path**. Nothing patches the **semantics** layer (`compute-offsets.cpp`, `runtime-type-info.cpp`), which lays out derived types and emits the `__fortran_type_info` tables using the host-compiled `Descriptor` where `long` is 8. The emcc-built `libFortranRuntime.a` then reads those tables as 32-bit → garbage `DerivedType*` → `Initialize()` no-ops → components never established → `Assign` reports "neither allocated nor allocatable". This matches the webR author's own description of the approach as "hard-coding the size of a long to what is needed for wasm32" — sufficient for F77 (LAPACK/BLAS, most R packages: no derived types), insufficient for F2003+.

**F3 — emscripten-forge route. `needs-an-upstream-patch` (different, worse patch series).**

```
p1_alloc_char       fatal ... Invalid descriptor
p2_alloc_arr        LINK-FAIL
p3_static_char      fatal ... Null address           <- r-wasm PASSES this
p4_poly_char        wasm trap
p6_alloc_fixedchar  fatal ... Invalid ...            <- r-wasm PASSES this
```

Same `c_size_t=8` on wasm32. Route closed; removed.

**F4 — `meson` absent from the image. `fixable-locally` — fixed.** `apt-get install -y meson` → 1.10.1. Not a real blocker either way, since xtb's CMake path is the preferred one (it has the `LLVMFlang` branch; meson does not).

**F5 — first `emcc` link costs ~4 minutes. `fixable-locally` — fixed.** Warmed sysroot cache pinned in docker volume `fwasm-emcache`; warm round trip 5.436 s.

**Not exercised in this spike** (carried from prior studies, *not* re-verified here): the macOS-arm64 host flang runtime abort, the f2c-LAPACK signature-mismatch shim, wasi-sdk's missing `signal`/`mkstemp`, and Emscripten's OpenMP support level. Treat those as prior-study claims, not spike findings.

### Remaining unknowns, and the next concrete experiment for each

1. **Has upstream LLVM already made flang's semantics layer target-aware for 32-bit?** *Cheapest, highest-leverage question.* If yes, the fix is a plain rebuild with no new patch. **Experiment:** build (or find) any flang ≥ 22 targeting wasm32 and run the saved `p1..p10` suite against it — minutes, not hours.
2. **Does patching only `compute-offsets.cpp` + `runtime-type-info.cpp` + `TargetCharacteristics` actually suffice?** Unknown — there may be further host-`long` assumptions downstream. **Experiment:** the patched rebuild from `r-wasm/llvm-project@wasm` (`-DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-emscripten -DLLVM_TARGETS_TO_BUILD=WebAssembly -DLLVM_ENABLE_PROJECTS="clang;flang;mlir" -DFLANG_ENABLE_FLANG_RT=OFF -DCMAKE_BUILD_TYPE=MinSizeRel`), then `p1..p10`, then `realcode/`. Budget this as its own milestone: a full LLVM+flang+MLIR build under x86_64 emulation on an 8-core / 7.75 GiB-RAM Docker VM is many hours and tens of GB — run it on a native linux-amd64 host or in CI, not under Rosetta.
3. **Would reference LAPACK/BLAS build cleanly with this toolchain today?** Strongly suggested by the F77-class passes but **not measured**. **Experiment:** it is independent of the derived-type bug and can be done now — build netlib LAPACK 3.12.1 + reference BLAS with `flang -fdefault-real-8 -fdefault-double-8`, link with `emcc`, run a `dsyev`/`dgemm` smoke test under node. A few hours, and it de-risks Milestone 2 in parallel with the compiler work.
4. **Are all of xtb's ~1000 `class(...)` sites blocked, or only some?** Only `error_type` was measured. Irrelevant to the go/no-go (one blocked site on the universal error path is enough) but relevant to estimating post-fix risk. **Experiment:** after a candidate fixed compiler exists, compile mctc-lib and toml-f standalone and run their own test suites under node before touching xtb.
5. **Everything downstream of a working compiler is entirely unmeasured:** whether `src/mctc/signal.c` builds under emcc, whether NODERAWFS holds up at xtb-test-suite scale, GFN2 numerical agreement wasm-vs-native, peak memory for a real Hessian against wasm32's 4 GB ceiling (`-sALLOW_MEMORY_GROWTH`), build wall-time and final `.wasm` size for an in-browser IR tool. **Experiment:** these only become answerable at Milestone 3; do not estimate them from this spike.

### Verdict: **NO-GO today; go-with-conditions after a compiler milestone**

**Measured here:** no currently available prebuilt Fortran→wasm toolchain can compile a working xtb. r-wasm 21.1.8 (the best available, newest tag, verified) aborts on unmodified xtb dependency source and silently corrupts default-initialized derived types. emscripten-forge 20.1.7 is strictly worse. That is two of the two prebuilt options, both closed, both with reproducible evidence.

**Also measured, and genuinely positive:** the *rest* of the pipeline looks sound. The compiler emits running wasm, `-fdefault-real-8 -fdefault-double-8` behaves correctly, node supplies argv/getenv/file-I/O/exit-codes, and the ctest/meson `exe_wrapper = node` mechanism demonstrably works. Nothing observed here casts doubt on the *plan*; the blocker is one specific, well-localized compiler defect.

**Inferred, not measured:** that patching flang's semantics layer to use 4-byte pointers and a 32-bit `CFI_index_t` on wasm32 would clear it. The root cause is measured (compiler says `long`=8, emcc says `long`=4, on the same target; descriptor sizes are byte-identical to x86_64 LP64) and the patch surface is read from the actual 3-commit diff — but that the fix is *sufficient* is a hypothesis, and it is the hypothesis the whole project now rests on.

**Conditions for a go**, in order of cost:

1. Run the saved `p1..p10` suite against LLVM ≥ 22 targeting wasm32. If it passes, the blocker is already gone upstream and this becomes a straightforward multi-month-free path. *(Hours.)*
2. If not: fund a flang-patch milestone — extend r-wasm's series into the semantics layer, rebuild on a native linux-amd64 host, re-run `p1..p10` and `realcode/`. This is compiler engineering, not build configuration, and it should be budgeted and staffed as such. *(Days to weeks, and it is a real risk of the project, not a formality.)*
3. In parallel and independently: build reference LAPACK/BLAS to wasm with the *current* toolchain to de-risk Milestone 2 while (1)/(2) are in flight.

Until condition 1 or 2 lands, the honest status of "xtb GFN2-xTB IR in the browser" is: **blocked on an unsolved compiler problem, with a specific, well-understood, plausibly-tractable fix that nobody has shipped yet.**