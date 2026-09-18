## SUMMARY
cheminfo has a single, remarkably consistent "C/C++ → Emscripten → embedded-base64 npm package" house pattern, now in four repos: inchi-js (0.2.0, the ancestor), surge-wasm (2.0.0), openbabel-wasm (private but readable via gh, unpublished v0.0.0), and openchemlib-search-wasm (1.0.0, TeaVM/WasmGC not Emscripten but identical packaging). Every one of them vendors upstream sources pinned by commit/tarball+sha256, builds with a single `bash build/build-wasm.sh` (`npm run build-wasm`), then **commits the .wasm gzipped+base64 into a generated TS/JS module** so consumers need no compiler, no fetch and no `.wasm` asset. The invariant emcc flag set is `-O3 -sMODULARIZE=1 -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1-2MiB -sINVOKE_RUN=0` with the binary handed in as `wasmBinary`; no repo uses pthreads, SIMD, WASM_BIGINT, `--preload-file`/`--embed-file`, or NODERAWFS. Two distinct JS boundaries exist: a `main()`/`callMain` CLI style (surge, with an FS device for streaming output) and an `extern "C"` shim returning a malloc'd JSON envelope consumed via `ccall` (inchi-js, openbabel-wasm) — never embind. Publishing is ESM-only, `type: module`, `exports` → `lib/`, one lazily-instantiated cached module promise, versions of upstream + Emscripten exported as constants, release-please + zakodium shared workflows. For ir.cheminfo.org: the site is the legacy cheminfo *visualizer* app at github.com/cheminfo-py/ir-teaching-app (last commit 2022-03-10), whose `/v1/ir?smiles=` REST API is github.com/cheminfo-py/xtbservice — a FastAPI + conda `xtb-python` + **ASE finite-difference `Infrared`** service (not xtb's own hessian driver), capped at 60 atoms (GFN2) / 100 (GFNFF) with a 30–100 s timeout. The same computation was re-implemented in 2026 as the `xtb-vibrational` worker in cheminfo-py/pipeline-workers for the private cheminfo/pipeline monorepo. That server-side path is exactly what in-browser xtb would replace.

## BLOCKERS
None

## DETAILS
## 1. The cheminfo WebAssembly house pattern

Four repos, one pattern. Clones are in `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/`.

