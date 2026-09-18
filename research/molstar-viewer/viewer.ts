import { Column } from 'molstar/lib/mol-data/db.js';
import { BondType } from 'molstar/lib/mol-model/structure/model/types.js';
import type { Model, Trajectory } from 'molstar/lib/mol-model/structure.js';
import { IndexPairBonds } from 'molstar/lib/mol-model-formats/structure/property/bonds/index-pair.js';
import { AnimateModelIndex } from 'molstar/lib/mol-plugin-state/animation/built-in/model-index.js';
import type { StateObjectSelector } from 'molstar/lib/mol-state';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { PluginSpec } from 'molstar/lib/mol-plugin/spec.js';
import { PluginBehaviors } from 'molstar/lib/mol-plugin/behavior.js';
import { PluginConfig } from 'molstar/lib/mol-plugin/config.js';
import { Color } from 'molstar/lib/mol-util/color/color.js';

import { framesToXyz } from './normal-mode.ts';

/** Explicit bond topology, so bonds never pop in and out as the geometry vibrates. */
export interface BondTopology {
  /** First atom index of each bond, zero-based. */
  readonly from: readonly number[];
  /** Second atom index of each bond, zero-based. */
  readonly to: readonly number[];
  /**
   * Bond order per bond.
   * @default 1 for every bond
   */
  readonly order?: readonly number[];
}

export interface StructureInput {
  readonly symbols: readonly string[];
  /** One or more coordinate frames in Angstrom, atom-major. */
  readonly frames: readonly Float32Array[];
  /**
   * Fixed bond topology. When omitted Mol* perceives bonds by distance in every
   * frame, which makes long bonds flicker during a large-amplitude vibration.
   */
  readonly bonds?: BondTopology;
}

/**
 * A Mol* plugin with no Mol* React UI and no Mol* stylesheet: the plugin creates
 * its own absolutely-positioned canvas inside `container`.
 * @param container Element with `position: relative` (or absolute/fixed).
 * @param options.darkBackground Render on a dark background.
 * @default options.darkBackground false
 */
export async function createMoleculeViewer(
  container: HTMLElement,
  options: { darkBackground?: boolean } = {},
): Promise<PluginContext> {
  const spec: PluginSpec = {
    actions: [],
    behaviors: [
      PluginSpec.Behavior(PluginBehaviors.Representation.HighlightLoci),
      PluginSpec.Behavior(PluginBehaviors.Representation.DefaultLociLabelProvider),
      PluginSpec.Behavior(PluginBehaviors.Camera.FocusLoci),
    ],
    animations: [AnimateModelIndex],
    config: [
      [PluginConfig.Viewport.ShowAnimation, false],
      [PluginConfig.Viewport.ShowExpand, false],
      [PluginConfig.Viewport.ShowSelectionMode, false],
    ],
    canvas3d: {
      renderer: {
        backgroundColor: options.darkBackground ? Color(0x18_1a_1c) : Color(0xff_ff_ff),
        // A small molecule has no depth to cue, and fog washes out the far atoms.
        pickingAlphaThreshold: 0.5,
      },
      cameraFog: { name: 'off', params: {} },
      // Orthographic reads better than perspective at molecular scale.
      camera: { mode: 'orthographic', helper: { axes: { name: 'off', params: {} } } },
    },
  };

  const plugin = new PluginContext(spec);
  await plugin.init();
  const mounted = await plugin.mountAsync(container);
  if (!mounted) {
    plugin.dispose();
    throw new Error('Mol*: WebGL is not available in this browser');
  }
  return plugin;
}

/** Repaint the viewport background without rebuilding the plugin. */
export function setBackground(plugin: PluginContext, darkBackground: boolean): void {
  plugin.canvas3d?.setProps({
    renderer: { backgroundColor: darkBackground ? Color(0x18_1a_1c) : Color(0xff_ff_ff) },
  });
}

