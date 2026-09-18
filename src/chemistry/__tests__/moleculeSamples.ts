/**
 * Small hand-built geometries the thermochemistry and symmetry tests share.
 *
 * Every mass is the standard atomic weight occ's `Molecule.atomicMasses()`
 * reports, so a test that also runs against the reference fixtures compares
 * like with like.
 */

import type { Geometry } from '../../types/index.ts';

import { buildNeopentane } from './neopentane.ts';

/** Standard atomic weights as occ's `Molecule.atomicMasses()` reports them. */
export const MASS = {
  H: 1.0079400539,
  C: 12.0107002258,
  N: 14.0066995621,
  O: 15.9994001389,
  F: 18.9984001637,
  P: 30.9737606049,
  Cl: 35.452999115,
  Ar: 39.948,
};

/** Neopentane, C(CH₃)₄: a 17-atom spherical top on ideal bond lengths. */
export const NEOPENTANE: MoleculeSample = buildNeopentane(MASS.C, MASS.H);

/** A geometry together with the masses it is to be analysed with. */
export interface MoleculeSample {
  geometry: Geometry;
  masses: Float64Array;
}

/** Water at the geometry stored in the `water` reference fixture. */
export const WATER: MoleculeSample = {
  geometry: {
    elements: ['O', 'H', 'H'],
    coordinates: Float64Array.of(
      1.05347377284625,
      0.02231766828301,
      -0.08370951406423,
      2.012483249174,
      0.0115256287444,
      -0.06904331431321,
      0.75097297797976,
      -0.51693329702741,
      0.64959282837744,
    ),
  },
  masses: Float64Array.of(MASS.O, MASS.H, MASS.H),
};

/** Carbon dioxide, a symmetric linear triatomic, at 1.16 A. */
export const CARBON_DIOXIDE: MoleculeSample = {
  geometry: {
    elements: ['O', 'C', 'O'],
    coordinates: Float64Array.of(0, 0, -1.16, 0, 0, 0, 0, 0, 1.16),
  },
  masses: Float64Array.of(MASS.O, MASS.C, MASS.O),
};

/** Hydrogen cyanide, an unsymmetric linear triatomic. */
export const HYDROGEN_CYANIDE: MoleculeSample = {
  geometry: {
    elements: ['H', 'C', 'N'],
    coordinates: Float64Array.of(0, 0, -1.066, 0, 0, 0, 0, 0, 1.156),
  },
  masses: Float64Array.of(MASS.H, MASS.C, MASS.N),
};

/** A single argon atom. */
export const ARGON: MoleculeSample = {
  geometry: { elements: ['Ar'], coordinates: Float64Array.of(0, 0, 0) },
  masses: Float64Array.of(MASS.Ar),
};

/**
 * A trihydrogen chain bent by 0.01 A at the middle atom. That displacement is
 * chosen to fall between xtb's two thresholds: the unit-mass linearity test
 * (10⁻⁴ Bohr²) says non-linear while the mass-weighted zeroing (3·10⁻⁴ amu·Å²)
 * still zeroes the smallest principal moment.
 */
export const NEARLY_LINEAR_TRIHYDROGEN: MoleculeSample = {
  geometry: {
    elements: ['H', 'H', 'H'],
    coordinates: Float64Array.of(0, 0, -1, 0.01, 0, 0, 0, 0, 1),
  },
  masses: Float64Array.of(MASS.H, MASS.H, MASS.H),
};

/** Methane, the five-atom XY₄ cage occ misassigns as D2. */
export const METHANE = tetrahedralXY4('C', 'H', 1.087);

/** Tetrachloromethane, the same cage with heavy ligands. */
export const TETRACHLOROMETHANE = tetrahedralXY4('C', 'Cl', 1.766);

/** White phosphorus: a bare P₄ tetrahedron with a 2.21 A edge. */
export const TETRAPHOSPHORUS: MoleculeSample = (() => {
  const offset = 2.21 / (2 * Math.SQRT2);
  return {
    geometry: {
      elements: ['P', 'P', 'P', 'P'],
      coordinates: Float64Array.of(
        offset,
        offset,
        offset,
        offset,
        -offset,
        -offset,
        -offset,
        offset,
        -offset,
        -offset,
        -offset,
        offset,
      ),
    },
    masses: Float64Array.of(MASS.P, MASS.P, MASS.P, MASS.P),
  };
})();

/**
 * A regular XY₄ cage with its four ligands on alternating cube corners.
 * @param centre - Element symbol of the central atom.
 * @param ligand - Element symbol of the four identical ligands.
 * @param bondLength - Centre-to-ligand distance in Angstrom.
 * @returns The geometry, central atom first, with its masses.
 */
export function tetrahedralXY4(
  centre: keyof typeof MASS,
  ligand: keyof typeof MASS,
  bondLength: number,
): MoleculeSample {
  const offset = bondLength / Math.sqrt(3);
  return {
    geometry: {
      elements: [centre, ligand, ligand, ligand, ligand],
      coordinates: Float64Array.of(
        0,
        0,
        0,
        offset,
        offset,
        offset,
        offset,
        -offset,
        -offset,
        -offset,
        offset,
        -offset,
        -offset,
        -offset,
        offset,
      ),
    },
    masses: Float64Array.of(
      MASS[centre],
      MASS[ligand],
      MASS[ligand],
      MASS[ligand],
      MASS[ligand],
    ),
  };
}
