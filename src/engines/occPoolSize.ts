/**
 * Below this many Cartesian coordinates the sweep runs on a single instance.
 *
 * Measured on an Apple M1 (8 logical / 4 performance cores, node 26): water
 * (3N = 9) sweeps in 19 ms on one instance and 13-14 ms on four or eight, while
 * warming eight instances costs ~200 ms even with the compiled module shared.
 * Spending 200 ms to save 6 ms is never right, so the threshold sits just above
 * water and just below benzene (3N = 36), where the pool is worth 2.5x.
 */
export const PARALLEL_MIN_COORDINATES = 18;

/**
 * Fewest columns a worker is given before another worker is added. Each column
 * is two SCF points plus one `postMessage` round trip carrying 3N doubles, so
 * six columns keep the transport a small fraction of the work.
 */
export const MIN_COLUMNS_PER_WORKER = 6;

/** What the pool-size decision depends on. */
export interface PoolSizeInput {
  /** `3 · atoms`, the number of displacement columns to share out. */
  coordinates: number;
  /** `navigator.hardwareConcurrency`, or a fallback when it is unavailable. */
  hardwareConcurrency: number;
  /**
   * Hard cap the caller imposes, e.g. 1 for the exactly reproducible path.
   * @default undefined
   */
  maxWorkers?: number;
}

/**
 * How many occjs instances to run the sweep on.
 *
 * One logical core is left for the main thread, which assembles the Hessian and
 * keeps the UI responsive. Measured speedups of the whole sweep against a
 * single instance: benzene 2.5x at K = 4, caffeine 4.3x at K = 8 (3580 ms →
 * 825 ms), ibuprofen 3.7x at K = 4 with K = 8 no better (2002 vs 2058 ms) —
 * four of the eight cores are efficiency cores, so returns flatten there.
 * @param input - Problem size, hardware, and any cap.
 * @returns At least 1, at most `maxWorkers` when one is given.
 */
export function poolSize(input: PoolSizeInput): number {
  const cap = input.maxWorkers ?? Number.POSITIVE_INFINITY;
  if (cap <= 1 || input.coordinates < PARALLEL_MIN_COORDINATES) return 1;

  const budget = Math.max(1, Math.floor(input.hardwareConcurrency) - 1);
  const useful = Math.max(
    1,
    Math.floor(input.coordinates / MIN_COLUMNS_PER_WORKER),
  );
  return Math.max(1, Math.min(cap, budget, useful));
}
