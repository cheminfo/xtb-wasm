import { optimizeGeometry } from './occOptimize.ts';
import { relaxInProcess } from './occRelax.ts';
import { createHandleScope } from './occScope.ts';
import { prepareSystem } from './occSetup.ts';
import type { OccModule } from './occTypes.ts';
import type {
  OptimizeCommand,
  RelaxCommand,
  WorkerMessage,
} from './occWorkerProtocol.ts';

/** How a job hands a message back to the pool, transferring what it owns. */
export type PostMessage = (
  message: WorkerMessage,
  transfer?: Transferable[],
) => void;

/**
 * The two commands that hold no state between them: each builds its own
 * calculator, answers, and leaves the worker as it found it. The stateful
 * `prepare` / `sweep` / `solve` trio stays in `occWorker.ts`, which owns the
 * calculator they share.
 */

/**
 * Relax the geometry as one step of a vibrational run, and report where it
 * landed.
 * @param module - The loaded occjs module.
 * @param command - The geometry and settings to relax.
 * @param post - How to answer the pool.
 * @throws When the SCF fails.
 */
export function runOptimizeCommand(
  module: OccModule,
  command: OptimizeCommand,
  post: PostMessage,
): void {
  const scope = createHandleScope();
  try {
    const { geometry, settings } = command.input;
    const prepared = prepareSystem(module, geometry, settings, scope);
    const relaxed = optimizeGeometry(
      module,
      prepared.molecule,
      prepared.calculator,
      {
        maxCycles: settings.maxCycles,
        onCycle: (cycle, energy) => {
          post(progress(command.id, cycle, energy));
        },
      },
    );
    post(
      {
        type: 'optimized',
        id: command.id,
        coordinates: relaxed.coordinates,
        cycles: relaxed.cycles,
        converged: relaxed.converged,
      },
      [relaxed.coordinates.buffer],
    );
  } finally {
    scope.release();
  }
}

/**
 * Relax a geometry as a whole job, and report its energy where it landed.
 * @param module - The loaded occjs module.
 * @param command - The geometry and settings to relax.
 * @param post - How to answer the pool.
 * @throws When the request is refused, or when the SCF fails.
 */
export function runRelaxCommand(
  module: OccModule,
  command: RelaxCommand,
  post: PostMessage,
): void {
  const result = relaxInProcess(
    module,
    { geometry: command.geometry, settings: command.settings },
    {
      onCycle: (cycle, energy) => {
        post(progress(command.id, cycle, energy));
      },
    },
  );
  post(
    {
      type: 'relaxed',
      id: command.id,
      coordinates: result.coordinates,
      energy: result.energy,
      cycles: result.cycles,
      converged: result.converged,
      warnings: result.warnings,
    },
    [result.coordinates.buffer],
  );
}

function progress(id: number, cycle: number, energy: number): WorkerMessage {
  return {
    type: 'progress',
    id,
    stage: 'optimize',
    fraction: null,
    message: `Optimizing: cycle ${cycle}, E = ${energy.toFixed(8)} Eh`,
  };
}
