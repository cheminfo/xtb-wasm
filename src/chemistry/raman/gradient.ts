import type { Geometry } from '../../types/index.ts';

import { squaredLength, validateBondIndices } from './bondGeometry.ts';
import { bondPolarizabilityComponents } from './lippincottStuttman.ts';

/**
 * Analytic Cartesian derivative of the bond-polarizability tensor.
 *
 * With `r = R_j − R_i`, `d = |r|`, `u = r/d`, one bond contributes
 * `α = α⊥·I + (α∥ − α⊥)·u uᵀ`. Only `α∥ = σ d⁴ / (256 α₁ α₂)^(1/6)` carries a
 * length, so `∂α∥/∂d = 4 α∥/d` and `∂α⊥/∂d = 0`. With `∂d/∂R_j,k = u_k` and
 * `∂u_p/∂R_j,k = (δ_pk − u_p u_k)/d` that gives
 *
 * `∂α_pq/∂R_j,k = (4α∥/d)·u_k u_p u_q + (α∥ − α⊥)·(δ_pk u_q + δ_qk u_p − 2 u_p u_q u_k)/d`
 *
 * and the derivative with respect to `R_i,k` is its negative, because the
 * contribution depends on the two positions only through their difference.
 * @param geometry - Elements and Cartesian coordinates in Å.
 * @param bonds - Atom-index pairs the tensor is summed over, held fixed.
 * @returns `∂α/∂R` in Å², flat and row-major: entry `[r·9 + p·3 + q]` is
 * `∂α_pq/∂x_r` for the `3·atoms` Cartesian coordinates `r`.
 * @throws When an element is outside `SUPPORTED_ELEMENTS`, or a bond index does
 * not address an atom of the geometry.
 */
export function polarizabilityGradient(
  geometry: Geometry,
  bonds: ReadonlyArray<readonly [number, number]>,
): Float64Array {
  const { elements, coordinates } = geometry;
  validateBondIndices(bonds, elements.length);
  const gradient = new Float64Array(elements.length * 27);
  const unit = new Float64Array(3);

  for (const pair of bonds) {
    const first = pair[0];
    const second = pair[1];
    const x =
      (coordinates[second * 3] as number) - (coordinates[first * 3] as number);
    const y =
      (coordinates[second * 3 + 1] as number) -
      (coordinates[first * 3 + 1] as number);
    const z =
      (coordinates[second * 3 + 2] as number) -
      (coordinates[first * 3 + 2] as number);
    const distance = Math.sqrt(squaredLength(x, y, z));
    const { parallel, perpendicular } = bondPolarizabilityComponents(
      elements[first] as string,
      elements[second] as string,
      distance,
    );

    unit[0] = x / distance;
    unit[1] = y / distance;
    unit[2] = z / distance;
    const parallelSlope = (4 * parallel) / distance;
    const anisotropySlope = (parallel - perpendicular) / distance;

    for (let axis = 0; axis < 3; axis++) {
      const unitAxis = unit[axis] as number;
      const secondBase = (second * 3 + axis) * 9;
      const firstBase = (first * 3 + axis) * 9;
      for (let row = 0; row < 3; row++) {
        const unitRow = unit[row] as number;
        for (let column = 0; column < 3; column++) {
          const unitColumn = unit[column] as number;
          const product = unitRow * unitColumn;
          const value =
            parallelSlope * unitAxis * product +
            anisotropySlope *
              ((row === axis ? unitColumn : 0) +
                (column === axis ? unitRow : 0) -
                2 * product * unitAxis);
          // `(atom·3 + axis)·9 + row·3 + column` with `atom` one of the bond's
          // two members is inside the `27·atoms` allocation by construction,
          // so the assertion states what the allocation already guarantees.
          const offset = row * 3 + column;
          const secondIndex = secondBase + offset;
          const firstIndex = firstBase + offset;
          gradient[secondIndex] = (gradient[secondIndex] as number) + value;
          gradient[firstIndex] = (gradient[firstIndex] as number) - value;
        }
      }
    }
  }

  return gradient;
}
