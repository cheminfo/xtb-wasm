import { expect, test } from 'vitest';

import { AVOGADRO, GAS_CONSTANT, HARTREE_J } from '../constants.ts';
import { thermochemistry } from '../thermochemistry.ts';

import {
  ARGON,
  CARBON_DIOXIDE,
  HYDROGEN_CYANIDE,
  NEARLY_LINEAR_TRIHYDROGEN,
  WATER,
} from './moleculeSamples.ts';

const WATER_REQUEST = {
  ...WATER,
  wavenumbers: [1538.9, 3643.06, 3651.64],
  electronicEnergy: -5.070544344175,
  symmetry: { pointGroup: 'C2v', symmetryNumber: 2 },
};

const CARBON_DIOXIDE_REQUEST = {
  ...CARBON_DIOXIDE,
  wavenumbers: [667.4, 667.4, 1333, 2349],
  electronicEnergy: 0,
  symmetry: { pointGroup: 'Dooh', symmetryNumber: 2 },
};

const HYDROGEN_CYANIDE_REQUEST = {
  ...HYDROGEN_CYANIDE,
  wavenumbers: [712, 712, 2129, 3311],
  electronicEnergy: 0,
  symmetry: { pointGroup: 'Coov', symmetryNumber: 1 },
};

const ARGON_REQUEST = { ...ARGON, wavenumbers: [], electronicEnergy: 0 };

/**
 * An entropy or heat capacity in the units the literature tabulates.
 * @param hartreePerKelvin - The value as the thermochemistry block reports it.
 * @returns The same value in J/(mol·K).
 */
function toJoulePerMoleKelvin(hartreePerKelvin: number): number {
  return hartreePerKelvin * HARTREE_J * AVOGADRO;
}

test('modes within 1 cm-1 of zero are ignored, so adding them changes nothing', () => {
  const clean = thermochemistry(WATER_REQUEST);
  const withResiduals = thermochemistry({
    ...WATER_REQUEST,
    wavenumbers: [-0.93, -0.12, 0, 0.44, 1, ...WATER_REQUEST.wavenumbers],
  });
  expect(withResiduals).toStrictEqual(clean);
});

test('a negative mode above -20 cm-1 is inverted rather than dropped', () => {
  const inverted = thermochemistry({
    ...WATER_REQUEST,
    wavenumbers: [-15, ...WATER_REQUEST.wavenumbers],
  });
  const positive = thermochemistry({
    ...WATER_REQUEST,
    wavenumbers: [15, ...WATER_REQUEST.wavenumbers],
  });
  expect(inverted.zeroPointEnergy).toBe(positive.zeroPointEnergy);
  expect(inverted.gibbsCorrection).toBe(positive.gibbsCorrection);
  expect(inverted.skippedImaginaryModes).toBe(0);
});

test('a mode at or below -20 cm-1 is dropped and counted as imaginary', () => {
  const saddle = thermochemistry({
    ...WATER_REQUEST,
    wavenumbers: [-412.6, -20, ...WATER_REQUEST.wavenumbers],
  });
  expect(saddle.skippedImaginaryModes).toBe(2);
  expect(saddle.zeroPointEnergy).toBe(
    thermochemistry(WATER_REQUEST).zeroPointEnergy,
  );
});

test('carbon dioxide takes the linear branch and reproduces its tabulated entropy', () => {
  const result = thermochemistry(CARBON_DIOXIDE_REQUEST);
  expect(result.isLinear).toBe(true);
  expect(result.symmetryNumber).toBe(2);
  // Tabulated S° is 213.79 J/(mol·K) at 1 bar, i.e. 213.68 at the 1 atm used here.
  expect(toJoulePerMoleKelvin(result.entropy)).toBeCloseTo(213.6455, 3);
  // Tabulated Cp is 37.14 J/(mol·K), i.e. Cv = 28.82.
  expect(toJoulePerMoleKelvin(result.heatCapacity)).toBeCloseTo(28.8259, 3);
});

test('a linear rotor carries RT of rotational enthalpy where a bent one carries 3RT/2', () => {
  // At 50 K every vibration of either molecule is frozen out, so the thermal
  // correction is purely rotational plus the 5RT/2 of translation and PV.
  const linear = thermochemistry({
    ...CARBON_DIOXIDE_REQUEST,
    temperature: 50,
  });
  const bent = thermochemistry({ ...WATER_REQUEST, temperature: 50 });
  const scale = 1 / (GAS_CONSTANT * 50);
  expect(toJoulePerMoleKelvin(linear.thermalCorrection) * scale).toBeCloseTo(
    3.5,
    6,
  );
  expect(toJoulePerMoleKelvin(bent.thermalCorrection) * scale).toBeCloseTo(
    4,
    12,
  );
});

test('hydrogen cyanide is linear with sigma 1', () => {
  const result = thermochemistry(HYDROGEN_CYANIDE_REQUEST);
  expect(result.isLinear).toBe(true);
  expect(result.symmetryNumber).toBe(1);
  // Tabulated S° is 201.8 J/(mol·K) and Cp 35.9, i.e. Cv = 27.6.
  expect(toJoulePerMoleKelvin(result.entropy)).toBeCloseTo(201.7252, 3);
  expect(toJoulePerMoleKelvin(result.heatCapacity)).toBeCloseTo(27.5648, 3);
});

