import type { Geometry } from '../../types/index.ts';

import { squaredLength } from './bondGeometry.ts';
import { ASE_COVALENT_RADIUS, LEGACY_RADII_CUTOFF } from './covalentRadii.ts';

/** How a caller's bond list and ASE's neighbour-list rule differ. */
export interface ConnectivityComparison {
  /** Pairs the legacy rule invents that the real bond list does not contain. */
  extraBonds: Array<[number, number]>;
  /** Real bonds the legacy rule fails to find. */
  missingBonds: Array<[number, number]>;
  /** True when the two lists are the same set of pairs. */
  agree: boolean;
}

/**
 * The bond list ASE's `BondPolarizability` builds: every pair closer than
 * `LEGACY_RADII_CUTOFF · (rᵢ + rⱼ)`. It is a distance rule, not a chemical one,
 * so it counts non-bonded contacts as bonds — all six Cl···Cl pairs of CCl₄,
 * and eight "bonds" in CBrClFI where the structure has four. Reproduced here
 * only so a calculation can be compared bit for bit with ASE's.
 * @param geometry - Elements and Cartesian coordinates in Å.
 * @returns Pairs `[i, j]` with `i < j`, ascending.
 * @throws When an element has no covalent radius in the ASE table.
 */
export function aseLegacyBonds(geometry: Geometry): Array<[number, number]> {
  const { elements, coordinates } = geometry;
  const cutoffs = legacyCutoffs(elements);
  const bonds: Array<[number, number]> = [];
  for (let first = 0; first < elements.length; first++) {
    const x1 = coordinates[first * 3] as number;
    const y1 = coordinates[first * 3 + 1] as number;
    const z1 = coordinates[first * 3 + 2] as number;
    const cutoff1 = cutoffs[first] as number;
    for (let second = first + 1; second < elements.length; second++) {
      const x = (coordinates[second * 3] as number) - x1;
      const y = (coordinates[second * 3 + 1] as number) - y1;
      const z = (coordinates[second * 3 + 2] as number) - z1;
      const distance = Math.sqrt(squaredLength(x, y, z));
      if (distance < cutoff1 + (cutoffs[second] as number)) {
        bonds.push([first, second]);
      }
    }
  }
  return bonds;
}

/**
 * Per-atom neighbour-list radius, `LEGACY_RADII_CUTOFF · r`, in Å. A pair is
 * bonded under the legacy rule when its distance is below the sum of two of
 * these.
 * @param elements - Element symbols, one per atom.
 * @returns One cutoff per atom.
 * @throws When an element has no covalent radius in the ASE table.
 */
export function legacyCutoffs(elements: readonly string[]): Float64Array {
  const cutoffs = new Float64Array(elements.length);
  for (let atom = 0; atom < elements.length; atom++) {
    const element = elements[atom] as string;
    const radius = ASE_COVALENT_RADIUS[element];
    if (radius === undefined) {
      throw new Error(`no ASE covalent radius for the element ${element}`);
    }
    cutoffs[atom] = LEGACY_RADII_CUTOFF * radius;
  }
  return cutoffs;
}

/**
 * Where the legacy distance rule and a real bond list disagree, so the UI can
 * warn before showing a spectrum computed the old way.
 * @param geometry - Elements and Cartesian coordinates in Å.
 * @param bonds - The real bond list, as atom-index pairs in any order.
 * @returns The two symmetric differences and whether they are both empty.
 * @throws When an element has no covalent radius in the ASE table.
 */
export function compareConnectivity(
  geometry: Geometry,
  bonds: ReadonlyArray<readonly [number, number]>,
): ConnectivityComparison {
  const graph = new Set<number>();
  const atomCount = geometry.elements.length;
  for (const pair of bonds) {
    graph.add(pairKey(pair[0], pair[1], atomCount));
  }

  const legacy = aseLegacyBonds(geometry);
  const legacyKeys = new Set<number>();
  const extraBonds: Array<[number, number]> = [];
  for (const pair of legacy) {
    const key = pairKey(pair[0], pair[1], atomCount);
    legacyKeys.add(key);
    if (!graph.has(key)) extraBonds.push(pair);
  }

  const missingBonds: Array<[number, number]> = [];
  for (const pair of bonds) {
    const low = Math.min(pair[0], pair[1]);
    const high = Math.max(pair[0], pair[1]);
    if (!legacyKeys.has(pairKey(low, high, atomCount))) {
      missingBonds.push([low, high]);
    }
  }

  return {
    extraBonds,
    missingBonds,
    agree: extraBonds.length === 0 && missingBonds.length === 0,
  };
}

function pairKey(first: number, second: number, atomCount: number): number {
  const low = Math.min(first, second);
  const high = Math.max(first, second);
  return low * atomCount + high;
}
