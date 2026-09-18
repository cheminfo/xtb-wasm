import type { Geometry } from '../../types/index.ts';

import { validateBondIndices } from './bondGeometry.ts';
import { legacyCutoffs } from './connectivity.ts';
import { fillBondTensor, fillLegacyTensor } from './tensor.ts';

/** Central-difference step ASE's `StaticRamanCalculator` defaults to, in Å. */
export const DEFAULT_FINITE_DIFFERENCE_STEP = 0.01;

/**
 * Central-difference Cartesian derivative of the bond-polarizability tensor,
 * `(α⁺ − α⁻)/(2·step)`, which is exactly what ASE's `PlaczekStatic` builds in
 * `electronic_me_Qcc` once its `Hartree·Bohr` factor has cancelled the
 * `1/(a₀·Eh)` that `BondPolarizability` applied.
 * @param geometry - Elements and Cartesian coordinates in Å.
 * @param bonds - Bond list held fixed at every displacement, or `null` to
 * rebuild ASE's radii-cutoff neighbour list at each displaced geometry. `null`
 * reproduces ASE bit for bit and, with it, the discontinuity a pair sitting
 * within `step` of the cutoff produces.
 * @param step - Central-difference step in Å.
 * @returns `∂α/∂R` in Å², flat and row-major: entry `[r·9 + p·3 + q]` is
 * `∂α_pq/∂x_r` for the `3·atoms` Cartesian coordinates `r`.
 * @throws When `step` is not a positive finite number, when a bond index does
 * not address an atom of the geometry, when an element is outside
 * `SUPPORTED_ELEMENTS`, or when it has no ASE covalent radius and the
 * neighbour list has to be rebuilt.
 */
export function finiteDifferenceGradient(
  geometry: Geometry,
  bonds: ReadonlyArray<readonly [number, number]> | null,
  step: number,
): Float64Array {
  const { elements, coordinates } = geometry;
  // A zero step turns the difference quotient into a silent Infinity that
  // reaches the caller as an empty spectrum rather than as an error.
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error(`the finite-difference step must be positive, got ${step}`);
  }
  if (bonds !== null) validateBondIndices(bonds, elements.length);
  const size = elements.length * 3;
  const gradient = new Float64Array(size * 9);
  const displaced = coordinates.slice();
  const fillTensor = tensorFiller(elements, bonds);
  const plus = new Float64Array(9);
  const minus = new Float64Array(9);
  const inverseInterval = 1 / (2 * step);

  for (let coordinate = 0; coordinate < size; coordinate++) {
    const original = displaced[coordinate] as number;
    displaced[coordinate] = original + step;
    fillTensor(plus, displaced);
    displaced[coordinate] = original - step;
    fillTensor(minus, displaced);
    displaced[coordinate] = original;

    const base = coordinate * 9;
    for (let component = 0; component < 9; component++) {
      gradient[base + component] =
        ((plus[component] as number) - (minus[component] as number)) *
        inverseInterval;
    }
  }

  return gradient;
}

/**
 * Binds the connectivity choice once, so the displacement loop does not branch
 * on it `6·atoms` times.
 */
function tensorFiller(
  elements: readonly string[],
  bonds: ReadonlyArray<readonly [number, number]> | null,
): (target: Float64Array, coordinates: Float64Array) => void {
  if (bonds !== null) {
    return (target, coordinates) =>
      fillBondTensor(target, elements, coordinates, bonds);
  }
  const cutoffs = legacyCutoffs(elements);
  return (target, coordinates) =>
    fillLegacyTensor(target, elements, coordinates, cutoffs);
}
