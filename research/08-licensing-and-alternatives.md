## SUMMARY
xtb is LGPL-3.0-or-later, but one file — `symmetry/symmetry_i.c`, Patchkovskii's brute-force symmetry analyzer — is GPL-2.0-or-later, which would make a statically linked xtb.wasm a GPL-3.0 combined work. It is used only to get a point group for the thermostatistics rotational symmetry number (src/thermo.f90:59 → src/main/property.F90:1344), never for frequencies or IR intensities, so an IR-only build can and should drop it and stay pure LGPL. Dependencies split into LGPL-3 (tblite, dftd4, CPCM-X) and Apache-2.0 (mctc-lib, multicharge, toml-f); LAPACK/OpenBLAS are BSD. Because WebAssembly has no shared-library mechanism, LGPL-3 §4(d)(1) is unavailable and you must satisfy §4(d)(0): publish the full build tree plus the linkable objects so a user can relink a modified xtb. The clean precedent is ffmpeg.wasm: `@ffmpeg/ffmpeg` is MIT (wrapper) while `@ffmpeg/core` — the package holding the .wasm — is declared `GPL-2.0-or-later`. Serving a .wasm from ir.cheminfo.org is conveying and triggers all of this; a server-side xtb behind an API conveys nothing and has zero copyleft obligation, which is a real decision-relevant asymmetry. On alternatives: Pyodide+xtb-python is dead (Pyodide's own scipy notes say "we don't have a good fortran to wasm compiler" and use f2c, which is Fortran-77-only; xtb-python is explicitly unmaintained). Reimplementation is a multi-year job, but the parameters are available permissively — the Grimme group's own Apache-2.0 `dxtb` ships the complete 1680-line `gfn2-xtb.toml`. Cheaper physics is measurably worse: GFN2-xTB scores r_match 0.690 unscaled against 7247 experimental gas-phase IR spectra vs GFN-FF's 0.545, and force-field/EEQ charge-based intensities are the weakest link. Open Babel cannot compute vibrational frequencies at all — it only stores them. The strongest recommendation is to target tblite (52k lines vs xtb's 176k, LGPL-3, C API already exposes dipole) and drive the finite-difference Hessian from JS.

## BLOCKERS
None

## DETAILS
> **Not legal advice.** I am reporting what the licence texts say and what comparable projects actually do. EPFL's TTO should sign off before the first npm publish.

---

# Part (a) — Licensing and distribution

## a.1 The licence stack, verified file by file

| Component | Version pinned by xtb | Licence | Evidence |
|---|---|---|---|
| **xtb** | main (this clone) | **LGPL-3.0-or-later** | `src/main/setup.f90:1-16`, `README.md:259-274`, both `COPYING` (GPL-3) and `COPYING.LESSER` (LGPL-3) present; 1192 files carry the LGPL header |
| **`symmetry/symmetry_i.c`** | vendored | **GPL-2.0-or-later** ⚠️ | `symmetry/symmetry_i.c:1-21` — "(C) 1996, 2003 S. Patchkovskii" |
| tblite | v0.6.0 | LGPL-3.0-or-later | `SPDX-Identifier: LGPL-3.0-or-later` in `src/tblite/xtb/gfn2.f90` |
| dftd4 | v4.2.0 | LGPL-3.0-or-later | `COPYING` + `COPYING.LESSER` at the tag |
| CPCM-X | v1.1.0 | LGPL-3.0 | `LICENSE` at the tag |
| mctc-lib | v0.5.1 | **Apache-2.0** | `LICENSE` + README §License |
| multicharge | v0.5.0 | **Apache-2.0** | `LICENSE` + README §License |
| toml-f | (via tblite v0.5.0) | **Apache-2.0 OR MIT** | `LICENSE-Apache` + `LICENSE-MIT` |
| test-drive | v0.5.0 | Apache-2.0 OR MIT | test-only, never linked into the product |
| LAPACK (Netlib) | — | modified BSD-3-Clause | `Reference-LAPACK/lapack/master/LICENSE` |
| OpenBLAS | — | BSD-3-Clause | GitHub API `license.spdx_id` |

**Net effect as the tree stands today: LGPL-3.0-or-later for everything except one C file, which is GPL-2.0-or-later.**

## a.2 The GPL landmine — and why it costs you nothing to defuse it

`symmetry/symmetry_i.c` is Serguei Patchkovskii's 1996 "brute force symmetry analyzer," GPL-2-or-later. It is compiled unconditionally (`meson.build:101`, `symmetry/CMakeLists.txt:23`). GPL-2-or-later can be taken as GPL-3, and GPL-3 governs the combination — so **a statically linked `xtb.wasm` containing that object is a GPL-3.0 combined work, not LGPL-3.0.** That is a materially heavier obligation: everything you link with it, including your JS glue if it is part of the same combined work, becomes subject to GPL-3 source-provision terms.

The good news is that it is trivially removable for an IR product. The full call chain is:

```
symmetry/symmetry_i.c :: schoenflies()          (GPL-2+)
  ← symmetry/symmetry.f90:70  get_schoenflies
    ← src/thermo.f90:59       getsymmetry
      ← src/main/property.F90:1344  → set%pgroup
        → src/getsymnum.f90   → rotational symmetry number σ
          → src/thermo.f90    thermodyn()  → S, H, G
```

It touches **entropy and free energy only**. Harmonic frequencies and IR intensities never see it. It already self-disables above `maxatdesy` atoms (`src/thermo.f90:38-42`), so xtb itself is built to run without a point group.

**Action:** drop `symmetry_i.c` from the build and stub `get_schoenflies` to return `'c1'`. Note it in your README as a deliberate deviation. Your blob is then uniformly LGPL-3.0-or-later.

## a.3 What LGPL-3 actually demands of a `.wasm` on npm and on a website

First, the trigger. Putting `xtb.wasm` on `ir.cheminfo.org` **is conveying** — the browser downloads a copy of the library. This is unlike SaaS: LGPL-3 has no AGPL-style network clause, so a server-side xtb behind an HTTP API conveys nothing and carries **zero** distribution obligation. That asymmetry is the single most decision-relevant fact in this whole report.

Second, the mechanism. LGPL-3 §4 lets you convey a Combined Work under your own terms if you do (a)–(e). Clauses (a), (b), (c) are trivial notices. Clause (d) is the one that bites, and it offers two routes:

- **4(d)(1)** — "Use a suitable shared library mechanism… one that **(a) uses at run time a copy of the Library already present on the user's computer system**, and (b) will operate properly with a modified version of the Library that is interface-compatible."
- **4(d)(0)** — "Convey the Minimal Corresponding Source… and the Corresponding Application Code in a form suitable for, and under terms that permit, the user to **recombine or relink** the Application with a modified version of the Linked Version."

A `.wasm` you serve to the browser is not already on the user's computer, so **4(d)(1) is unavailable**. You are on the 4(d)(0) relinking path. In practice that means publishing, alongside the blob:

1. The **complete xtb source at the exact revision you built** (plus your patches — the symmetry removal, any `execute_command_line` stubs, any Fortran-77 downgrades). A git submodule or vendored tarball, not a bare "see grimme-lab/xtb" link.
2. The **complete, reproducible build recipe**: your Dockerfile, the emsdk version pinned exactly, every `emcc`/`emflags` line, the LAPACK subset you used. Someone must be able to run one command and get a byte-comparable-in-behaviour `.wasm`.
3. **The linkable objects for your own non-LGPL parts** — your C shim, your Embind/`--js-library` glue — as `.o`/`.a`/`.bc` artefacts (or under a licence that permits relinking, which is the easier route: just MIT your own glue and ship its source). Attach them to the GitHub release; they need not be in the npm tarball.
4. Copies of `COPYING` and `COPYING.LESSER` in the package, plus a prominent notice that xtb is used and is LGPL-covered (§4(a)–(b)).

**Does "shipping the build scripts" satisfy it?** Almost, and in the real world it is what everyone accepts — but only if the scripts are genuinely sufficient to relink. The test in §4(d)(0) is the *user's ability to substitute a modified xtb*, not your good intentions. A Dockerfile that pins `emsdk 3.1.x`, vendors the exact xtb revision, and produces the shipped artefact passes that test. A README saying "we built it with emcc" does not. Since you are MIT-ing your own glue anyway, the practical burden collapses to: **publish the build repo, pin everything, tag it to match every npm version.**

## a.4 How comparable projects handle it — copy the good one

**Do copy ffmpeg.wasm's two-package split.** It is the cleanest precedent for exactly your situation:

| npm package | contents | declared licence |
|---|---|---|
| `@ffmpeg/ffmpeg` 0.12.15 | JS wrapper | `MIT` |
| `@ffmpeg/core` 0.12.10 | **the .wasm blob** | `GPL-2.0-or-later` |

The wrapper stays permissive so consumers can depend on it freely; the package that actually carries the copyleft code says so in its SPDX field. Your mapping:

- `xtb-wasm` — the JS/TS API, `"license": "MIT"`, depends on:
- `xtb-wasm-core` — the `.wasm` + minimal loader, `"license": "LGPL-3.0-or-later"`, `COPYING`/`COPYING.LESSER` in `files`, README pointing at the build repo and the release's object artefacts.

(If you keep `symmetry_i.c`, that second field must read `GPL-3.0-or-later` instead — another reason to drop it.)

**Do not copy wasm-vips.** `wasm-vips` 0.0.18 statically links LGPL-2.1 libvips into its `.wasm` and declares `"license": "MIT"` in `package.json`, with an MIT `LICENSE` file and no LGPL notice. It is the popular pattern and it is not compliant. `ffmpeg.wasm` has an open issue on precisely this ([#902](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/902), opened 2025-09-19, unresolved) about their MIT top-level declaration — which is why the `@ffmpeg/core` split matters.

## a.5 Parameter files and citation

**Parameters are not separately licensed.** `param_gfn2-xtb.txt` (1601 lines) and its siblings carry no licence header — just a `$info` block naming the method and DOI. They fall under the repo's LGPL-3.

**But you do not need them at runtime.** GFN2's parameters are compiled into `src/xtb/gfn2.f90` (970 lines of data); `XTBPATH` appears exactly once in the whole source tree (`src/type/environment.f90:145`) and exists only to *override* the built-ins. Your wasm build ships no parameter files. (They are still LGPL-covered *inside* the blob — this simplifies packaging, not licensing.)

**And if you ever reimplement, the parameters are available permissively.** The Grimme group's own `dxtb` is **Apache-2.0** and ships the complete `src/dxtb/_src/param/gfn2/gfn2-xtb.toml` — 1680 lines, the full GFN2 parameter set, with `SPDX-Identifier: Apache-2.0` headers throughout the repo. That is a decisive fact for alternative (4) below: a clean-room implementation needs no LGPL data at all.

**Citation is convention, not licence.** Nothing in LGPL-3 requires academic citation. The README asks for it and ships `assets/references.bib`. For an IR product the courteous set is:

- xtb general — Bannwarth, Caldeweyher, Ehlert, Hansen, Pracht, Seibert, Spicher, Grimme, *WIREs Comput. Mol. Sci.* **2020**, 11, e01493, [10.1002/wcms.1493](https://doi.org/10.1002/wcms.1493)
- GFN2-xTB — Bannwarth, Ehlert, Grimme, *JCTC* **2019**, 15, 1652–1671, [10.1021/acs.jctc.8b01176](https://doi.org/10.1021/acs.jctc.8b01176)
- DFT-D4 — Caldeweyher *et al.*, *J. Chem. Phys.* **2019**, 150, 154122
- GFN-FF (if used) — Spicher, Grimme, *Angew. Chem. Int. Ed.* **2020**, 59, 15665–15673

Put these in the UI's About panel, which your `rules/react.md` already mandates ("About… credits every borrowed work").

## a.6 Licensing checklist

- [ ] Remove `symmetry_i.c`; stub `get_schoenflies` → `'c1'`; document the deviation
- [ ] Split into `xtb-wasm` (MIT wrapper) + `xtb-wasm-core` (LGPL-3.0-or-later, holds the blob)
- [ ] Ship `COPYING` and `COPYING.LESSER` in `xtb-wasm-core`'s `files`
- [ ] Public build repo: pinned emsdk, vendored xtb at an exact SHA, all patches as files, one-command reproducible build
- [ ] Attach relinkable objects (`.a`/`.o`) for your glue to each GitHub release, and tag releases 1:1 with npm versions
- [ ] Prominent notice in the README and in the site's About panel that xtb is used and is LGPL-covered
- [ ] Citations in the About panel

---

# Part (b) — The honest alternatives

## b.1 Server-side xtb behind a small API

**Delivers in-browser IR spectra?** The *spectrum* appears in the browser; the *computation* does not. Contradicts the stated goal.
**Effort:** days. **Quality:** the reference — full GFN2-xTB, unmodified.

Every existing web-facing xtb is this: [atomistica.online](https://www.tandfonline.com/doi/abs/10.1080/08927022.2024.2329736) (*Molecular Simulation* 2024), [WebMO](https://www.webmo.net/), Rowan. Nobody has done it in the browser — which is both a warning and the opportunity.

**The cheminfo-shaped deployment.** You do not need to build xtb at all: `xtb-6.7.1-linux-x86_64.tar.xz` (27.1 MB, 31 269 downloads) is a static Intel-compiled binary. Per your `rules/docker.md`:

```
Dockerfile          node:24-alpine? No — the xtb binary is glibc-linked.
                    Use node:24 (bookworm) or add a builder stage.
                    Download+verify the .sha256, unpack to /opt/xtb.
compose.yaml        + compose.traefik.yaml + compose.cloudflared.yaml,
                    COMPOSE_FILE picker in .env.example
```

Service block, sized per your table (this is "service with real compute", so the upper end):

```yaml
services:
  backend:
    image: ghcr.io/cheminfo/ir-xtb-backend:latest
    build: .
    init: true
    read_only: true                 # xtb writes scratch files → give it a tmpfs
    tmpfs:
      - /tmp:size=256m
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
    ulimits: { core: 0 }
    restart: unless-stopped
    stop_grace_period: 30s
    mem_limit: 2g
    cpus: '2'
    pids_limit: 512
    volumes:
      - ./data:/app/data
```

The `read_only: true` + `tmpfs` combination matters here: xtb is a file-oriented program (it writes `g98.out`, `vibspectrum`, `hessian`, `xtbhess.coord` into its CWD), so run each job in a fresh `mkdtemp` under `/tmp`.

Fastify + TypeBox, routes under `/v1`, Swagger at `/docs` per `rules/backend.md`:

- `POST /v1/ir` — body `{ molfile | smiles, charge, multiplicity, solvent? }` → job id
- `GET /v1/ir/:id` — `{ status, frequencies: number[], intensities: number[], spectrum: {x,y} }`

Two things to get right: (1) **spawn with a hard timeout and a concurrency semaphore** — an unbounded queue of Hessians will pin every core; (2) **`recursiveUntypeArrays` in a `preSerialization` hook** so the `Float64Array` frequency/intensity arrays don't serialize as `{"0":…}` objects.

**Cost.** A 2 vCPU / 4 GB box (Hetzner CX22 class, ~€4.35/mo before the June 2026 price rises; ~$24/mo equivalent on DigitalOcean) handles a teaching/demo load comfortably. Anchor: **77 atoms → 8 s wall on 4 threads of an i7-11800H** (Pracht *et al.*, *JCTC* 2024, [10.1021/acs.jctc.4c01157](https://doi.org/10.1021/acs.jctc.4c01157)). Typical drawn molecules (15–30 atoms) are well under a second. The real cost is not CPU, it is *you* — a service to monitor, patch, rate-limit, and keep alive for a decade, versus a static file on a CDN.

**Why you might still want it even after shipping wasm:** large molecules where 6N gradient evaluations blow past a browser tab's patience; OpenMP threading (a wasm build only gets threads with `SharedArrayBuffer` + COOP/COEP headers, which constrains embedding); avoiding a multi-MB cold-start download on mobile; and — per §a.3 — **it triggers no LGPL distribution obligation whatsoever.**

## b.2 Pyodide + xtb-python — refuted

**Delivers in-browser IR spectra? No.** This is not a maybe; it is closed on two independent grounds.

**Ground 1 — it inherits the whole problem.** `xtb-python` is a CFFI binding to `libxtb`. To load it in Pyodide, `libxtb` must already be a wasm shared object. You are back at square one, plus Pyodide's ~10 MB baseline.

**Ground 2 — Pyodide itself says the tooling doesn't exist.** From `packages/scipy/info.md` on `pyodide/main`, fetched today:

> "The biggest issue that comes up in building scipy is that we don't have a good fortran to wasm compiler. Some version of flang classic might work. Instead of compiling from fortran directly, we rely on f2c to cross compile the code to C and then compile C to wasm."

And from `packages/scipy/meta.yaml`:

> "if you see the following errors: `Declaration error: adjustable dimension on non-argument` … you are trying to compile code that isn't written to the fortran 77 standard. The line number in the error points to the last line of the problematic subroutine. **Try deleting it.**"

f2c handles Fortran 77. xtb is 322 `.f90` + 51 `.F90` files of Fortran 90/2003/2008 — derived types, allocatables, `class`, type-bound procedures, interfaces. f2c cannot process it, and "try deleting the subroutine" is not a strategy for a quantum-chemistry code.

**Ground 3 — it's abandoned anyway.** `grimme-lab/xtb-python` README, first line after the intro:

> "⚠️ `xtb-python` is no longer in active development. We recommend using [tblite](https://github.com/tblite/tblite) instead."

Last push 2024-09-03. **Verdict: dead end. Do not spend a day on it.** Its one useful output is the pointer to tblite — see b.7.

## b.3 Hybrid: wasm for small, server for large, one JS API

**Delivers in-browser IR spectra? Yes, for the common case.** **Effort:** the wasm effort plus ~2 days. **Quality:** identical either side.

This is the design that should be in the plan regardless of which engine you build first, because the API shape is the cheap part and it de-risks everything else:

```ts
interface IrBackend {
  computeIr(molecule: Molecule, options: IrOptions): Promise<IrResult>;
}
// LocalWasmBackend | RemoteApiBackend, chosen by a policy function
```

Route on atom count (a threshold you calibrate once against real timings — start around 40 heavy atoms), on `navigator.deviceMemory`, and on whether the wasm module loaded at all. Ship the remote backend first: it is a day's work, it makes the frontend real immediately, and it becomes the permanent fallback rather than throwaway scaffolding. Then the wasm backend is a drop-in that upgrades the common path.

Two subtleties worth designing in from the start:

- **Same numbers both sides.** Snapshot-test a fixture set of ~20 molecules against the server, then assert the wasm backend reproduces them to a stated tolerance. Without this you will ship two silently different products.
- **Progressive results.** Because the Hessian is 6N finite differences (§b.7), both backends can stream progress. In wasm you get this for free by driving the displacement loop from JS.

## b.4 Reimplementing GFN2-xTB for the IR subset

**Delivers in-browser IR spectra? Eventually.** **Effort: 1–3 person-years.** **Quality:** identical *if* you finish; wrong in subtle, hard-to-find ways until then.

**Is a clean-room implementation legally possible? Yes, comfortably.** The method is fully published (Bannwarth/Ehlert/Grimme, *JCTC* 2019, 15, 1652–1671, with an open ChemRxiv preprint and an extensive SI), and — the decisive point — **the complete parameter set is available under Apache-2.0** from the Grimme group's own `dxtb` (`gfn2-xtb.toml`, 1680 lines). You would not need to touch an LGPL byte.

**Is it a sane amount of work? Almost certainly not.** The best available evidence is `dxtb` itself: a from-scratch PyTorch rewrite by the original authors (Friede, Hölzer, Ehlert, Grimme, *J. Chem. Phys.* 2024, **161**, 062501), 142 stars, actively developed since 2023 — and its README still says, twice:

> "The libcint interface is **required for GFN2-xTB**." … "provides access to higher-order multipole integrals and their derivatives (required for GFN2-xTB)"

with that interface Linux-only. If the people who invented GFN2 could not get a pure-array implementation of its multipole integrals to production quality and fell back to a C integral library, an outside team writing it in TypeScript will not do better. The IR subset does not help much either: you need SCF-converged density, analytical gradients, *and* the dipole moment with atomic-multipole electrostatics — that is essentially the whole method, minus the parts you were not going to implement anyway.

**The one interesting corner:** `libcint` is **C, Apache-2.0** — so it compiles to wasm with plain `emcc`, no Fortran involved. A hypothetical "reimplement the GFN2 driver in C/Rust, link libcint for integrals, take parameters from dxtb's TOML" project is fully permissive and toolchain-clean. It is still 1–3 years. Note it as the shape a reimplementation would take, not as a recommendation.

## b.5 Cheaper physics — and why it's cheaper than it looks

**Delivers in-browser IR spectra? Yes.** **Effort: weeks.** **Quality: measurably and visibly worse — especially the intensities.**

The definitive benchmark is Pracht, Grant, Grimme, *JCTC* **2020**, 16(11), 7044–7060 ([10.1021/acs.jctc.0c00877](https://doi.org/10.1021/acs.jctc.0c00877), open access), against **7247 experimental gas-phase IR spectra**, scored with the Cauchy–Schwarz `r_match` similarity (0–1):

| Method | unscaled | freq-scaled | mass-scaled |
|---|---|---|---|
| B3LYP-3c (DFT reference) | 0.628 | **0.862** | **0.865** |
| **GFN2-xTB** | **0.690** | 0.723 | 0.750 |
| GFN1-xTB | 0.632 | 0.686 | 0.721 |
| **GFN-FF** | **0.545** | 0.564 | 0.589 |
| PM6-D3H4 | 0.518 | 0.640 | — |
| PM7 | 0.476 | 0.634 | — |

Read the GFN2 row carefully: it is the *best unscaled* method in the table, better than raw B3LYP-3c. That is exactly the property you want for a zero-configuration web tool. Dropping to GFN-FF costs ~0.15 `r_match`, and the authors are specific about where it goes:

> GFN-FF "mainly suffers from relatively large errors in the intensities."

**On the "Open Babel already gives us this for free" hope — it does not, on two counts.**

*Count 1: Open Babel cannot compute frequencies.* `OBVibrationData` (`include/openbabel/generic.h:812`) is documented as "Used to hold the normal modes of a molecule" — it is a **container populated by the file-format parsers** when reading Gaussian/ORCA output. The forcefield API offers only `NumericalSecondDerivative(OBAtom *a, …)` returning a `vector3` (`forcefield.h:479`), and the only other Hessian mentions in `forcefield.cpp` (lines 3128, 3219) are the L-BFGS *inverse-Hessian approximation used for geometry optimization*. There is no vibrational analysis anywhere. You would be writing: assemble a 3N×3N Hessian by finite-differencing `GetGradient` (6N calls), mass-weight, project out translations/rotations, diagonalize. That is real work — perhaps two weeks — not a freebie. The same is true of RDKit (BSD, has MMFF94 + UFF with analytic gradients, has RDKit-JS in wasm, has no Hessian).

*Count 2: the intensities have no credible source.* Frequencies from MMFF94 are respectable — Halgren fitted them, reporting ~61 cm⁻¹ RMS vs experiment (*J. Comput. Chem.* 1996, 17, 553–586) — and UFF is worse. But an IR spectrum is frequencies **and** dμ/dQ, and a fixed-point-charge force field has no dipole model worth differentiating. Pracht *et al.* 2024 tested exactly this and concluded:

> "The use of classical EEQ models for this purpose should be avoided."

EEQ is a charge-equilibration model — strictly better than Gasteiger or MMFF94 point charges — and it is still condemned. A spectrum with plausible peak *positions* and meaningless peak *heights* looks convincing and teaches the wrong thing, which for `ir.cheminfo.org` is worse than no spectrum.

*MOPAC is not an escape route.* `openmopac/mopac` is **9.19 MB of Fortran** to 10 kB of C (GitHub language stats), latest release v23.2.5 (2026-05-03). Its Apache-2.0 licence is lovely and completely irrelevant — the toolchain problem is identical to xtb's, and PM6/PM7 score *below* GFN1-xTB in the table above (0.518 / 0.476 unscaled).

**Where cheap physics genuinely earns its place:** as the pre-optimizer. Run MMFF94 in Open Babel/RDKit wasm to clean up the drawn geometry, hand the result to GFN2 for the Hessian. That cuts GFN2's optimization iterations substantially for free.

## b.6 ML surrogate in ONNX Runtime Web / TF.js

**Delivers in-browser IR spectra? Yes — and it is the only alternative that is both fully in-browser and cheap to run.** **Effort:** weeks to a few months. **Quality: potentially better than GFN2, with a large asterisk.**

Published, permissively licensed, IR-specific models:

| Model | Reference | Licence | Input | Reported accuracy |
|---|---|---|---|---|
| **Chemprop-IR** | McGill, Forsuelo, Guan, Green, *JCIM* 2021, [10.1021/acs.jcim.1c00055](https://doi.org/10.1021/acs.jcim.1c00055) | **MIT** (`gfm-collab/chemprop-IR`) | SMILES (D-MPNN) | SIS ≈ **0.57**, "similar to DFT scaled frequencies" |
| **Abdul Al & Allouche** | arXiv:[2405.05737](https://arxiv.org/abs/2405.05737); *Chem. Phys. Lett.* [10.1016/j.cplett.2024.141603](https://doi.org/10.1016/j.cplett.2024.141603) | not stated | **3D structure** | SIS **0.92** vs 0.57 for scaled DFT, on 200 test molecules |
| **DetaNet** | Zou *et al.*, *Nat. Comput. Sci.* 2023, **3**, 957–964 | **MIT** (`WeiHuQLU/DetaNet`) | 3D structure (E(3)-equivariant) | IR + Raman + UV-Vis + NMR; trained on QM9S |

Two structural cautions:

**Caution 1 — the licence trap in the best-scoring option.** The method that actually beats GFN2 on the Pracht 2024 benchmark is MACE-OFF23 (best avg `r_msc` **0.859** vs GFN2-xTB's **0.787**). But MACE-OFF23 is released under the **Academic Software License**: *"free to use them for academic purpose, but not for commercial purposes."* For a public website run by an academic group that is arguably fine and arguably not — it is exactly the kind of ambiguity you avoided by choosing LGPL xtb. Checkpoints are 7.3 / 18.4 / 55.5 MB, so it is a payload problem too. **Chemprop-IR and DetaNet are MIT and carry no such issue.**

**Caution 2 — training-set generalization is the whole ballgame.** DetaNet is trained on **QM9S** — QM9 is ≤9 heavy atoms, C/N/O/F only. Chemprop-IR is trained on a specific experimental corpus. Ask a QM9-trained model about a sulfonamide, a boronic ester, or a transition-metal complex and it will emit a confident, wrong spectrum with no error signal. GFN2-xTB, by contrast, is parametrized across essentially the whole periodic table (Z=1–86) and *degrades* rather than *hallucinates* outside its comfort zone. For a pedagogic tool where students type arbitrary structures, that difference matters more than the headline SIS number.

**Practical browser path if you pursue it:** Chemprop-IR is a D-MPNN over SMILES — the smallest, most ONNX-exportable of the three, and the only one needing no 3D geometry (no conformer generation in the browser). Expect scatter/gather op friction on export. DetaNet needs `e3nn` + `torch-scatter`, which will fight ONNX export hard. **This is the strongest candidate for a fast, low-risk v1 that ships entirely in-browser** — and it composes beautifully with the hybrid design in b.3: ML surrogate instantly, GFN2 on demand for the real answer.

## b.7 The recommendation the evidence actually points at: target tblite, not xtb

This was not in the brief, but it falls out of the licensing and effort analysis strongly enough to state plainly.

| | xtb | **tblite v0.6.0** |
|---|---|---|
| Fortran source | ~176 000 lines | **52 442 lines**, 162 files |
| Licence | LGPL-3 **+ one GPL-2 C file** | **uniformly LGPL-3.0-or-later** |
| LAPACK/BLAS surface | dgemm, dsysv, dgemv, dsytrf, dsymm, dsyev, dsygvd, dspmv, dpotrf, dsygvx, … | **12 routines**: dgemm, dgemv, dsymm, dsymv, dtrsm, dsygvd, dsygst, dsyevr, dpotrf, dgetrf, dgetri, dgetrs |
| C API | `include/xtb.h`, 344 lines | `include/tblite.h` + 12 headers, **dipole exposed** (`result.h:164`) |
| Scope | CLI, MD, docking, ONIOM, metadynamics, CPCM-X, mass-spec… | GFN1/GFN2 Hamiltonian, energies, gradients, dipole |
| Status | maintained, v6.7.1 (2024-07-23) | maintained; the Grimme group's own recommended successor |

The Grimme group's abandonment notice on `xtb-python` says it outright: *"We recommend using tblite instead."*

Crucially, **you do not need xtb's Hessian code at all.** `src/hessian.F90:31 numhess` is two-sided finite differences of the analytical gradient (`step=set%step_hess`, `step2=0.5_wp/step`, `call calc%hessian(…, h, dipd)`), confirmed by the docs: *"Vibrational frequency calculations are available only through two-sided numerical differentiation of analytical gradients."* The `dipd` array collected in that same loop is what becomes the IR intensities.

So the IR algorithm is: **6N calls to (gradient + dipole), assemble, mass-weight, project, diagonalize.** tblite's C API already gives you energy, gradient, and dipole. That means:

- Port a much smaller, cleaner, uniformly-LGPL Fortran library.
- Write the 6N displacement loop **in JS or in a small C shim** — not in Fortran.
- Get a progress bar and cancellation for free, because you can yield to the event loop between displacements. A 30 s calculation with a progress bar is a usable web app; a 30 s frozen tab is not.
- Diagonalize the 3N×3N mass-weighted Hessian with a small hand-rolled Jacobi/`dsyev` in C — for N=50 that's a 150×150 matrix, microseconds, no LAPACK dependency in the outer layer.

---

# Comparison table

| # | Option | In-browser? | Effort | IR quality (`r_match` / SIS) | Licence risk | Verdict |
|---|---|---|---|---|---|---|
| 0 | **xtb → wasm (as briefed)** | ✅ | high (toolchain) | **0.690** unscaled — best-in-class | **medium**: LGPL-3 §4(d)(0) relinking; GPL-2 file must be removed | The goal. Do it via tblite (#7). |
| 1 | Server-side xtb + Fastify/Docker | ❌ (result only) | **days** | 0.690 — reference | **none** (no conveying) | Build it first. Permanent fallback. |
| 2 | Pyodide + xtb-python | ❌ | n/a | n/a | n/a | **Refuted.** No Fortran→wasm compiler; f2c is F77-only; xtb-python abandoned. |
| 3 | Hybrid wasm + server, one JS API | ✅ common case | +2 days on top | 0.690 both sides | inherits #0 | **Right architecture.** Design the interface now. |
| 4 | Clean-room GFN2 reimplementation | ✅ eventually | **1–3 person-years** | 0.690 if finished | **none** — Apache-2.0 params from dxtb; libcint is C/Apache-2.0 | Legally clean, practically unaffordable. dxtb still needs libcint. |
| 5a | GFN-FF (still Fortran, still in xtb) | ✅ | same as #0 | **0.545**; intensities poor | same as #0 | Same port cost, worse answer. Pointless. |
| 5b | MMFF94/UFF via Open Babel/RDKit wasm | ✅ | weeks | freqs ~61 cm⁻¹ RMS; **intensities not credible** ("EEQ should be avoided") | permissive | **Not free** — neither library computes a Hessian. Good as a *pre-optimizer*. |
| 5c | MOPAC (PM6/PM7) | ✅ | same Fortran problem | 0.518 / 0.476 — worse than GFN1 | Apache-2.0 ✅ | Nice licence, same toolchain wall, worse physics. |
| 6 | ML surrogate (Chemprop-IR / DetaNet) in ORT-Web | ✅ **fully** | weeks–months | SIS 0.57 (Chemprop-IR) → 0.92 (3D model) | **MIT** for both — but MACE-OFF23 is ASL non-commercial | **Strongest fast v1.** Watch the training-domain cliff. Pairs perfectly with #3. |
| **7** | **tblite → wasm; drive the 6N Hessian loop from JS** | ✅ | **high but ~3× smaller than #0** | 0.690 — identical to xtb | **low**: uniform LGPL-3, no GPL file, 12 LAPACK routines | **Recommended target.** |

## Suggested sequence

1. **Week 1** — server-side xtb behind `/v1/ir` (b.1), plus the `IrBackend` interface from b.3. Real spectra on `ir.cheminfo.org` immediately, zero licence exposure, and the fallback you will keep forever.
2. **Weeks 2–6** — Chemprop-IR (MIT) exported to ONNX, wired in as the instant-preview backend. This alone may satisfy the pedagogic goal for most visitors, entirely in-browser.
3. **In parallel** — the tblite→wasm port (b.7), with the licensing checklist from a.6 applied from the first commit, not retrofitted before publish.

Local artefacts from this research: extracted text of arXiv:2408.08174 at `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/ir.txt`; tblite v0.6.0 clone at `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/tblite`.

## Sources

- [xtb repository](https://github.com/grimme-lab/xtb) — local clone; [tblite](https://github.com/tblite/tblite); [dftd4](https://github.com/dftd4/dftd4); [mctc-lib](https://github.com/grimme-lab/mctc-lib); [multicharge](https://github.com/grimme-lab/multicharge); [CPCM-X](https://github.com/grimme-lab/CPCM-X); [toml-f](https://github.com/toml-f/toml-f)
- [grimme-lab/dxtb](https://github.com/grimme-lab/dxtb) (Apache-2.0, GFN2 parameters) — [dxtb paper, *J. Chem. Phys.* 2024, 161, 062501](https://pubs.aip.org/aip/jcp/article/161/6/062501/3307390/dxtb-An-efficient-and-fully-differentiable)
- [grimme-lab/xtb-python](https://github.com/grimme-lab/xtb-python) (deprecation notice); [pyodide/pyodide `packages/scipy/info.md`](https://github.com/pyodide/pyodide/blob/main/packages/scipy/info.md)
- [Pracht, Grant, Grimme, *JCTC* 2020, 16, 7044–7060](https://pmc.ncbi.nlm.nih.gov/articles/PMC8378236/) — the 7247-spectrum benchmark
- [Pracht *et al.*, *JCTC* 2024, 10.1021/acs.jctc.4c01157](https://arxiv.org/abs/2408.08174) — timings and doubly-harmonic IR
- [Chemprop-IR, *JCIM* 2021](https://pubs.acs.org/doi/abs/10.1021/acs.jcim.1c00055) / [repo](https://github.com/gfm-collab/chemprop-IR); [DetaNet, *Nat. Comput. Sci.* 2023](https://www.nature.com/articles/s43588-023-00550-y) / [repo](https://github.com/WeiHuQLU/DetaNet); [Abdul Al & Allouche, arXiv:2405.05737](https://arxiv.org/abs/2405.05737)
- [ACEsuit/mace-off](https://github.com/ACEsuit/mace-off) (ASL); [ffmpeg.wasm issue #902](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/902); [ffmpeg.wasm-core LICENSE.md](https://github.com/ffmpegwasm/ffmpeg.wasm-core/blob/n4.3.1-wasm/LICENSE.md); [kleisauke/wasm-vips](https://github.com/kleisauke/wasm-vips)
- [openmopac/mopac](https://github.com/openmopac/mopac); [openbabel/openbabel](https://github.com/openbabel/openbabel); [xtb docs — vibrational frequencies](https://xtb-docs.readthedocs.io/en/latest/hessian.html); [atomistica.online, *Molecular Simulation* 2024](https://www.tandfonline.com/doi/abs/10.1080/08927022.2024.2329736)
- LGPL background: [FOSSA on LGPL](https://fossa.com/blog/open-source-software-licenses-101-lgpl-license/), [licensecheck.io on LGPL linking](https://licensecheck.io/blog/lgpl-dynamic-linking) — secondary; the primary authority used above is the §4 text in `COPYING.LESSER` itself
