import type { PoolWorker } from './occPoolWorker.ts';
import { sendCommand } from './occPoolWorker.ts';

/** How the sweep scheduler reports progress. */
export interface SweepProgress {
  /** @default undefined */
  onProgress?: (stage: 'hessian', fraction: number, message: string) => void;
}

/**
 * Hand the displacement columns out one at a time, so a worker on a slow core
 * cannot stall the sweep: a static split measured 1188 ms against 825 ms for
 * caffeine at K = 8.
 * @param workers - The pool; every one must already have been prepared.
 * @param id - Run identifier, echoed in each command.
 * @param size - `3 · atoms`, the number of columns.
 * @param rawColumns - Receives the raw Hessian, `column · size + row`.
 * @param dipole - Receives `dμ/dx`, `column · 3 + axis`, or `null`.
 * @param options - Progress reporting.
 * @throws When a worker reports an error.
 */
export async function runSweep(
  workers: readonly PoolWorker[],
  id: number,
  size: number,
  rawColumns: Float64Array,
  dipole: Float64Array | null,
  options: SweepProgress,
): Promise<void> {
  let next = 0;
  let done = 0;
  await Promise.all(
    workers.map(async (worker) => {
      while (next < size) {
        const column = next++;
        const columns = new Int32Array([column]);
        /* eslint-disable-next-line no-await-in-loop -- one column at a time is
           the point: it is what keeps a slow core from stalling the sweep. */
        const slice = await sendCommand(
          worker,
          { cmd: 'sweep', id, columns },
          'swept',
        );
        const offset = column * size;
        for (let row = 0; row < size; row++) {
          rawColumns[offset + row] = slice.hessian[row] as number;
        }
        if (dipole !== null && slice.dipole !== null) {
          for (let axis = 0; axis < 3; axis++) {
            dipole[column * 3 + axis] = slice.dipole[axis] as number;
          }
        }
        done++;
        options.onProgress?.(
          'hessian',
          done / size,
          `Displacement ${done} of ${size}`,
        );
      }
    }),
  );
}