| repo | upstream | toolchain | npm | HEAD |
|---|---|---|---|---|
| [cheminfo/inchi-js](https://github.com/cheminfo/inchi-js) | IUPAC InChI C | emcc + emcmake | `inchi-js@0.2.0` (2026-05-23) | e6609f2, 2026-08-16 |
| [cheminfo/surge-wasm](https://github.com/cheminfo/surge-wasm) | surge 2.0 + nauty 2.9.3 (C) | emcc, Docker emsdk | `surge-wasm@2.0.0` (2026-08-16) | 726be9a, 2026-08-16 |
| [cheminfo/openbabel-wasm](https://github.com/cheminfo/openbabel-wasm) **(private, readable via gh)** | Open Babel 3.2.1 (C++) + 9 deps | em++ + emcmake | **unpublished**, v0.0.0 | 9cfad2f, 2026-08-18 |
| [cheminfo/openchemlib-search-wasm](https://github.com/cheminfo/openchemlib-search-wasm) | OpenChemLib (Java) | **TeaVM → WasmGC** + binaryen | `openchemlib-search-wasm@1.0.0` (2026-08-28) | b055bf6, 2026-08-28 |

`mljs/xgboost` ("A port of XGBoost to javascript with emscripten") is dead — last push 2018-06-27. No wasm repos in zakodium / zakodium-oss / image-js.

### 1.1 How upstream source is vendored

Three variants, all pinned, none using a meson wrap:

- **git submodule** — inchi-js: `.gitmodules` → `vendor/inchi` = `IUPAC-InChI/InChI`, branch `dev`. `build/build-wasm.sh:20-24` hard-fails if the submodule is empty.
- **tarball + sha256** — surge-wasm `build/build-wasm.sh:17-21`: `NAUTY_VERSION=2_9_3 / NAUTY_SHA256=9fc4eda…`, `SURGE_VERSION=2.0 / SURGE_SHA256=e8f1298…`; `fetch()` (lines 41-52) aborts on mismatch.
- **depth-1 fetch of an exact commit** — openbabel-wasm `build/build-wasm.sh:23-53`: `OB_COMMIT=0e94434fa75c9f61095023e3c12e0d5f2ac035ff` into `vendor/openbabel`, then `rm -rf test .git` ("217 MB of reference data no build target reads").

**Patches** are numbered files under `build/patches/`, applied idempotently:

```sh
patch -p1 -d "$OB_DIR" --dry-run --forward --silent < "$patch"   # then apply, else "already applied"
```
(`openbabel-wasm/build/build-wasm.sh:67-76`). Eight patches, 539 lines total, each with a prose header explaining the failure it fixes — e.g. `0020-pthread-library.patch` (Emscripten's libc folds pthread into libc, so CMake `FindThreads` sets `CMAKE_USE_PTHREADS_INIT` but `find_library(pthread)` fails and `PTHREAD_LIBRARY-NOTFOUND` reaches the link line), `0023-static-plugin-registration.patch` (143 lines), `0022-no-source-dir-downloads.patch` (106 lines).

**Dependencies** get one shell script each under `build/deps/` (zlib, boost-headers, eigen3, rapidjson, libxml2, pixman, cairo, maeparser, coordgen — 1174 lines total), installing into a private `build/sysroot`, ordered by dependency. Emscripten *ports* are used where available: `--use-port=zlib --use-port=libpng --use-port=freetype --use-port=boost_headers`. There is even a `build/deps/pkgconfig-shim/pkg-config`.

### 1.2 The exact Emscripten invocations

**surge-wasm** (`build/build-wasm.sh:77-88`) — a `main()`-driven CLI program, the closest analogue to `xtb`:

```sh
emcc -o "$BUILD_DIR/surge.mjs" \
  -O3 -I "$NAUTY_DIR" \
  -DWORDSIZE=64 -DMAXN=WORDSIZE \
  -DOUTPROC=surgeproc -DPREPRUNE=surgepreprune -DPRUNE=surgeprune -DGENG_MAIN=geng_main \
  "$SURGE_SRC/surge.c" "$SURGE_SRC/geng.c" "$SURGE_SRC/planarity.c" "$NAUTY_DIR/nautyL1.a" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 \
  -sEXPORTED_RUNTIME_METHODS=callMain,FS \
  -sINCOMING_MODULE_JS_API=wasmBinary,noInitialRun,thisProgram,print,printErr,onExit \
  -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,worker \
  -sSTACK_SIZE=1048576
```
Configure step: `emconfigure ./configure --disable-popcnt --disable-clz` + `emmake make nautyL1.a` — with a comment that autoconf's *runtime* probes cannot work when the compiler emits wasm.

**openbabel-wasm** (`build/build-wasm.sh:87-150`) — configure with `emcmake cmake` (`-DENABLE_OPENMP=OFF -DOPTIMIZE_NATIVE=OFF -DBUILD_SHARED=OFF -DBABEL_DATADIR=/obdata …`, `CMAKE_CXX_FLAGS="-O3 -fwasm-exceptions …"`), build `libopenbabel.a`, then link a hand-written shim:

```sh
em++ -O3 -fwasm-exceptions build/ob_shim.cpp \
  -Wl,--whole-archive "$BUILD_DIR/ob/src/libopenbabel.a" -Wl,--no-whole-archive \
  … libinchi.a libxml2.a libmaeparser.a libcoordgen.a libcairo.a libpixman-1.a \
  -sMODULARIZE=1 -sEXPORT_NAME=openBabelModule \
  -sENVIRONMENT=web,worker \
  -sEXPORTED_FUNCTIONS=_ob_convert,_ob_formats,_ob_plugins,_ob_version,_ob_set_datadir,_ob_init,_ob_free,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,stringToUTF8,lengthBytesUTF8,FS,ENV \
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=2097152 \
  -sFORCE_FILESYSTEM=1 -sMALLOC=emmalloc -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -o "$BUILD_DIR/openbabel.js"
```
`--whole-archive` wraps *only* `libopenbabel.a`, with an inline note that the format plugins register through static initializers that `--gc-sections` otherwise collects, "leaving a module that reports 21 formats while smi->can still works".

**inchi-js** uses a small CMakeLists (`build/CMakeLists.txt:34-49`): `-sEXPORTED_FUNCTIONS=_inchi_from_molfile,…,_malloc,_free`, `-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,stringToUTF8,lengthBytesUTF8`, `-sEXPORT_NAME='inchiModule'`, `-sMODULARIZE`, `-sENVIRONMENT=web`, `-sSTACK_SIZE=2097152`, `-sALLOW_MEMORY_GROWTH=1`, `-O3`.

**What is never used:** pthreads / `-pthread` / `PROXY_TO_PTHREAD`, SIMD (`-msimd128`), `-sWASM_BIGINT`, `--preload-file`, `--embed-file`, `NODERAWFS`, `-flto`, `--closure`, embind. `-sENVIRONMENT` never includes `node`, with the reason spelled out at `openbabel-wasm/build/build-wasm.sh:138-140`: the node branch imports `node:fs` and `node:crypto` "which no browser bundler can resolve" — the packages still work under Node because the bytes are handed in as `wasmBinary` and the FS is MEMFS.

`emcmake`/`emconfigure` are used for the CMake and autotools projects respectively; a raw `emcc` line is used when the program is small enough to list its .c files.

### 1.3 The JS boundary — two styles, both relevant to xtb

**(a) `callMain` / CLI style (surge-wasm).** `instance.callMain(['-o/surge.out', ...flags])` (`src/wasm/runSurge.ts:111`). Because surge is a CLI that ends in `exit()` and keeps state in globals, **a fresh module instance is built per run** and thrown away; only the decompressed binary is cached (`src/wasm/loadWasm.ts:39-68`). The instance options are `{ wasmBinary, noInitialRun: true, thisProgram: 'surge', print, printErr, onExit, quit }` — with `quit` overridden because "Emscripten's Node build writes the exit status onto `process.exitCode`, which a library must never do to the process embedding it".

Output is streamed through an **Emscripten FS character device** rather than stdout:
```ts
const device = FS.makedev(64, 0);
FS.registerDevice(device, { open, close, write(_s, buffer, offset, length) { … } });
FS.mkdev('/surge.out', device);
```
The rationale (`runSurge.ts:42-51`) is that C block-buffers writes to a *file*, so the callback fires ~1 kB at a time instead of once per line — and each chunk is the only moment the run can be cancelled (throwing an `Ended` sentinel from the write callback implements both `timeoutMs` and `onBatch → false`).

**(b) `extern "C"` + JSON envelope (inchi-js, openbabel-wasm).** `build/ob_shim.cpp` (326 lines) exposes `ob_init`, `ob_set_datadir`, `ob_convert`, `ob_formats`, `ob_plugins`, `ob_version`, `ob_free`. Every entry point takes NUL-terminated UTF-8 and returns a malloc'd JSON document that JS must release with `ob_free`:

```
{"ok": <bool>, "result": <string>, "log": <string>, "error": <string>}
```

with `result` base64-encoded so binary outputs survive. The header comment states the design reason: "An exception must never escape into the WebAssembly trap handler — that aborts the instance permanently and every later call fails."

On the JS side `callEnvelope()` (`src/wasm/loadWasm.ts:72-118`) **copies string args onto the heap with `_malloc`/`stringToUTF8` rather than passing `'string'` to `ccall`**, with the reason documented: `ccall` marshals string args through the stack, so an input larger than `STACK_SIZE` silently corrupts memory and kills the instance. Everything is freed in a `finally`.

### 1.4 Data files

Not `--preload-file`. openbabel-wasm compiles `-DBABEL_DATADIR=/obdata`, links `-sFORCE_FILESYSTEM=1`, ships a second embedded blob `src/wasm/dataFs.ts` (1.29 MB of base64) holding a minimal archive (`<byteLength> <name>\n` + raw bytes per file) built from the 49-entry `build/data-manifest.txt`, and unpacks it at load with `FS.mkdir` + `FS.writeFile`, then `ccall('ob_set_datadir', null, ['string'], ['/obdata'])` (`src/wasm/loadWasm.ts:129-152`).

### 1.5 Embedding and npm packaging

`build/embed-wasm.js` reads the `.wasm`, gzips it via `CompressionStream`, base64s it, and writes **committed generated modules**:

- `src/wasm/data.ts` — `export const wasmBase64 = '…'` with a "generated, do not edit by hand, run `npm run build-wasm`" header.
- `src/wasm/glue.ts` — the Emscripten glue prefixed with `/* eslint-disable */ // @ts-nocheck`. With `-sEXPORT_ES6` (surge) nothing more is needed; with plain `-sMODULARIZE` (openbabel) the UMD trailer is stripped with `source.search(/;if\s*\(typeof exports[\s\S]*?$/u)` and `export default openBabelModule;` appended.
- `src/version.ts` — upstream + Emscripten versions, re-exported from the public API.

Load-time decode uses only Web Platform APIs — `decode` from cheminfo's own `uint8-base64` (the packages' **only** runtime dependency), `Blob().stream().pipeThrough(new DecompressionStream('gzip'))`.

Two publishing shapes:

| | surge-wasm, openchemlib-search-wasm | inchi-js, openbabel-wasm |
|---|---|---|
| build | `tsc --project tsconfig.build.json` → `lib/` | `node build/bundle.js` (esbuild ESM, `platform: browser`, `target: es2022`) + `dts-bundle-generator` |
| `exports` | `{".": "./lib/index.js"}` | `{".": {"types": "./lib/<name>.d.ts", "default": "./lib/<name>.js"}}` |
| `files` | `["lib","src",…]` + `src/.npmignore` (`__tests__`, `.DS_Store`, `.npmignore`) | `["lib", "COPYING", "NOTICE"]` |

All are `"type": "module"`, ESM-only, no CJS. `prepack: npm run tsc`, `.npmrc` = `ignore-scripts=true`.

Sizes actually shipped: `surge-wasm@2.0.0` 620,425 B unpacked / 65 files (195 kB wasm → 95 kB base64 source); `inchi-js@0.2.0` 1,351,887 B / 7 files; `openchemlib-search-wasm@1.0.0` 259,252 B / 47 files; openbabel-wasm README: `.wasm` 7.37 MB raw / 2.46 MB gzip / 1.82 MB brotli, data tables 3.53 MB raw → 1.29 MB base64-in-source, tarball 3.33 MB, ~100 ms startup.

### 1.6 TypeScript API shape

Flat named exports from `src/index.ts`, all `async`, plus the version constants. Examples:

- surge: `generate(formula, options?) → { smiles, ended: 'complete'|'timeout'|'stopped', log, durationMs }`, `count(...)`, `buildFlags`, `parseLog`, `SurgeError` carrying the upstream stderr, and `SURGE_VERSION / NAUTY_VERSION / EMSCRIPTEN_VERSION`.
- openbabel: `convert(input, options) → { result, log }`, `convertToBytes(...) → { result: Uint8Array, log }`, `getInputFormats()`, `getPlugins(category)`, plus an escape hatch `loadOpenBabelWasm()` returning the raw Emscripten module.

Long-running work is made **cancellable and observable** through the options object rather than by threads: `onBatch(batch, total) → false` stops, `batchSize`, `timeoutMs`; the README documents that a hard limit needs a Worker + `worker.terminate()`. Every optional interface property carries a `@default` JSDoc tag.

Async init is a memoised module-level promise (`let modulePromise: Promise<X> | undefined`, `modulePromise ??= instantiate()`).

### 1.7 Build orchestration and reproducibility

`npm run build-wasm` → `bash build/build-wasm.sh` in every emcc repo, never a Makefile. surge-wasm re-execs itself inside a **pinned Docker image** when emcc is absent:

```sh
EMSDK_IMAGE=emscripten/emsdk:6.0.6
… exec docker run --rm -v "$PACKAGE_DIR":/work -w /work "$EMSDK_IMAGE" bash build/build-wasm.sh
```

openbabel-wasm caches `libopenbabel.a` and skips reconfigure unless `FORCE=1` ("recompiling 298 translation units takes minutes"). openchemlib-search-wasm goes furthest on reproducibility: CI rebuilds the module and runs `git diff --exit-code -- wasm`, which required stamping gzip header byte 9 to `0xff` because macOS writes `0x13` and Linux `0x03`.

CI: shared zakodium workflows — `nodejs.yml@nodejs-v1` (`lint-check-types: true`, Node 24), `release.yml@release-v1` (`npm: true`, `BOT_TOKEN` + `NPM_BOT_TOKEN`), `typedoc.yml@typedoc-v1` (`entry: src/index.ts`). openbabel-wasm overrides `npm-test-command: npm run test-bundle && npm run test-only`. surge-wasm adds a hand-written `browser.yml` for Playwright.

### 1.8 Test strategy for a wasm module

1. **Unit** — `src/__tests__/*.test.ts`, vitest, flat `test()` calls, v8 coverage with the generated modules excluded (`vitest.config.ts` `coverage.exclude: ['src/wasm/data.ts','src/wasm/dataFs.ts','src/wasm/glue.ts']`). Assertions are exact chemical values (`'LFQSCWFLJHTTHZ-UHFFFAOYSA-N'`, the seven C4H10O SMILES), never "length > 0".
2. **Bundle re-run** — `vitest.config.bundle.ts` aliases the wrapper imports to `lib/<name>.js` with a regex, so the whole suite re-executes against the artifact that ships. Wired as `test-bundle` before `test-only` in the `test` script.
3. **Tarball contract** — `src/__tests__/npmPack.test.ts` runs `npm pack --dry-run --json --ignore-scripts` and asserts the exact sorted file list plus `license === 'GPL-2.0-only'` (60 s timeout because npm walks a multi-MB bundle).
4. **Real browser** — surge-wasm's `browser/serve.js` esbuild-bundles `lib/index.js`, serves it on :31230, and `browser/surge.spec.ts` runs `generate`/`count` inside Chromium via `page.evaluate`, asserting `pageerror` is empty. This is the check that `-sENVIRONMENT=web,worker` really produced browser-clean output.
5. Regression corpora (inchi-js has `__tests__/regression/*.sdf` suites and a `readme.test.ts` that executes the README examples).

## 2. ir.cheminfo.org and the existing xtb integration

**The site.** `https://ir.cheminfo.org/` serves *IRCalc: Making molecules vibrate* (`<meta name="keyword" content="IR, spectroscopy, xtb">`) — a **legacy cheminfo visualizer** page (`data-main="visualizer/src/init"`, requirejs, `data-ci-view="./visualizer/view.json"`, 178 kB view). `last-modified: Mon, 04 Oct 2021`, nginx/1.27.5. The backing repo is **[cheminfo-py/ir-teaching-app](https://github.com/cheminfo-py/ir-teaching-app)** (HEAD 977a0cd, 2022-03-10) — nginx + docker-compose gluing the visualizer frontend to the backend. There is **no `ir.cheminfo.org` repo in the cheminfo org**, and no React/Vite rewrite exists.

**The xtb backend.** **[cheminfo-py/xtbservice](https://github.com/cheminfo-py/xtbservice)** (MIT, HEAD d9227ea 2022-03-08, last push 2024-05-13), FastAPI, mounted at `https://ir.cheminfo.org/v1`:

- `GET|POST /ir` — `smiles` (or `molFile`), `method ∈ {GFNFF, GFN2xTB, GFN1xTB}`, default `GFNFF` → `IRResult { wavenumbers, intensities, ramanIntensities, zeroPointEnergy, modes, mostRelevantModesOfAtoms, mostRelevantModesOfBonds, hasImaginaryFrequency, isLinear, momentsOfInertia, hasLargeImaginaryFrequency }`
- `POST /conformers`, `GET /app_version` (currently returns `{"app_version":"0+unknown"}`)
- Docs at `/v1/docs`, OpenAPI 3.0.2 at `/v1/openapi.json`.

**Critical architectural detail for a wasm port:** the service does **not** use xtb's own Fortran hessian / `--ohess` driver or the xtb CLI. It uses `xtb-python`'s ASE calculator for single points and lets **ASE do the finite-difference vibrational analysis**:

```python
from ase.vibrations import Infrared
from ase.vibrations.placzek import PlaczekStatic
from ase.calculators.bond_polarizability import BondPolarizability
from ase.optimize.lbfgs import LBFGS
from xtb.ase.calculator import XTB
```
(`xtbservice/ir.py:8-20`; optimisation is ASE `LBFGS(fmax=5e-6, maxiter=100)` in `xtbservice/optimize.py:24-40`). The 2026 rewrite says so explicitly: *"This worker uses the same computational approach as the xtbservice — ASE's Infrared class and PlaczekStatic Raman calculator with BondPolarizability, **not the xtb CLI**"* (`pipeline-workers/xtb-vibrational/worker.py:1-11`).

So the surface an in-browser xtb actually has to reproduce is **energy + forces + dipole for a displaced geometry**, repeated over a 6N finite-difference grid, plus JS-side mass-weighting/diagonalisation, folding (`fold()`, Gaussian, width 4 cm⁻¹, 800–4000, npts = (end-start)/width*10+1) and mode analysis. The heavy Fortran drivers (`hessian.f90`, the CLI, `execute_command_line`) are not on the current critical path at all.

**Operational envelope of the current service:** `MAX_ATOMS_XTB=60`, `MAX_ATOMS_FF=100`, `TIMEOUT=100` s (30 s in the shipped `.env`), `WORKERS=1`, `OMP_NUM_THREADS=1,1`, diskcache keyed on `hash(atoms)+method`, Python 3.7 on `continuumio/miniconda3` with conda `rdkit` + `xtb-python`, `requirements.txt` pinning `fastapi==0.68.1` and a personal ASE fork `git+https://github.com/kjappelbaum/ase.git@polarizability`. The stack is unmaintained since 2024.

**The 2026 successor.** [cheminfo-py/pipeline-workers](https://github.com/cheminfo-py/pipeline-workers) (HEAD d70ea4c, 2026-03-20) has `xtb-optimization/`, `xtb-vibrational/`, `rdkit-conformers/`, `psi4-optimization/` workers driven over SSE by the private [cheminfo/pipeline](https://github.com/cheminfo/pipeline) monorepo (workers `xtbOptimization` / `xtbVibrational` seeded in `backend/src/db/seedTestData.ts:262,330`; user-facing help in `frontend/src/components/help/xtbOptimization.ts`). Container limits: `XTB_VIB_MEMORY:-4G`, `XTB_VIB_CPUS:-1`.

**Directly relevant prior finding:** `pipeline-workers/xtb-vibrational/Dockerfile` opens with

```dockerfile
# Force amd64 platform — xtb's ARM64 build has numerical bugs that cause
# GFN2-xTB calculations to diverge.
FROM --platform=linux/amd64 condaforge/miniforge3:latest
```

cheminfo has already been bitten by xtb producing divergent GFN2-xTB results on a non-x86 target. Any wasm32 port needs a numerical-agreement test suite against the x86 reference from day one — which fits their existing habit of asserting exact values in tests.

## 3. What this means for an xtb-wasm recommendation

To fit the established pattern, an `xtb-wasm` package should: vendor xtb by pinned commit under `vendor/` with patches in `build/patches/`; build via one `build/build-wasm.sh` that runs inside a pinned `emscripten/emsdk:<version>` image; disable OpenMP and link single-threaded; target `-sENVIRONMENT=web,worker` with `-sMODULARIZE=1 -sALLOW_MEMORY_GROWTH=1 -sINVOKE_RUN=0` and the binary passed as `wasmBinary`; expose a hand-written `extern "C"` shim over `include/xtb.h` returning a JSON envelope via `ccall` (the openbabel-wasm model) — or `callMain` + an FS device if the CLI is used; embed parameter files the way `dataFs.ts` embeds Open Babel's tables; commit `src/wasm/{data,glue}.ts` + a generated `src/version.ts`; publish ESM-only with `exports → lib/`; and test with the four-layer strategy including a Playwright browser run. The Fortran-vs-Emscripten question is the only genuinely new problem — everything downstream of "we have a `.wasm`" is already solved and templated in these repos.
