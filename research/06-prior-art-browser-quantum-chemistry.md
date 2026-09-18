## SUMMARY
No one has ported the Fortran xtb (or tblite) to WebAssembly — verified with exhaustive GitHub repo/code/issue/PR searches across the whole grimme-lab and tblite orgs, npm, and the web. Zero hits, zero issues, zero PRs, zero discussions. But the far more important finding is that the goal is already reachable without touching Fortran: peterspackman/occ ships a native ~9,000-line C++17 reimplementation of GFN2-xTB (developed against xtb/tblite references, agreeing "to single µHa on small molecules"), it is compiled to WebAssembly with emcc/embind, and it is published on npm as @peterspackman/occjs@0.9.3 (2026-08-05). I installed it and actually ran GFN2-xTB in Node 26: water E = -5.07025643 Ha, and a numerical Hessian giving 1573.9 / 3573.6 / 3668.0 cm⁻¹ in 51 ms; benzene's full 36-mode Hessian in 1.04 s. The one missing piece for ir.cheminfo.org is IR intensities — occ computes frequencies and normal modes but exposes no dipole derivatives, so band positions come free and intensities need adding. Secondary prior art: ExaPsi/IQCP (Rust → wasm, live at iqcp.dev) does full HF/DFT with analytical Hessians, IR and Raman spectra entirely client-side; ss0832/gfn2-rs is an unofficial Rust GFN2 with no BLAS/LAPACK dependency. If you did insist on the real Fortran, that path is also no longer science fiction — emscripten-forge ships libflang 22.1.6 for wasm32 plus LAPACK 3.12.1 and OpenBLAS 0.3.34 built with it, and r-wasm/flang-wasm (updated 2026-06-08) does the same for webR. No client-side ML IR-spectrum predictor exists; all of them (Chemprop-IR, NNMol-IR, Graphormer-IR) are Python/server-side.

## BLOCKERS
None

## DETAILS
## Bottom line

**Nobody has compiled Fortran xtb to WebAssembly.** That is a solid negative result, established below with the exact queries.

