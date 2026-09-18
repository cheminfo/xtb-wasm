# Mol* in React + Vite: rendering a molecule and animating its normal modes

Verified 2026-08-29 against **molstar 5.11.0**, React 19.2, Vite 7.3.6, TypeScript 6, Node 26.
Working spike: `/private/tmp/.../scratchpad/molstar-spike`. Sources copied to `research/molstar-viewer/`.

Every claim below was produced by running code, not by reading docs.

## 1. Package, wrapper, initialization

- **Package: `molstar` 5.11.0.** One package, MIT, 80 MB unpacked, ESM under `lib/`. The
  `@molstar/*` scope on npm is third-party forks (pdbe-molstar, rcsb-molstar, …) — not upstream.
- **There is no official React wrapper.** `molstar-react`, `react-molstar-wrapper`,
  `@e-infra/react-molstar-wrapper` are third-party and unmaintained/one-person. Write the ~40-line
  effect yourself.
- **Two init routes.** `createPluginUI` builds the whole Mol* React app (left panel, sequence
  viewer, state tree). For a small-molecule pane inside a BlueprintJS app you want the other one:

  ```ts
  const plugin = new PluginContext(spec);   // molstar/lib/mol-plugin/context.js
  await plugin.init();
  const ok = await plugin.mountAsync(container);   // container must be position: relative
  ```

  `mountAsync` creates its own absolutely-positioned `<div>` + `<canvas>` styled **inline**
  (`mol-plugin/container.js`), so **no Mol* CSS is needed at all** on this route.
  `createPluginAsync` does not exist in 5.x; the async variants are
  `initViewerAsync` / `initContainerAsync` / `mountAsync`.

**Measured bundle cost (vite build, es2022):**

| route | JS | CSS |
|---|---|---|
| `PluginContext` + `mountAsync`, minimal `PluginSpec` | 3,100 kB (880 kB gzip) | 0 |
| `createPluginUI` + `DefaultPluginUISpec` + `renderReact18` | +498 kB (135 kB gzip) | 73 kB (16 kB gzip) |

## 2. Vite gotchas (each reproduced)

- **CSS path.** `import 'molstar/lib/mol-plugin-ui/skin/light.scss'` fails the build:
  `[vite:css] Preprocessor dependency "sass-embedded" not found`. `lib/` ships **only** `.scss`.
  Use the prebuilt `import 'molstar/build/viewer/molstar.css'` (works with zero Vite config), or
  `build/viewer/theme/dark.css` / `light.css` / `blue.css` — each is a full standalone skin, not
  an override layer. **Or skip CSS entirely** with the `PluginContext` route.
- **`molstar` has no `exports` map** — deep `molstar/lib/...` imports are the API. Always keep the
  `.js` extension in the specifier.
- **No CommonJS interop problem** in 5.11 + Vite 7: 1239 modules transformed, clean build. The old
  `commonjsOptions` / `optimizeDeps.include` workarounds are no longer needed.
- **No `sb-ffmpeg` / `h264-mp4-encoder` problem** as long as you never import the mp4-export
  extension. It is a `molstar` dependency but tree-shakes away.
- `createPluginUI` emits ~30 Rollup "circular dependency between chunks" warnings from
  `mol-plugin-ui/sequence/*`. Noisy but harmless; the `PluginContext` route emits none.
- Dev-mode `optimizeDeps` re-scan triggers one page reload the first time a new `molstar/lib/...`
  path is imported. Pre-list the deep imports in `optimizeDeps.include` to avoid it.

## 3. Native normal-mode support: **none**

Grepped the whole of `molstar/lib`:

- No vibration / normal-mode / wavenumber trajectory provider. The only hit for "vibration" is
  a Jmol-syntax token in `mol-script/transpilers/jmol/properties.js`.
- `mol-plugin-ui/structure/procedural-animation.tsx` + `mol-geo/geometry/animation.ts` (new in
  5.x, 2026) are a **shader wiggle/tumble effect** (`uWiggleAmplitude`, `uTumbleSpeed`) for making
  illustrations look alive. Random per-vertex noise — not physical, not mode-driven.
- `AnimateStructureSpin`, `AnimateAssemblyUnwind`, `AnimateExplodeUnits`, `AnimateCameraRock`,
  `AnimateTime`, `AnimateModelIndex` are the built-in animations. Only the last is relevant.

**So: generate frames yourself and drive `AnimateModelIndex`.** That is the built-in trajectory
animation (`built-in.animate-model-index`), and it is exactly the right primitive.

## 4. The working approach

