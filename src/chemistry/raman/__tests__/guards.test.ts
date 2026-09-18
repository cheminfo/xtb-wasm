import { expect, test } from 'vitest';

import {
  bondPolarizability,
  finiteDifferenceGradient,
  polarizabilityGradient,
  ramanActivities,
} from '../index.ts';
import { placzekActivities } from '../placzek.ts';

const WATER = {
  elements: ['O', 'H', 'H'],
  coordinates: new Float64Array([0, 0, 0, 0, 0, 0.9575, 0, 0.9266, -0.24]),
};
const BONDS: Array<[number, number]> = [
  [0, 1],
  [0, 2],
];
const MASSES = new Float64Array([15.999, 1.008, 1.008]);

function waterModes(): Array<{ eigenvector: Float64Array }> {
  const eigenvector = new Float64Array(9);
  eigenvector[2] = 1;
  return [{ eigenvector }];
}

test('a molfile bond block used 1-based is rejected instead of yielding NaN', () => {
  // Atom numbers 1..3 shifted by one address atom 3, which does not exist.
  const oneBased: Array<[number, number]> = [
    [1, 2],
    [1, 3],
  ];
  expect(() => bondPolarizability(WATER, oneBased)).toThrow(
    'the bond [1, 3] is outside the 3 atoms of the geometry',
  );
  expect(() => polarizabilityGradient(WATER, oneBased)).toThrow(
    'the bond [1, 3] is outside the 3 atoms of the geometry',
  );
  expect(() => finiteDifferenceGradient(WATER, oneBased, 0.01)).toThrow(
    'the bond [1, 3] is outside the 3 atoms of the geometry',
  );
  expect(() =>
    ramanActivities(WATER, waterModes(), MASSES, { bonds: oneBased }),
  ).toThrow('the bond [1, 3] is outside the 3 atoms of the geometry');
});

test('a negative or fractional bond index is named too', () => {
  expect(() => bondPolarizability(WATER, [[-1, 0]])).toThrow(
    'the bond [-1, 0] is outside the 3 atoms of the geometry',
  );
  expect(() => bondPolarizability(WATER, [[0, 1.5]])).toThrow(
    'the bond [0, 1.5] is outside the 3 atoms of the geometry',
  );
});

test('a non-positive or non-finite step is rejected by value', () => {
  expect(() => finiteDifferenceGradient(WATER, BONDS, 0)).toThrow(
    'the finite-difference step must be positive, got 0',
  );
  expect(() => finiteDifferenceGradient(WATER, BONDS, -0.01)).toThrow(
    'the finite-difference step must be positive, got -0.01',
  );
  expect(() => finiteDifferenceGradient(WATER, BONDS, Number.NaN)).toThrow(
    'the finite-difference step must be positive, got NaN',
  );
  expect(() =>
    ramanActivities(WATER, waterModes(), MASSES, {
      bonds: BONDS,
      derivative: 'finite-difference',
      step: 0,
    }),
  ).toThrow('the finite-difference step must be positive, got 0');
});

test('a zero mass is rejected rather than reported as an infinite band', () => {
  const gradient = polarizabilityGradient(WATER, BONDS);
  expect(() =>
    placzekActivities(
      gradient,
      waterModes(),
      new Float64Array([15.999, 0, 1.008]),
    ),
  ).toThrow('the mass of atom 1 is 0, expected a positive number');
  expect(() =>
    ramanActivities(
      WATER,
      waterModes(),
      new Float64Array([15.999, -1, 1.008]),
      {
        bonds: BONDS,
      },
    ),
  ).toThrow('the mass of atom 1 is -1, expected a positive number');
});

test('the guards do not disturb a sound call', () => {
  const activities = ramanActivities(WATER, waterModes(), MASSES, {
    bonds: BONDS,
  });
  expect(activities).toHaveLength(1);
  const first = activities[0];
  if (first === undefined) throw new Error('no activity was returned');
  // Moving only the oxygen along z against a frozen bond list. Both values come
  // from an independent Richardson-extrapolated difference of the model in
  // python, not from this implementation.
  expect(first.activity).toBeCloseTo(2.26912_52452, 8);
  expect(first.depolarizationRatio).toBeCloseTo(0.50885_35413, 8);
});
