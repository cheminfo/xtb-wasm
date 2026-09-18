import { expect, test } from 'vitest';

import { filterThermoModes } from '../modeFilter.ts';

test('projected translations and rotations within 1 cm-1 of zero are discarded', () => {
  const filtered = filterThermoModes([
    -0.4, 0, 0.3, 0.95, -1, 1, 1538.9, 3643.06, 3651.64,
  ]);
  expect(Array.from(filtered.wavenumbers)).toStrictEqual([
    1538.9, 3643.06, 3651.64,
  ]);
  expect(filtered.imaginaryCount).toBe(0);
  expect(filtered.invertedCount).toBe(0);
});

test('a negative mode above -20 cm-1 is inverted, and one below it is dropped', () => {
  const filtered = filterThermoModes([-19.9, -20, -20.1, -85.3, 300]);
  expect(Array.from(filtered.wavenumbers)).toStrictEqual([19.9, 300]);
  expect(filtered.invertedCount).toBe(1);
  expect(filtered.imaginaryCount).toBe(3);
});

test('the inversion threshold is exclusive, so exactly -20 is imaginary', () => {
  const filtered = filterThermoModes([-20]);
  expect(filtered.wavenumbers).toHaveLength(0);
  expect(filtered.imaginaryCount).toBe(1);
});

test('both thresholds are overridable', () => {
  const filtered = filterThermoModes([-30, -5, 8, 400], {
    vibrationThreshold: 10,
    inversionThreshold: -40,
  });
  expect(Array.from(filtered.wavenumbers)).toStrictEqual([30, 400]);
  expect(filtered.invertedCount).toBe(1);
  expect(filtered.imaginaryCount).toBe(0);
});

test('an empty list stays empty', () => {
  const filtered = filterThermoModes([]);
  expect(filtered.wavenumbers).toHaveLength(0);
  expect(filtered.imaginaryCount).toBe(0);
  expect(filtered.invertedCount).toBe(0);
});
