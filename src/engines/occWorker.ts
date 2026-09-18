/// <reference lib="webworker" />
import { describeOccError, loadOccModule } from './occModule.ts';
import { optimizeGeometry } from './occOptimize.ts';
import type { HandleScope } from './occScope.ts';
import { createHandleScope } from './occScope.ts';
import type { PreparedSystem } from './occSetup.ts';
import { prepareSystem } from './occSetup.ts';
import type { SweepContext } from './occSweep.ts';
import { createSweepContext, sweepColumns } from './occSweep.ts';
import { detectPointGroup } from './occSymmetry.ts';
import type { OccModule } from './occTypes.ts';
import { readAtomicMasses, solveVibrations } from './occVibrations.ts';
import type {
  OptimizeCommand,
  PrepareCommand,
  WorkerCommand,
  WorkerMessage,
} from './occWorkerProtocol.ts';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;

/**
 * One worker owns one occjs module and one calculator, warm-started at the
 * reference geometry, for the whole life of a run. Rebuilding either per
 * displacement costs 3.1-4.3 ms of pure setup and throws away the SCF guess
 * that makes the next point cheap, so both are held here rather than passed
 * with every command.
 */
let occModule: OccModule | null = null;
let runScope: HandleScope | null = null;
let system: PreparedSystem | null = null;
let sweep: SweepContext | null = null;
let wantDipole = false;

workerScope.addEventListener(
  'message',
  (event: MessageEvent<WorkerCommand>) => {
    void dispatch(event.data);
  },
);

/** Post a message, transferring the buffers the pool will take ownership of. */
function post(message: WorkerMessage, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, { transfer });
}

async function dispatch(command: WorkerCommand): Promise<void> {
  try {
    if (command.cmd === 'load') {
      const startedAt = performance.now();
      occModule = await loadOccModule({
        wasmPath: command.wasmPath,
        dataPath: command.dataPath,
        wasmModule: command.wasmModule,
        dataPackage: command.dataPackage,
      });
      post({ type: 'loaded', loadMs: performance.now() - startedAt });
      return;
    }

    const module = occModule;
    if (module === null) {
      throw new Error('the occjs module has not been loaded in this worker');
    }

    switch (command.cmd) {
      case 'optimize':
        optimize(module, command);
        return;
      case 'prepare':
        prepare(module, command);
        return;
      case 'sweep':
        runSweep(command.id, command.columns);
        return;
      case 'solve':
        solve(module, command.id, command.hessian);
        return;
      default:
        throw new Error('the pool sent a command this worker does not know');
    }
  } catch (error) {
    const message =
      occModule === null
        ? error instanceof Error
          ? error.message
          : String(error)
        : describeOccError(occModule, error);
    post({
      type: 'error',
      id: command.cmd === 'load' ? 0 : command.id,
      message,
    });
  }
}

function optimize(module: OccModule, command: OptimizeCommand): void {
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
          post({
            type: 'progress',
            id: command.id,
            stage: 'optimize',
            fraction: null,
            message: `Optimizing: cycle ${cycle}, E = ${energy.toFixed(8)} Eh`,
          });
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

function prepare(module: OccModule, command: PrepareCommand): void {
  releaseRun();
  const scope = createHandleScope();
  runScope = scope;

  const { geometry, settings, outputs } = command.input;
  const prepared = prepareSystem(module, geometry, settings, scope);
  system = prepared;
  wantDipole = outputs.ir;
  sweep = createSweepContext(
    module,
    prepared.molecule,
    prepared.calculator,
    wantDipole,
    scope,
  );
  const pointGroup = detectPointGroup(
    module,
    prepared.molecule,
    geometry.elements,
    prepared.coordinates,
  );

  post({
    type: 'prepared',
    id: command.id,
    atoms: prepared.atoms,
    coordinates: prepared.coordinates,
    masses: readAtomicMasses(prepared.molecule, prepared.atoms),
    energy: prepared.energy,
    pointGroup,
    isUnrestricted: prepared.isUnrestricted,
    spinEnergy: prepared.spinEnergy,
    warnings: [...prepared.warnings, ...pointGroup.warnings],
  });
}

function runSweep(id: number, columns: Int32Array): void {
  const context = sweep;
  if (context === null) {
    throw new Error('sweep was requested before prepare');
  }
  const output = {
    hessian: new Float64Array(columns.length * context.size),
    dipole: wantDipole ? new Float64Array(columns.length * 3) : null,
  };
  sweepColumns(context, columns, output);

  const transfer: Transferable[] = [output.hessian.buffer];
  if (output.dipole !== null) transfer.push(output.dipole.buffer);
  post(
    {
      type: 'swept',
      id,
      columns,
      hessian: output.hessian,
      dipole: output.dipole,
    },
    transfer,
  );
}

function solve(module: OccModule, id: number, hessian: Float64Array): void {
  const prepared = system;
  if (prepared === null) {
    throw new Error('solve was requested before prepare');
  }
  const solution = solveVibrations(
    module,
    prepared.molecule,
    hessian,
    prepared.atoms * 3,
  );
  post(
    {
      type: 'solved',
      id,
      frequencies: solution.frequencies,
      normalModes: solution.normalModes,
    },
    [solution.frequencies.buffer, solution.normalModes.buffer],
  );
}

/** Drop the previous run's calculator and every wasm handle it held. */
function releaseRun(): void {
  sweep = null;
  system = null;
  runScope?.release();
  runScope = null;
}
