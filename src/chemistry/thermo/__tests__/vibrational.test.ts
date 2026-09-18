import { expect, test } from 'vitest';

import {
  AVOGADRO,
  GAS_CONSTANT,
  HARTREE_J,
  WAVENUMBER_PER_HARTREE,
} from '../../constants.ts';
import { headGordonWeight, vibrationalContribution } from '../vibrational.ts';

/** Average moment of water, kg·m² — a representative small-molecule value. */
const AVERAGE_MOMENT = 1.9724485904023037e-47;

const OPTIONS = {
  temperature: 298.15,
  rotorThreshold: 50,
  averageMoment: AVERAGE_MOMENT,
};

test('the Chai-Head-Gordon switch is exactly one half at the threshold', () => {
  expect(headGordonWeight(50, 50)).toBe(0.5);
});

test('the switch is 1/(1 + (sthr/nu)^4) with the exponent fixed at four', () => {
  expect(headGordonWeight(100, 50)).toBeCloseTo(1 / (1 + 0.5 ** 4), 15);
  expect(headGordonWeight(25, 50)).toBeCloseTo(1 / 17, 15);
  expect(headGordonWeight(500, 50)).toBeCloseTo(1 / (1 + 1e-4), 15);
});

test('a negative threshold disables the mixing entirely', () => {
  expect(headGordonWeight(12, -1)).toBe(1);
});

test('the zero-point energy is half the sum of the wavenumbers', () => {
  const wavenumbers = Float64Array.of(1538.9, 3643.06, 3651.64);
  const { zeroPointEnergy } = vibrationalContribution(wavenumbers, OPTIONS);
  const inHartree = zeroPointEnergy / (HARTREE_J * AVOGADRO);
  const expected =
    (0.5 * (1538.9 + 3643.06 + 3651.64)) / WAVENUMBER_PER_HARTREE;
  expect(inHartree).toBeCloseTo(expected, 14);
  expect(inHartree).toBeCloseTo(0.020124421545, 11);
});

test('a stiff mode is frozen out to its exact Boltzmann-suppressed residue', () => {
  const stiff = vibrationalContribution(Float64Array.of(4000), OPTIONS);
  // 4000 cm⁻¹ is 5755 K, so e^-x is 4e-9 and every thermal quantity is that
  // small; the exact residues pin it far better than an upper bound, which
  // would also pass if the terms were wrongly zero.
  expect(stiff.thermalEnergy).toBeCloseTo(1.980708658198549e-4, 12);
  expect(stiff.entropy).toBeCloseTo(6.156192369165005e-7, 15);
  expect(stiff.heatCapacity).toBeCloseTo(1.292493079079178e-5, 13);
});

test('a wavenumber that is not strictly positive is refused', () => {
  expect(() =>
    vibrationalContribution(Float64Array.of(1500, 0), OPTIONS),
  ).toThrow(
    'every wavenumber must be strictly positive, received 0 at index 1',
  );
  expect(() => vibrationalContribution(Float64Array.of(-5), OPTIONS)).toThrow(
    'every wavenumber must be strictly positive, received -5 at index 0',
  );
});

test('a stiff mode approaches the classical limit R as the temperature rises', () => {
  const hot = vibrationalContribution(Float64Array.of(4000), {
    ...OPTIONS,
    temperature: 2e6,
  });
  // The leading correction to the classical R is -x²/12 with x = hcν/kT, which
  // is 7e-7 here, so five digits is as close as the limit can be approached.
  expect(hot.heatCapacity / GAS_CONSTANT).toBeCloseTo(1, 5);
});

test('a soft mode is damped towards the free rotor, so its entropy stays finite', () => {
  const soft = vibrationalContribution(Float64Array.of(0.5), OPTIONS);
  const bare = vibrationalContribution(Float64Array.of(0.5), {
    ...OPTIONS,
    rotorThreshold: -1,
  });
  expect(soft.entropy).toBeLessThan(bare.entropy);
  expect(soft.entropy).toBeCloseTo(19.9182864, 6);
  expect(bare.entropy).toBeCloseTo(58.4253196, 6);
});

test('the mixture is exactly the Head-Gordon weighting of its two limits', () => {
  const wavenumber = 50;
  const mixed = vibrationalContribution(Float64Array.of(wavenumber), OPTIONS);
  const oscillator = vibrationalContribution(Float64Array.of(wavenumber), {
    ...OPTIONS,
    rotorThreshold: -1,
  });
  // At the threshold the oscillator keeps half the weight, so twice the mixture
  // minus the pure oscillator is the pure free rotor.
  const rotorEntropy = 2 * mixed.entropy - oscillator.entropy;
  expect(mixed.entropy).toBeCloseTo(
    0.5 * oscillator.entropy + 0.5 * rotorEntropy,
    12,
  );
  expect(mixed.heatCapacity).toBeCloseTo(
    0.5 * oscillator.heatCapacity + 0.5 * 0.5 * GAS_CONSTANT,
    12,
  );
});

test('the free-rotor heat capacity of a vanishing mode is exactly R/2', () => {
  const soft = vibrationalContribution(Float64Array.of(0.01), OPTIONS);
  expect(soft.heatCapacity).toBeCloseTo(0.5 * GAS_CONSTANT, 7);
});

test('an empty mode list contributes nothing', () => {
  const none = vibrationalContribution(new Float64Array(0), OPTIONS);
  expect(none).toStrictEqual({
    zeroPointEnergy: 0,
    thermalEnergy: 0,
    entropy: 0,
    heatCapacity: 0,
  });
});
