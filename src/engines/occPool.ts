import {
  disposeOccPool,
  ensurePool,
  hardwareConcurrency,
} from './occPoolLifecycle.ts';
import { poolSize } from './occPoolSize.ts';
import { runSweep } from './occPoolSweep.ts';
import type { PoolWorker } from './occPoolWorker.ts';
import { sendCommand } from './occPoolWorker.ts';
import type { RawVibrational, RunInput, RunOptions } from './occRun.ts';
import { symmetrizeHessian } from './occVibrations.ts';
import type { PreparedMessage } from './occWorkerProtocol.ts';

/** Control-plane options of a pooled run. */
export interface PoolRunOptions extends RunOptions {
  /**
   * Hard cap on the number of occjs instances. Pass 1 for the exactly
   * reproducible path; see the note on non-determinism below.
   * @default undefined
   */
  maxWorkers?: number;
}

let identifier = 0;

/**
 * Run a vibrational calculation across a pool of independent occjs instances.
 *
 * The 3N displacement columns are handed out one at a time from a shared queue,
 * so a worker on a slow efficiency core cannot stall the sweep — a static split
 * measured 1188 ms against 825 ms for caffeine at K = 8. The pool is kept alive
 * between runs, because each instance costs ~100 MB and ~100 ms to create.
 *
 * NON-DETERMINISM: each displacement is warm-started from the density of the
 * previous point that worker happened to visit, so the sweep is not
 * bit-reproducible. Measured K = 1 against K = 8 on benzene: frequencies move
 * by ~0.0135 cm⁻¹ and intensities by ~4.3e-4 relative, varying run to run —
 * ~37x inside the 0.5 cm⁻¹ frequency tolerance and ~47x inside the 2 %
 * intensity tolerance. Pass `maxWorkers: 1` when exact reproducibility matters.
 * @param input - Geometry, settings and requested outputs.
 * @param options - Pool cap, progress and cancellation.
 * @returns The raw numbers of the calculation.
 * @throws When the pool cannot start, when occ fails, or on cancellation.
 */
export async function runVibrationalInPool(
  input: RunInput,
  options: PoolRunOptions = {},
): Promise<RawVibrational> {
  const size = input.geometry.elements.length * 3;
  const count = poolSize({
    coordinates: size,
    hardwareConcurrency: hardwareConcurrency(),
    maxWorkers: options.maxWorkers,
  });
  options.onProgress?.('init', null, `Starting ${count} GFN2 instance(s)…`);
  const workers = await ensurePool(count);

  if (options.signal === undefined) {
    return orchestrate(workers, input, options, size);
  }
  const cancelled = new Promise<never>((_, reject) => {
    options.signal?.addEventListener(
      'abort',
      () => {
        disposeOccPool();
        reject(new Error('calculation cancelled'));
      },
      { once: true },
    );
  });
  return Promise.race([orchestrate(workers, input, options, size), cancelled]);
}

/** Relax, sweep in parallel, then project and diagonalize on the primary. */
async function orchestrate(
  workers: PoolWorker[],
  input: RunInput,
  options: PoolRunOptions,
  size: number,
): Promise<RawVibrational> {
  const primary = workers[0] as PoolWorker;
  const id = ++identifier;
  let geometry = input.geometry;
  let optimizeMs = 0;
  let optimizerCycles = 0;
  let optimizerConverged = true;

  if (input.settings.optimize) {
    const started = performance.now();
    const relaxed = await sendCommand(
      primary,
      { cmd: 'optimize', id, input },
      'optimized',
      (message) => {
        options.onProgress?.(message.stage, message.fraction, message.message);
      },
    );
    geometry = {
      elements: geometry.elements,
      coordinates: relaxed.coordinates,
    };
    optimizerCycles = relaxed.cycles;
    optimizerConverged = relaxed.converged;
    optimizeMs = performance.now() - started;
  }

  const prepareInput: RunInput = {
    geometry,
    settings: { ...input.settings, optimize: false },
    outputs: input.outputs,
  };
  options.onProgress?.('hessian', 0, `Displacement 0 of ${size}`);
  const started = performance.now();
  const prepared = await Promise.all(
    workers.map((worker) =>
      sendCommand(
        worker,
        { cmd: 'prepare', id, input: prepareInput },
        'prepared',
      ),
    ),
  );
  const reference = prepared[0] as PreparedMessage;

  const columns = new Float64Array(size * size);
  const dipole = input.outputs.ir ? new Float64Array(size * 3) : null;
  await runSweep(workers, id, size, columns, dipole, options);
  const hessianMs = performance.now() - started;

  options.onProgress?.('analyse', null, 'Projecting and diagonalizing…');
  const hessian = symmetrizeHessian(columns, size);
  const solved = await sendCommand(
    primary,
    { cmd: 'solve', id, hessian },
    'solved',
  );

  const warnings = [...reference.warnings];
  if (!optimizerConverged) {
    warnings.push(
      `The optimizer stopped after ${optimizerCycles} cycles without converging, so the Hessian is not at a stationary point.`,
    );
  }
  if (workers.length > 1) {
    warnings.push(
      `The displacement sweep ran on ${workers.length} parallel GFN2 instances, so the numbers are reproducible only to ~0.02 cm⁻¹ and ~0.1 % in intensity.`,
    );
  }
  return {
    coordinates: reference.coordinates,
    energy: reference.energy,
    masses: reference.masses,
    frequencies: solved.frequencies,
    normalModes: solved.normalModes,
    dipoleDerivatives: dipole,
    hessian,
    pointGroup: reference.pointGroup,
    isUnrestricted: reference.isUnrestricted,
    spinEnergy: reference.spinEnergy,
    optimizerCycles,
    optimizerConverged,
    optimizeMs,
    hessianMs,
    warnings,
  };
}
