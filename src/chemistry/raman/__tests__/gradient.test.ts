import { expect, test } from 'vitest';

import {
  aseLegacyBonds,
  bondPolarizabilityComponents,
  finiteDifferenceGradient,
  polarizabilityGradient,
} from '../index.ts';

import { agreement, aseReference, caseGeometry } from './aseReference.ts';

/** Molecules whose legacy neighbour list is stable under a 0.01 Å displacement. */
const STABLE = new Set(['water', 'methanol', 'benzene', 'toluene']);

test('the legacy finite difference reproduces ASE on all five molecules', () => {
  const cases = aseReference().gradientCases;
  expect(cases).toHaveLength(5);
  for (const testCase of cases) {
    const gradient = finiteDifferenceGradient(
      caseGeometry(testCase),
      null,
      0.01,
    );
    const measured = agreement(testCase.dAlphaDxA2.flat(), gradient);
    expect(measured.maxNormalized).toBeLessThan(1e-12);
  }
});

test('the analytic gradient matches the finite difference to 2e-4 max-normalized', () => {
  for (const testCase of aseReference().gradientCases) {
    if (!STABLE.has(testCase.name)) continue;
    const geometry = caseGeometry(testCase);
    const bonds = aseLegacyBonds(geometry);
    const analytic = polarizabilityGradient(geometry, bonds);
    const difference = finiteDifferenceGradient(geometry, bonds, 0.01);
    const measured = agreement(difference, analytic);
    expect(measured.maxNormalized).toBeLessThan(2e-4);
    expect(measured.maxNormalized).toBeGreaterThan(0);
  }
});

test('the analytic derivative of a diatomic is the closed form 4·alpha_parallel/d', () => {
  const distance = 0.9575;
  const geometry = {
    elements: ['O', 'H'],
    coordinates: new Float64Array([0, 0, 0, 0, 0, distance]),
  };
  const gradient = polarizabilityGradient(geometry, [[0, 1]]);
  const { parallel, perpendicular } = bondPolarizabilityComponents(
    'O',
    'H',
    distance,
  );

  // Bond along z: alpha_zz = alpha_parallel, alpha_xx = alpha_yy = alpha_perp,
  // and only the z coordinates move the bond at all.
  const hydrogenZ = 5 * 9;
  expect(gradient[hydrogenZ + 8]).toBeCloseTo((4 * parallel) / distance, 12);
  expect(gradient[hydrogenZ]).toBeCloseTo(0, 15);
  expect(gradient[hydrogenZ + 4]).toBeCloseTo(0, 15);
  expect(gradient[2 * 9 + 8]).toBeCloseTo((-4 * parallel) / distance, 12);

  // Bending the bond out of z rotates the anisotropy into xz at the rate
  // (alpha_parallel - alpha_perp)/d.
  const hydrogenX = 3 * 9;
  expect(gradient[hydrogenX + 2]).toBeCloseTo(
    (parallel - perpendicular) / distance,
    12,
  );
  expect(gradient[hydrogenX + 6]).toBe(gradient[hydrogenX + 2]);
  expect(gradient[hydrogenX]).toBeCloseTo(0, 15);
});

test('the gradient is translationally invariant', () => {
  const testCase = aseReference().gradientCases.find(
    (entry) => entry.name === 'toluene',
  );
  if (testCase === undefined) throw new Error('the toluene case is missing');
  const geometry = caseGeometry(testCase);
  const gradient = polarizabilityGradient(geometry, aseLegacyBonds(geometry));
  const atomCount = geometry.elements.length;
  for (let axis = 0; axis < 3; axis++) {
    for (let component = 0; component < 9; component++) {
      let sum = 0;
      for (let atom = 0; atom < atomCount; atom++) {
        sum += gradient[(atom * 3 + axis) * 9 + component] as number;
      }
      expect(sum).toBeCloseTo(0, 12);
    }
  }
});

test('caffeine shows the legacy neighbour-list flicker the analytic path avoids', () => {
  const testCase = aseReference().gradientCases.find(
    (entry) => entry.name === 'caffeine',
  );
  if (testCase === undefined) throw new Error('the caffeine case is missing');
  const geometry = caseGeometry(testCase);
  const rebuilt = finiteDifferenceGradient(geometry, null, 0.01);
  const analytic = polarizabilityGradient(geometry, aseLegacyBonds(geometry));

  let rebuiltPeak = 0;
  let analyticPeak = 0;
  for (let index = 0; index < rebuilt.length; index++) {
    const value = Math.abs(rebuilt[index] as number);
    if (value > rebuiltPeak) rebuiltPeak = value;
    const exact = Math.abs(analytic[index] as number);
    if (exact > analyticPeak) analyticPeak = exact;
  }
  // A pair crossing the radii cutoff inside the +-0.01 A step adds a whole bond
  // between the two displacements, so the difference quotient diverges.
  expect(rebuiltPeak).toBeCloseTo(360.56675_36848, 7);
  expect(analyticPeak).toBeCloseTo(26.23363_96795, 8);
  expect(agreement(rebuilt, analytic).maxNormalized).toBeGreaterThan(1);
});

test('the flicker is a change of the bond list, not of the tensor formula', () => {
  const reference = aseReference().gradientCases;
  const caffeine = reference.find((entry) => entry.name === 'caffeine');
  const benzene = reference.find((entry) => entry.name === 'benzene');
  if (caffeine === undefined || benzene === undefined) {
    throw new Error('a gradient case is missing');
  }
  expect(displacedBondCounts(caffeine)).toStrictEqual([27, 28]);
  expect(displacedBondCounts(benzene)).toStrictEqual([12]);
  expect(aseLegacyBonds(caseGeometry(caffeine))).toHaveLength(28);
});

/**
 * The distinct bond-list sizes ASE's rule produces over every +-0.01 A
 * displacement of a molecule, ascending.
 */
function displacedBondCounts(testCase: {
  elements: string[];
  coordinates: number[];
}): number[] {
  const elements = testCase.elements;
  const coordinates = new Float64Array(testCase.coordinates);
  const counts = new Set<number>();
  for (let coordinate = 0; coordinate < coordinates.length; coordinate++) {
    const original = coordinates[coordinate] as number;
    for (const step of [0.01, -0.01]) {
      coordinates[coordinate] = original + step;
      counts.add(aseLegacyBonds({ elements, coordinates }).length);
    }
    coordinates[coordinate] = original;
  }
  return [...counts].toSorted((first, second) => first - second);
}
