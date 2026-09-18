import {
  ATOMIC_POLARIZABILITY,
  REDUCED_ELECTRONEGATIVITY,
} from './parameters.ts';

/** The two principal components of a single bond's polarizability, in Å³. */
export interface BondComponents {
  /** Component along the bond axis, α∥. Grows as the fourth power of length. */
  parallel: number;
  /**
   * Component across the bond axis, α⊥. It depends only on the two elements,
   * never on the bond length, which is why the analytic derivative below has a
   * single term and why this model cannot polarize a symmetric stretch.
   */
  perpendicular: number;
}

/**
 * Lippincott–Stutman bond polarizability: the parallel and perpendicular
 * components of one bond's contribution to the molecular polarizability.
 * @param element1 - Symbol of the first atom.
 * @param element2 - Symbol of the second atom.
 * @param distance - Bond length in Å.
 * @returns Both components in Å³.
 * @throws When either element is outside `SUPPORTED_ELEMENTS`.
 */
export function bondPolarizabilityComponents(
  element1: string,
  element2: string,
  distance: number,
): BondComponents {
  const polarizability1 = ATOMIC_POLARIZABILITY[element1];
  const polarizability2 = ATOMIC_POLARIZABILITY[element2];
  const electronegativity1 = REDUCED_ELECTRONEGATIVITY[element1];
  const electronegativity2 = REDUCED_ELECTRONEGATIVITY[element2];
  if (polarizability1 === undefined || electronegativity1 === undefined) {
    throw unsupportedBond(element1, element2);
  }
  if (polarizability2 === undefined || electronegativity2 === undefined) {
    throw unsupportedBond(element1, element2);
  }

  const electronegativityGap = electronegativity1 - electronegativity2;
  const sigma =
    element1 === element2
      ? 1
      : Math.exp((-electronegativityGap * electronegativityGap) / 4);

  const squared = distance * distance;
  const parallel =
    (sigma * squared * squared) /
    Math.cbrt(Math.sqrt(256 * polarizability1 * polarizability2));

  const weight1 = electronegativity1 * electronegativity1;
  const weight2 = electronegativity2 * electronegativity2;
  const perpendicular =
    (weight1 * polarizability1 + weight2 * polarizability2) /
    (weight1 + weight2);

  return { parallel, perpendicular };
}

function unsupportedBond(element1: string, element2: string): Error {
  return new Error(
    `no Lippincott-Stutman parameters for the bond ${element1}-${element2}`,
  );
}
