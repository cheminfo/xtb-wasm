/**
 * Moments of inertia and the rotor classification xtb performs before its
 * thermochemistry block.
 *
 * Two different inertia tensors are involved and they are not
 * interchangeable. `axis2` builds the mass-weighted tensor in amu·Å² and zeroes
 * any principal moment below 3·10⁻⁴, which is what feeds the rotational
 * partition function and the average moment. `is_linear` builds a separate
 * UNIT-mass tensor in Bohr² and calls the rotor linear when any of its moments
 * falls below 10⁻⁴. Mixing the two is how a slightly bent molecule ends up with
 * a zeroed moment in a non-linear branch, and an infinite free energy.
 */

import type { Geometry } from '../../types/index.ts';
import { AMU_KG, ANGSTROM_PER_BOHR } from '../constants.ts';

import { symmetricEigenvalues3 } from './eigen3.ts';

/** amu·Å² below which xtb's `axis2` sets a principal moment to exactly zero. */
const MOMENT_ZERO_THRESHOLD = 3e-4;
/** Bohr² below which xtb's unit-mass `is_linear` test calls a rotor linear. */
const LINEAR_MOMENT_THRESHOLD = 1e-4;

/** The rotor as xtb sees it, in the units its thermochemistry works in. */
export interface InertiaAnalysis {
  /** Sum of the atomic masses, amu. */
  totalMass: number;
  /** Principal moments in amu·Å², ascending, with tiny values set to zero. */
  moments: Float64Array;
  /** Mean of the three (zeroed) principal moments, kg·m² — xtb's `avmom`. */
  averageMoment: number;
  /** True when every principal moment vanished, i.e. a single atom. */
  isAtom: boolean;
  /** True when at least one principal moment was set to zero. */
  hasZeroedMoment: boolean;
}

/**
 * Principal moments of inertia about the centre of mass.
 * @param geometry - Element symbols and Cartesian coordinates in Angstrom.
 * @param masses - Atomic masses in amu, one per atom.
 * @returns The three principal moments in amu·Å², ascending.
 */
export function principalMoments(
  geometry: Geometry,
  masses: Float64Array,
): Float64Array {
  const { coordinates, elements } = geometry;
  const atomCount = elements.length;
  if (masses.length !== atomCount) {
    throw new RangeError(
      `expected ${atomCount} masses but received ${masses.length}`,
    );
  }
  if (coordinates.length !== 3 * atomCount) {
    throw new RangeError(
      `expected ${3 * atomCount} coordinates but received ${coordinates.length}`,
    );
  }
  return momentsOfInertia(coordinates, atomCount, masses);
}

/**
 * Classify the rotor the way xtb's `axis2` does.
 * @param geometry - Element symbols and Cartesian coordinates in Angstrom.
 * @param masses - Atomic masses in amu, one per atom.
 * @returns The zeroed principal moments, the total mass and the average moment.
 */
export function inertiaAnalysis(
  geometry: Geometry,
  masses: Float64Array,
): InertiaAnalysis {
  const moments = principalMoments(geometry, masses);

  let hasZeroedMoment = false;
  let zeroedCount = 0;
  for (let index = 0; index < 3; index++) {
    if ((moments[index] as number) < MOMENT_ZERO_THRESHOLD) {
      moments[index] = 0;
      hasZeroedMoment = true;
      zeroedCount++;
    }
  }

  const atomCount = geometry.elements.length;
  let totalMass = 0;
  for (let atom = 0; atom < atomCount; atom++) {
    totalMass += masses[atom] as number;
  }

  const momentSum =
    (moments[0] as number) + (moments[1] as number) + (moments[2] as number);

  return {
    totalMass,
    moments,
    averageMoment: ((momentSum / 3) * AMU_KG) / 1e20,
    isAtom: zeroedCount === 3,
    hasZeroedMoment,
  };
}

/**
 * xtb's linearity test: the UNIT-mass inertia tensor in Bohr², linear when any
 * principal moment falls below 10⁻⁴. It deliberately ignores the masses, so it
 * does not move when an isotope does.
 * @param geometry - Element symbols and Cartesian coordinates in Angstrom.
 * @returns True when the rotor is to be treated as linear.
 */
export function isLinearRotor(geometry: Geometry): boolean {
  const atomCount = geometry.elements.length;
  if (atomCount === 1) return true;

  const bohr = new Float64Array(3 * atomCount);
  for (let index = 0; index < bohr.length; index++) {
    bohr[index] = (geometry.coordinates[index] as number) / ANGSTROM_PER_BOHR;
  }
  const unitMasses = new Float64Array(atomCount).fill(1);
  const moments = momentsOfInertia(bohr, atomCount, unitMasses);
  for (let index = 0; index < 3; index++) {
    if ((moments[index] as number) < LINEAR_MOMENT_THRESHOLD) return true;
  }
  return false;
}

/**
 * Eigenvalues of the inertia tensor taken about the mass-weighted centroid.
 * @param coordinates - Flat Cartesian coordinates, any consistent length unit.
 * @param atomCount - Number of atoms.
 * @param masses - Weights, one per atom, in the same unit for every atom.
 * @returns The three principal moments, ascending, in mass·length².
 */
function momentsOfInertia(
  coordinates: Float64Array,
  atomCount: number,
  masses: Float64Array,
): Float64Array {
  let totalMass = 0;
  let centreX = 0;
  let centreY = 0;
  let centreZ = 0;
  for (let atom = 0; atom < atomCount; atom++) {
    const mass = masses[atom] as number;
    totalMass += mass;
    centreX += mass * (coordinates[3 * atom] as number);
    centreY += mass * (coordinates[3 * atom + 1] as number);
    centreZ += mass * (coordinates[3 * atom + 2] as number);
  }
  centreX /= totalMass;
  centreY /= totalMass;
  centreZ /= totalMass;

  let xx = 0;
  let yy = 0;
  let zz = 0;
  let xy = 0;
  let xz = 0;
  let yz = 0;
  for (let atom = 0; atom < atomCount; atom++) {
    const mass = masses[atom] as number;
    const x = (coordinates[3 * atom] as number) - centreX;
    const y = (coordinates[3 * atom + 1] as number) - centreY;
    const z = (coordinates[3 * atom + 2] as number) - centreZ;
    xx += mass * (y * y + z * z);
    yy += mass * (x * x + z * z);
    zz += mass * (x * x + y * y);
    xy -= mass * x * y;
    xz -= mass * x * z;
    yz -= mass * y * z;
  }

  const moments = symmetricEigenvalues3({ xx, yy, zz, xy, xz, yz });
  // A numerically exact zero can come back marginally negative, and a negative
  // moment would poison sqrt(I₁I₂I₃) further down.
  for (let index = 0; index < 3; index++) {
    if ((moments[index] as number) < 0) moments[index] = 0;
  }
  return moments;
}