export interface LoadedStructure {
  readonly trajectory: StateObjectSelector;
  readonly frameCount: number;
}

/**
 * Replace whatever is on screen with `input`, as a ball-and-stick model coloured
 * by element. When `input.frames` holds more than one frame the result is a
 * trajectory that `playMode` can animate.
 */
export async function loadStructure(
  plugin: PluginContext,
  input: StructureInput,
): Promise<LoadedStructure> {
  await plugin.clear();

  const xyz = framesToXyz(input.symbols, input.frames);
  const data = await plugin.builders.data.rawData(
    { data: xyz, label: 'normal mode' },
    { state: { isGhost: true } },
  );
  const trajectory = await plugin.builders.structure.parseTrajectory(data, 'xyz');

  const trajectoryData = trajectory.data;
  if (!trajectoryData) throw new Error('Mol*: the XYZ trajectory failed to parse');
  if (input.bonds) applyBondTopology(trajectoryData, input.bonds);

  const model = await plugin.builders.structure.createModel(trajectory, { modelIndex: 0 });
  const structure = await plugin.builders.structure.createStructure(model);
  await plugin.builders.structure.representation.addRepresentation(structure, {
    type: 'ball-and-stick',
    typeParams: { sizeFactor: 0.25, aromaticBonds: false },
    color: 'element-symbol',
    colorParams: { carbonColor: { name: 'element-symbol', params: {} } },
  });

  // `reset` frames the whole scene with Mol*'s protein-sized margin; for three
  // atoms that leaves the molecule as a speck. Focus the render objects instead.
  plugin.managers.camera.focusRenderObjects(undefined, {
    extraRadius: 0.8,
    minRadius: 2.5,
    durationMs: 0,
  });
  return { trajectory, frameCount: input.frames.length };
}

/** Start or stop the built-in trajectory animation. */
export async function playMode(
  plugin: PluginContext,
  playing: boolean,
  periodSeconds = 1,
): Promise<void> {
  if (!playing) {
    await plugin.managers.animation.stop();
    return;
  }
  if (plugin.managers.animation.isAnimating) return;
  await plugin.managers.animation.play(AnimateModelIndex, {
    mode: { name: 'loop', params: { direction: 'forward' } },
    duration: { name: 'fixed', params: { durationInS: periodSeconds } },
  });
}

/** Jump to one frame without animating — used when the user scrubs. */
export async function setFrame(
  plugin: PluginContext,
  trajectory: StateObjectSelector,
  frameIndex: number,
): Promise<void> {
  const cell = plugin.state.data.select(trajectory.ref)[0];
  if (!cell) return;
  const models = plugin.state.data.tree.children.get(trajectory.ref).toArray();
  const modelRef = models[0];
  if (!modelRef) return;
  await plugin.state.data.build().to(modelRef).update({ modelIndex: frameIndex }).commit();
}

function applyBondTopology(trajectory: Trajectory, bonds: BondTopology): void {
  const count = bonds.from.length;
  const order = bonds.order ?? new Array<number>(count).fill(1);
  const keys = new Int32Array(count);
  for (let i = 0; i < count; i++) keys[i] = i;

  const indexPairBonds = IndexPairBonds.fromData(
    {
      pairs: {
        indexA: Column.ofIntArray(bonds.from as number[]),
        indexB: Column.ofIntArray(bonds.to as number[]),
        order: Column.ofIntArray(order as number[]),
        key: Column.ofIntArray(keys),
        // -1 defers to `maxDistance`, which is Infinity here: never reject a bond.
        distance: Column.ofConst(-1, count, Column.Schema.float),
        flag: Column.ofConst(BondType.Flag.Covalent, count, Column.Schema.int),
      },
      count,
    },
    { maxDistance: Number.POSITIVE_INFINITY },
  );

  for (let i = 0; i < trajectory.frameCount; i++) {
    IndexPairBonds.Provider.set(trajectory.getFrameAtIndex(i) as Model, indexPairBonds);
  }
}
