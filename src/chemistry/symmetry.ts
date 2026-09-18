/**
 * Rotational symmetry numbers.
 *
 * σ enters the rotational entropy as −R·ln σ, so it is a silent error in ΔG
 * rather than a cosmetic label: benzene at σ = 1 instead of 12 is 1.5 kcal/mol
 * out at room temperature. The point group itself comes from the engine (occ's
 * `MolecularPointGroup`); this module only resolves it into the σ that is
 * actually used, and repairs the one misassignment that has been measured.
 */

import type { Geometry } from '../types/index.ts';

import { principalMoments } from './thermo/inertia.ts';

export { principalMoments } from './thermo/inertia.ts';

/** A point group as reported by the engine, with the σ it implies. */
export interface DetectedSymmetry {
  /** Schoenflies label for display, e.g. `D6h`, `Cs`, `Dooh`. */
  pointGroup: string;
  /** Rotational symmetry number the engine derived from that group. */
  symmetryNumber: number;
}

/** The symmetry that was actually used, once the XY₄ guard has had its say. */
export interface ResolvedSymmetry extends DetectedSymmetry {
  /** True when the XY4 guard overrode the detected value. */
  corrected: boolean;
}

/**
 * Relative agreement of the three principal moments below which a five-atom
 * XY₄ cage counts as a spherical top. Loose enough for a numerically optimized
 * geometry, tight enough that a substituted or distorted XY₃Z never qualifies.
 */
const SPHERICAL_TOP_TOLERANCE = 1e-3;

/**
 * Resolve the σ to use from the point group the engine detected.
 *
 * occ misassigns the five-atom XY₄ cage — CH₄, CF₄, SiH₄, CCl₄ — as D2 with
 * σ = 4 where it is T_d with σ = 12, which is 0.65 kcal/mol of G at 298 K.
 * Larger tetrahedral and octahedral systems come back correct, so the
 * correction is gated on that exact shape: five atoms, one central element
 * with four identical ligands, and three equal principal moments.
 * @param geometry - Element symbols and Cartesian coordinates in Angstrom.
 * @param masses - Atomic masses in amu, one per atom.
 * @param detected - Point group and σ as the engine reported them.
 * @returns The σ and label to use, flagged when they were overridden.
 */
export function resolveSymmetry(
  geometry: Geometry,
  masses: Float64Array,
  detected: DetectedSymmetry,
): ResolvedSymmetry {
  if (detected.symmetryNumber === 12) {
    return { ...detected, corrected: false };
  }
  if (!isTetrahedralXY4(geometry, masses)) {
    return { ...detected, corrected: false };
  }
  return { pointGroup: 'Td', symmetryNumber: 12, corrected: true };
}

/**
 * Whether a geometry is a five-atom XY₄ spherical top.
 * @param geometry - Element symbols and Cartesian coordinates in Angstrom.
 * @param masses - Atomic masses in amu, one per atom.
 * @returns True for the exact shape occ is known to misassign.
 */
function isTetrahedralXY4(geometry: Geometry, masses: Float64Array): boolean {
  const { elements } = geometry;
  if (elements.length !== 5) return false;

  const counts = new Map<string, number>();
  for (let atom = 0; atom < 5; atom++) {
    const element = elements[atom] as string;
    counts.set(element, (counts.get(element) ?? 0) + 1);
  }
  if (counts.size !== 2) return false;
  let hasCentre = false;
  let hasLigands = false;
  for (const count of counts.values()) {
    if (count === 1) hasCentre = true;
    if (count === 4) hasLigands = true;
  }
  if (!hasCentre || !hasLigands) return false;

  const moments = principalMoments(geometry, masses);
  const largest = moments[2] as number;
  if (largest <= 0) return false;
  return (
    largest - (moments[0] as number) <= SPHERICAL_TOP_TOLERANCE * largest &&
    largest - (moments[1] as number) <= SPHERICAL_TOP_TOLERANCE * largest
  );
}
