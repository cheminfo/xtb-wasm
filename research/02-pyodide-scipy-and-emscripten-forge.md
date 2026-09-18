## SUMMARY
There are two different answers in 2026, and only one of them matters for xtb. Pyodide still compiles SciPy's Fortran with a fork of f2c (hoodmane/f2c) driven by a `gfortran` interceptor in pyodide-build, plus ~15 hand patches and a `_f2c_fixes.py` post-processor; its BLAS/LAPACK is OpenBLAS 0.3.31 built `NOFORTRAN=1 TARGET=RISCV64_GENERIC`, i.e. the pre-f2c'd netlib LAPACK 3.12.0 C sources plus libf2c from CLAPACK 3.2.1. That route is strictly fixed-form F77 and is a dead end for xtb — and Pyodide is abandoning it anyway (SciPy 1.19/2.0, Dec 2026/Jan 2027, will be Fortran-free; tracked in pyodide-recipes#604). The important finding is the *other* route: emscripten-forge ships a real LLVM Flang cross-compiler for `wasm32-unknown-emscripten` (`flang_emscripten-wasm32` 22.1.6, `libflang` 22.1.6) and uses it to build reference LAPACK 3.12.1, OpenBLAS 0.3.34 with real Fortran, ARPACK 3.9.1 and SciPy 1.18.0 including its Fortran parts. The same compiler (r-wasm/flang-wasm, LLVM 21.1.8, `ghcr.io/r-wasm/flang-wasm:v21.1.8`) is what webR uses to build R's Fortran. Crucially, the wasm patch set touches only `flang/lib/Optimizer/CodeGen/*` ABI/target files and the runtime CMake — **zero** parser/semantics/lowering changes — so the full Fortran 2018 front-end is intact. Modern F2008 like xtb (90 files use `class(`, plus `select type`, abstract interfaces, `associate`, `block`, `do concurrent`) is therefore in scope for flang-wasm and totally out of scope for f2c. There is no quantum-chemistry package in either Pyodide (340 recipes) or emscripten-forge (639 packages); nobody has packaged xtb/tblite/xtb-python for wasm.

## BLOCKERS
None

## DETAILS
**Bottom line up front:** the SciPy-in-Pyodide machinery is *not* what you want to reuse for xtb — it is an f2c pipeline that is structurally F77-only, and Pyodide is in the process of deleting it rather than upgrading it. But the research turned up the thing you actually need: a maintained **LLVM Flang cross-compiler for `wasm32-unknown-emscripten`**, packaged and in production use by two independent projects (webR and emscripten-forge/JupyterLite), whose patch set does not touch the Fortran front-end at all. Modern F2008 like xtb is in scope.

---

## 1. How SciPy's Fortran is compiled for Pyodide today (2026)

**Still f2c.** Not flang, not LFortran.

The mechanism, end to end:

- `pyodide-recipes/packages/scipy/meta.yaml` build script clones a fork of f2c and points the build at it:
  ```
  git clone https://github.com/hoodmane/f2c.git --depth 1
  (cd f2c/src && cp makefile.u makefile && sed -i "s/gram.c:/gram.c1:/" makefile && make)
  export F2C_PATH=$(pwd)/f2c/src/f2c
  ```
- The recipe declares `requirements.executable: [gfortran]`. That is a lie of convenience: `pyodide-build/pyodide_build/pywasmcross.py:657` intercepts any `gfortran` invocation and replays it through f2c:
  ```python
  if line[0] == "gfortran":
      from _f2c_fixes import replay_f2c
      tmp = replay_f2c(line)
  ```
  `replay_f2c` (in `pyodide_build/_f2c_fixes.py`) rewrites `gfortran x.f` → `gcc x.c`, runs `f2c -R` on each source, and hands the C to emcc. gfortran is only ever really run for `-E` preprocessing of `.F` files and for compiler-capability queries.
- Around that sit three layers of correction:
  1. `_f2c_fixes.py`: `fix_f2c_input`, `fix_f2c_output`, `scipy_fix_cfile` — string surgery on generated C (`character`→`integer`, stripping `ftnlen` args, `void`→`int` on every `F_FUNC`/`BLAS_FUNC` declaration, injecting a `second_()` for PROPACK's `lansvd`).
  2. Five checked-in patches: `0001-gemm_-no-const`, `0002-make-int-return-values`, `0003-Fix-gees-calls`, `0004-Remove-chla_transtype`, `0005-Set-wrapper-return-type-to-int`.
  3. ~35 `sed -i` lines in the recipe itself, rewriting return types across SuperLU, PROPACK, ARPACK/arnaud, fitpack, trlib, qhull, odrpack.
- `packages/scipy/info.md` states the situation plainly: *"The biggest issue that comes up in building scipy is that we don't have a good fortran to wasm compiler. Some version of flang classic might work. Instead of compiling from fortran directly, we rely on f2c…"* It then explains the two f2c failure modes (implicit numeric casts across call sites; `char*`↔`int` with hidden `ftnlen` length arguments) — both direct consequences of wasm's strict function-signature checking.

**History (short):** [pyodide#184, "Compiling Fortran for WASM", opened 2018-09-21] concluded f2c was the only viable short-term option and noted the F77-only limit. [scipy#15290, the 2022 "Scipy in Pyodide status report"] catalogued the damage: `mvnun`/`mvnun_weighted` unbuildable (dynamically sized arrays), LAPACK `cuncsd/dorcsd/sorcsd/zuncsd` deleted, 36 missing symbols against LAPACK 3.3, and the conclusion *"LAPACK 3.3 introduces some dynamically sized arrays and other features which aren't compatible with Fortran 77, so it can't be f2c'd anymore."* flang-classic was rejected because its LLVM 7 object format could not link with Emscripten's LLVM 13.

**Where it is going: away from Fortran, not toward a Fortran compiler.** [pyodide-recipes#604, opened 2026-06-22, still open] — SciPy main has dropped `scipy.odr`, the last Fortran in SciPy; **SciPy v1.19.0 (Dec 2026/Jan 2027) will be the first Fortran-free SciPy**. The experimental replacement stack is **BLIS 2.1** (already merged as `packages/libblis/meta.yaml`, PR #609, plus a SIMD variant #610) + **`semicolon-lapack`** (ilayn's C rewrite). As of the 2026-07-09 update, PR #619 has *"the entirety of the SciPy test suite passing in WASM with BLIS and semicolon-lapack"*, held back until December.

**Meson cross file** (`pyodide-build/pyodide_build/tools/emscripten.meson.cross`) — trivially reusable, 12 lines:
```ini
[binaries]
exe_wrapper = 'node'
pkg-config = 'pkg-config'
[properties]
needs_exe_wrapper = true
skip_sanity_check = true
longdouble_format = 'IEEE_QUAD_LE'
[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm'
endian = 'little'
```
emscripten-forge's SciPy cross file is character-for-character equivalent.

**Known limitations today:** the only *Fortran*-attributed exclusions in the current recipe are two test modules that compile Fortran at test time — `scipy-conftest.py:25-26` skips `test_odeint_jac.py` and `io/tests/test_fortran.py` with *"test module removed: uses Fortran extension not built for WASM"*. Everything else in the xfail list is threads/processes/floating-point-exceptions, not Fortran. All SciPy subpackages, including `scipy.odr`, import successfully.

---

## 2. THE CRUX: is this F77-only, and therefore useless for xtb?

**The f2c path: yes, hopelessly F77-only — and xtb is far outside it.**

`replay_f2c` only touches `.f`/`.F`. `.f90`/`.F90` are never converted. And xtb is not marginally modern, it is thoroughly modern (measured on your clone, `src` + `include`):

| feature | files |
|---|---|
| `.f90` / `.F90` | 289 / 50 (vs 8 `.f`) |
| `class(` (polymorphic dummy args) | 90 |
| `allocatable` | 207 |
| `iso_fortran_env` | 21 |
| `associate` | 20 |
| `iso_c_binding` | 17 |
| `type is` | 14 |
| `block` | 13 |
| `abstract interface` | 12 |
| `select type` | 11 |
| `do concurrent` | 4 |
| OpenMP directives | 52 |

f2c cannot parse a single derived-type module, let alone `class(...)` dispatch. **The Pyodide/SciPy f2c machinery is not transferable to xtb. Full stop.**

**But the answer to "can modern Fortran reach wasm" is now YES — via a different, better-established route.**

The decisive evidence is the shape of the flang wasm patch set. Enumerating every `+++ b/` header across all four emscripten-forge `libflang` patches gives exactly nine files:

```
flang/lib/Optimizer/CodeGen/Target.cpp          # add TargetWasm32 (complex arg/return marshalling)
flang/lib/Optimizer/CodeGen/CodeGen.cpp         # malloc signature for 32-bit target
flang/lib/Optimizer/CodeGen/FIROpPatterns.cpp   # assumed-size dummy array indexing on wasm32
flang/lib/Optimizer/CodeGen/TypeConverter.cpp
flang/lib/Optimizer/Support/Utils.cpp
flang/include/flang/Optimizer/Builder/Runtime/RTBuilder.h   # sizeof(long)→FLANG_TARGET_SIZEOF_LONG etc.
flang/include/flang/Optimizer/Support/DataLayout.h
flang-rt/lib/CMakeLists.txt                     # disable quadmath/float128
flang-rt/lib/runtime/CMakeLists.txt
```

**Zero changes under `flang/lib/Parser`, `flang/lib/Semantics`, or `flang/lib/Lower`.** The wasm work is purely (a) an ABI descriptor for how complex numbers are passed/returned on wasm32, and (b) fixing cross-compilation bugs where flang used the *host's* `sizeof(long)` for a 32-bit target. The entire Fortran 2018 front-end is untouched, so language-feature support on wasm32 is whatever flang supports on x86-64.

Corroborating evidence:
- [gws.phd/posts/fortran_wasm, 2024-03-12, LLVM 18.1.1] — the original patch, explicitly listing "Modern Fortran features (Fortran 90+)", `ALLOCATE()`, complex arithmetic, and hidden CHARACTER length args as working.
- emscripten-forge's `libflang/build.sh` self-tests by compiling a **free-form `hello.f90`** and running it under node.
- emscripten-forge builds **reference Netlib LAPACK 3.12.1 from Fortran** (`lapack/build.sh`: `emcmake cmake … -DCMAKE_Fortran_COMPILER=$FC`), **ARPACK-NG 3.9.1**, **OpenBLAS 0.3.34 with `FC=flang-new`**, and **SciPy 1.18.0's Fortran** — all with flang, all published for `emscripten-wasm32`.
- webR builds R's Fortran with the same compiler (r-wasm/flang-wasm's stated purpose).

**Caveats you must budget for:**
- wasm32 is **not upstream in LLVM**. I grepped `flang/lib/Optimizer/CodeGen/Target.cpp` at both `llvmorg-22.1.6` and `main` today: no wasm case (the switch lists x86, x86_64, aarch64, ppc/ppc64/ppc64le, sparc/sparcv9, riscv64, amdgpu, nvptx64, loongarch64, systemz). [llvm#54832, "WebAssembly (wasm32-wasi) target for flang", closed 2022-04-21] never landed. You depend on a downstream patch — but a *small, stable, two-maintainer* one (r-wasm's fork carries only 3 non-upstream commits: "Add wasm32 target to flang" 2025-05-12, "Use i32 for long in MLIR" 2026-05-11, "Use i32 for index type in flang runtime" 2026-05-18).
- **flang 22 has a real wasm codegen bug.** emscripten-forge's OpenBLAS recipe disables the Fortran BLAS test drivers with the comment: *"The Fortran BLAS drivers in test/ and ctest/*.f crash flang 22 when targeting wasm32-unknown-emscripten (segfault in ARM64FindSegmentsInFunction)."* Expect to hit codegen bugs on 176k lines.
- **OpenMP is not available.** Neither libflang nor flang-wasm builds an OpenMP runtime for wasm (both build only `flang-rt`/`libFortranRuntime.a`). Emscripten 6.0.8 (2026-08-20) does ship an OpenMP runtime updated to LLVM 22.1.8, but it needs pthreads/SharedArrayBuffer; Pyodide rejects `-fopenmp` outright (`pywasmcross.py:282-286`). For xtb, build with OpenMP off.
- `execute_command_line` (6 files in xtb) has no meaning in wasm and will need stubbing.
- wasm32 is 32-bit with a 4 GB ceiling and no `long double`/float128 (patch 0002 disables quadmath in flang-rt).

---

## 3. emscripten-forge / conda-forge-for-wasm

A conda channel (rattler-build + prefix.dev) for the `emscripten-wasm32` platform, run largely by QuantStack; it is what `jupyterlite-xeus` installs from. Measured from `https://repo.prefix.dev/emscripten-forge-4x/emscripten-wasm32/repodata.json`:

- **639 unique packages, 2610 artifacts** (the `-dev` channel has 340/1706).
- **Fortran compiler support: yes, first-class.** `flang_emscripten-wasm32` 22.1.6 is a proper cross-compiler activation package. Its `activate.sh` is exactly the wiring an xtb build needs:
  ```sh
  export FC=flang; export F77=flang; export F90=flang; export F95=flang; export F18=flang
  export FFLAGS="--target=wasm32-unknown-emscripten"
  export FPICFLAGS="-fPIC"
  export FCLIBS="-lflang_rt.runtime"
  ```
  `libflang` 22.1.6 builds `flang-rt` for wasm and installs `lib/clang/22/lib/wasm32-unknown-emscripten/libflang_rt.runtime.a`.
- Fortran-heavy packages already shipping: `liblapack`/`libblas`/`libcblas` 3.12.1, `openblas` 0.3.32/0.3.33/0.3.34, `arpack` 3.9.1, `scipy` 1.18.0, `numpy` 2.5.2, `r-base` 4.6.1 plus ~180 R packages, `octave`, `lfortran` 0.65.0, `xeus-lfortran`. There is also an `emf2c` recipe (hoodmane's f2c) for legacy cases, and a `clapack` 3.2.1 / `libf2c` for the same.
- **Quantum chemistry: none.** Scanning all 639 names for `chem|rdkit|ase|pyscf|xtb|openbabel|mol|nmr` returns nothing chemistry-related (`r-cachem` and `sqlalchemy` are substring false hits). The nearest neighbours are `freesasa`, `biopython`, `gsl`, `nlopt`, `pycalphad`.
- **Could xtb/tblite be packaged there? Plausibly yes, and it is the natural home.** All four xtb Meson subproject deps (mctc-lib, tblite, dftd4, multicharge, CPCM-X) are pure modern Fortran with no system dependencies beyond LAPACK/BLAS, and LAPACK/BLAS is already a solved, published emscripten-forge package. The recipe shape would mirror `arpack`: `${{ compiler('fortran') }}` + `libblas`/`liblapack`/`libflang`, with the meson cross file. Whether you *want* a conda-packaged xtb versus a plain `.wasm`+`.js` npm bundle for ir.cheminfo.org is a separate question — for your use case the npm route is more natural, but emscripten-forge is the proof-of-toolchain and the place to steal the recipe from.

**Practical warning for your macOS arm64 machine:** `flang_emscripten-wasm32` is published **only for `linux-64` hosts**. The `osx-arm64` repodata for that channel contains exactly one package (`emscripten_emscripten-wasm32` 4.0.9) and no flang. Your realistic options are:
1. `docker run ghcr.io/r-wasm/flang-wasm:v21.1.8` — prebuilt, LLVM 21.1.8 + Emscripten 5.0.7, flang at `/opt/flang/host/bin/flang`, wasm runtime at `/opt/flang/wasm/lib`. Tags available: `v18.1.1`, `v20.1.4`, `v21.1.8`, `main`, `dev`. This is the fastest path to a first experiment.
2. Nix: `r-wasm/flang-wasm`'s `flake.nix` lists `aarch64-darwin` in `allSystems`.
3. Build LLVM from source with `-DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-emscripten -DLLVM_TARGETS_TO_BUILD=WebAssembly -DLLVM_ENABLE_PROJECTS="clang;flang;mlir"` (hours, resource-intensive; that is precisely why flang-wasm exists as a cached artifact).

---

## 4. Pyodide package list and JupyterLite chemistry stacks

Pyodide has **340 recipes**. Full scan for chemistry: **nothing**. No `rdkit`, no `ase`, no `pyscf`, no `openbabel`, no `xtb-python`. The bio-adjacent set is `biopython`, `pysam`, `freesasa`, `pyrodigal`, `sourmash`, `screed`, `phispy`, `msprime`, `tskit`, `demes`, `newick`. Physics/astro is much better served (`astropy`, `galpy`, `rebound`, `healpy`, `iminuit`).

JupyterLite/xeus kernels pull from emscripten-forge, so they inherit exactly the same gap — a `xeus-python` JupyterLite site can ship numpy/scipy/scikit-learn/matplotlib but no chemistry stack.

The chemistry that *does* exist in wasm exists outside both distributions:
- **RDKit MinimalLib** (`@rdkit/rdkit` on npm, latest `2025.3.4-1.0.0`, published 2025-07-07) — C++/Emscripten, independent of Pyodide.
- Your own `openbabel-wasm`, `surge-wasm`, `openchemlib-search-wasm`.
- **`jinzhezenggroup/xtbloom`** (GPL-3.0, pushed 2026-08-28) — a C++17 reimplementation of GFN1/GFN2-xTB with "Experimental client-side GFN1/GFN2 CPU/WASM adapter" and a browser demo. **But its README lists analytic/C-ABI Hessians and IR spectra as "Not implemented"**, and it self-describes as "AI-first software" where coding agents wrote most components. Worth a look as a data point, not as a dependency for ir.cheminfo.org.

---

## 5. The actual LAPACK + BLAS situation in wasm

Two distinct stacks, and they now differ substantially:

| | Pyodide 314.x | emscripten-forge-4x |
|---|---|---|
| BLAS/LAPACK | OpenBLAS **0.3.31**, `NOFORTRAN=1` | OpenBLAS **0.3.34**, `FC=flang-new` (real Fortran) |
| LAPACK source | OpenBLAS's pre-f2c'd `lapack-netlib/SRC/*.c` (498 C files shipped alongside 493 `.f`), LAPACK **3.12.0** | real Fortran, plus separate reference **liblapack 3.12.1** |
| OpenBLAS TARGET | `RISCV64_GENERIC`, `BINARY=32`, `-msimd128` | `WASM128_GENERIC` (native wasm arch) |
| f2c runtime | `libf2c.a` from **CLAPACK-3.2.1**, symbols linked into `libopenblas.so` | not needed (`libflang_rt.runtime.a`) |
| threads | `USE_THREAD=0` | `USE_THREAD=0` |
| alternatives in tree | `libblis` 2.1 (+ SIMD), semicolon-lapack incoming | — |

So: **Pyodide's LAPACK is essentially f2c'd reference netlib LAPACK 3.12.0 in generic C** — not hand-tuned assembly kernels, and until recently not even the wasm target. `packages/scipy/info.md` says it outright: *"we rely on f2c both directly and via OpenBLAS which has f2c'd its Fortran files and then modified the generated C files by hand."*

**Upstream OpenBLAS caught up in 2026**: v0.3.32 (2026-03-23) *"Moved the preliminary support for a Web Assembly target to its own WASM architecture and WASM128_GENERIC target"*; v0.3.33 (2026-04-23) *"wasm: added optimized kernels for STRSM and DTRSM"*. The WASM128_GENERIC target carries SIMD128 kernels for SGEMM/DGEMM, DAXPY, SUM, DOT, ROT, TRSM. **Pyodide has not adopted it** (still `TARGET=RISCV64_GENERIC`); emscripten-forge has.

**Performance, measured:**

Square matrix product, `OMP_NUM_THREADS=1`, i7-1165G7 (pyodide#3763, rth, 2023-04-27; native OpenBLAS 0.3.21 vs wasm 0.3.23):

| n | dtype | native (ms) | wasm ref-BLAS (ms) | wasm OpenBLAS (ms) | wasm-OB vs native |
|---|---|---|---|---|---|
| 1000 | f64 | 39.72 | 598.80 | 271.83 | **6.8x slower** |
| 2000 | f64 | 318.13 | 6785.50 | 2236.59 | **7.0x slower** |
| 1000 | f32 | 19.43 | 584.75 | 266.86 | **13.7x slower** |
| 2000 | f32 | 141.12 | 5149.48 | 2167.66 | **15.4x slower** |

So OpenBLAS bought ~2.2-3.0x over reference BLAS in wasm, landing at roughly **7x slower than native for float64 GEMM**. Adding WASM SIMD128 (pyodide PR #5960, merged 2025-10-26) helped less than hoped: `cblas_sgemm` 2.26x at 128², but 1.00-1.02x at 256²-512²; `cblas_sdot` 1.60x at n=10⁴, ~1.0x beyond. Library size cost: `libopenblas.so` grew 5.76 MB → 6.25 MB.

For calibration on payload size, emscripten-forge's compressed conda packages for `emscripten-wasm32`: `liblapack` 2.27 MB, `openblas` 5.16 MB, `libblas` 0.18 MB, `arpack` 0.14 MB, `scipy` 8.91 MB, `numpy` 2.69 MB.

---

## 6. What this means concretely for xtb-wasm

1. **Do not follow the SciPy/Pyodide recipe.** It is an f2c pipeline plus ~50 hand-written string rewrites, it is F77-only, and it is being deleted in December 2026.
2. **Follow the webR / emscripten-forge recipe instead.** Concretely: `docker run ghcr.io/r-wasm/flang-wasm:v21.1.8` (or build emscripten-forge's `libflang` 22.1.6), then drive xtb's existing Meson build with:
   - the 12-line `emscripten.meson.cross` file (unchanged from either project),
   - `FC=flang`, `FFLAGS=--target=wasm32-unknown-emscripten`, `FCLIBS=-lflang_rt.runtime`,
   - `CC/CXX` = emcc/em++, linker = emcc (emscripten-forge's SciPy patch 0003 does exactly "set fortran linker to emcc"),
   - LAPACK/BLAS from emscripten-forge's already-published `liblapack`/`libblas` 3.12.1 or `openblas` 0.3.34 (`TARGET=WASM128_GENERIC`) — the LAPACK dependency is already a solved problem in wasm; you do not have to solve it.
3. **Expect the friction to be in three places**, none of them "modern Fortran doesn't work": (a) flang wasm codegen bugs on a 176k-line codebase (there is a known flang-22 segfault on some Fortran when targeting wasm32); (b) turning OpenMP off across 52 files; (c) stubbing the 6 `execute_command_line` sites and any file I/O assumptions.
4. **Your existing C-API asset matters.** `include/xtb.h` (344 lines) is exactly the right shape for an `-sEXPORTED_FUNCTIONS` / embind boundary — you get to keep the emcc + npm-packaging workflow you already know, with flang only replacing the Fortran front half of the compile.
5. **You would be first.** No quantum-chemistry package exists in Pyodide (340 recipes) or emscripten-forge (639 packages), and no xtb/tblite wasm port exists on GitHub. The only adjacent thing is `xtbloom`'s experimental WASM adapter, which explicitly lacks Hessians and IR spectra — i.e. exactly the feature you need.
