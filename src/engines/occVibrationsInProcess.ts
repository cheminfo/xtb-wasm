import type {
  EngineRunOptions,
  VibrationalRequest,
  VibrationalResult,
} from '../types/index.ts';

import { loadInProcessModule } from './occModule.ts';
import { buildResult } from './occResult.ts';
import { runVibrational } from './occRun.ts';
import { vibrationalRefusals } from './occjs.ts';

/** The `engineId` of a result computed by {@link computeVibrationsInProcess}. */
export const IN_PROCESS_ENGINE_ID = 'occjs-in-process';

/**
 * Compute the vibrational analysis of one molecule on the current thread,
 * loading occ on first use.
 *
 * The engines need `Worker` and the bundler-resolved wasm URL, so they are a
 * browser-only path. This one works wherever the module loads — Node, a test
 * run, or inside a worker the caller already owns — at the cost of blocking the
 * thread it is called on. It runs on a single instance, so two calls on the
 * same request give the same digits.
 *
 * Raman activities and thermochemistry are filled only once
 * `installVibrationalAnalyser()` has been called, as with the engines.
 * @param request - The molecule, settings and requested outputs.
 * @param options - Progress and cancellation.
 * @returns The finished result.
 * @throws When the request cannot be honoured, when occ fails, or on cancellation.
 */
export async function computeVibrationsInProcess(
  request: VibrationalRequest,
  options: EngineRunOptions = {},
): Promise<VibrationalResult> {
  const startedAt = performance.now();
  const problems = vibrationalRefusals(request);
  if (problems.length > 0) throw new Error(problems.join(' '));

  const module = await loadInProcessModule();
  const raw = runVibrational(
    module,
    {
      geometry: {
        elements: request.molecule.elements,
        coordinates: request.molecule.coordinates,
      },
      settings: request.settings,
      outputs: request.outputs,
    },
    {
      signal: options.signal,
      onProgress: (stage, fraction, message) => {
        options.onProgress?.({ stage, fraction, message });
      },
    },
  );
  return buildResult({
    engineId: IN_PROCESS_ENGINE_ID,
    request,
    raw,
    startedAt,
  });
}
