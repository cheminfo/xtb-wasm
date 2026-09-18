import type {
  EngineCapabilities,
  EngineRunOptions,
  VibrationalEngine,
  VibrationalRequest,
  VibrationalResult,
} from '../types/index.ts';

import { runVibrationalInPool } from './occPool.ts';
import { buildResult } from './occResult.ts';

/** What every occjs engine can do. `m.XtbMethod` has exactly one value. */
const CAPABILITIES: EngineCapabilities = {
  methods: ['GFN2'],
  ir: true,
  raman: 'bond-polarizability',
  thermochemistry: true,
  charge: true,
  openShell: true,
  constraints: false,
};

/** How one occjs engine differs from another. */
export interface OccjsEngineOptions {
  id: string;
  label: string;
  description: string;
  /**
   * Cap on the number of parallel occjs instances. 1 makes the run exactly
   * reproducible; omit it to let `poolSize` decide from the molecule and the
   * hardware.
   * @default undefined
   */
  maxWorkers?: number;
}

/**
 * Build a GFN2-xTB engine that runs in this browser, via OCC compiled to
 * WebAssembly. Optimization, Hessian and dipole derivatives all run locally —
 * nothing leaves the machine.
 * @param options - Identity and the pool cap.
 * @returns The engine.
 */
export function createOccjsEngine(
  options: OccjsEngineOptions,
): VibrationalEngine {
  return {
    id: options.id,
    label: options.label,
    description: options.description,
    location: 'browser',
    capabilities: CAPABILITIES,

    isAvailable: async () => typeof Worker !== 'undefined',

    validate: (request) => refusals(request),

    compute: async (
      request: VibrationalRequest,
      runOptions: EngineRunOptions,
    ): Promise<VibrationalResult> => {
      const startedAt = performance.now();
      const problems = refusals(request);
      if (problems.length > 0) throw new Error(problems.join(' '));

      const raw = await runVibrationalInPool(
        {
          geometry: {
            elements: request.molecule.elements,
            coordinates: request.molecule.coordinates,
          },
          settings: request.settings,
          outputs: request.outputs,
        },
        {
          maxWorkers: options.maxWorkers,
          signal: runOptions.signal,
          onProgress: (stage, fraction, message) => {
            runOptions.onProgress?.({ stage, fraction, message });
          },
        },
      );
      return buildResult({ engineId: options.id, request, raw, startedAt });
    },
  };
}

/**
 * GFN2-xTB in the browser, sweeping the displacements across a pool of occjs
 * instances. This is the engine the UI runs.
 */
export const occjsEngine = createOccjsEngine({
  id: 'occjs',
  label: 'OCC (browser)',
  description:
    'GFN2-xTB in WebAssembly — optimization, Hessian and dipole derivatives run on this machine',
});

/**
 * The same engine pinned to a single instance, so two runs of the same input
 * give identical digits. The parallel sweep visits the displacements in a
 * run-dependent order and each point is warm-started from the previous one, so
 * it is reproducible only to ~0.02 cm⁻¹, which is coarser than a digit-for-digit
 * fixture comparison needs.
 */
export const occjsSerialEngine = createOccjsEngine({
  id: 'occjs-serial',
  label: 'OCC (browser, single instance)',
  description:
    'GFN2-xTB in WebAssembly on one instance — slower, but bit-reproducible',
  maxWorkers: 1,
});

/** Every reason this build cannot honour a request. */
function refusals(request: VibrationalRequest): string[] {
  const problems: string[] = [];
  const { settings, molecule } = request;

  if (!CAPABILITIES.methods.includes(settings.method)) {
    problems.push(
      `This WebAssembly build only implements ${CAPABILITIES.methods.join(', ')}; ${settings.method} is not available.`,
    );
  }
  if (molecule.elements.length < 2) {
    problems.push('A single atom has no vibrations.');
  }
  if (
    !Number.isInteger(settings.unpairedElectrons) ||
    settings.unpairedElectrons < 0
  ) {
    problems.push(
      'The number of unpaired electrons must be a non-negative integer.',
    );
  }
  if (!Number.isInteger(settings.charge)) {
    problems.push('The charge must be an integer number of electrons.');
  }
  if (!(settings.temperature > 0)) {
    problems.push('The temperature must be above 0 K.');
  }
  return problems;
}
