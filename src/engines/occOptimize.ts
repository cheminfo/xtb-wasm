import { ANGSTROM_PER_BOHR } from '../chemistry/constants.ts';

import { describeOccError } from './occModule.ts';
import { createHandleScope, withHandleScope } from './occScope.ts';
import type { OccModule, OccMolecule, OccXtbCalculator } from './occTypes.ts';

/**
 * Berny criteria 100× tighter than occ's defaults. At the defaults caffeine
 * lands 5.8e-4 Eh high and its lowest mode is off by 39.6 cm⁻¹; tightened, that
 * becomes 6.8e-6 Eh and 0.73 cm⁻¹, for 39 optimizer steps instead of 7 — which
 * is negligible next to the 6N Hessian sweep.
 */
const TIGHT_CRITERIA = {
  gradientMax: 4.5e-6,
  gradientRms: 1.5e-6,
  stepMax: 1.8e-5,
  stepRms: 1.2e-5,
};

/** What a relaxation produced. */
export interface OptimizationResult {
  /** The relaxed geometry, flat `x,y,z` per atom in Å. */
  coordinates: Float64Array;
  /** Total energy at the last accepted cycle, Eh. */
  energy: number;
  cycles: number;
  converged: boolean;
}

/** How a relaxation reports progress and gets cancelled. */
export interface OptimizeOptions {
  maxCycles: number;
  /** @default undefined */
  onCycle?: (cycle: number, energy: number) => void;
  /** @default undefined */
  signal?: AbortSignal;
}

/**
 * Relax a geometry with occ's Berny optimizer on a GFN2 energy and gradient.
 * One calculator is reused across all cycles — rebuilding it per cycle costs
 * 3.1-4.3 ms of pure setup and throws away the SCF guess, which is exactly what
 * makes the next cycle cheap.
 * @param module - The loaded occjs module.
 * @param molecule - The starting molecule, centred on its centre of mass.
 * @param calculator - A calculator on `molecule`, with charge and unpaired
 * electrons already applied.
 * @param options - Cycle budget, progress and cancellation.
 * @returns The relaxed geometry and the energy it was reached at.
 * @throws When occ fails for a reason other than a collapsed trust radius, or
 * when `options.signal` aborts.
 */
export function optimizeGeometry(
  module: OccModule,
  molecule: OccMolecule,
  calculator: OccXtbCalculator,
  options: OptimizeOptions,
): OptimizationResult {
  return withHandleScope((scope) => {
    const atoms = calculator.numAtoms();
    const criteria = scope.keep(new module.ConvergenceCriteria());
    criteria.gradientMax = TIGHT_CRITERIA.gradientMax;
    criteria.gradientRms = TIGHT_CRITERIA.gradientRms;
    criteria.stepMax = TIGHT_CRITERIA.stepMax;
    criteria.stepRms = TIGHT_CRITERIA.stepRms;
    const optimizer = scope.keep(new module.BernyOptimizer(molecule, criteria));
    const positions = scope.keep(calculator.positions());

    const coordinates = new Float64Array(atoms * 3);
    let energy = Number.NaN;
    let cycles = 0;
    let converged = false;

    for (let cycle = 0; cycle < options.maxCycles && !converged; cycle++) {
      if (options.signal?.aborted === true) {
        throw new Error('calculation cancelled');
      }
      const cycleScope = createHandleScope();
      try {
        const candidate = cycleScope.keep(optimizer.getNextGeometry());
        readAngstrom(candidate, atoms, coordinates);
        for (let atom = 0; atom < atoms; atom++) {
          for (let axis = 0; axis < 3; axis++) {
            positions.set(
              axis,
              atom,
              (coordinates[atom * 3 + axis] as number) / ANGSTROM_PER_BOHR,
            );
          }
        }
        calculator.updateStructure(positions);
        const evaluated = calculator.energyAndGradient();
        cycleScope.keep(evaluated.gradient);
        cycleScope.keep(evaluated);
        energy = evaluated.energy;
        optimizer.update(energy, evaluated.gradient);
        cycles = cycle + 1;
        options.onCycle?.(cycles, energy);
        converged = optimizer.step();
      } catch (error) {
        // Berny raises "The trust radius got too small" once it is sitting on
        // the minimum but still cannot satisfy a very tight step criterion. The
        // geometry is stationary, so accept it rather than failing the run.
        const message = describeOccError(module, error);
        if (!message.includes('trust radius')) {
          throw new Error(message, { cause: error });
        }
        converged = true;
      } finally {
        cycleScope.release();
      }
    }

    if (converged) {
      withHandleScope((finalScope) => {
        readAngstrom(
          finalScope.keep(optimizer.getNextGeometry()),
          atoms,
          coordinates,
        );
      });
    }
    return { coordinates, energy, cycles, converged };
  });
}

/** Read a molecule's 3 × N Å positions into a flat `x0,y0,z0,x1,…` array. */
function readAngstrom(
  molecule: OccMolecule,
  atoms: number,
  out: Float64Array,
): void {
  withHandleScope((scope) => {
    const positions = scope.keep(molecule.positions());
    for (let atom = 0; atom < atoms; atom++) {
      for (let axis = 0; axis < 3; axis++) {
        out[atom * 3 + axis] = positions.get(axis, atom);
      }
    }
  });
}
