## SUMMARY
LAPACK/BLAS in wasm is a solved problem in 2026, but only if you keep one calling convention on both sides. I verified on this machine that the scratchpad's flang 21.1.8 compiles Fortran straight to `wasm32-unknown-emscripten` objects, emits `dgemm_`/`dsyev_` (trailing underscore, no leading underscore — identical to the f2c/ELF convention), passes everything by reference, appends hidden CHARACTER lengths as trailing `i32`, and returns COMPLEX via `sret` — exactly what f2c expects. I linked such an object against a hand-written f2c-convention C LAPACK with emcc and ran it correctly under Node 26. The two ways it dies are both signature mismatches that are harmless natively but fatal in wasm: f2c/CLAPACK declares subroutines `int foo_()` where flang expects `void`, and CLAPACK/OpenBLAS omit the trailing `ftnlen` arguments that flang always passes. Both reproduce as `wasm-ld: warning: function signature mismatch` followed by `RuntimeError: unreachable` at call time; there is no linker flag to relax this. The practical consequence is that OpenBLAS's Fortran-free build (which ships an f2c'd LAPACK covering every routine xtb needs) cannot be linked directly to flang-compiled xtb without a ~40-function shim — whereas compiling reference LAPACK from Fortran with the *same* flang (what webR does) is self-consistent by construction. On measured dgemm, wasm costs 2.4–5.5x versus identical native code (relaxed SIMD recovers ~2.2x of that), but ~50x versus Apple's AMX-accelerated Accelerate; for xtb's actual eigenproblems (n=3·N_atoms, ~90–300) small-matrix LAPACK is latency-bound and the realistic penalty is the 2.4–5.5x figure, not 50x. Threads are viable because ir.cheminfo.org is self-hosted nginx (not GitHub Pages) and can set COOP/COEP directly, and the wasm32 4 GiB ceiling is irrelevant at xtb's memory footprint.

## BLOCKERS
["Cannot explain why the scratchpad's flang 21.1.8 emits correct wasm32 ABI when upstream Target.cpp at its reported build commit has no wasm case and a TODO('target not implemented') default. The binary's provenance is unresolved — reproduce the build or pin r-wasm/flang-wasm or emscripten-forge's flang_emscripten-wasm32 22.1.6 (linux-64 host only) before standardizing.", 'Did not build actual reference LAPACK or OpenBLAS to wasm end-to-end — the ABI conclusions come from a minimal reproduction (flang wasm object + hand-written f2c-convention C LAPACK) plus reading the real OpenBLAS/CLAPACK signatures, not from a full liblapack link.', "dgemm benchmarks use a hand-written blocked kernel, not OpenBLAS's tuned WASM128_GENERIC kernels; the true OpenBLAS-wasm vs OpenBLAS-native ratio is unmeasured and likely differs from the 2.4-5.5x same-source figure.", 'Benchmarks ran under Node 26 on Apple Silicon only — no browser (V8-in-Chrome, JSC/Safari, SpiderMonkey) or x86-64 measurements, and no threaded measurements.', "Whether flang's OpenMP runtime works on wasm32 is unverified; xtb defaults to -Dopenmp=true.", "Did not audit which cross-origin subresources ir.cheminfo.org's visualizer actually loads, so the concrete blast radius of enabling COEP: require-corp is unquantified."]

## DETAILS
## Bottom line

LAPACK/BLAS in WebAssembly is not the thing that will kill an xtb port. The **ABI seam between a Fortran-compiled-to-wasm caller and a C/f2c LAPACK callee** is — and it dies loudly and reproducibly, in a way that is completely invisible on x86-64/arm64. I reproduced both failure modes and both fixes on this machine today.

The single most important sentence in this report: **wasm validates function signatures at the call site; native ABIs do not.** Every "extra argument ignored by the callee" and "return value the caller discards" trick that makes gfortran-calls-OpenBLAS work everywhere on Linux becomes a `RuntimeError: unreachable` in wasm.

---

## 1. What works today, verified locally

The scratchpad already contains `flang+llvm-21.1.8`. It compiles Fortran straight to wasm with **no patches**:

```
$ flang --target=wasm32-unknown-emscripten -c t.f90 -o t_wasm.o     # exit 0
$ file t_wasm.o
t_wasm.o: WebAssembly (wasm) binary module version 0x1 (MVP)
```

Symbol naming is *already* the f2c convention — this is the good news nobody tells you:

| | native Darwin arm64 | wasm32-emscripten |
|---|---|---|
| `dgemm` reference | `U _dgemm_` | `U dgemm_` |
| `dsyev` reference | `U _dsyev_` | `U dsyev_` |

Trailing underscore, **no leading underscore**. Identical to what `emcc` emits for a C function literally named `dgemm_`. So there is *zero* name-mangling work. (`-fno-underscoring` is never needed.)

### The full calling convention flang emits on wasm32

From `flang --target=wasm32-unknown-emscripten -S -emit-llvm`, compared against the same source at native aarch64:

| construct | native aarch64 | **wasm32** | f2c expects |
|---|---|---|---|
| all arguments | by pointer | by pointer | by pointer ✅ |
| hidden CHARACTER length | trailing `i64` | trailing **`i32`** | `ftnlen` = `int` ✅ |
| `REAL(8)` function (`ddot`) | `double` | `double` | `doublereal` ✅ |
| `COMPLEX(8)` function (`zdotc`) | `{double,double}` direct | **`sret` hidden 1st arg** | hidden 1st arg ✅ |
| `LOGICAL` function (`lsame`) | `i32` | `i32` | `logical`=`long`=i32 ✅ |
| default `INTEGER` | `i32` | `i32` | LP64 `blasint` ✅ |

This is a remarkably clean match, and it is **not luck**: wasm32 is LP32, so f2c's `typedef long int integer/ftnlen` is genuinely 32-bit there, and the classic "f2c returns complex through a hidden pointer" convention is exactly what flang picks for wasm. The two notorious killers (complex return, integer width) are *already aligned*.

### End-to-end proof

```
emcc -O2 t_wasm.o stub_void.c main.c -o run2.js && node run2.js
dgemm_ called: transa='N' (len=1) transb='T' (len=1) m=3 n=3 k=3 alpha=1 beta=0 lda=3
dsyev_ called: jobz='V' (len=1) uplo='U' (len=1) n=3 lda=3 lwork=512
info=0  w = 4 9 16          <-- correct
```

Fortran → wasm → linked to C LAPACK → correct numbers, under Node 26. Character flags, hidden lengths and 32-bit integers all arrive intact.

---

## 2. The two things that kill it (both reproduced)

### Killer #1 — `int` vs `void` return

f2c and CLAPACK translate a Fortran `SUBROUTINE` into a C function returning `int`:

```c
/* netlib.org/clapack/CLAPACK-3.1.1/BLAS/SRC/dgemm.c */
int dgemm_(char *transa, char *transb, integer *m, ... integer *ldc)
```

flang declares it `void`. Natively this is a non-event (caller ignores `eax`). In wasm:

```
wasm-ld: warning: function signature mismatch: dgemm_
>>> defined as (i32 ×15) -> void in t_wasm.o
>>> defined as (i32 ×15) -> i32  in stub.o

$ node run.js
RuntimeError: unreachable
    at wasm://wasm/d5132cce:wasm-function[2]:0x261
```

Changing **only** `int`→`void` in the C file makes the identical program run correctly. That is the whole fix.

Good news: **modern OpenBLAS already got this right.** Its f2c'd LAPACK uses `void`:

```c
/* OpenBLAS develop, lapack-netlib/SRC/dsyev.c:652 */
/* Subroutine */ void dsyev_(char *jobz, char *uplo, integer *n, doublereal *a,
     integer *lda, doublereal *w, doublereal *work, integer *lwork, integer *info)
```

### Killer #2 — the missing `ftnlen` arguments (this is the real one)

Look at that signature again: **9 arguments, no trailing lengths.** flang emits 11 (`ptr ×9, i32, i32`). Same for BLAS:

```c
/* OpenBLAS develop, common_interface.h:498 */
void OPENBLAS_API(dgemm)(char *, char *, blasint *, blasint *, blasint *, double *, ...)
```

No `ftnlen`. This is why OpenBLAS works with gfortran on every Linux box on Earth — the extra register arguments are simply never read. In wasm it is an arity mismatch:

```
wasm-ld: warning: function signature mismatch: dgemm_
>>> defined as (i32 ×15) -> void in t_wasm.o
>>> defined as (i32 ×13) -> i32  in stub_noflen.o
RuntimeError: unreachable
```

**There is no escape hatch.** `emcc --help | grep -i signature` → nothing; wasm-ld has no `--no-check-signatures`. The only mercy is that a mismatched symbol which is never *called* is dropped silently (verified — a module with an unreferenced mismatched import instantiates and runs fine). That matters here: xtb references complex LAPACK (`zheev`, `zhegv`, `zdotc`) only from `interface` blocks in mctc-lib and never calls them on the GFN2 path, so those mismatches would be harmless.

### Fixes, in order of preference

1. **One compiler for everything (recommended).** Compile reference LAPACK 3.12 *and* xtb with the same flang. Both sides then agree by construction. This is precisely what webR does, and xtb's meson already has `-Dlapack=netlib`. Cost: reference LAPACK is unoptimized.
2. **Shim layer.** Build OpenBLAS with `SYMBOLSUFFIX=`, then write ~40 one-line C forwarders with the flang signature that drop the lengths and call through. Mechanical, testable, and lets you keep OpenBLAS's optimized kernels.
3. **Patch the Fortran interfaces.** I tested this: `BIND(C)` does **not** help — flang still appends hidden lengths for `character(kind=c_char)`, `character(len=1,kind=c_char)` and `character(kind=c_char), dimension(*)` alike. Only declaring the flags as `integer(c_signed_char)` yields the exact 9-argument form:
   ```
   character(kind=c_char)   → declare void @dsyev_(ptr ×9, i32, i32)
   integer(c_signed_char)   → declare void @dsyev_(ptr ×9)          ✅
   ```
   Since xtb funnels *all* LAPACK through `src/mctc/lapack/*.f90`, this is a contained patch — but it means passing `iachar('V')` instead of `'V'` at every call site. I'd rank it below the shim.

---

## 3. Implementation landscape, 2026

| Option | Repo / version | Status | Verdict for xtb |
|---|---|---|---|
| **flang → wasm (Fortran LAPACK)** | `r-wasm/flang-wasm`, pushed 2026-06-08; local flang 21.1.8 works unpatched | Active; powers webR | **Best.** Self-consistent ABI, full LAPACK |
| **OpenBLAS** | `WASM128_GENERIC` target, added v0.3.32 (2026-03-23); latest v0.3.34 (2026-07-16) | Official target, single-threaded | **Best BLAS.** Needs the shim |
| **OpenBLAS f2c'd LAPACK** | bundled `lapack-netlib/SRC/*.c`, auto-used at `NOFORTRAN=1` (PR #3539) | Ships today; covers dsyev, dsygvd, dsysv, dsytrf, dpotrf, dsyevd (all verified HTTP 200) | Viable **with the shim**; `void` return already correct |
| **semicolon-lapack** | `ilayn/semicolon-lapack`, v0.01.4-pre, pushed 2026-08-06 | C11, all 4 precisions 100% translated, CBLAS-only dep, has `emscripten-wasm.ini` | Promising but **pre-release**; SciPy+BLIS combo only passes 57% of tests |
| **BLIS** | `flame/blis`, pushed 2026-07-10 | C99, threadless builds; used in the SciPy-wasm work | BLAS only, no LAPACK |
| **CLAPACK (netlib 3.1.1/3.2.1)** | frozen ~2008 | Legacy | `int` return **and** no ftnlen — worst of both |
| **blasjs** | `R-js/blasjs` 1.0.15, pushed 2023-04-10 | Pure TS, BLAS 1-3 only | **No.** No LAPACK, stale, and JS won't touch wasm speed |
| **emlapack** | `likr/emlapack`, pushed **2017**-08-19 | Dead | No |
| **stdlib** | `stdlib-js/stdlib`, very active | Incremental JS/C LAPACK routines | Not a drop-in `liblapack.a` |

**Is there a ready-to-use LAPACK-in-wasm artifact to link against today?** Not as a downloadable `liblapack.a` you can hand to `emcc`. The closest are (a) `emscripten-forge`'s `flang_emscripten-wasm32` conda package (22.1.6, published ~3 months ago, **linux-64 host only**) plus building LAPACK yourself, or (b) OpenBLAS built with emcc. Both require a build step. Nobody publishes a prebuilt one.

---

## 4. Performance — measured today, on this machine

**Setup:** 2026-08-28, Apple Silicon arm64, Node 26.0.0, emcc 5.0.7-git, clang -O3. Same blocked dgemm source compiled every way; **checksums identical across all builds**, so these are like-for-like.

### N=512

| build | GFLOP/s | vs native |
|---|---|---|
| native `clang -O3 -march=native` | 12.27 | 1.0x |
| wasm `-O3` | 2.25 | **5.45x slower** |
| wasm `-O3 -msimd128` | 4.22 | 2.91x slower |
| wasm `-O3 -msimd128 -mrelaxed-simd` | 5.02 | **2.44x slower** |
| **Accelerate (AMX)** | **258.90** | 0.05x — 51.6x *faster* than best wasm |

### N=128 — the size range xtb actually lives in

| build | GFLOP/s | vs native |
|---|---|---|
| native | 16.02 | 1.0x |
| wasm scalar | 4.75 | 3.37x slower |
| wasm relaxed-SIMD | 4.81 | 3.33x slower |

**SIMD buys ~1% at N=128 and ~2.2x at N=512.** Small matrices are latency- and loop-overhead-bound, not vector-throughput-bound.

### Which number should you plan against?

The honest answer is **2.4–5.5x, not 50x**, and here is why. xtb's IR path diagonalizes a 3N×3N Hessian:

```fortran
! xtb/src/hessian.f90:388-389
lwork  = 1 + 6*n3 + 2*n3**2
call dsyev ('V','U',n3,res%hess,n3,res%freq,aux,lwork,info)   ! n3 = 3*mol%n
```

For a 30-atom molecule that is n=90; 100 atoms is n=300. I measured Accelerate's own `dsyev` at those sizes:

| n | atoms | Accelerate DSYEV |
|---|---|---|
| 90 | 30 | 2.356 ms |
| 150 | 50 | 6.690 ms |
| 300 | 100 | 49.645 ms |
| 600 | 200 | 345.504 ms |

That is ~2–7 GFLOP/s effective — **AMX gives nothing at these sizes.** The 51x AMX gemm gap is a red herring for this workload; it only applies to large dense gemm, which xtb doesn't do. Expect a wasm xtb to land in the **3–6x slower than native** band overall.

The literature agrees on the general figure: Jangda et al. (USENIX ATC'19) measured matrix-multiply at 2–3.4x slower in Chrome and Firefox pre-SIMD, and "nearly all benchmarks within 2x of native". Frank Denis' [2026-06-23 runtime survey](https://00f.net/2026/06/23/webassembly-runtimes-2026/) reports geomean-vs-native on libsodium: WAMR AOT 1.57x, WasmEdge 1.74x, Wasmer 2.08x, Wasmtime 2.41x — but **Node 26.3.1 at 7.95x and Bun at 8.77x**. Treat those two with care: libsodium is dominated by 64-bit integer crypto that leans on the `wide_arithmetic` proposal, not FP linear algebra. My own dgemm numbers on Node (2.4–5.5x) are the more relevant proxy.

**What threads buy:** the parallelism in xtb is in the SCF and gradient loops, not in a single 90×90 `dsyev` (which LAPACK cannot usefully thread anyway). The bigger IR win is that the numerical Hessian is ~6N independent gradient evaluations — embarrassingly parallel, and better exploited by sharding at the xtb level across workers than by threading BLAS.

---

## 5. Threads in the browser — better news than expected

**ir.cheminfo.org is not GitHub Pages.**

```
$ dig +short CNAME ir.cheminfo.org  →  ch9b.chemexper.com. → 195.15.0.46
$ curl -sI https://ir.cheminfo.org/
HTTP/2 200
server: nginx/1.27.5
last-modified: Mon, 04 Oct 2021 16:01:10 GMT     ← the current page is a 2021 visualizer stub
```

No COOP/COEP headers are set today, but it is **your own nginx**, so two lines in the server block give you cross-origin isolation and `SharedArrayBuffer`:

```nginx
add_header Cross-Origin-Opener-Policy   same-origin;
add_header Cross-Origin-Embedder-Policy require-corp;
```

No `coi-serviceworker` needed. (That workaround — which forces a reload on first visit and registers a SW to synthesize the headers — is the GitHub Pages answer, and it's worth knowing it exists, but you don't need it.)

**What it breaks, and this is the real cost:** `COEP: require-corp` means every cross-origin subresource must carry `Cross-Origin-Resource-Policy: cross-origin` or be fetched with CORS + `crossorigin`, and **every cross-origin iframe must send its own COEP+CORP or it will not load at all**. Since the page currently boots the cheminfo visualizer via requirejs and pulls assets from lactame.com, audit that first. `www.lactame.com` already sends `access-control-allow-origin: *`, which helps, but CORP is a separate header. `credentialless` iframes relax the iframe half (Chromium + Firefox for the directive; the attribute is Chromium-only).

Emscripten side: `-pthread` at **both** compile and link, plus `-sPTHREAD_POOL_SIZE=N`. Emscripten 6.0.5 (2026-07-29) updated its OpenMP to LLVM 22.1.8. **However**: xtb defaults to `-Dopenmp=true` (`meson_options.txt:52-57`), and whether flang's OpenMP runtime works on wasm32 is **unverified** — build the first port with `-Dopenmp=false` and revisit.

---

## 6. Memory — a non-issue for this workload

Node 26 hands out the entire wasm32 address space:

```
4096 MB : OK
grew to 4 GiB: OK, bytes=4294967296
```

Browsers are stingier — Chrome commonly caps a tab around 2–4 GiB and often refuses large *initial* allocations (~512 MB), so allocate small and grow.

xtb doesn't care. Its largest arrays are O(nbf²) plus the 3N×3N Hessian: at 200 atoms that's 600²×8 B ≈ **2.9 MB**. You are three orders of magnitude under the ceiling.

**memory64 is therefore irrelevant here**, which is fortunate, because it also costs performance (64-bit pointers, extra bounds-check work) and Safari lags. For the record: Chrome ≥133 unflagged, Firefox ≥143 (possibly flagged), Safari trailing; browser caps ~16 GB where supported.

---

## 7. Recommended path

1. **Build reference LAPACK 3.12 from Fortran with the same flang** that builds xtb. One compiler, one convention, zero shims. `-Dlapack=netlib`. Get it *working* first.
2. **Then** swap BLAS for OpenBLAS `WASM128_GENERIC` behind a small shim layer (~40 forwarders adding the trailing `ftnlen` args) and measure. Keep reference LAPACK on top of it.
3. Build with `-msimd128 -mrelaxed-simd`, and feature-detect: relaxed SIMD is Chrome 114+/Firefox 120+/Safari 18.4+, so ship a scalar fallback.
4. `-Dopenmp=false` initially; get parallelism from sharding the 6N Hessian displacements across Web Workers instead, which is a better fit than threaded BLAS at n≈90–300.
5. Set COOP/COEP in nginx only once you actually need `SharedArrayBuffer`, and audit the visualizer's cross-origin assets before flipping it.

### One open risk to close first

The scratchpad's flang 21.1.8 emits correct wasm32 ABI, but I could not explain *why*. Upstream `flang/lib/Optimizer/CodeGen/Target.cpp` at the exact commit it reports (`2078da43e25a`, 1949 lines) contains **no wasm case** — the switch falls through `default: break;` to `TODO(..., "target not implemented")` at line 1937 — and `TargetWasm32` appears nowhere in llvm-project (GitHub code search: 0 hits). Yet complex-returning code compiled cleanly with correct `sret`. Either that binary is patched despite its version string, or wasm32 is handled somewhere I did not find.

**Before standardizing on a toolchain, reproduce the build** (or pin `r-wasm/flang-wasm`, or the `emscripten-forge` `flang_emscripten-wasm32` 22.1.6 package — note it is **linux-64 host only**, so CI/Docker, not the Mac). Do not let the port depend on an unreproducible compiler in a scratch directory.

---

### Reproduction artifacts

All test files are in `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/lapacktest/`:

- `t.f90` — Fortran calling `dgemm`/`dsyev`
- `stub.c` (f2c `int` return → **traps**) / `stub_void.c` (`void` → **works**) / `stub_noflen.c` (CLAPACK verbatim, no ftnlen → **traps**)
- `f2.f90` — probes `ddot`/`dlamch`/`zdotc`/`lsame` ABI
- `bindc.f90` — BIND(C) experiment
- `gemm.c`, `gemm128.c`, `acc.c` — the benchmarks

Sources: [CLAPACK 3.1.1 dgemm.c](https://netlib.org/clapack/CLAPACK-3.1.1/BLAS/SRC/dgemm.c) · [OpenBLAS](https://github.com/OpenMathLib/OpenBLAS) · [OpenBLAS #4023](https://github.com/OpenMathLib/OpenBLAS/issues/4023) · [semicolon-lapack](https://github.com/ilayn/semicolon-lapack) · [pyodide-recipes #604](https://github.com/pyodide/pyodide-recipes/issues/604) · [r-wasm/flang-wasm](https://github.com/r-wasm/flang-wasm) · [Fortran on WebAssembly (Stagg, 2024-03-12)](https://gws.phd/posts/fortran_wasm/) · [WebAssembly runtimes 2026 (Denis, 2026-06-23)](https://00f.net/2026/06/23/webassembly-runtimes-2026/) · [Jangda et al., USENIX ATC'19](https://www.usenix.org/system/files/atc19-jangda.pdf) · [web.dev COOP/COEP](https://web.dev/articles/coop-coep) · [MDN COEP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy) · [Emscripten pthreads](https://emscripten.org/docs/porting/pthreads.html) · [V8 4GB wasm memory](https://v8.dev/blog/4gb-wasm-memory) · [blasjs](https://github.com/R-js/blasjs) · [emlapack](https://github.com/likr/emlapack) · [flang_emscripten-wasm32](https://prefix.dev/channels/emscripten-forge-4x/packages/flang_emscripten-wasm32)
