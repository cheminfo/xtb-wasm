import type { Geometry } from '../../types/index.ts';

import { aseLegacyBonds } from './connectivity.ts';
import {
  DEFAULT_FINITE_DIFFERENCE_STEP,
  finiteDifferenceGradient,
} from './finiteDifference.ts';
import { polarizabilityGradient } from './gradient.ts';
import { SUPPORTED_ELEMENTS } from './parameters.ts';
import type { RamanActivity } from './placzek.ts';
import { placzekActivities } from './placzek.ts';

/** How the bond list and the polarizability derivative are obtained. */
export interface RamanOptions {
  /**
   * Bond list as atom-index pairs. Required for `'graph'` connectivity.
   * @default undefined
   */
  bonds?: ReadonlyArray<readonly [number, number]>;
  /**
   * `'graph'` sums the model over the molecule's real bonds. `'ase-legacy'`
   * reproduces ASE's distance rule, which counts non-bonded contacts as bonds
   * — all six Cl···Cl pairs of CCl₄, eight "bonds" in CBrClFI where the
   * structure has four — and is offered only to compare against results
   * computed with ASE.
   * @default 'graph'
   */
  connectivity?: 'graph' | 'ase-legacy';
  /**
   * `'analytic'` differentiates the model in closed form: exact, far cheaper,
   * and immune to the neighbour-list flicker of the legacy rule.
   * `'finite-difference'` is ASE's central difference.
   * @default 'analytic'
   */
  derivative?: 'analytic' | 'finite-difference';
  /**
   * Central-difference step in Å, used only by `'finite-difference'`.
   * @default 0.01
   */
  step?: number;
}

/** Which elements of a molecule the Lippincott–Stutman tables cover. */
export interface RamanSupport {
  /** True when every element has both model parameters. */
  supported: boolean;
  /** The distinct elements that do not, in order of first appearance. */
  unsupported: string[];
}

/**
 * Raman scattering activities and depolarization ratios of a set of normal
 * modes, in the Placzek static approximation over the Lippincott–Stutman
 * bond-polarizability model. The model is purely geometric — no wavefunction is
 * involved — so this costs nothing measurable on top of the Hessian.
 * @param geometry - Elements and Cartesian coordinates in Å.
 * @param modes - One entry per mode, each carrying the mass-weighted unit-norm
 * eigenvector of the projected Hessian, length `3·atoms`. It is the vector the
 * engine returns unscaled, normalized so `Σᵢ eigenvectorᵢ² = 1`, equivalently
 * `Σᵢ mᵢ·(eigenvectorᵢ/√mᵢ)² = 1`; this function divides by `√m` internally to
 * recover the Cartesian displacement ASE calls `im_r · modes_Qq`.
 * @param masses - Atomic masses in amu, one per atom, needed for exactly that
 * division. Use the same table the Hessian was built with.
 * @param options - Connectivity and derivative choices.
 * @returns One entry per input mode, in the same order.
 * @throws When an element is outside `SUPPORTED_ELEMENTS`, when `'graph'`
 * connectivity is requested without a bond list, when a bond index does not
 * address an atom of the geometry, when a mass is not positive, or when
 * `masses` and the modes disagree with the geometry about the atom count.
 */
export function ramanActivities(
  geometry: Geometry,
  modes: ReadonlyArray<{ eigenvector: Float64Array }>,
  masses: Float64Array,
  options: RamanOptions = {},
): RamanActivity[] {
  const {
    connectivity = 'graph',
    derivative = 'analytic',
    step = DEFAULT_FINITE_DIFFERENCE_STEP,
  } = options;

  const support = ramanSupport(geometry.elements);
  if (!support.supported) {
    throw new Error(
      `the Lippincott-Stutman tables do not cover ${support.unsupported.join(', ')}`,
    );
  }
  if (masses.length !== geometry.elements.length) {
    throw new Error(
      `${masses.length} masses for ${geometry.elements.length} atoms`,
    );
  }

  const bonds = resolveBonds(geometry, connectivity, options.bonds);
  const gradient =
    derivative === 'analytic'
      ? polarizabilityGradient(geometry, bonds)
      : finiteDifferenceGradient(
          geometry,
          connectivity === 'ase-legacy' ? null : bonds,
          step,
        );
  return placzekActivities(gradient, modes, masses);
}

/**
 * Whether the model can treat a molecule at all, so a caller can hide the Raman
 * output instead of throwing.
 * @param elements - Element symbols, one per atom. Duplicates are fine.
 * @returns Support flag plus the distinct elements that are missing.
 */
export function ramanSupport(elements: readonly string[]): RamanSupport {
  const missing = new Set<string>();
  for (const element of elements) {
    if (!SUPPORTED_ELEMENT_SET.has(element)) missing.add(element);
  }
  const unsupported = [...missing];
  return { supported: unsupported.length === 0, unsupported };
}

/** Membership form of {@link SUPPORTED_ELEMENTS}, for the per-atom scan. */
const SUPPORTED_ELEMENT_SET = new Set(SUPPORTED_ELEMENTS);

/**
 * The legacy rule rebuilds its list from coordinates, so it needs no caller
 * input; the graph path has no fallback, because guessing a bond list would be
 * the very behaviour `'ase-legacy'` exists to isolate.
 */
function resolveBonds(
  geometry: Geometry,
  connectivity: 'graph' | 'ase-legacy',
  bonds: ReadonlyArray<readonly [number, number]> | undefined,
): ReadonlyArray<readonly [number, number]> {
  if (connectivity === 'ase-legacy') return aseLegacyBonds(geometry);
  if (bonds === undefined) {
    throw new Error("'graph' connectivity requires a bond list");
  }
  return bonds;
}

export {
  aseLegacyBonds,
  compareConnectivity,
  legacyCutoffs,
} from './connectivity.ts';
export type { ConnectivityComparison } from './connectivity.ts';
export { ASE_COVALENT_RADIUS, LEGACY_RADII_CUTOFF } from './covalentRadii.ts';
export {
  DEFAULT_FINITE_DIFFERENCE_STEP,
  finiteDifferenceGradient,
} from './finiteDifference.ts';
export { polarizabilityGradient } from './gradient.ts';
export { bondPolarizabilityComponents } from './lippincottStuttman.ts';
export type { BondComponents } from './lippincottStuttman.ts';
export {
  ATOMIC_POLARIZABILITY,
  REDUCED_ELECTRONEGATIVITY,
  SUPPORTED_ELEMENTS,
} from './parameters.ts';
export { placzekActivities } from './placzek.ts';
export type { RamanActivity } from './placzek.ts';
export {
  depolarizationRatio,
  ramanActivity,
  ramanInvariants,
} from './invariants.ts';
export type { RamanInvariants } from './invariants.ts';
export {
  E2_ANGSTROM2_PER_EV_PER_ANGSTROM3,
  bondPolarizability,
  fillBondTensor,
  fillLegacyTensor,
} from './tensor.ts';
