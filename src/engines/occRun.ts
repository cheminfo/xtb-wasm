import type {
  CalculationSettings,
  EnergyBreakdown,
  EngineStage,
  Geometry,
  OutputSelection,
} from '../types/index.ts';

import { optimizeGeometry } from './occOptimize.ts';
import { createHandleScope } from './occScope.ts';
import { prepareSystem } from './occSetup.ts';
import { createSweepContext, sweepColumns } from './occSweep.ts';
import type { PointGroupInfo } from './occSymmetry.ts';
import { detectPointGroup } from './occSymmetry.ts';
import type { OccModule } from './occTypes.ts';
import {
  readAtomicMasses,
  solveVibrations,
  symmetrizeHessian,
} from './occVibrations.ts';

/** One calculation to run, as both the engine and a worker receive it. */
export interface RunInput {
  geometry: Geometry;
  settings: CalculationSettings;
  outputs: OutputSelection;
}

/** How a run reports progress and gets cancelled. */
export interface RunOptions {
  /** @default undefined */
  onProgress?: (
    stage: EngineStage,
    fraction: number | null,
    message: string,
  ) => void;
  /** @default undefined */
  signal?: AbortSignal;
}

/**
 * Everything one occjs instance can say about a calculation, before the pure
 * JavaScript analyse step turns it into a `VibrationalResult`.
 */
export interface RawVibrational {
  /** The geometry the Hessian was built at, centred, in Å. */
  coordinates: Float64Array;
  energy: EnergyBreakdown;
  /** Standard atomic weights from occ's own table, amu. */
  masses: Float64Array;
  /** `3N` wavenumbers in cm⁻¹, ascending. */
  frequencies: Float64Array;
  /** `3N × 3N` row-major mass-weighted eigenvectors, one per column. */
  normalModes: Float64Array;
  /** `3N × 3` dipole derivatives in e, or `null` when IR was not requested. */
  dipoleDerivatives: Float64Array | null;
  /**
   * The symmetrized Cartesian Hessian in Eh/Bohr², `3N × 3N` row-major. Carried
   * so the validation page can compare its rotation-invariant scalars against a
   * reference without redoing the sweep.
   */
  hessian: Float64Array;
  pointGroup: PointGroupInfo;
  isUnrestricted: boolean;
  spinEnergy: number;
  optimizerCycles: number;
  optimizerConverged: boolean;
  optimizeMs: number;
  hessianMs: number;
  warnings: string[];
}

/**
 * Run a whole vibrational calculation on one occjs instance: relax the
 * geometry, sweep the 3N coordinates once for the Hessian and the dipole
 * derivatives together, then project and diagonalize. This is the K = 1 path,
 * and it is the exactly reproducible one — the pooled sweep in `occPool.ts`
 * visits the displacements in a run-dependent order, which perturbs the
 * SCF warm start.
 * @param module - The loaded occjs module.
 * @param input - Geometry, settings and requested outputs.
 * @param options - Progress and cancellation.
 * @returns The raw numbers of the calculation.
 * @throws When the SCF fails, or on cancellation.
 */
export function runVibrational(
  module: OccModule,
  input: RunInput,
  options: RunOptions = {},
): RawVibrational {
  const { settings, outputs } = input;
  let geometry = input.geometry;
  const warnings: string[] = [];
  let optimizeMs = 0;
  let optimizerCycles = 0;
  let optimizerConverged = true;

  if (settings.optimize) {
    const started = performance.now();
    const scope = createHandleScope();
    try {
      const system = prepareSystem(module, geometry, settings, scope);
      const relaxed = optimizeGeometry(
        module,
        system.molecule,
        system.calculator,
        {
          maxCycles: settings.maxCycles,
          signal: options.signal,
          onCycle: (cycle, energy) => {
            options.onProgress?.(
              'optimize',
              null,
              `Optimizing: cycle ${cycle}, E = ${energy.toFixed(8)} Eh`,
            );
          },
        },
      );
      geometry = {
        elements: geometry.elements,
        coordinates: relaxed.coordinates,
      };
      optimizerCycles = relaxed.cycles;
      optimizerConverged = relaxed.converged;
    } finally {
      scope.release();
    }
    optimizeMs = performance.now() - started;
  }

  const scope = createHandleScope();
  try {
    const system = prepareSystem(module, geometry, settings, scope);
    warnings.push(...system.warnings);
    if (!optimizerConverged) {
      warnings.push(
        `The optimizer stopped after ${optimizerCycles} cycles without converging, so the Hessian is not at a stationary point.`,
      );
    }
    const size = system.atoms * 3;
    const context = createSweepContext(
      module,
      system.molecule,
      system.calculator,
      outputs.ir,
      scope,
    );

    const started = performance.now();
    const columns = new Int32Array(size);
    for (let column = 0; column < size; column++) columns[column] = column;
    const output = {
      hessian: new Float64Array(size * size),
      dipole: outputs.ir ? new Float64Array(size * 3) : null,
    };
    options.onProgress?.('hessian', 0, `Displacement 0 of ${size}`);
    sweepColumns(context, columns, output, {
      signal: options.signal,
      onColumn: (done, total) => {
        options.onProgress?.(
          'hessian',
          done / total,
          `Displacement ${done} of ${total}`,
        );
      },
    });
    const hessianMs = performance.now() - started;

    options.onProgress?.('analyse', null, 'Projecting and diagonalizing…');
    const hessian = symmetrizeHessian(output.hessian, size);
    const solution = solveVibrations(module, system.molecule, hessian, size);
    const pointGroup = detectPointGroup(
      module,
      system.molecule,
      geometry.elements,
      system.coordinates,
    );
    warnings.push(...pointGroup.warnings);

    return {
      coordinates: system.coordinates,
      energy: system.energy,
      masses: readAtomicMasses(system.molecule, system.atoms),
      frequencies: solution.frequencies,
      normalModes: solution.normalModes,
      dipoleDerivatives: output.dipole,
      hessian,
      pointGroup,
      isUnrestricted: system.isUnrestricted,
      spinEnergy: system.spinEnergy,
      optimizerCycles,
      optimizerConverged,
      optimizeMs,
      hessianMs,
      warnings,
    };
  } finally {
    scope.release();
  }
}
