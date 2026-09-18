import { createHandleScope } from './occScope.ts';
import type { OccModule, OccMolecule } from './occTypes.ts';

/** The eigen-decomposition of the projected mass-weighted Hessian. */
export interface VibrationalSolution {
  /** Wavenumbers in cm⁻¹, ascending, `3N` entries including the projected ones. */
  frequencies: Float64Array;
  /**
   * `3N × 3N`, row-major, so column `mode` is the unit-norm mass-weighted
   * eigenvector of that mode. Eigen's `SelfAdjointEigenSolver` guarantees the
   * columns are orthonormal, so they are stored verbatim with no rescaling.
   */
  normalModes: Float64Array;
}

/**
 * Diagonalize a Cartesian Hessian the caller built, with the same algebraic
 * Eckart projection `XtbCalculator.vibrationalModes` applies. occ replaces the
 * mass-weighted Hessian by `Pᵀ H P`, so the six translations and rotations come
 * out at ±0.000 cm⁻¹ whether or not the gradient vanishes.
 * @param module - The loaded occjs module.
 * @param molecule - The molecule the Hessian belongs to; supplies the masses
 * and the centre of mass the projector is built from.
 * @param hessian - `size · size` row-major values of the SYMMETRIZED Cartesian
 * Hessian, as `symmetrizeHessian` produces from a raw sweep.
 * @param size - `3 · atoms`.
 * @returns Wavenumbers and mass-weighted eigenvectors.
 */
export function solveVibrations(
  module: OccModule,
  molecule: OccMolecule,
  hessian: Float64Array,
  size: number,
): VibrationalSolution {
  const scope = createHandleScope();
  try {
    const matrix = scope.keep(module.Mat.create(size, size));
    for (let row = 0; row < size; row++) {
      const offset = row * size;
      for (let column = 0; column < size; column++) {
        matrix.set(row, column, hessian[offset + column] as number);
      }
    }

    const modes = scope.keep(
      module.computeVibrationalModesFromMolecule(matrix, molecule, true),
    );
    const wavenumbers = scope.keep(modes.frequenciesCm);
    const frequencies = new Float64Array(size);
    for (let index = 0; index < size; index++) {
      frequencies[index] = wavenumbers.get(index);
    }
    const columns = scope.keep(modes.normalModes);
    const normalModes = new Float64Array(size * size);
    for (let row = 0; row < size; row++) {
      const offset = row * size;
      for (let column = 0; column < size; column++) {
        normalModes[offset + column] = columns.get(row, column);
      }
    }
    return { frequencies, normalModes };
  } finally {
    scope.release();
  }
}

/**
 * Symmetrize a central-difference Hessian. The two triangles of a raw sweep
 * differ by ~4e-5 Eh/Bohr² at the 0.005 Bohr step, because each column is
 * differentiated independently; occ's own `XtbCalculator.hessian` returns an
 * already-symmetrized matrix, and after this step the two agree to 1.1e-16,
 * i.e. to double-precision round-off.
 * @param hessian - `size · size` values, `column · size + row`.
 * @param size - `3 · atoms`.
 * @returns A new `size · size` row-major symmetric matrix.
 */
export function symmetrizeHessian(
  hessian: Float64Array,
  size: number,
): Float64Array {
  const out = new Float64Array(size * size);
  for (let row = 0; row < size; row++) {
    const offset = row * size;
    out[offset + row] = hessian[offset + row] as number;
    for (let column = row + 1; column < size; column++) {
      const average =
        0.5 *
        ((hessian[column * size + row] as number) +
          (hessian[offset + column] as number));
      out[offset + column] = average;
      out[column * size + row] = average;
    }
  }
  return out;
}

/**
 * Read the standard atomic weights occ uses. They agree with xtb's own table to
 * 6-7 significant figures, which is why they must come from here rather than
 * from a JavaScript periodic-table package whose values differ in the 7th digit
 * and would put the reduced masses out of step with the Hessian.
 * @param molecule - The molecule to read.
 * @param atoms - Number of atoms.
 * @returns One mass per atom, in amu.
 */
export function readAtomicMasses(
  molecule: OccMolecule,
  atoms: number,
): Float64Array {
  const scope = createHandleScope();
  try {
    const masses = scope.keep(molecule.atomicMasses());
    const out = new Float64Array(atoms);
    for (let atom = 0; atom < atoms; atom++) {
      out[atom] = masses.get(atom);
    }
    return out;
  } finally {
    scope.release();
  }
}
