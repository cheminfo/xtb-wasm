import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms.js';
import { AnimateModelIndex } from 'molstar/lib/mol-plugin-state/animation/built-in/model-index.js';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { StateSelection } from 'molstar/lib/mol-state';
import { beforeAll, expect, test } from 'vitest';

import { installDomStub } from './dom-stub.ts';
import { buildModeFrames, framesToXyz, normalizeAmplitude } from '../normal-mode.ts';
import { buildArrowMesh } from '../mode-arrows.ts';

beforeAll(() => {
  installDomStub();
});

const SYMBOLS = ['O', 'H', 'H'];
const EQUILIBRIUM = new Float64Array([0, 0, 0.1173, 0, 0.7572, -0.4692, 0, -0.7572, -0.4692]);
const BEND = new Float64Array([0, 0, -0.07, 0, 0.42, 0.556, 0, -0.42, 0.556]);
const FRAME_COUNT = 12;

/** A plugin with no canvas: enough for the state tree and the animation loop. */
async function headlessPlugin() {
  const plugin = new PluginContext({
    actions: [],
    behaviors: [],
    animations: [AnimateModelIndex],
    config: [],
  });
  await plugin.init();
  return plugin;
}

async function loadWaterBend(plugin: PluginContext) {
  const scale = normalizeAmplitude(BEND, 0.35);
  const frames = buildModeFrames(
    { symbols: SYMBOLS, coordinates: EQUILIBRIUM },
    BEND,
    scale,
    FRAME_COUNT,
  );
  const data = await plugin.builders.data.rawData(
    { data: framesToXyz(SYMBOLS, frames), label: 'bend' },
    { state: { isGhost: true } },
  );
  const trajectory = await plugin.builders.structure.parseTrajectory(data, 'xyz');
  const model = await plugin.builders.structure.createModel(trajectory, { modelIndex: 0 });
  await plugin.builders.structure.createStructure(model);
  return trajectory;
}

function currentModelIndex(plugin: PluginContext): number {
  const cells = plugin.state.data.select(
    StateSelection.Generators.ofTransformer(StateTransforms.Model.ModelFromTrajectory),
  );
  return (cells[0]!.transform.params as { modelIndex: number }).modelIndex;
}

test('a generated multi-model XYZ becomes a Mol* trajectory with one frame per step', async () => {
  const plugin = await headlessPlugin();
  const trajectory = await loadWaterBend(plugin);
  expect(trajectory.data!.frameCount).toBe(FRAME_COUNT);
  expect(trajectory.data!.representative.atomicHierarchy.atoms._rowCount).toBe(3);
  plugin.dispose();
});

test('AnimateModelIndex advances the displayed frame across one period', async () => {
  const plugin = await headlessPlugin();
  await loadWaterBend(plugin);

  expect(AnimateModelIndex.canApply!(plugin)).toStrictEqual({ canApply: true });
  await plugin.managers.animation.play(AnimateModelIndex, {
    mode: { name: 'loop', params: { direction: 'forward' } },
    duration: { name: 'fixed', params: { durationInS: 1 } },
  });
  expect(plugin.managers.animation.isAnimating).toBe(true);

  const seen: number[] = [];
  for (const t of [0, 250, 500, 750, 999]) {
    // eslint-disable-next-line no-await-in-loop -- the animation loop is sequential by construction
    await plugin.managers.animation.tick(t, true);
    seen.push(currentModelIndex(plugin));
  }
  expect(seen).toStrictEqual([0, 3, 6, 9, 11]);

  await plugin.managers.animation.stop();
  expect(plugin.managers.animation.isAnimating).toBe(false);
  plugin.dispose();
});

test('the frame Mol* displays really carries the displaced coordinates', async () => {
  const plugin = await headlessPlugin();
  const trajectory = await loadWaterBend(plugin);
  const scale = normalizeAmplitude(BEND, 0.35);

  const frame0 = trajectory.data!.getFrameAtIndex(0) as { atomicConformation: { z: ArrayLike<number> } };
  const frame6 = trajectory.data!.getFrameAtIndex(6) as { atomicConformation: { z: ArrayLike<number> } };
  // frame 0: cos(0) = +1, frame 6 of 12: cos(pi) = -1
  expect(frame0.atomicConformation.z[0]).toBeCloseTo(0.1173 + scale * -0.07, 5);
  expect(frame6.atomicConformation.z[0]).toBeCloseTo(0.1173 - scale * -0.07, 5);
  plugin.dispose();
});

test('loading a second structure replaces the first without leaving cells behind', async () => {
  const plugin = await headlessPlugin();
  await loadWaterBend(plugin);
  const firstCellCount = plugin.state.data.cells.size;

  await plugin.clear();
  expect(plugin.state.data.cells.size).toBe(1); // the root only

  await loadWaterBend(plugin);
  expect(plugin.state.data.cells.size).toBe(firstCellCount);
  plugin.dispose();
});

test('buildArrowMesh emits one cone-tipped arrow per displaced atom', () => {
  const scale = normalizeAmplitude(BEND, 0.35);
  const displacement = Array.from(BEND, (v) => v * scale);
  const mesh = buildArrowMesh({
    coordinates: Array.from(EQUILIBRIUM),
    displacement,
    color: 0xff_57_22,
    shaftRadius: 0.04,
    minLength: 0.05,
  });
  expect(mesh.triangleCount).toBeGreaterThan(0);
  // groups are atom indices; the O displacement (0.035 A) falls below minLength
  expect(mesh.groupBuffer.ref.value.slice(0, mesh.triangleCount * 3)).toContain(1);
  expect(mesh.groupBuffer.ref.value.slice(0, mesh.triangleCount * 3)).toContain(2);
});

test('scrubbing to a frame updates the displayed model without animating', async () => {
  const plugin = await headlessPlugin();
  const trajectory = await loadWaterBend(plugin);
  const modelRef = plugin.state.data.tree.children.get(trajectory.ref).toArray()[0]!;

  await plugin.state.data.build().to(modelRef).update({ modelIndex: 7 }).commit();
  expect(currentModelIndex(plugin)).toBe(7);
  expect(plugin.state.data.cells.get(modelRef)!.obj!.label).toBe('Model 8');
  expect(plugin.managers.animation.isAnimating).toBe(false);
  plugin.dispose();
});
