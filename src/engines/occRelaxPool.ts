import type { RelaxRequest, RelaxResult } from '../types/relax.ts';

import {
  disposeOccPool,
  ensurePool,
  hardwareConcurrency,
} from './occPoolLifecycle.ts';
import type { PoolWorker } from './occPoolWorker.ts';
import { sendCommand } from './occPoolWorker.ts';
import { resolveRelaxSettings } from './occRelax.ts';

/** How a pooled relaxation is capped, watched and cancelled. */
export interface RelaxPoolOptions {
  /**
   * Hard cap on the number of occjs instances. Each one costs about 100 MB, so
   * a long batch on a small machine is worth capping.
   * @default one per structure, one below the core count
   */
  maxWorkers?: number;
  /**
   * Called as each structure finishes. A batch reports per structure and not
   * per optimizer cycle: the cycles of several structures interleave across the
   * pool, so a cycle number would not describe anything the reader can see.
   * @default undefined
   */
  onSettled?: (done: number, total: number) => void;
  /**
   * Gives the batch up. A wasm call never reads its message queue while it
   * runs, so cancelling terminates the pool rather than asking it to stop.
   * @default undefined
   */
  signal?: AbortSignal;
}

/**
 * Relax one geometry in a worker and report the GFN2 energy where it landed.
 *
 * This is the opt-in second stage after a force field: MMFF94 places the atoms,
 * GFN2 — which has D4 dispersion and a real electronic structure — decides how
 * good the result is. Starting from a geometry a force field already minimised
 * it costs 4-7 ms for a few atoms, ~20 ms for benzene, ~200 ms for caffeine and
 * ~670 ms for ibuprofen, which is why it is never automatic.
 * @param request - Geometry and what to override of the defaults.
 * @param options - Pool cap, progress and cancellation.
 * @returns The relaxed geometry, its energy and what the optimizer did.
 * @throws When `Worker` is unavailable, when occ fails, or on cancellation.
 */
export async function relaxGeometry(
  request: RelaxRequest,
  options: RelaxPoolOptions = {},
): Promise<RelaxResult> {
  const [result] = await relaxGeometries([request], {
    ...options,
    maxWorkers: 1,
  });
  if (result === undefined) {
    throw new Error('the relaxation produced no result');
  }
  return result;
}

/**
 * Relax several geometries, one per worker, and report each energy where it
 * landed.
 *
 * Every relaxation is an independent whole job, so the batch parallelises
 * cleanly: the structures are handed out one at a time from a shared queue,
 * which keeps a worker on a slow core from stalling the rest. This is the call
 * that refines a conformer set.
 *
 * Results come back in the order the requests were given, whichever worker
 * produced them.
 * @param requests - The structures to relax.
 * @param options - Pool cap, progress and cancellation.
 * @returns One result per request, in request order.
 * @throws When `Worker` is unavailable, when occ fails on any structure, or on
 * cancellation. A failure gives up the whole batch.
 */
export async function relaxGeometries(
  requests: readonly RelaxRequest[],
  options: RelaxPoolOptions = {},
): Promise<RelaxResult[]> {
  if (requests.length === 0) return [];
  const count = relaxPoolSize({
    structures: requests.length,
    hardwareConcurrency: hardwareConcurrency(),
    maxWorkers: options.maxWorkers,
  });
  const workers = await ensurePool(count);
  const batch = drain(workers, requests, options);
  if (options.signal === undefined) return batch;

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
  return Promise.race([batch, cancelled]);
}

/** What the relaxation pool-size decision depends on. */
export interface RelaxPoolSizeInput {
  /** How many structures are in the batch. */
  structures: number;
  /** `navigator.hardwareConcurrency`, or a fallback when it is unavailable. */
  hardwareConcurrency: number;
  /** Hard cap the caller imposes. @default undefined */
  maxWorkers?: number;
}

/**
 * How many occjs instances to relax a batch on.
 *
 * One instance per structure and no more — a second worker on a one-structure
 * batch is 100 MB and ~100 ms of warm-up for nothing — and one logical core is
 * left for the main thread, which keeps the UI responsive while the batch runs.
 * @param input - Batch size, hardware, and any cap.
 * @returns At least 1, at most `maxWorkers` when one is given.
 */
export function relaxPoolSize(input: RelaxPoolSizeInput): number {
  const cap = input.maxWorkers ?? Number.POSITIVE_INFINITY;
  const budget = Math.max(1, Math.floor(input.hardwareConcurrency) - 1);
  return Math.max(1, Math.min(cap, budget, input.structures));
}

let identifier = 0;

/** Every worker takes the next structure until the queue is empty. */
async function drain(
  workers: readonly PoolWorker[],
  requests: readonly RelaxRequest[],
  options: RelaxPoolOptions,
): Promise<RelaxResult[]> {
  const results = new Array<RelaxResult | undefined>(requests.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    workers.map(async (worker) => {
      while (next < requests.length) {
        const index = next++;
        const request = requests[index] as RelaxRequest;
        const startedAt = performance.now();
        /* eslint-disable-next-line no-await-in-loop -- one structure at a time
           is the point: it is what keeps a slow core from stalling the batch. */
        const relaxed = await sendCommand(
          worker,
          {
            cmd: 'relax',
            id: ++identifier,
            geometry: request.geometry,
            settings: resolveRelaxSettings(request.settings),
          },
          'relaxed',
        );
        results[index] = {
          coordinates: relaxed.coordinates,
          energy: relaxed.energy,
          cycles: relaxed.cycles,
          converged: relaxed.converged,
          elapsedMs: performance.now() - startedAt,
          warnings: relaxed.warnings,
        };
        done++;
        options.onSettled?.(done, requests.length);
      }
    }),
  );
  return results as RelaxResult[];
}
