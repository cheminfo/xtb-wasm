import { expect, test } from 'vitest';

import { principalMoments, resolveSymmetry } from '../symmetry.ts';

import {
  MASS,
  METHANE,
  NEOPENTANE,
  TETRACHLOROMETHANE,
  TETRAPHOSPHORUS,
} from './moleculeSamples.ts';

test('methane is a spherical top: the three principal moments agree', () => {
  const moments = principalMoments(METHANE.geometry, METHANE.masses);
  // 8/3 · m_H · d², the standard XY4 result.
  const expected = (8 / 3) * MASS.H * 1.087 * 1.087;
  expect(moments[0]).toBeCloseTo(expected, 10);
  expect(moments[1]).toBeCloseTo(expected, 10);
  expect(moments[2]).toBeCloseTo(expected, 10);
});

test("occ's D2 misassignment of methane is corrected to Td with sigma 12", () => {
  expect(
    resolveSymmetry(METHANE.geometry, METHANE.masses, {
      pointGroup: 'D2',
      symmetryNumber: 4,
    }),
  ).toStrictEqual({ pointGroup: 'Td', symmetryNumber: 12, corrected: true });
});

test('tetrachloromethane is corrected the same way', () => {
  expect(
    resolveSymmetry(TETRACHLOROMETHANE.geometry, TETRACHLOROMETHANE.masses, {
      pointGroup: 'D2',
      symmetryNumber: 4,
    }),
  ).toStrictEqual({ pointGroup: 'Td', symmetryNumber: 12, corrected: true });
});

test('a correct Td detection is left untouched', () => {
  expect(
    resolveSymmetry(METHANE.geometry, METHANE.masses, {
      pointGroup: 'Td',
      symmetryNumber: 12,
    }),
  ).toStrictEqual({ pointGroup: 'Td', symmetryNumber: 12, corrected: false });
});

test('P4 is not five atoms, so the guard never fires on it', () => {
  expect(
    resolveSymmetry(TETRAPHOSPHORUS.geometry, TETRAPHOSPHORUS.masses, {
      pointGroup: 'D2',
      symmetryNumber: 4,
    }),
  ).toStrictEqual({ pointGroup: 'D2', symmetryNumber: 4, corrected: false });
});

test('neopentane is a spherical top the guard still leaves alone', () => {
  const moments = principalMoments(NEOPENTANE.geometry, NEOPENTANE.masses);
  expect((moments[2] as number) - (moments[0] as number)).toBeLessThan(
    1e-6 * (moments[2] as number),
  );
  expect(
    resolveSymmetry(NEOPENTANE.geometry, NEOPENTANE.masses, {
      pointGroup: 'T',
      symmetryNumber: 12,
    }),
  ).toStrictEqual({ pointGroup: 'T', symmetryNumber: 12, corrected: false });
});

test('a neopentane detected as something other than sigma 12 is not rescued', () => {
  expect(
    resolveSymmetry(NEOPENTANE.geometry, NEOPENTANE.masses, {
      pointGroup: 'D2',
      symmetryNumber: 4,
    }),
  ).toStrictEqual({ pointGroup: 'D2', symmetryNumber: 4, corrected: false });
});

test('a mixed-ligand XY3Z is not an XY4 cage', () => {
  const fluoromethane = {
    elements: ['C', 'H', 'H', 'H', 'F'],
    coordinates: METHANE.geometry.coordinates,
  };
  const masses = Float64Array.of(MASS.C, MASS.H, MASS.H, MASS.H, MASS.F);
  expect(
    resolveSymmetry(fluoromethane, masses, {
      pointGroup: 'C3v',
      symmetryNumber: 3,
    }),
  ).toStrictEqual({ pointGroup: 'C3v', symmetryNumber: 3, corrected: false });
});

test('a distorted XY4 is not a spherical top and is left alone', () => {
  const coordinates = Float64Array.from(METHANE.geometry.coordinates);
  coordinates[5] = 0.8 * (coordinates[5] as number);
  expect(
    resolveSymmetry(
      { elements: METHANE.geometry.elements, coordinates },
      METHANE.masses,
      { pointGroup: 'C2v', symmetryNumber: 2 },
    ),
  ).toStrictEqual({ pointGroup: 'C2v', symmetryNumber: 2, corrected: false });
});

test('an unknown detection is still corrected for the XY4 shape', () => {
  expect(
    resolveSymmetry(METHANE.geometry, METHANE.masses, {
      pointGroup: 'unknown',
      symmetryNumber: 1,
    }),
  ).toStrictEqual({ pointGroup: 'Td', symmetryNumber: 12, corrected: true });
});