Generate N displaced frames → multi-model XYZ → `parseTrajectory` → `ModelFromTrajectory` →
`AnimateModelIndex` in `loop` mode.

Frame f uses `cos(2*pi*f/N)`, so the sequence is periodic and `loop` plays it seamlessly with no
palindrome bookkeeping.

### Two ways to build the trajectory — both measured, both sub-millisecond

Benzene, 12 atoms, 24 frames, Node 26, mean of 50 runs:

| route | time |
|---|---|
| build `XyzFile` in memory (`Column.ofFloatArray`) → `trajectoryFromXyz` | **0.555 ms** |
| serialize a 9 kB multi-model XYZ string → `parseXyz` → `trajectoryFromXyz` | **0.453 ms** |

The string route is not slower and uses only the public builder API, so **prefer it**. The
in-memory route matters only if you want to avoid `toFixed(6)` precision loss:
`XyzFile` is a plain interface (`{ molecules: [{ count, comment, x, y, z, type_symbol }] }`) whose
columns you build with `Column.ofFloatArray` / `Column.ofStringArray`, then feed to
`trajectoryFromXyz` inside a custom `StateTransformer` from `SO.Root` to `SO.Molecule.Trajectory`.

### Per-frame cost is negligible

`AnimateModelIndex` re-runs `ModelFromTrajectory` → `StructureFromModel` → representation on every
animation step. Measured **in the browser**, 60 sequential `state.build().to(model).update({modelIndex})`
commits:

| molecule | median | p95 | max |
|---|---|---|---|
| water, 3 atoms, 20 frames | 0.5 ms | 0.7 ms | 1.6 ms |
| benzene, 12 atoms, 20 frames | 0.4 ms | 0.5 ms | 0.9 ms |

That is ~1.5 % of a 30 fps budget. **The state-tree rebuild is a non-issue at small-molecule size**
— no need for a custom conformation-mutating fast path.

(Raw rAF throughput under headless SwiftShader was 9–11 fps animating vs 80 fps paused, but that is
the *software* rasterizer redrawing the scene, not the CPU rebuild. On a GPU this is display-rate.)

### Bond flicker — the trap nobody warns about

XYZ carries no bonds, so Mol* perceives them **by distance, independently in every frame**. Measured
on benzene with a 0.4 Å displacement:

```
NO-IPB  frame 0: bonds=11     <-- one C-H exceeded the distance threshold
NO-IPB  frame 1: bonds=12
...
```

A bond popping in and out 20 times a second is very visible. Fix: attach an explicit
`IndexPairBonds` to **every** frame model, computed once from the equilibrium geometry:

```ts
IndexPairBonds.fromData({ pairs: { indexA, indexB, order, key,
  distance: Column.ofConst(-1, count, Column.Schema.float),   // -1 => defer to maxDistance
  flag: Column.ofConst(BondType.Flag.Covalent, count, Column.Schema.int) }, count },
  { maxDistance: Number.POSITIVE_INFINITY });                  // => never reject a bond
for (let i = 0; i < traj.frameCount; i++) IndexPairBonds.Provider.set(traj.getFrameAtIndex(i), ipb);
```

Result: `WITH-IPB frame 0..5: bonds=12` on every frame, orders preserved
(`0-1:2 0-5:1 0-6:1 1-2:1 ...`). `Provider.set` writes to `model._staticPropertyData`, which is
**per-model**, so the loop over frames is required — setting it on `representative` alone is not enough.
`getFrameAtIndex` returns a `Model` synchronously for an `ArrayTrajectory` (what XYZ produces).

Get the topology from OpenChemLib on the equilibrium geometry once, not from Mol*.

## 5. Small-molecule look

- `type: 'ball-and-stick'`, `typeParams: { sizeFactor: 0.25, aromaticBonds: false }`,
  `color: 'element-symbol'` with `colorParams: { carbonColor: { name: 'element-symbol', params: {} } }`
  (the default carbon colour is a protein-oriented grey chain colour).
- **`camera: { mode: 'orthographic' }`** and **`cameraFog: { name: 'off' }`** — perspective + fog are
  tuned for 100 Å proteins and wash out a 3 Å molecule.
- **Do not use `plugin.managers.camera.reset()`** — it applies Mol*'s protein-sized margin and leaves
  water as a speck (visible in my first screenshot). Use
  `plugin.managers.camera.focusRenderObjects(undefined, { extraRadius: 0.8, minRadius: 2.5, durationMs: 0 })`.
