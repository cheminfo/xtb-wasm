/**
 * The derived conversion factors the thermochemistry block depends on.
 *
 * Each one is checked against an independently published value rather than
 * against the expression that produced it, because the failure this guards
 * against is a plausible-but-wrong factor, not an arithmetic slip.
 */

import { expect, test } from 'vitest';

import {
  AMU_KG,
  ANGSTROM_PER_BOHR,
  AVOGADRO,
  BOLTZMANN_HARTREE_PER_K,
  BOLTZMANN_WAVENUMBER_PER_K,
  CALORIE_J,
  GAS_CONSTANT,
  HARTREE_J,
  KCAL_PER_MOL_PER_HARTREE,
  KJ_PER_MOL_PER_HARTREE,
  PLANCK_J_S,
  WAVENUMBER_PER_HARTREE,
} from '../constants.ts';

test('the Hartree is 2625.4996 kJ/mol and 627.5095 kcal/mol', () => {
  expect(KJ_PER_MOL_PER_HARTREE).toBeCloseTo(2625.499639479163, 10);
  expect(KCAL_PER_MOL_PER_HARTREE).toBeCloseTo(627.5094740628974, 10);
  expect(KJ_PER_MOL_PER_HARTREE / KCAL_PER_MOL_PER_HARTREE).toBeCloseTo(
    CALORIE_J,
    12,
  );
});

test('the Hartree is 219474.63 cm-1', () => {
  expect(WAVENUMBER_PER_HARTREE).toBeCloseTo(219474.63136314112, 6);
});

test('the Boltzmann constant is 0.6950348 cm-1/K, i.e. 1.4387769 K·cm', () => {
  expect(BOLTZMANN_WAVENUMBER_PER_K).toBeCloseTo(0.695034799, 8);
  expect(1 / BOLTZMANN_WAVENUMBER_PER_K).toBeCloseTo(1.4387768775039336, 10);
});

test('the Boltzmann constant is 3.1668116e-6 Eh/K', () => {
  expect(BOLTZMANN_HARTREE_PER_K).toBeCloseTo(3.166811563e-6, 14);
  expect(GAS_CONSTANT / (HARTREE_J * AVOGADRO)).toBeCloseTo(
    BOLTZMANN_HARTREE_PER_K,
    18,
  );
});

test('the molar gas constant is 8.31446 J/(mol·K) and 1.98720 cal/(mol·K)', () => {
  expect(GAS_CONSTANT).toBeCloseTo(8.31446261815324, 12);
  expect(GAS_CONSTANT / CALORIE_J).toBeCloseTo(1.987204259, 8);
});

test('a Bohr is 0.529177210903 Angstrom', () => {
  expect(ANGSTROM_PER_BOHR).toBeCloseTo(0.529177210903, 12);
});

test('1 amu·Angstrom² is 1.6605390666e-47 kg·m²', () => {
  expect(AMU_KG / 1e20).toBeCloseTo(1.660539066_6e-47, 58);
});

test('a moment of 1 amu·Angstrom² is a rotational constant of 16.8576 cm-1', () => {
  const moment = AMU_KG / 1e20;
  const rotationalConstant =
    PLANCK_J_S / (8 * Math.PI * Math.PI * moment * 299_792_458) / 100;
  expect(rotationalConstant).toBeCloseTo(16.85763, 5);
});

test('the round trip between cm-1 and Hartree is exact to machine precision', () => {
  const wavenumber = 3651.64;
  expect(
    (wavenumber / WAVENUMBER_PER_HARTREE) * WAVENUMBER_PER_HARTREE,
  ).toBeCloseTo(wavenumber, 10);
});
