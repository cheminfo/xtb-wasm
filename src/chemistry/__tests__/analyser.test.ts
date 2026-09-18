import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import {
  getVibrationalAnalyser,
  setVibrationalAnalyser,
} from '../../engines/occAnalyse.ts';
import type { Geometry, Molecule, VibrationalMode } from '../../types/index.ts';
import { installVibrationalAnalyser } from '../analyser.ts';

afterEach(() => {
  setVibrationalAnalyser(null);
});

/**
 * Carbon dioxide, linear along z, at its GFN2 bond length. Its symmetric
 * stretch is the case the bond-polarizability model pins exactly.
 */
const CARBON_DIOXIDE: Geometry = {
  elements: ['O', 'C', 'O'],
  coordinates: new Float64Array([0, 0, -1.16, 0, 0, 0, 0, 0, 1.16]),
};

const CARBON_DIOXIDE_MASSES = new Float64Array([
  15.999_400_138_9, 12.010_700_225_8, 15.999_400_138_9,
]);

test('nothing is installed until installVibrationalAnalyser is called', () => {
  expect(getVibrationalAnalyser()).toBeNull();
  installVibrationalAnalyser();
  const analyser = getVibrationalAnalyser();
  expect(analyser).not.toBeNull();
  expect(typeof analyser?.ramanActivities).toBe('function');
  expect(typeof analyser?.thermochemistry).toBe('function');
});

test('the installed Raman analyser gives CO2 symmetric stretch a ratio of exactly 1/3', () => {
  installVibrationalAnalyser();
  const compute = getVibrationalAnalyser()?.ramanActivities;
  if (compute === undefined) throw new Error('no Raman analyser installed');

  // The symmetric stretch: the two oxygens move against each other along z and
  // the carbon stays put, so the eigenvector is mass-weighted and unit-norm.
  const activities = compute(
    CARBON_DIOXIDE,
    [symmetricStretch()],
    CARBON_DIOXIDE_MASSES,
    null,
  );
  expect(activities).toHaveLength(1);
  // alpha_perp does not depend on bond length in this model, so dalpha/dQ is a
  // pure zz tensor and the ratio collapses to 3/(5+4) whatever the geometry.
  expect(activities[0]?.depolarizationRatio).toBeCloseTo(0.333_333_333_3, 9);
  expect(activities[0]?.ramanActivity).toBeGreaterThan(0);
});

test('a molecule with bonds uses its graph rather than the distance rule', () => {
  installVibrationalAnalyser();
  const compute = getVibrationalAnalyser()?.ramanActivities;
  if (compute === undefined) throw new Error('no Raman analyser installed');

  const withGraph = compute(
    CARBON_DIOXIDE,
    [symmetricStretch()],
    CARBON_DIOXIDE_MASSES,
    moleculeWithBonds(),
  );
  const withDistanceRule = compute(
    CARBON_DIOXIDE,
    [symmetricStretch()],
    CARBON_DIOXIDE_MASSES,
    null,
  );
  // The two oxygens sit 2.32 A apart, outside ASE's 1.5*(r_O + r_O) = 1.98 A,
  // so the distance rule finds the same two C=O bonds the graph does and the
  // two paths must agree exactly. CO2 is the case where they do; CCl4 is the
  // case where they do not, which is why the graph is the default.
  expect(withGraph[0]?.ramanActivity).toBeCloseTo(
    withDistanceRule[0]?.ramanActivity ?? Number.NaN,
    10,
  );
});

test('the installed thermochemistry analyser reproduces xtb for water', () => {
  installVibrationalAnalyser();
  const compute = getVibrationalAnalyser()?.thermochemistry;
  if (compute === undefined) throw new Error('no thermochemistry analyser');

  // Read from the fixture rather than transcribed: the rotational entropy
  // follows the moments of inertia, so a mistyped coordinate shows up as a
  // wrong free energy and nothing else.
  // The JSON keys are snake_case, so they are read with bracket access rather
  // than becoming property names, as src/engines/__tests__/fixtures.ts does.
  const fixture = JSON.parse(
    new TextDecoder().decode(
      readFileSync(
        join(import.meta.dirname, '../../reference/fixtures/water.json'),
      ),
    ),
  ) as Record<string, Record<string, unknown>>;

  const atoms = (fixture.optimized_geometry_xyz as { atoms: FixtureAtom[] })
    .atoms;
  const coordinates = new Float64Array(atoms.length * 3);
  const elements = new Array<string>(atoms.length);
  for (let atom = 0; atom < atoms.length; atom++) {
    const entry = atoms[atom] as (typeof atoms)[number];
    elements[atom] = entry.symbol;
    coordinates[atom * 3] = entry.x;
    coordinates[atom * 3 + 1] = entry.y;
    coordinates[atom * 3 + 2] = entry.z;
  }

  const block = compute({
    geometry: { elements, coordinates },
    masses: new Float64Array([
      15.999_400_138_9, 1.007_940_053_9, 1.007_940_053_9,
    ]),
    wavenumbers: Float64Array.from(
      (fixture.vibrations as { frequencies: number[] }).frequencies,
    ),
    electronicEnergy: energy('total_energy'),
    temperature: 298.15,
    pressure: 101_325,
    symmetryNumber: 2,
    pointGroup: 'C2v',
  });

  expect(energy('zero_point_energy')).toBe(0.020_124_421_574);

  // The fixtures store frequencies to two decimals, which is what sets the
  // floor on how closely any re-derivation can land.
  expect(block.zeroPointEnergy).toBeCloseTo(energy('zero_point_energy'), 8);
  expect(block.totalFreeEnergy).toBeCloseTo(energy('total_free_energy'), 6);
  expect(block.totalEnthalpy).toBeCloseTo(energy('total_enthalpy'), 6);
  expect(block.symmetryNumber).toBe(2);
  expect(block.isLinear).toBe(false);
  expect(block.skippedImaginaryModes).toBe(0);

  /**
   * One entry of the fixture's `energies_hartree` block.
   * @param key - The snake_case JSON key.
   * @returns The energy in Hartree.
   */
  function energy(key: string): number {
    return (fixture.energies_hartree as Record<string, number>)[key] as number;
  }
});

/** The CO2 symmetric stretch, as a unit-norm mass-weighted eigenvector. */
function symmetricStretch(): VibrationalMode {
  const oxygen = Math.sqrt(CARBON_DIOXIDE_MASSES[0] as number);
  const norm = Math.SQRT2 * oxygen;
  const eigenvector = new Float64Array([
    0,
    0,
    -oxygen / norm,
    0,
    0,
    0,
    0,
    0,
    oxygen / norm,
  ]);
  return {
    wavenumber: 1300,
    irIntensity: 0,
    ramanActivity: null,
    depolarizationRatio: null,
    eigenvector,
    cartesianDisplacement: new Float64Array(9),
    maxDisplacement: 1,
    reducedMass: 1,
    forceConstant: 1,
    involvement: null,
  };
}

/** CO2 carrying the two real C=O bonds its structure has. */
function moleculeWithBonds(): Molecule {
  return {
    id: 'co2',
    label: 'carbon dioxide',
    formula: 'CO2',
    source: { kind: 'smiles', smiles: 'O=C=O', seed: 42 },
    charge: 0,
    unpairedElectrons: 0,
    bonds: [
      [0, 1],
      [1, 2],
    ],
    ...CARBON_DIOXIDE,
  };
}

/** One atom of a fixture's stored optimized geometry. */
interface FixtureAtom {
  symbol: string;
  x: number;
  y: number;
  z: number;
}
