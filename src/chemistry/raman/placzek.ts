import {
  depolarizationRatio,
  ramanActivity,
  ramanInvariants,
} from './invariants.ts';

/** Raman observables of one normal mode in the Placzek static approximation. */
export interface RamanActivity {
  /** Raman scattering activity in Å⁴/amu. */
  activity: number;
  /**
   * Depolarization ratio at 90° scattering for linearly polarized incident
   * radiation, in [0, 0.75]. Not the natural-light ratio, which is bounded by
   * 6/7 — see `depolarizationRatio`.
   */
  depolarizationRatio: number;
}

/**
 * Projects a Cartesian polarizability derivative onto normal modes and reduces
 * each mode's transition tensor to its Raman observables — ASE's
 * `Raman.map_to_modes` followed by `get_absolute_intensities(delta=0)`.
 *
 * `V_qcc[r] = ∂α/∂x_r / √m_r` and `V_Qcc = Σ_r L[r] · V_qcc[r]`, so the mass
 * weighting of the eigenvector and the `1/√m` of ASE's `im_r` combine into the
 * Cartesian displacement `L[r]/√m_r` that ASE calls `modes_Qq · im_r`.
 * @param gradient - `∂α/∂R` in Å², flat row-major, `9·3·atoms` elements, as
 * `polarizabilityGradient` or `finiteDifferenceGradient` returns it.
 * @param modes - One entry per mode, each carrying the mass-weighted unit-norm
 * eigenvector of the projected Hessian, length `3·atoms`.
 * @param masses - Atomic masses in amu, one per atom.
 * @returns One entry per input mode, in the same order.
 * @throws When the gradient, a mode's eigenvector and the mass list disagree
 * about the atom count, or when a mass is not positive.
 */
export function placzekActivities(
  gradient: Float64Array,
  modes: ReadonlyArray<{ eigenvector: Float64Array }>,
  masses: Float64Array,
): RamanActivity[] {
  const size = masses.length * 3;
  if (gradient.length !== size * 9) {
    throw new Error(
      `the gradient holds ${gradient.length} values, expected ${size * 9} for ${masses.length} atoms`,
    );
  }

  const inverseRootMass = new Float64Array(size);
  for (let atom = 0; atom < masses.length; atom++) {
    // A zero or negative mass would divide the eigenvector by zero or by NaN
    // and hand the caller an Infinity that looks like a very intense band.
    const mass = masses[atom] as number;
    if (!Number.isFinite(mass) || mass <= 0) {
      throw new Error(
        `the mass of atom ${atom} is ${mass}, expected a positive number`,
      );
    }
    const inverse = 1 / Math.sqrt(mass);
    inverseRootMass[atom * 3] = inverse;
    inverseRootMass[atom * 3 + 1] = inverse;
    inverseRootMass[atom * 3 + 2] = inverse;
  }

  const activities: RamanActivity[] = new Array(modes.length);
  const tensor = new Float64Array(9);
  for (let mode = 0; mode < modes.length; mode++) {
    const eigenvector = (modes[mode] as { eigenvector: Float64Array })
      .eigenvector;
    if (eigenvector.length !== size) {
      throw new Error(
        `mode ${mode} has ${eigenvector.length} components, expected ${size}`,
      );
    }
    tensor.fill(0);
    for (let coordinate = 0; coordinate < size; coordinate++) {
      const weight =
        (eigenvector[coordinate] as number) *
        (inverseRootMass[coordinate] as number);
      if (weight === 0) continue;
      const base = coordinate * 9;
      for (let component = 0; component < 9; component++) {
        tensor[component] =
          (tensor[component] as number) +
          weight * (gradient[base + component] as number);
      }
    }
    const invariants = ramanInvariants(tensor);
    activities[mode] = {
      activity: ramanActivity(invariants),
      depolarizationRatio: depolarizationRatio(invariants),
    };
  }

  return activities;
}
