import { expect, test } from 'vitest';

import {
  aseLegacyBonds,
  bondPolarizability,
  compareConnectivity,
} from '../index.ts';

import {
  agreement,
  aseReference,
  caseGeometry,
  tetrahedral,
} from './aseReference.ts';

const CHLORINE_CONTACTS: Array<[number, number]> = [
  [1, 2],
  [1, 3],
  [1, 4],
  [2, 3],
  [2, 4],
  [3, 4],
];

test('bondPolarizability reproduces every ASE tensor in the reference file', () => {
  const cases = aseReference().alphaCases;
  expect(cases).toHaveLength(10);
  for (const testCase of cases) {
    const tensor = bondPolarizability(caseGeometry(testCase), testCase.bonds);
    const measured = agreement(testCase.alphaA3, tensor);
    expect(measured.maxNormalized).toBeLessThan(1e-14);
    expect(measured.relative).toBeLessThan(1e-8);
    expect(measured.scale).toBeGreaterThan(1);
  }
});

test('the tensor is symmetric and carries the expected trace for benzene', () => {
  const benzene = aseReference().alphaCases.find(
    (testCase) => testCase.name === 'C6H6',
  );
  if (benzene === undefined) throw new Error('the C6H6 case is missing');
  const tensor = bondPolarizability(caseGeometry(benzene), benzene.bonds);
  expect(tensor[1]).toBe(tensor[3]);
  expect(tensor[2]).toBe(tensor[6]);
  expect(tensor[5]).toBe(tensor[7]);
  expect(mean(tensor)).toBeCloseTo(11.16144_1947, 8);
});

test('the legacy rule finds exactly the reference bond count on every molecule', () => {
  for (const testCase of aseReference().alphaCases) {
    const bonds = aseLegacyBonds(caseGeometry(testCase));
    expect(bonds).toStrictEqual(testCase.bonds);
  }
  for (const testCase of aseReference().gradientCases) {
    expect(aseLegacyBonds(caseGeometry(testCase))).toHaveLength(
      testCase.nBonds,
    );
  }
});

test('the legacy rule turns tetrahedral CCl4 into ten bonds and inflates alpha 8-fold', () => {
  const geometry = tetrahedral(
    'C',
    ['Cl', 'Cl', 'Cl', 'Cl'],
    [1.766, 1.766, 1.766, 1.766],
  );
  const graph: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ];
  const legacy = aseLegacyBonds(geometry);
  expect(legacy).toHaveLength(10);

  const graphTensor = bondPolarizability(geometry, graph);
  const legacyTensor = bondPolarizability(geometry, legacy);
  expect(mean(graphTensor)).toBeCloseTo(7.97183_0063, 8);
  expect(mean(legacyTensor)).toBeCloseTo(62.73840_9053, 7);
});

test('compareConnectivity names the Cl...Cl contacts the legacy rule invents', () => {
  const geometry = tetrahedral(
    'C',
    ['Cl', 'Cl', 'Cl', 'Cl'],
    [1.766, 1.766, 1.766, 1.766],
  );
  const comparison = compareConnectivity(geometry, [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ]);
  expect(comparison.agree).toBe(false);
  expect(comparison.extraBonds).toStrictEqual(CHLORINE_CONTACTS);
  expect(comparison.missingBonds).toStrictEqual([]);
});

test('CBrClFI gets eight legacy bonds where the structure has four', () => {
  const geometry = tetrahedral(
    'C',
    ['F', 'Cl', 'Br', 'I'],
    [1.35, 1.77, 1.93, 2.14],
  );
  const comparison = compareConnectivity(geometry, [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ]);
  expect(aseLegacyBonds(geometry)).toHaveLength(8);
  expect(comparison.extraBonds).toStrictEqual([
    [1, 4],
    [2, 3],
    [2, 4],
    [3, 4],
  ]);
  expect(comparison.missingBonds).toStrictEqual([]);
});

test('compareConnectivity reports agreement on a molecule the rules agree on', () => {
  const water = aseReference().alphaCases[0];
  if (water === undefined) throw new Error('the H2O case is missing');
  expect(water.name).toBe('H2O');
  const comparison = compareConnectivity(caseGeometry(water), water.bonds);
  expect(comparison).toStrictEqual({
    extraBonds: [],
    missingBonds: [],
    agree: true,
  });
});

test('a bond stretched past the radii cutoff is reported as missing, not extra', () => {
  const geometry = {
    elements: ['O', 'H'],
    coordinates: new Float64Array([0, 0, 0, 0, 0, 4]),
  };
  expect(aseLegacyBonds(geometry)).toStrictEqual([]);
  expect(compareConnectivity(geometry, [[1, 0]])).toStrictEqual({
    extraBonds: [],
    missingBonds: [[0, 1]],
    agree: false,
  });
});

test('an element with no ASE covalent radius stops the legacy rule by name', () => {
  expect(() =>
    aseLegacyBonds({
      elements: ['C', 'Es'],
      coordinates: new Float64Array([0, 0, 0, 1.5, 0, 0]),
    }),
  ).toThrow('no ASE covalent radius for the element Es');
});

/** The mean polarizability of a row-major 3x3 tensor, tr(alpha)/3. */
function mean(tensor: Float64Array): number {
  return (
    ((tensor[0] as number) + (tensor[4] as number) + (tensor[8] as number)) / 3
  );
}
