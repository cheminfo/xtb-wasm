import { expect, test } from 'vitest';

import {
  depolarizationRatio,
  ramanActivity,
  ramanInvariants,
} from '../index.ts';

test('an isotropic tensor carries all of its weight in the mean polarizability', () => {
  const invariants = ramanInvariants(
    new Float64Array([2, 0, 0, 0, 2, 0, 0, 0, 2]),
  );
  expect(invariants).toStrictEqual({
    meanSquared: 4,
    anisotropySquared: 0,
    asymmetricAnisotropySquared: 0,
  });
  expect(ramanActivity(invariants)).toBe(180);
  expect(depolarizationRatio(invariants)).toBe(0);
});

test('a traceless diagonal tensor is pure anisotropy', () => {
  // gamma'^2 = ((1+1)^2 + 1^2 + 1^2)/2 = 3, alphaBar'^2 = 0.
  const invariants = ramanInvariants(
    new Float64Array([1, 0, 0, 0, -1, 0, 0, 0, 0]),
  );
  expect(invariants.meanSquared).toBe(0);
  expect(invariants.anisotropySquared).toBe(3);
  expect(ramanActivity(invariants)).toBe(21);
});

test('the symmetric off-diagonal weight is 3/4 of the doubled component', () => {
  // xy = yx = 1: gamma'^2 = 3/4 * (1+1)^2 = 3, and the trace stays zero.
  const invariants = ramanInvariants(
    new Float64Array([0, 1, 0, 1, 0, 0, 0, 0, 0]),
  );
  expect(invariants).toStrictEqual({
    meanSquared: 0,
    anisotropySquared: 3,
    asymmetricAnisotropySquared: 0,
  });
});

test('an antisymmetric tensor shows up only in the asymmetric anisotropy', () => {
  // xy = 1, yx = -1: the symmetric sum vanishes, the difference is 2.
  const invariants = ramanInvariants(
    new Float64Array([0, 1, 0, -1, 0, 0, 0, 0, 0]),
  );
  expect(invariants).toStrictEqual({
    meanSquared: 0,
    anisotropySquared: 0,
    asymmetricAnisotropySquared: 3,
  });
  // delta = 0 in ASE's get_absolute_intensities, so it never reaches the activity.
  expect(ramanActivity(invariants)).toBe(0);
  expect(depolarizationRatio(invariants)).toBe(0);
});

test('the depolarization ratio is the polarized form, bounded by 3/4 not 6/7', () => {
  const traceless = ramanInvariants(
    new Float64Array([1, 0, 0, 0, -1, 0, 0, 0, 0]),
  );
  // rho = 3*gamma'^2 / (45*alphaBar'^2 + 4*gamma'^2) = 9/12 for alphaBar' = 0.
  expect(depolarizationRatio(traceless)).toBe(0.75);
  // The natural-light ratio 6*gamma'^2/(45*alphaBar'^2 + 7*gamma'^2) would be 6/7.
  expect(depolarizationRatio(traceless)).not.toBeCloseTo(6 / 7, 6);
});

test('a mixed tensor reproduces the hand-computed invariants and ratio', () => {
  // diag(3, 1, 1): alphaBar'^2 = 25/9, gamma'^2 = (4 + 4 + 0)/2 = 4.
  const invariants = ramanInvariants(
    new Float64Array([3, 0, 0, 0, 1, 0, 0, 0, 1]),
  );
  expect(invariants.meanSquared).toBeCloseTo(25 / 9, 15);
  expect(invariants.anisotropySquared).toBe(4);
  expect(ramanActivity(invariants)).toBeCloseTo(153, 12);
  expect(depolarizationRatio(invariants)).toBeCloseTo(12 / 141, 15);
});
