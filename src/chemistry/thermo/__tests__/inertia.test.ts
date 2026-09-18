import { expect, test } from 'vitest';

import { AMU_KG } from '../../constants.ts';
import {
  inertiaAnalysis,
  isLinearRotor,
  principalMoments,
} from '../inertia.ts';

/** Standard atomic weights as occ's `Molecule.atomicMasses()` reports them. */
const MASS = {
  H: 1.0079400539,
  C: 12.0107002258,
  O: 15.9994001389,
};

const CARBON_DIOXIDE = {
  elements: ['O', 'C', 'O'],
  coordinates: Float64Array.of(0, 0, -1.16, 0, 0, 0, 0, 0, 1.16),
};
const CARBON_DIOXIDE_MASSES = Float64Array.of(MASS.O, MASS.C, MASS.O);

const WATER = {
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
};
const WATER_MASSES = Float64Array.of(MASS.O, MASS.H, MASS.H);

test('a symmetric linear triatomic has one vanishing and two equal moments', () => {
  const moments = principalMoments(CARBON_DIOXIDE, CARBON_DIOXIDE_MASSES);
  // 2 m_O d² about the carbon, which is also the centre of mass.
  const expected = 2 * MASS.O * 1.16 * 1.16;
  expect(moments[0]).toBeCloseTo(0, 12);
  expect(moments[1]).toBeCloseTo(expected, 10);
  expect(moments[2]).toBeCloseTo(expected, 10);
});

test('the principal moments of water are translation invariant', () => {
  const displaced = new Float64Array(WATER.coordinates.length);
  for (let index = 0; index < displaced.length; index++) {
    displaced[index] = (WATER.coordinates[index] as number) + 12.5;
  }
  const shifted = { elements: WATER.elements, coordinates: displaced };
  const moved = principalMoments(shifted, WATER_MASSES);
  const original = principalMoments(WATER, WATER_MASSES);
  for (let index = 0; index < 3; index++) {
    expect(moved[index]).toBeCloseTo(original[index] as number, 9);
  }
});

test('water is an asymmetric top with three distinct positive moments', () => {
  const analysis = inertiaAnalysis(WATER, WATER_MASSES);
  expect(analysis.totalMass).toBeCloseTo(18.0152802467, 10);
  expect(analysis.moments[0]).toBeCloseTo(0.5787200950266804, 10);
  expect(analysis.moments[1]).toBeCloseTo(1.2030343635789946, 10);
  expect(analysis.moments[2]).toBeCloseTo(1.781754458605675, 10);
  expect(analysis.hasZeroedMoment).toBe(false);
  expect(analysis.isAtom).toBe(false);
  expect(isLinearRotor(WATER)).toBe(false);
});

test('the average moment is the mean of the three, in kg·m²', () => {
  const analysis = inertiaAnalysis(WATER, WATER_MASSES);
  const mean =
    ((analysis.moments[0] as number) +
      (analysis.moments[1] as number) +
      (analysis.moments[2] as number)) /
    3;
  expect(analysis.averageMoment).toBeCloseTo((mean * AMU_KG) / 1e20, 60);
  expect(analysis.averageMoment).toBeCloseTo(1.9724485904023037e-47, 60);
});

test('a single atom has no moments at all', () => {
  const argon = { elements: ['Ar'], coordinates: Float64Array.of(0, 0, 0) };
  const analysis = inertiaAnalysis(argon, Float64Array.of(39.948));
  expect(Array.from(analysis.moments)).toStrictEqual([0, 0, 0]);
  expect(analysis.isAtom).toBe(true);
  expect(analysis.averageMoment).toBe(0);
  expect(isLinearRotor(argon)).toBe(true);
});

test('a diatomic is linear and has its smallest moment zeroed', () => {
  const dihydrogen = {
    elements: ['H', 'H'],
    coordinates: Float64Array.of(0, 0, 0, 0, 0, 0.7414),
  };
  const analysis = inertiaAnalysis(dihydrogen, Float64Array.of(MASS.H, MASS.H));
  expect(analysis.moments[0]).toBe(0);
  expect(analysis.moments[2]).toBeCloseTo(0.2770192004349132, 12);
  expect(analysis.hasZeroedMoment).toBe(true);
  expect(analysis.isAtom).toBe(false);
  expect(isLinearRotor(dihydrogen)).toBe(true);
});

test('linearity ignores the masses, so CO2 stays linear when bent by 0.05 A', () => {
  expect(isLinearRotor(CARBON_DIOXIDE)).toBe(true);
  const bent = {
    elements: CARBON_DIOXIDE.elements,
    coordinates: Float64Array.of(0, 0, -1.16, 0.05, 0, 0, 0, 0, 1.16),
  };
  expect(isLinearRotor(bent)).toBe(false);
});

test('a mass count that does not match the geometry is rejected', () => {
  expect(() => principalMoments(WATER, Float64Array.of(16, 1))).toThrow(
    'expected 3 masses but received 2',
  );
});

test('a coordinate count that does not match the geometry is rejected', () => {
  expect(() =>
    principalMoments(
      { elements: ['O', 'H'], coordinates: Float64Array.of(0, 0, 0) },
      Float64Array.of(MASS.O, MASS.H),
    ),
  ).toThrow('expected 6 coordinates but received 3');
});
