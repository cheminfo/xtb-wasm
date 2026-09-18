import { useEffect, useRef, useState } from 'react';
import type { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import type { StateObjectSelector } from 'molstar/lib/mol-state';

import {
  buildModeFrames,
  normalizeAmplitude,
  parseXyzFrames,
} from './molstar/normal-mode.ts';
import type { NormalMode } from './molstar/normal-mode.ts';
import { showModeArrows } from './molstar/mode-arrows.ts';
import type { BondTopology } from './molstar/viewer.ts';
import {
  createMoleculeViewer,
  loadStructure,
  playMode,
  setBackground,
} from './molstar/viewer.ts';

export interface MoleculeViewerProps {
  /** Equilibrium geometry as a single-model XYZ document, in Angstrom. */
  xyz: string;
  /**
   * Normal mode to animate. When absent the equilibrium geometry is shown still.
   * Must be referentially stable (module constant or `useMemo`): a fresh object
   * literal on every render rebuilds the whole trajectory on every render.
   */
  mode?: NormalMode;
  /**
   * Peak excursion of the most-displaced atom, in Angstrom.
   * @default 0.35
   */
  amplitude?: number;
  /**
   * Whether the vibration is animating.
   * @default false
   */
  playing?: boolean;
  /**
   * Frames per vibration period.
   * @default 20
   */
  frameCount?: number;
  /**
   * Wall-clock seconds per vibration period.
   * @default 1
   */
  periodSeconds?: number;
  /**
   * Fixed bond topology; without it bonds are perceived per frame by distance.
   * Referentially stable, like `mode`.
   */
  bonds?: BondTopology;
  /** Called once with the live plugin, for screenshots or extra representations. */
  onReady?: (plugin: PluginContext) => void;
  /**
   * Draw one displacement arrow per atom.
   * @default false
   */
  showArrows?: boolean;
  /**
   * Dark viewport background.
   * @default false
   */
  dark?: boolean;
  /**
   * CSS height of the viewer.
   * @default '400px'
   */
  height?: string;
}

/** Ball-and-stick Mol* viewer that animates one normal mode of a small molecule. */
export function MoleculeViewer(props: MoleculeViewerProps) {
  const {
    xyz,
    mode,
    amplitude = 0.35,
    playing = false,
    frameCount = 20,
    periodSeconds = 1,
    bonds,
    onReady,
    showArrows = false,
    dark = false,
    height = '400px',
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<PluginContext>(null);
  const trajectoryRef = useRef<StateObjectSelector>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [plugin, setPlugin] = useState<PluginContext>();
  const [error, setError] = useState<string>();

  // Create / destroy the plugin. StrictMode mounts this effect twice, so the
  // creation is guarded by a disposed flag and the cleanup always disposes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let created: PluginContext | undefined;

    createMoleculeViewer(container, { darkBackground: dark })
      .then((instance) => {
        created = instance;
        if (disposed) {
          instance.dispose();
          return;
        }
        pluginRef.current = instance;
        setPlugin(instance);
        onReadyRef.current?.(instance);
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      disposed = true;
      created?.dispose();
      if (pluginRef.current === created) pluginRef.current = null;
      setPlugin(undefined);
    };
    // `dark` is applied by a separate effect so a theme flip never rebuilds WebGL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (plugin) setBackground(plugin, dark);
  }, [plugin, dark]);

  // Rebuild the trajectory whenever geometry, mode or amplitude changes.
  useEffect(() => {
    if (!plugin) return;
    let cancelled = false;

    const { symbols, frames: parsed } = parseXyzFrames(xyz);
    const equilibrium = parsed[0];
    if (!equilibrium) {
      setError('the XYZ document contains no frame');
      return;
    }

    const frames = mode
      ? buildModeFrames(
          { symbols, coordinates: equilibrium },
          mode.eigenvector,
          normalizeAmplitude(mode.eigenvector, amplitude),
          frameCount,
        )
      : [equilibrium];

    loadStructure(plugin, { symbols, frames, bonds })
      .then(async (loaded) => {
        if (cancelled) return;
        trajectoryRef.current = loaded.trajectory;
        if (mode && showArrows) {
          // Draw the arrows ~3x the animation amplitude, otherwise most of the
          // vector is buried inside the ball-and-stick sphere it starts from.
          const scale = normalizeAmplitude(mode.eigenvector, amplitude * 3);
          const displacement = new Float64Array(equilibrium.length);
          for (let i = 0; i < displacement.length; i++) {
            displacement[i] = (mode.eigenvector[i] as number) * scale;
          }
          await showModeArrows(plugin, equilibrium, displacement);
        }
        if (cancelled) return;
        if (playing && frames.length > 1) await playMode(plugin, true, periodSeconds);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
    // `playing` is handled by the effect below; including it here would reload
    // the whole trajectory on every play/pause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin, xyz, mode, amplitude, frameCount, bonds, showArrows]);

  useEffect(() => {
    if (!plugin || !trajectoryRef.current) return;
    void playMode(plugin, playing && !!mode, periodSeconds);
    return () => {
      if (!plugin.isInitialized) return;
      void plugin.managers.animation.stop();
    };
  }, [plugin, playing, mode, periodSeconds]);

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {error ? (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