**But somebody has already put GFN2-xTB in the browser** — by reimplementing it in C++ rather than porting the Fortran. That project is [`peterspackman/occ`](https://github.com/peterspackman/occ), it ships on npm as [`@peterspackman/occjs`](https://www.npmjs.com/package/@peterspackman/occjs), and I ran it successfully during this investigation. This changes the shape of the xtb-wasm project completely: the Fortran toolchain problem may be avoidable.

---

## 1. Negative result: no xtb / tblite WebAssembly port

Searched and found nothing:

| Search surface | Queries | Result |
|---|---|---|
| `gh search repos` | `xtb wasm`, `xtb webassembly`, `xtb browser quantum`, `tblite wasm`, `libxtb`, `xtb-js`, `xtb.js`, `mopac wasm`, `mopac js`, `quantum chemistry wasm`, `quantum chemistry webassembly`, `chemistry webassembly`, `psi4 wasm`, `pyscf wasm`, `semiempirical rust`, `gfn2-xtb rust`, `xtb rust`, `gfn-xtb`, `xtb semiempirical`, `sparrow semiempirical`, `openmopac`, `rdkit wasm`, `openbabel wasm` | 0 relevant |
| `gh search issues` in `grimme-lab/xtb`, `tblite/tblite`, `grimme-lab/dftd4`, `grimme-lab/mctc-lib`, `grimme-lab/crest` | `wasm`, `webassembly`, `emscripten`, `browser`, `javascript`, `js` | **0 hits in every repo** (one false positive, xtb#601, unrelated) |
| `gh search prs --repo grimme-lab/xtb` | `wasm`, `emscripten` | `[]` |
| `gh search code` | `xtb emscripten`, `xtb.wasm`, `tblite emscripten`, `libxtb wasm`, `flang emcc`, `gfn2-xtb javascript` | all empty — and code search verified live (`xtb_singlepoint` correctly returns `grimme-lab/xtb` `include/xtb.h`) |
| npm registry API | `xtb`, `xtb wasm`, `tblite`, `mopac`, `semiempirical`, `gfn2`, `quantum chemistry wasm` | nothing; `xtb` returns only the XTB forex-broker API clients |
| Web | `xtb GFN2-xTB WebAssembly browser emscripten`, `"tblite" OR "xtb" wasm emscripten fortran browser github issue`, `"xtb" grimme "in the browser" OR "web app" OR "WebAssembly" 2025 2026` | no prior art |

xtb has Discussions enabled (128 threads) as does tblite (18) — neither surfaces any wasm topic in search.

No xtb Pyodide/emscripten wheel exists either.

---

## 2. THE finding: `occ` — native C++ GFN2-xTB, already in wasm, already on npm

**Repo:** https://github.com/peterspackman/occ — "Open Computational Chemistry in C++", 34 stars, C++17, licensed **GPL-3.0-or-later OR LGPL-3.0-or-later**, actively maintained (v0.9.3, 2026-08-05). Author Peter Spackman (CrystalExplorer).

**What it is.** occ ships an **in-tree, from-scratch C++ implementation of GFN2-xTB** — not a wrapper around the Fortran. Cloned to `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/occ`:

- `src/xtb/` + `include/occ/xtb/` = **9,030 lines**: `gfn2_engine.cpp`, `gfn2_parameters.cpp`, `h0.cpp`/`h0_gradient.cpp`, `anisotropic.cpp` (CAMM AES), `camm.cpp`, `gamma.cpp`, `repulsion.cpp`, `sto_ng.cpp`, `multipole_ints.cpp`, plus a full periodic path (`gfn2_periodic_calculator.cpp`, `multipole_ewald.cpp`, `periodic_integrals.cpp`).
- `include/occ/xtb/xtb_calculator.h:33` — *"In-tree GFN2-xTB calculator"*; `backend_name()` returns `"Native"`.
- Parameters from `share/xtb/gfn2.json` (published GFN2 set).
- A separate optional `TbliteCalculator` (`src/xtb/tblite_wrapper.cpp`) wraps the Fortran tblite — **not** used in the wasm build.
- Accuracy claim in `README.md:68-83`: developed against xtb and tblite, *"agrees with xTB to single uHa on small molecules"*; analytical molecular gradient validated to 5e-5 Ha/Bohr; `tests/xtb_native_tests.cpp` contains explicit tblite reference values (e.g. line 1728 `"AES potential: tblite reference for water_mol"`).
- Documented limitations: **open-shell GFN2 and GFN1/GFN0 are out of scope for v1**; periodic gradients not wired up; the multipole-on analytical gradient has a ~1 mHa gap vs FD, so the charge-only gradient is the production variant.

**Why no Fortran problem.** occ is pure C++ on Eigen — there is no LAPACK/BLAS link, no Fortran runtime, no OpenMP in the wasm build. `scripts/build_wasm.sh`:

```sh
emcmake cmake . -B"wasm" -DCMAKE_BUILD_TYPE=Release -DUSE_OPENMP=OFF -GNinja \
  -DENABLE_JS_BINDINGS=ON -DUSE_SYSTEM_EIGEN=OFF \
  -DCMAKE_CXX_FLAGS="-msimd128" -DCMAKE_C_FLAGS="-msimd128"
cmake --build "wasm" --target occjs --target occ.wasm
```

**JS bindings exist and are complete.** `src/js/xtb_bindings.cpp` binds `XtbCalculator` (embind) with `fromMolecule` / `fromDimer` / `fromCrystal`, `singlePoint()`, `charge`, `numUnpairedElectrons`, `temperature`, `maxIterations`, and — critically — `hessian(step)` (line 187) and `vibrationalModes(step, projectTrRot)` (line 191). `src/js/opt_bindings.cpp:192-203` binds `VibrationalModes` with `frequenciesCm`, `normalModes`, `hessian`, `nModes()`.

### I ran it

```
npm i @peterspackman/occjs@0.9.3      # 60.8 MB unpacked; occjs.wasm 21.5 MB + occjs.data 8.6 MB
```

Node 26.0.0, macOS arm64 (scripts kept at `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/occjs-test/`):

| system | atoms | module load | single point | Hessian + freq | frequencies (cm⁻¹) |
|---|---|---|---|---|---|
| water | 3 | 231 ms | 55 ms, E = **-5.07025643 Ha**, 7 iters | 51 ms | 1573.9 / 3573.6 / 3668.0 |
| methanol | 6 | — | 2 ms, E = -8.22518523 Ha | 265 ms | …1486, 2915-2955, 3778.9 |
| benzene | 12 | — | 5 ms, E = -15.87866222 Ha | 1041 ms | 36 modes, C–H 3031-3054 |
| aspirin-ish | 21 | — | 309 ms, 132 iters | 29.9 s | garbage — my hand-typed geometry was not a minimum |

The water frequencies and energy are the right GFN2-xTB numbers. **This is a working browser-grade GFN2-xTB.**

Two practical caveats worth knowing before you build on it:

1. **`index.d.ts` does not declare `XtbCalculator`** — the TypeScript wrapper is behind the wasm. The class *is* registered at runtime (`strings occjs.wasm | grep -c XtbCalculator` = 20) and works via `Module.XtbCalculator.fromMolecule(mol)`. `packages/occjs/test/xtb_hessian_smoke.mjs` in the repo uses exactly that. Typings are a trivial upstream PR.
2. **The published `VibrationalModes` property is `frequenciesCm`**, not `frequencies_cm` as the repo's own smoke test says — the smoke test in the repo is stale.

### The gap you would have to fill: IR intensities

occ gives you **band positions and normal modes, but not intensities**. Verified:
- `include/occ/xtb/xtb_result.h` has **no dipole field** at all.
- `grep -n "dipole" include/occ/xtb/xtb_calculator.h src/js/xtb_bindings.cpp` → nothing.
- `grep -rni "ir_intensit|infrared|intensities" include src` → only `crystal/powder.h` (X-ray).

The ingredients are present though: `include/occ/xtb/camm.h` computes atomic charges/dipoles/quadrupoles, and `tests/xtb_native_tests.cpp:331` already computes a total molecular dipole as `-tr(P·D_α)`. IR intensities = finite-difference of that dipole along the same displaced geometries the numerical Hessian already visits — i.e. ~free if folded into `compute_hessian_numerical`. That is a contained upstream contribution to a maintained LGPL C++ project, not a Fortran port.

**Licensing note:** GPL-3.0-or-later **OR** LGPL-3.0-or-later. The LGPL arm is the one you want for shipping a wasm blob from a permissively-licensed cheminfo package; check it against your usual MIT posture before committing.

---

## 3. Second finding: IQCP — Rust → wasm, IR + Raman in the browser, live

https://github.com/ExaPsi/IQCP · https://iqcp.dev (HTTP 200, last-modified 2026-08-09, served cross-origin-isolated with COOP/COEP)

- Created 2026-01-24, **v2.0.0 released 2026-05-03**, MIT, Rust, 4 stars, single author, Zenodo DOI 10.5281/zenodo.18798309, JCIM submission in progress.
- RHF / LDA / B3LYP / B3LYP-D3(BJ), six basis sets (STO-3G → cc-pVDZ), H–Ar.
- **Analytical Hessians via CPHF, IR intensities from dipole derivatives, semi-analytical Raman activities, RRHO thermochemistry**, Lorentzian/Gaussian broadened spectra — all client-side.
- Two wasm modules, **470 KB core + 289 KB spectra gzipped** (vs occ's 21.5 MB wasm + 8.6 MB data — a useful contrast in what a purpose-built engine costs).
- Validated vs PySCF 2.11.0 over 108 systems: max RHF deviation 77 nHa, H₂O frequencies within 0.01 cm⁻¹. 1,418 Rust + 361 TS tests.
- Architecture: React/Vite SPA → Web Worker → wasm-bindgen, lazy-loading the spectra module.

This is the closest existing thing to the ir.cheminfo.org product goal — but it is **ab initio, not GFN2-xTB**, so it is orders of magnitude more expensive per molecule and capped at small systems. Its value to you is as a proven blueprint (worker offloading, lazy spectra module, deep-linkable state) and as evidence the product shape works.

---

## 4. If you insist on the real Fortran xtb: that path is also open now

Not prior art for xtb specifically, but the toolchain blocker described in your brief is largely gone:

- **[r-wasm/flang-wasm](https://github.com/r-wasm/flang-wasm)** — patched LLVM Flang targeting `wasm32-unknown-emscripten` + a prebuilt Fortran runtime for Emscripten. 24 stars, **last commit 2026-06-08**. Used to build **BLAS 3.12.0 and LAPACK 3.12.0** for webR. The patches (per [gws.phd/posts/fortran_wasm](https://gws.phd/posts/fortran_wasm/)) are: wasm32 target specifics in `flang/lib/Optimizer/CodeGen/Target.cpp` for complex-number marshalling, and hard-coding 4-byte `long` in `RTBuilder.h`/`CodeGen.cpp`. Docker and Nix images provided.
- **emscripten-forge** — an *independent* second implementation, now packaged: recipe `libflang` **v22.1.6** built from `llvmorg-22.1.6` with four patches from `serge-sans-paille/llvm-project` branch `feature/flang-wasm`; `flang_emscripten-wasm32` v22.1.6 published on the `emscripten-forge-4x` prefix.dev channel ~3 months ago. On top of it they build **LAPACK 3.12.1** (`liblapack.a`, `libblas.a`), **OpenBLAS 0.3.34** (12 emscripten patches), **scipy 1.18.0** (15 Fortran/wasm-ABI patches), plus Octave and R.
- **LFortran** compiled LAPACK and fpm in **February 2026** (9/10 production codes toward beta), and has a native wasm backend — but still alpha for Fortran 2008/2018.

The recurring pattern in every one of those patch sets (`0004-Add-dummy-length-arguments-for-char-arguments`, `0007-Extra-char-length-arguments-in-linalg-cython-wrapper`, `0011-Return-int-from-ctest-F77-wrappers-for-wasm-ABI`) is the hidden-character-length and return-type ABI mismatch — that is what a Fortran-xtb port would spend its time on, plus xtb's 26 `execute_command_line`/`system()` call sites, which have no meaning in wasm and must be stubbed.

---

## 5. Other non-Fortran GFN implementations

| Project | Language | Status | Verdict |
|---|---|---|---|
| **[peterspackman/occ](https://github.com/peterspackman/occ)** | C++17 | maintained, npm-published, wasm | **the one** |
| [ss0832/gfn2-rs](https://github.com/ss0832/gfn2-rs) | Rust | 0 stars, created **and** last pushed 2026-07-03, GPL-3.0 | Unofficial GFN2 with analytic gradients, semi-numerical Hessian, TD-GFN2, periodic; **explicitly no BLAS/LAPACK — uses `faer`**, so wasm-trivial. But one-day repo, unvetted, and the GFN2 parameter file is not distributed (must be taken from xtb). |
| [grimme-lab/dxtb](https://github.com/grimme-lab/dxtb) | Python/PyTorch | 142 stars, Apache-2.0, pushed 2026-08-17 | Differentiable GFN1-xTB from the Grimme lab itself. Not a browser path (needs torch). |
| [pprcht/gfnff](https://github.com/pprcht/gfnff) | Fortran | 24 stars, 2026-07-12 | Standalone GFN-FF extracted from xtb — force field, not GFN2. |
| zarkoivkovicc/GFN1-xTB.jl, fewillemann/GFN1-xTB, AceMouse/Simple-GFNn-xTB, harvey-group/xtbAutoDiffWork | Julia/misc | 0-1 stars, teaching projects | Not usable. |

No JS/TS GFN implementation exists. Entos/Qcore is proprietary and unavailable.

---

## 6. ML surrogates for IR — no browser option exists

All the credible IR-from-structure models are Python/server-side; **none ships an ONNX or TF.js browser artifact**:

- **Chemprop-IR** — D-MPNN, JCIM 2021 ([10.1021/acs.jcim.1c00055](https://pubs.acs.org/doi/10.1021/acs.jcim.1c00055)), github.com/gfm-collab/chemprop-IR, Zenodo 4698943. Supports C,H,O,N,Si,S,P,F,Cl,Br,I in gas/liquid/KBr/nujol/CCl₄.
- **NNMol-IR** — github.com/allouchear/NNMol-IR, arXiv 2405.05737, Chem. Phys. Lett. 2024.
- **Graphormer-IR** — graph transformer, ChemRxiv 2023.
- **PALIRS** — active-learning MLIP for IR, arXiv 2506.13486.
- The only web app found (Devpost "IR Spectrum Predictor", SchNet) serves predictions from a FastAPI backend.

Exporting Chemprop-IR to ONNX and running it with `onnxruntime-web` is a plausible parallel product line, but it would be new work — there is no prior art to lift.

---

## 7. Server-side alternatives (if browser-native is dropped)

- **Your own**: `https://ir.cheminfo.org/v1/openapi.json` → title *"XTB webservice"*, version 1, endpoints `GET /app_version`, `GET /ir`, `POST /ir`, `POST /conformers` (FastAPI). This is the baseline the wasm work would replace.
- **ChemCloud / BigChem** (Martínez group) — [mtzgroup/bigchem](https://github.com/mtzgroup/bigchem) (20★, 2026-07-15), [chemcloud-client](https://github.com/mtzgroup/chemcloud-client) (13★, 2026-07-16), server live at chemcloud.mtzlab.com. Runs xtb through QCEngine; J. Chem. Phys. 160, 142501 (2024).
- **WebMO** — exposes GFN0/GFN2-xTB through a hosted web UI (WIREs Comput. Mol. Sci. 2022, 10.1002/wcms.1554).
- `xtb-python` speaks QCSchema for QCArchive.

---

## 8. Precedent for big scientific codebases in wasm (performance expectations)

- **[Moorhen](https://github.com/moorhen-coot/Moorhen)** (moorhen.org, npm `moorhen`) — Coot + CCP4 + FFTW2 + Privateer + GSL compiled to wasm with emscripten. Ships in CCP4 Cloud.
- **[Atomify](https://github.com/andeplane/atomify)** — LAMMPS in wasm, documented at **~50% of native single-threaded speed**. That 2× factor is the right planning number.
- peterspackman also has an unreleased `lmpjs` (LAMMPS wasm, 0★, 2025-08-27).
- Your own `openbabel-wasm` / `rdkit-js` are the same class of problem, already solved.

---

## Recommendation implied by the evidence

The xtb-wasm framing may be the wrong project. The evidence says: **fork/contribute to `occ`, not port `xtb`.** You get a validated GFN2-xTB already running in wasm with frequencies today; the delta to a working ir.cheminfo.org backend-free build is IR intensities via dipole derivatives, which is a bounded change to code that already computes the dipole. The alternatives — a Flang-wasm build of 176k lines of Fortran with 26 `execute_command_line` sites and pervasive LAPACK, or waiting on LFortran — are both far larger and strictly riskier.

Two things to verify before committing: (a) whether occ's C++ GFN2 reproduces the frequencies your current xtb webservice returns on a representative set of your teaching molecules (a straight A/B against the existing `/v1/ir` endpoint), and (b) whether GPL/LGPL is acceptable for the deliverable.