test('a single atom has no vibrations and no rotations at all', () => {
  const result = thermochemistry(ARGON_REQUEST);
  expect(result.zeroPointEnergy).toBe(0);
  expect(result.isLinear).toBe(false);
  expect(result.skippedImaginaryModes).toBe(0);
  expect(toJoulePerMoleKelvin(result.heatCapacity) / GAS_CONSTANT).toBeCloseTo(
    1.5,
    12,
  );
  expect(
    toJoulePerMoleKelvin(result.thermalCorrection) / (GAS_CONSTANT * 298.15),
  ).toBeCloseTo(2.5, 12);
  // Sackur-Tetrode for argon: 154.846 J/(mol·K) at 1 bar, 154.736 at 1 atm.
  expect(toJoulePerMoleKelvin(result.entropy)).toBeCloseTo(154.7362, 3);
});

test('a nearly linear rotor with a zeroed moment stays finite', () => {
  const result = thermochemistry({
    ...NEARLY_LINEAR_TRIHYDROGEN,
    wavenumbers: [500, 900, 1400, 2000],
    electronicEnergy: 0,
  });
  expect(result.isLinear).toBe(true);
  expect(Number.isFinite(result.entropy)).toBe(true);
  expect(result.gibbsCorrection).toBeCloseTo(-0.0037536318, 9);
});

test('entropy rises and free energy falls as the temperature rises', () => {
  let previousEntropy = -Infinity;
  let previousGibbs = Infinity;
  for (const temperature of [100, 200, 298.15, 500, 1000, 2000]) {
    const result = thermochemistry({ ...WATER_REQUEST, temperature });
    expect(result.entropy).toBeGreaterThan(previousEntropy);
    expect(result.totalFreeEnergy).toBeLessThan(previousGibbs);
    previousEntropy = result.entropy;
    previousGibbs = result.totalFreeEnergy;
  }
});

test('the heat capacity is positive everywhere and reaches 6R for water', () => {
  for (const temperature of [10, 100, 298.15, 1000]) {
    expect(
      thermochemistry({ ...WATER_REQUEST, temperature }).heatCapacity,
    ).toBeGreaterThan(0);
  }
  const hot = thermochemistry({ ...WATER_REQUEST, temperature: 2e6 });
  // 3R/2 translation + 3R/2 rotation + 3R for three fully excited vibrations.
  expect(toJoulePerMoleKelvin(hot.heatCapacity) / GAS_CONSTANT).toBeCloseTo(
    6,
    5,
  );
});

test('raising the pressure removes R·ln(p/p0) of entropy', () => {
  const standard = thermochemistry(ARGON_REQUEST);
  const doubled = thermochemistry({ ...ARGON_REQUEST, pressure: 202_650 });
  expect(
    toJoulePerMoleKelvin(doubled.entropy - standard.entropy) / GAS_CONSTANT,
  ).toBeCloseTo(-Math.LN2, 12);
});

test('an unpaired electron adds R·ln 2 of electronic entropy', () => {
  const doublet = thermochemistry({ ...WATER_REQUEST, unpairedElectrons: 1 });
  const singlet = thermochemistry(WATER_REQUEST);
  expect(
    toJoulePerMoleKelvin(doublet.entropy - singlet.entropy) / GAS_CONSTANT,
  ).toBeCloseTo(Math.LN2, 12);
});

test('a smaller rotor threshold moves entropy back towards the oscillator', () => {
  const soft = {
    ...WATER_REQUEST,
    wavenumbers: [30, 60, ...WATER_REQUEST.wavenumbers],
  };
  const damped = thermochemistry(soft);
  const harmonic = thermochemistry({ ...soft, rotorThreshold: -1 });
  expect(harmonic.entropy).toBeGreaterThan(damped.entropy);
  expect(thermochemistry({ ...soft, rotorThreshold: 50 })).toStrictEqual(
    damped,
  );
});

test('a non-physical temperature, pressure or symmetry number is refused', () => {
  expect(() => thermochemistry({ ...WATER_REQUEST, temperature: 0 })).toThrow(
    'temperature must be positive, received 0',
  );
  expect(() => thermochemistry({ ...WATER_REQUEST, pressure: -1 })).toThrow(
    'pressure must be positive, received -1',
  );
  expect(() =>
    thermochemistry({ ...WATER_REQUEST, symmetryNumber: 0 }),
  ).toThrow('symmetry number must be at least 1, received 0');
});

test('a negative or fractional unpaired-electron count is refused', () => {
  // 2S + 1 would be zero or negative, and R·ln of that is −Infinity, which
  // would propagate silently into an infinitely negative free energy.
  expect(() =>
    thermochemistry({ ...WATER_REQUEST, unpairedElectrons: -1 }),
  ).toThrow('unpairedElectrons must be a non-negative integer, received -1');
  expect(() =>
    thermochemistry({ ...WATER_REQUEST, unpairedElectrons: 1.5 }),
  ).toThrow('unpairedElectrons must be a non-negative integer, received 1.5');
});
