# xtb-wasm

GFN2-xTB as a library: hand it a structure and it returns the optimized geometry, the
harmonic wavenumbers, the IR intensities, the Raman activities and the RRHO
thermochemistry — computed on the machine the page is open on, with nothing uploaded. Or
ask only for the geometry and the energy, which is the cheap half of that.

The quantum chemistry is [`@peterspackman/occjs`](https://www.npmjs.com/package/@peterspackman/occjs)
— OCC, an independent C++17 implementation of GFN2-xTB compiled to WebAssembly — driven
from a pool of Web Workers.

```sh
npm install xtb-wasm openchemlib
```

## Usage

```ts
import {
  DEFAULT_OUTPUTS,
  DEFAULT_SETTINGS,
  installVibrationalAnalyser,
  moleculeFromSmiles,
  occjsEngine,
} from 'xtb-wasm';

// Binds the Raman and thermochemistry analyses to the engine. Call once, at
// startup: without it a run still succeeds but leaves both fields null.
installVibrationalAnalyser();

const molecule = await moleculeFromSmiles('CC(=O)C', 'acetone');

const result = await occjsEngine.compute(
  { molecule, settings: DEFAULT_SETTINGS, outputs: DEFAULT_OUTPUTS },
  {
    onProgress: (progress) => {
      console.log(progress.stage, progress.fraction, progress.message);
    },
  },
);

for (const mode of result.modes) {
  console.log(mode.wavenumber, mode.irIntensity, mode.ramanActivity);
}
console.log(result.energy.total, result.thermochemistry?.totalFreeEnergy);
```

`compute` rejects a request it cannot honour rather than quietly ignoring part of it;
`occjsEngine.validate(request)` returns the same refusals as strings without running
anything.

### Relaxing a geometry and nothing else

A geometry optimization with no Hessian after it is the cheap half of the library, and it
is what a conformer search wants as a second stage: a force field such as MMFF94 places the
atoms well but ranks conformers badly, because it has no dispersion and no electronic
structure, and both are what decides which conformer is lowest.

```ts
import { relaxGeometries, relaxGeometry } from 'xtb-wasm';

const relaxed = await relaxGeometry({
  geometry: { elements: ['O', 'H', 'H'], coordinates: new Float64Array([...]) },
});
relaxed.energy.total; // Eh, at relaxed.coordinates
relaxed.energy.dispersion; // the D4 term, which MMFF94 has no counterpart for
relaxed.cycles;
relaxed.converged;
```

`relaxGeometries` takes several structures and hands them out one at a time across the
worker pool — every relaxation is an independent whole job, so a set of conformers
parallelises cleanly — and returns one result per request, in request order:

```ts
const results = await relaxGeometries(conformers, {
  onSettled: (done, total) => console.log(`${done} of ${total}`),
  signal: controller.signal,
});
```

The energy comes from a single point taken **at the geometry that is returned**, not from
the optimizer's last cycle, so the number and the coordinates describe the same molecule.
Starting from a geometry a force field already minimised, and measured on an Apple M1, one
relaxation costs 4–7 ms up to six atoms, ~20 ms for benzene, ~200 ms for caffeine (24
atoms) and ~670 ms for ibuprofen (33 atoms), in 2 to 9 optimizer cycles. That is why it is
opt-in: a tool offers it as an action, never on every keystroke.

Accuracy: a water and a benzene pulled 3 % off their minima relax back onto native xtb
6.7.1's own optimized energies to 1e-7 and 1e-5 Eh (`src/engines/__tests__/occRelax.test.ts`).

## What a consumer needs

**A Vite-compatible bundler.** The wasm binary and its data package are resolved through
the bundler with Vite's `?url` suffix — declared in `src/assets.d.ts` — so that the
consumer's own asset pipeline decides where they are served from and how they are hashed.
Under another bundler, alias `@peterspackman/occjs/wasm?url` and
`@peterspackman/occjs/data?url` to the corresponding files inside
`@peterspackman/occjs`.

**Three Vite settings, all three required.** Without them the build fails, and the one that
matters most fails _without naming a reason_ — Vite compiles a worker to `iife` by default,
occjs opens with a top-level `await`, and the resulting error is swallowed on its way out of
the worker bundler, so what a consumer sees is an unrelated plugin further down the pipeline
finding no `dist/index.html`.

```ts
export default defineConfig({
  optimizeDeps: {
    // Both packages locate their WebAssembly next to an ESM entry point and
    // resolve it from import.meta.url; pre-bundling rewrites that and the wasm
    // stops loading. xtb-wasm also spawns its worker through a `new URL`, which
    // only survives if the package is served as source.
    exclude: ['@peterspackman/occjs', 'xtb-wasm'],
  },
  // occjs uses a top-level await, which cannot be expressed in an `iife`.
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
```

**Room for the binary.** The wasm is 21 MB and its data package 8.2 MB, emitted as two
assets and fetched only when a calculation starts. Nothing of them is in the initial
download of a page that imports this package behind a dynamic `import()`, but they do ship
in the deployed bundle.

**openchemlib as a peer dependency.** It is a peer on purpose: two copies mean two
`Molecule` classes, and the atom indices that `Molecule.bonds` carries — the ones a
bond-to-mode mapping compares against — stop being comparable across them.

The engine needs `Worker`; `occjsEngine.isAvailable()` reports whether it is there.

## Public API

| Group           | Exports                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engines         | `occjsEngine`, `occjsSerialEngine`, `createOccjsEngine`, `ENGINES`, `getEngine`, `disposeOccPool`, `occPoolWorkerCount`                                                                                                   |
| Relaxation      | `relaxGeometry`, `relaxGeometries`                                                                                                                                                                                        |
| Input           | `moleculeFromSmiles`, `moleculeFromMolfile`, `moleculeFromIdCode`, `moleculeFromGeometry`, `moleculeFromStructure`, `moleculesFromText`, `moleculesFromFile`, `geometryFromPdb`, `detectFormat`, `getOcl`, `DEFAULT_SEED` |
| Analyses        | `installVibrationalAnalyser`, `thermochemistry`, `ramanActivities`, `bondPolarizability`, `ramanSupport`, `compareConnectivity`, `SUPPORTED_ELEMENTS`, `resolveSymmetry`, `principalMoments`                              |
| Geometry        | `fromXyz`, `toXyz`, `geometryFromOcl`, `canonicalElement`, `elementSymbols`                                                                                                                                               |
| Defaults, units | `DEFAULT_SETTINGS`, `DEFAULT_OUTPUTS`, `DEFAULT_RELAX_SETTINGS`, and the CODATA conversion factors (`WAVENUMBER_PER_HARTREE`, `IR_INTENSITY_KM_PER_MOL`, `KCAL_PER_MOL_PER_HARTREE`, …)                                   |

Types: `Molecule`, `Geometry`, `MoleculeSource`, `CalculationSettings`, `OutputSelection`,
`VibrationalRequest`, `VibrationalResult`, `VibrationalMode`, `ModeInvolvement`,
`Thermochemistry`, `EnergyBreakdown`, `Timings`, `VibrationalEngine`,
`EngineCapabilities`, `EngineProgress`, `EngineStage`, `EngineRunOptions`, `XtbMethod`,
`RelaxSettings`, `RelaxRequest`, `RelaxResult`, `RelaxOptions`, `RelaxPoolOptions`.

`occjsSerialEngine` is the same physics pinned to one instance. The parallel sweep visits
the displacements in a run-dependent order and warm-starts each point from the previous
one, so it reproduces itself only to ~0.02 cm⁻¹; the serial engine gives identical digits
run to run, which is what a fixture comparison needs.

### Input formats

SMILES, OpenChemLib idCodes, molfile (V2000 and V3000), multi-record SDF, XYZ and PDB.
Charge and unpaired electrons are read from the structure, so ions and radicals work.
`moleculesFromText` detects the format itself.

## `xtb-wasm/reference`

```ts
import { REFERENCE_FIXTURES, REFERENCE_TOLERANCES } from 'xtb-wasm/reference';
```

Ten GFN2 calculations produced by **native xtb 6.7.1** — water, methanol, acetic acid,
benzene, toluene, paracetamol, aspirin, caffeine, ibuprofen and cholesterol, 3 to 74 atoms
— each carrying the optimized geometry, the energies, the wavenumbers, the IR intensities,
the Hessian invariants and the thermochemistry, plus a `tier1_hess_at_optimized_geometry`
block that is a `--hess` run at exactly the stored coordinates.

They are the data this package is validated against, shipped so that a consumer can re-run
the validation instead of taking the accuracy claim on trust. `REFERENCE_TOLERANCES` is
the measured agreement a result must reach to count as reproducing native xtb. Both sit
behind the subpath so the ~190 kB of JSON never reaches a bundle that only wants to compute
a spectrum.

The provenance — the container, the generation scripts, the raw geometries, the run logs,
the native test-suite baseline and the three spread studies behind every tolerance — is in
[`experiments/reference/`](experiments/reference) in the repository.

## Accuracy, measured

**Frequencies and IR intensities**, against the fixtures: water max |Δν| 0.107 cm⁻¹,
benzene 0.590 cm⁻¹. Intensities come from the true GFN2 dipole — the AO multipole over the
wavefunction basis — not a point-charge approximation.

**Thermochemistry**: Grimme's modified RRHO, transcribed from xtb's own `print_thermo`
(`sthr = 50` cm⁻¹, Head-Gordon damping α = 4, mRRHO on). It reproduces xtb's ZPVE, enthalpy
and free energy on all ten fixtures. Water: total free energy −5.068045 Eh against xtb's
−5.068045036403. The rotational symmetry number comes from the detected point group, with a
guard for a defect in occ's detector — a five-atom XY₄ such as methane is reported D2/σ=4
instead of Td/σ=12, worth 0.65 kcal/mol in G.

**Size**: cholesterol, 74 atoms, runs a full Hessian in about 90 s on a single instance.

## Speed, measured

The displacement sweep is fused: one pass of `energyAndGradient` on a persistent calculator
yields both the Hessian column and the dipole derivative. Against two separate 6N sweeps
that rebuild the molecule each time, that is **9.5× on water, 2.6× on benzene, 1.9× on
caffeine**, with the Hessian bit-identical. The Web Worker
pool adds a further **2.5–4.3×** (benzene 2.5× at 4 workers, caffeine 4.3× at 8,
3580 ms → 825 ms).

occ's own wasm threading is not used and COOP/COEP headers are not required:
`SharedArrayBuffer` is gated without cross-origin isolation in every browser, and where
threads are available they are worth only ~1.2×.

## Limits

**GFN2 only.** `m.XtbMethod` has exactly one value in this build. GFN1, GFN0 and GFN-FF
would need a tblite-enabled build, which is not reachable for WebAssembly. The engine
refuses any other method rather than substituting one.

**Gas phase only — no implicit solvation.** Every geometry, wavenumber and intensity
describes one isolated molecule, so a band measured in solution or in the solid state can
sit tens of cm⁻¹ away. A continuum model would not close that gap either: it can add a
solvation free energy at a fixed geometry, never shift a band. The measurements behind that
statement, and the patches to occ that produced them, are in
[`upstream/occ-smd-solvation/`](upstream/occ-smd-solvation); they are not part of this
build.

**Raman is empirical.** The Placzek quantity over the Lippincott–Stutman
bond-polarizability model — purely geometric, with no wavefunction behind it. Absolute
intensities are typically tens of percent out and it is qualitatively wrong for cumulated
and triple bonds. It covers 36 elements; `ramanSupport(elements)` names the ones it
cannot do. By default it uses the molecule's real bond graph and an analytic
polarizability gradient; ASE's `d < 1.5·(rᵢ+rⱼ)` rule is available for bit-comparison but
invents bonds — every Cl···Cl pair of CCl₄ counts as one, which is why its mean
polarizability comes out nearly eight times too large.

**No band widths are predicted.** The result carries wavenumbers and intensities; whatever
draws a spectrum chooses the line shape. Rotational fine structure, hydrogen bonding,
vibrational lifetime and solvent inhomogeneity are all absent.

## Repository layout

| Path                   | What it is                                                          |
| ---------------------- | ------------------------------------------------------------------- |
| `src/types/`           | The shared contract: molecule, calculation, vibration, engine       |
| `src/engines/`         | The occjs driver: fused sweep, worker pool, result assembly         |
| `src/chemistry/`       | Raman, thermochemistry, symmetry, geometry, CODATA constants        |
| `src/molecules/`       | Every input format, plus charge and radical detection               |
| `src/reference/`       | The 10 native-xtb fixtures and their tolerances — what ships        |
| `experiments/`         | How the fixtures were produced, and every measurement behind them   |
| `upstream/`            | Patches for occ that are not part of the build, with their evidence |
| `research/`, `report/` | The investigations behind the design, kept verbatim                 |

## Licence

OCC is GPL-3.0, so this package is distributed under the same terms. See
[`LICENSE`](LICENSE).