- `camera.helper.axes = { name: 'off' }` kills the axes widget.
- **Background:** set `canvas3d.renderer.backgroundColor` in the spec, and flip it later with
  `plugin.canvas3d?.setProps({ renderer: { backgroundColor } })` — **never rebuild the plugin for a
  theme change** (verified: 1 canvas before and after a light/dark flip).
- Minimal `PluginSpec`: `actions: []`, behaviors `HighlightLoci` + `DefaultLociLabelProvider` +
  `FocusLoci`, `animations: [AnimateModelIndex]`. Representation providers are in the registry by
  default; you do not need `DefaultPluginSpec` (which drags in volume streaming and every action).

## 6. React StrictMode: the leak is real, and measured

`vite dev` + `<StrictMode>`, naive `useEffect` cleanup (`plugin?.dispose()` on a local that the
promise assigns later):

```
DEV + StrictMode, NAIVE cleanup :
  {"effectsRun":2,"promisesResolved":2,"cleanupsRun":1,"cleanupsThatSawAPlugin":0,
   "canvasesInDom":2,"liveWebglContexts":2}
DEV + StrictMode, GUARDED cleanup:
  {"canvasesInDom":1,"liveWebglContexts":1}
```

The cleanup runs **before** `createMoleculeViewer` resolves, so it sees `undefined` and disposes
nothing; both plugins then mount a canvas. Chrome caps live WebGL contexts at ~16 — a handful of
remounts kills the page.

The fix is the `disposed` flag pattern:

```ts
let disposed = false;
let created: PluginContext | undefined;
createMoleculeViewer(container).then((instance) => {
  created = instance;
  if (disposed) { instance.dispose(); return; }   // <-- the essential line
  setPlugin(instance);
});
return () => { disposed = true; created?.dispose(); };
```

Note this **does not reproduce in a production build** (`effectsRun: 1`) — StrictMode double-invokes
effects only in dev. Test it in dev mode or you will ship the bug.

**Swapping the structure** must go through `await plugin.clear()` and rebuild the state tree — never
create a second plugin. Verified: cell count returns to exactly the same value after
clear + reload, and 1 canvas survives a mode swap.

## 7. Displacement arrows

Works, ~155 lines. A `StateTransformer` (own namespace: `StateTransformer.builderFactory('xtb-ir')`,
not `PluginStateTransform.BuiltIn` which is Mol*'s `ms-plugin` namespace) from `SO.Root` to
`SO.Shape.Provider`, whose `getShape` builds a `Mesh` of two `addCylinder` calls per atom (shaft +
`radiusTop: 0` cone head), then `.apply(StateTransforms.Representation.ShapeRepresentation3D)`.
252 triangles for water. Screenshots: `molstar-viewer/shot-water-arrows.png`,
`shot-benzene-dark-arrows.png`.

Two things I got wrong first, both worth knowing:

1. **Do not call `mesh.setBoundingSphere()` with a guessed radius.** I set 16 Å and the scene bounds
   exploded, shrinking the molecule to a dot. Omit it — Mol* derives the sphere from the vertex
   buffer.
2. **Arrows must be exaggerated.** At the animation amplitude (0.35 Å) the shaft is entirely inside
   the H sphere (radius 0.275 Å at `sizeFactor: 0.25`) and only a stub shows. Draw them at ~3× the
   animation amplitude. Better still (not implemented): start the shaft at the sphere surface.

## 8. Headless testing without jsdom or WebGL

A ~30-line DOM stub (`document.addEventListener/createElement/body`, `window`) is enough to
construct a `PluginContext`, build the full state tree, and drive the animation manager in plain
Node/vitest. No jsdom, no `gl` package, no `HeadlessPluginContext`. `PluginContext` only needs
`document` because of `PluginLayout`'s fullscreen listener.

10 tests pass in 3 s, including the exact animation trace:

```
AnimateModelIndex over a 1 s fixed duration, 12 frames, tick at t = 0,250,500,750,999 ms
  -> modelIndex [0, 3, 6, 9, 11]
```

`plugin.managers.animation.tick(t, /* isSynchronous */ true)` is the hook that makes this
deterministic. In the browser you never call it: `animationLoop.start()` fires inside `_initViewer`,
i.e. as soon as `mountAsync` creates the canvas.

## 9. In-house prior art

`cheminfo/stereo-nmr` (private) already pairs Mol* with react-ocl for linked 2D/3D atom
highlighting on Gaussian log files. Read it before writing the selection/highlight layer.

The clonall index has **no** XYZ parser, no normal-mode helper, and no 3D-structure package — the
helpers in `research/molstar-viewer/normal-mode.ts` are genuinely new, not reinvented.
