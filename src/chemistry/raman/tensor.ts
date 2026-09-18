import type { Geometry } from '../../types/index.ts';
import { ANGSTROM_PER_BOHR, HARTREE_EV } from '../constants.ts';

import { squaredLength, validateBondIndices } from './bondGeometry.ts';
import { bondPolarizabilityComponents } from './lippincottStuttman.ts';

/**
 * Factor turning a polarizability in Å³ into ASE's `e²Å²/eV`, i.e. `1/(a₀·Eh)`
 * with `a₀` in Å and `Eh` in eV. ASE's `BondPolarizability.__call__` returns
 * the tensor scaled by this factor and `PlaczekStatic.electronic_me_Qcc`
 * multiplies it straight back out, so it cancels exactly in the derivative;
 * this module therefore works in Å³ throughout and exposes the factor for a
 * consumer that wants ASE's unit.
 */
export const E2_ANGSTROM2_PER_EV_PER_ANGSTROM3 =
  1 / (ANGSTROM_PER_BOHR * HARTREE_EV);

/**
 * Bond-polarizability tensor of a geometry, summed over a given bond list.
 * @param geometry - Elements and Cartesian coordinates in Å.
 * @param bonds - Atom-index pairs to sum over. Each pair counts once.
 * @returns The symmetric 3×3 tensor in Å³, row-major, 9 elements.
 * @throws When an element is outside `SUPPORTED_ELEMENTS`, or a bond index does
 * not address an atom of the geometry.
 */
export function bondPolarizability(
  geometry: Geometry,
  bonds: ReadonlyArray<readonly [number, number]>,
): Float64Array {
  validateBondIndices(bonds, geometry.elements.length);
  const tensor = new Float64Array(9);
  fillBondTensor(tensor, geometry.elements, geometry.coordinates, bonds);
  return tensor;
}

/**
 * Writes the bond-polarizability tensor of a fixed bond list into an existing
 * array, so a finite-difference sweep can reuse one buffer for every
 * displacement.
 * @param target - Row-major 3×3 destination in Å³, 9 elements, overwritten.
 * @param elements - Element symbols, one per atom.
 * @param coordinates - Flat Cartesian coordinates in Å.
 * @param bonds - Atom-index pairs to sum over.
 * @throws When an element is outside `SUPPORTED_ELEMENTS`.
 */
export function fillBondTensor(
  target: Float64Array,
  elements: readonly string[],
  coordinates: Float64Array,
  bonds: ReadonlyArray<readonly [number, number]>,
): void {
  const sums = zeroSums();
  for (const pair of bonds) {
    addBond(sums, elements, coordinates, pair[0], pair[1]);
  }
  writeTensor(target, sums);
}

/**
 * Writes the bond-polarizability tensor of every pair inside ASE's radii
 * cutoff, rebuilding the neighbour list from the coordinates on the spot. This
 * is the shape the legacy finite-difference path needs: ASE rediscovers its
 * bonds at every displaced geometry, so no bond list can be shared between
 * displacements.
 * @param target - Row-major 3×3 destination in Å³, 9 elements, overwritten.
 * @param elements - Element symbols, one per atom.
 * @param coordinates - Flat Cartesian coordinates in Å.
 * @param cutoffs - Per-atom `LEGACY_RADII_CUTOFF · r`, in Å.
 * @throws When an element is outside `SUPPORTED_ELEMENTS`.
 */
export function fillLegacyTensor(
  target: Float64Array,
  elements: readonly string[],
  coordinates: Float64Array,
  cutoffs: Float64Array,
): void {
  const sums = zeroSums();
  const atomCount = cutoffs.length;
  for (let first = 0; first < atomCount; first++) {
    const x1 = coordinates[first * 3] as number;
    const y1 = coordinates[first * 3 + 1] as number;
    const z1 = coordinates[first * 3 + 2] as number;
    const cutoff1 = cutoffs[first] as number;
    for (let second = first + 1; second < atomCount; second++) {
      const x = (coordinates[second * 3] as number) - x1;
      const y = (coordinates[second * 3 + 1] as number) - y1;
      const z = (coordinates[second * 3 + 2] as number) - z1;
      const squared = squaredLength(x, y, z);
      const distance = Math.sqrt(squared);
      if (distance >= cutoff1 + (cutoffs[second] as number)) continue;
      addBond(sums, elements, coordinates, first, second);
    }
  }
  writeTensor(target, sums);
}

/**
 * The six independent components of a symmetric 3×3 tensor, accumulated as
 * plain numbers so the bond loop never reads back from a typed array.
 */
interface TensorSums {
  xx: number;
  yy: number;
  zz: number;
  xy: number;
  xz: number;
  yz: number;
}

function zeroSums(): TensorSums {
  return { xx: 0, yy: 0, zz: 0, xy: 0, xz: 0, yz: 0 };
}

/**
 * ASE's accumulation, term for term: an isotropic part on the diagonal plus an
 * anisotropic part along the bond axis. The `dₚdq/d²` form rather than a
 * pre-normalized unit vector is kept because it is what
 * `BondPolarizability.__call__` evaluates, and the two differ in the last bits.
 */
function addBond(
  sums: TensorSums,
  elements: readonly string[],
  coordinates: Float64Array,
  first: number,
  second: number,
): void {
  const x =
    (coordinates[second * 3] as number) - (coordinates[first * 3] as number);
  const y =
    (coordinates[second * 3 + 1] as number) -
    (coordinates[first * 3 + 1] as number);
  const z =
    (coordinates[second * 3 + 2] as number) -
    (coordinates[first * 3 + 2] as number);
  // The squared length is needed by every off-diagonal term anyway, so it is
  // computed once rather than recovered from the distance.
  const squared = squaredLength(x, y, z);
  const distance = Math.sqrt(squared);
  const { parallel, perpendicular } = bondPolarizabilityComponents(
    elements[first] as string,
    elements[second] as string,
    distance,
  );

  const isotropic = (parallel + 2 * perpendicular) / 3;
  const anisotropy = parallel - perpendicular;
  const third = 1 / 3;
  sums.xx += isotropic + anisotropy * ((x * x) / squared - third);
  sums.yy += isotropic + anisotropy * ((y * y) / squared - third);
  sums.zz += isotropic + anisotropy * ((z * z) / squared - third);
  sums.xy += anisotropy * ((x * y) / squared);
  sums.xz += anisotropy * ((x * z) / squared);
  sums.yz += anisotropy * ((y * z) / squared);
}

function writeTensor(target: Float64Array, sums: TensorSums): void {
  target[0] = sums.xx;
  target[1] = sums.xy;
  target[2] = sums.xz;
  target[3] = sums.xy;
  target[4] = sums.yy;
  target[5] = sums.yz;
  target[6] = sums.xz;
  target[7] = sums.yz;
  target[8] = sums.zz;
}
