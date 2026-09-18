import type { PoolWorker } from './occPoolWorker.ts';
import { spawnPoolWorkers, terminatePoolWorkers } from './occPoolWorker.ts';

/** Fallback when `navigator.hardwareConcurrency` is unavailable. */
const ASSUMED_CORES = 4;

let pool: PoolWorker[] = [];
let pending: Promise<PoolWorker[]> | null = null;

/**
 * Reuse the pool when it is already big enough, otherwise rebuild it.
 *
 * Requests are serialized through one promise chain, so two runs starting at
 * once cannot each spawn their own set of workers.
 * @param count - How many instances the caller needs.
 * @returns Exactly `count` workers; index 0 is the primary.
 * @throws When a worker cannot start.
 */
export function ensurePool(count: number): Promise<PoolWorker[]> {
  const chained = (pending ?? Promise.resolve(pool)).then(async (current) => {
    if (current.length >= count) return current;
    terminatePoolWorkers(current);
    pool = await spawnPoolWorkers(count);
    return pool;
  });
  pending = chained;
  return chained.then(
    (workers) => workers.slice(0, count),
    (error: unknown) => {
      // A failed chain must not poison every later run.
      if (pending === chained) pending = null;
      throw error instanceof Error ? error : new Error(String(error));
    },
  );
}

/**
 * Terminate every worker and forget the pool. The next run starts a fresh one.
 */
export function disposeOccPool(): void {
  terminatePoolWorkers(pool);
  pool = [];
  pending = null;
}

/**
 * How many occjs instances the pool currently holds.
 * @returns The live worker count, 0 when the pool has not been started.
 */
export function occPoolWorkerCount(): number {
  return pool.length;
}

/**
 * How many logical cores the browser admits to.
 * @returns The core count, or a conservative assumption outside a browser.
 */
export function hardwareConcurrency(): number {
  return typeof navigator === 'undefined'
    ? ASSUMED_CORES
    : navigator.hardwareConcurrency || ASSUMED_CORES;
}
