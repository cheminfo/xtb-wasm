import { expect, test } from 'vitest';

import { ramanSupport } from '../index.ts';
import { bondPolarizabilityComponents } from '../lippincottStuttman.ts';
import {
  ATOMIC_POLARIZABILITY,
  REDUCED_ELECTRONEGATIVITY,
  SUPPORTED_ELEMENTS,
} from '../parameters.ts';

test('the two tables have the sizes the fork has, and Kr is in only one', () => {
  expect(Object.keys(ATOMIC_POLARIZABILITY)).toHaveLength(37);
  expect(Object.keys(REDUCED_ELECTRONEGATIVITY)).toHaveLength(36);
  expect(ATOMIC_POLARIZABILITY.Kr).toBe(5.256);
  expect(REDUCED_ELECTRONEGATIVITY.Kr).toBeUndefined();
});

test('the supported set is the 36-element intersection, without Kr', () => {
  expect(SUPPORTED_ELEMENTS).toHaveLength(36);
  expect(SUPPORTED_ELEMENTS).not.toContain('Kr');
  expect(SUPPORTED_ELEMENTS.toSorted()).toStrictEqual(
    Object.keys(REDUCED_ELECTRONEGATIVITY).toSorted(),
  );
});

test('the halogens the fork added to the ten-element upstream table are present', () => {
  expect(ATOMIC_POLARIZABILITY.F).toBe(0.49);
  expect(ATOMIC_POLARIZABILITY.Cl).toBe(1.388);
  expect(ATOMIC_POLARIZABILITY.Br).toBe(1.941);
  expect(ATOMIC_POLARIZABILITY.I).toBe(2.972);
  expect(REDUCED_ELECTRONEGATIVITY.F).toBe(1.056);
  expect(REDUCED_ELECTRONEGATIVITY.Cl).toBe(0.753);
  expect(REDUCED_ELECTRONEGATIVITY.Br).toBe(0.633);
  expect(REDUCED_ELECTRONEGATIVITY.I).toBe(0.584);
});

test('the original ten elements keep their published values', () => {
  expect(ATOMIC_POLARIZABILITY.H).toBe(0.592);
  expect(ATOMIC_POLARIZABILITY.C).toBe(0.978);
  expect(ATOMIC_POLARIZABILITY.N).toBe(0.743);
  expect(ATOMIC_POLARIZABILITY.O).toBe(0.592);
  expect(ATOMIC_POLARIZABILITY.S).toBe(1.82);
  expect(REDUCED_ELECTRONEGATIVITY.H).toBe(1);
  expect(REDUCED_ELECTRONEGATIVITY.C).toBe(0.846);
  expect(REDUCED_ELECTRONEGATIVITY.O).toBe(1);
});

test('bond components match ASE 3.29.0 + the fork table to the last ulp', () => {
  const carbonChlorine = bondPolarizabilityComponents('C', 'Cl', 1.766);
  expect(carbonChlorine.parallel).toBeCloseTo(3.660404068165372, 12);
  expect(carbonChlorine.perpendicular).toBe(1.1592342396070863);

  const carbonIodine = bondPolarizabilityComponents('C', 'I', 2.14);
  expect(carbonIodine.parallel).toBeCloseTo(6.8485331391339415, 12);
  expect(carbonIodine.perpendicular).toBe(1.621531115510252);

  const carbonBromine = bondPolarizabilityComponents('C', 'Br', 1.93);
  expect(carbonBromine.parallel).toBeCloseTo(4.892557820359527, 12);
  expect(carbonBromine.perpendicular).toBe(1.3236304002579709);

  const carbonCarbon = bondPolarizabilityComponents('C', 'C', 1.39);
  expect(carbonCarbon.parallel).toBe(1.4924722166571296);
  expect(carbonCarbon.perpendicular).toBe(0.9779999999999999);

  const oxygenHydrogen = bondPolarizabilityComponents('H', 'O', 0.9575);
  expect(oxygenHydrogen.parallel).toBe(0.3972597522663975);
  expect(oxygenHydrogen.perpendicular).toBe(0.592);
});

test('sigma is 1 for a homonuclear bond and below 1 otherwise', () => {
  const homonuclear = bondPolarizabilityComponents('C', 'C', 1.5);
  const bare = 1.5 ** 4 / (256 * 0.978 * 0.978) ** (1 / 6);
  expect(homonuclear.parallel).toBeCloseTo(bare, 12);

  const heteronuclear = bondPolarizabilityComponents('C', 'F', 1.5);
  const sigma = Math.exp(-((0.846 - 1.056) ** 2) / 4);
  expect(sigma).toBeCloseTo(0.98903_55526, 10);
  expect(heteronuclear.parallel).toBeCloseTo(
    (sigma * 1.5 ** 4) / (256 * 0.978 * 0.49) ** (1 / 6),
    12,
  );
});

test('the perpendicular component ignores the bond length entirely', () => {
  const short = bondPolarizabilityComponents('C', 'O', 1.2);
  const long = bondPolarizabilityComponents('C', 'O', 1.6);
  expect(long.perpendicular).toBe(short.perpendicular);
  expect(long.parallel / short.parallel).toBeCloseTo((1.6 / 1.2) ** 4, 12);
});

test('a bond outside the tables is rejected by name', () => {
  expect(() => bondPolarizabilityComponents('C', 'Kr', 1.9)).toThrow(
    'no Lippincott-Stutman parameters for the bond C-Kr',
  );
  expect(() => bondPolarizabilityComponents('Fe', 'O', 1.9)).toThrow(
    'no Lippincott-Stutman parameters for the bond Fe-O',
  );
});

test('ramanSupport names the distinct unsupported elements once each', () => {
  expect(ramanSupport(['C', 'H', 'O', 'I', 'Br'])).toStrictEqual({
    supported: true,
    unsupported: [],
  });
  expect(ramanSupport(['C', 'H', 'Kr', 'H', 'Kr'])).toStrictEqual({
    supported: false,
    unsupported: ['Kr'],
  });
  expect(ramanSupport(['Fe', 'O', 'O', 'Zn'])).toStrictEqual({
    supported: false,
    unsupported: ['Fe', 'Zn'],
  });
});
