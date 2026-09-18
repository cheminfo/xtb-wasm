import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Geometry } from '../../../types/index.ts';

/** `BondPolarizability` on a fixed bond list, in Å³. */
export interface AlphaCase {
  name: string;
  elements: string[];
  coordinates: number[];
  bonds: Array<[number, number]>;
  alphaA3: number[];
  /** Whether upstream ASE's ten-element table covers the molecule. */
  aseTableSupported: boolean;
}

/** ASE's central-difference `∂α/∂R` in Å², one row of 9 per Cartesian coordinate. */
export interface GradientCase {
  name: string;
  elements: string[];
  coordinates: number[];
  nBonds: number;
  alphaA3: number[];
  dAlphaDxA2: number[][];
}

/** `PlaczekStatic.get_absolute_intensities()` in Å⁴/amu, one value per mode. */
export interface IntensityCase {
  name: string;
  elements: string[];
  coordinates: number[];
  masses: number[];
  delta: number;
  /** Cartesian displacements `L/√m`, one row of `3·atoms` per mode. */
  modes: number[][];
  activitiesA4PerAmu: number[];
}

/** Agreement between a computed vector and its reference. */
export interface Agreement {
  /**
   * Largest absolute error divided by the largest reference magnitude. This is
   * the metric to judge a tensor or a spectrum by: a per-element relative error
   * is meaningless on a component that is zero by symmetry, where the two
   * implementations differ only in their summation order.
   */
  maxNormalized: number;
  /**
   * Largest relative error over the entries above `1e-6` of the largest
   * reference magnitude.
   */
  relative: number;
  /** The largest reference magnitude the two metrics are scaled by. */
  scale: number;
}

const reference = JSON.parse(
  readFileSync(join(import.meta.dirname, 'data/aseReference.json')).toString(),
) as {
  about: string;
  alphaCases: AlphaCase[];
  gradientCases: GradientCase[];
  intensityCases: IntensityCase[];
};

/**
 * ASE 3.29.0 reference values, produced with the extended Lippincott–Stutman
 * table of kjappelbaum/ase@polarizability, the same table `parameters.ts`
 * carries.
 * @returns The three reference case lists.
 */
export function aseReference() {
  return reference;
}

/**
 * How closely a computed vector reproduces a reference one, under both a
 * max-normalized and a large-entries-only relative metric.
 * @param expected - Reference values.
 * @param actual - Computed values, same length and order.
 * @returns Both metrics plus the scale they use.
 */
export function agreement(
  expected: readonly number[] | Float64Array,
  actual: ArrayLike<number>,
): Agreement {
  let scale = 0;
  for (const value of expected) {
    const magnitude = Math.abs(value);
    if (magnitude > scale) scale = magnitude;
  }
  let maxNormalized = 0;
  let relative = 0;
  for (let index = 0; index < expected.length; index++) {
    const target = expected[index] as number;
    const error = Math.abs((actual[index] as number) - target);
    const normalized = error / scale;
    if (normalized > maxNormalized) maxNormalized = normalized;
    if (Math.abs(target) > 1e-6 * scale) {
      const ratio = error / Math.abs(target);
      if (ratio > relative) relative = ratio;
    }
  }
  return { maxNormalized, relative, scale };
}

/**
 * The geometry of a reference case, with coordinates in a typed array.
 * @param testCase - Any reference case.
 * @returns Elements and Cartesian coordinates in Å.
 */
export function caseGeometry(testCase: {
  elements: string[];
  coordinates: number[];
}): Geometry {
  return {
    elements: testCase.elements,
    coordinates: new Float64Array(testCase.coordinates),
  };
}

/**
 * Rebuilds the mass-weighted eigenvectors `ramanActivities` expects from the
 * reference's Cartesian displacements `w = L/√m`, so the test exercises the
 * documented input convention rather than ASE's internal one.
 * @param testCase - An intensity case.
 * @returns One mode per reference row, each with `eigenvectorᵢ = wᵢ·√mᵢ`.
 */
export function caseModes(
  testCase: IntensityCase,
): Array<{ eigenvector: Float64Array }> {
  const rootMass = new Float64Array(testCase.masses.length * 3);
  for (let atom = 0; atom < testCase.masses.length; atom++) {
    const root = Math.sqrt(testCase.masses[atom] as number);
    rootMass[atom * 3] = root;
    rootMass[atom * 3 + 1] = root;
    rootMass[atom * 3 + 2] = root;
  }
  const modes = new Array<{ eigenvector: Float64Array }>(testCase.modes.length);
  for (let mode = 0; mode < testCase.modes.length; mode++) {
    const displacement = testCase.modes[mode] as number[];
    const eigenvector = new Float64Array(displacement.length);
    for (let index = 0; index < displacement.length; index++) {
      eigenvector[index] =
        (displacement[index] as number) * (rootMass[index] as number);
    }
    modes[mode] = { eigenvector };
  }
  return modes;
}

/**
 * An idealized tetrahedral XY₄ / CXYZW geometry, used to show what the legacy
 * distance rule invents on a molecule whose ligands are large.
 * @param center - Central atom symbol.
 * @param ligands - The four ligand symbols.
 * @param lengths - The four bond lengths in Å, in the same order.
 * @returns Elements and Cartesian coordinates in Å, the centre at the origin.
 */
export function tetrahedral(
  center: string,
  ligands: readonly string[],
  lengths: readonly number[],
): Geometry {
  const directions = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ];
  const elements = [center, ...ligands];
  const coordinates = new Float64Array(elements.length * 3);
  for (let ligand = 0; ligand < ligands.length; ligand++) {
    const component = (lengths[ligand] as number) / Math.sqrt(3);
    const direction = directions[ligand] as number[];
    for (let axis = 0; axis < 3; axis++) {
      coordinates[(ligand + 1) * 3 + axis] =
        component * (direction[axis] as number);
    }
  }
  return { elements, coordinates };
}
