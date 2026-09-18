import { expect, test } from 'vitest';

import {
  KCAL_PER_MOL_PER_HARTREE,
  WAVENUMBER_PER_HARTREE,
} from '../constants.ts';
import type { DetectedSymmetry } from '../symmetry.ts';
import { thermochemistry } from '../thermochemistry.ts';

import { readReferenceFixture } from './referenceFixture.ts';

/**
 * Half-width of the interval a stored frequency was rounded from: the fixtures
 * print two decimals, so every wavenumber carries an independent uniform
 * uncertainty of ±0.005 cm⁻¹. That rounding, not the model, sets the floor on
 * every comparison below.
 */
const FREQUENCY_HALF_WIDTH = 0.005;

/**
 * `toBeCloseTo(value, digits)` admits a deviation of `10**-digits / 2`, so a
 * budget of `b` standard deviations is passed in as `2 * b`. The largest
 * deviation actually observed over the ten fixtures is 2.3 σ for the zero-point
 * energy (cholesterol) and 2.7 σ for the free energy, which is why the free
 * energy gets the wider budget: it depends on ln ν through the free-rotor term
 * and so is more rounding-sensitive than a plain sum of frequencies.
 */
const ZERO_POINT_BUDGET = 2 * 6;

/** Deviation budget for H and G, in standard deviations, doubled as above. */
const FREE_ENERGY_BUDGET = 2 * 8;

/** Point group and σ occ's `MolecularPointGroup` reports for each fixture. */
const SYMMETRY = new Map<string, DetectedSymmetry>([
  ['water', { pointGroup: 'C2v', symmetryNumber: 2 }],
  ['methanol', { pointGroup: 'Cs', symmetryNumber: 1 }],
  ['acetic_acid', { pointGroup: 'Cs', symmetryNumber: 1 }],
  ['benzene', { pointGroup: 'D6h', symmetryNumber: 12 }],
  ['toluene', { pointGroup: 'C1', symmetryNumber: 1 }],
  ['paracetamol', { pointGroup: 'Cs', symmetryNumber: 1 }],
  ['aspirin', { pointGroup: 'C1', symmetryNumber: 1 }],
  ['caffeine', { pointGroup: 'Cs', symmetryNumber: 1 }],
  ['ibuprofen', { pointGroup: 'C1', symmetryNumber: 1 }],
  ['cholesterol', { pointGroup: 'C1', symmetryNumber: 1 }],
]);

const FIXTURE_NAMES = Array.from(SYMMETRY.keys());

test.each(FIXTURE_NAMES)(
  'the tier-1 zero-point energy of %s matches xtb',
  (name) => {
    const fixture = readReferenceFixture(name);
    const result = thermochemistry({
      geometry: fixture.geometry,
      masses: fixture.masses,
      wavenumbers: fixture.tierOneWavenumbers,
      electronicEnergy: fixture.tierOneElectronicEnergy,
      symmetry: SYMMETRY.get(name),
    });
    expect(result.zeroPointEnergy).toBeCloseTo(
      fixture.tierOneZeroPointEnergy,
      -Math.log10(
        ZERO_POINT_BUDGET * roundingSigma(fixture.tierOneWavenumbers.length),
      ),
    );
  },
);

test.each(FIXTURE_NAMES)(
  'the enthalpy and free energy of %s match xtb',
  (name) => {
    const fixture = readReferenceFixture(name);
    const result = thermochemistry({
      geometry: fixture.geometry,
      masses: fixture.masses,
      wavenumbers: fixture.wavenumbers,
      electronicEnergy: fixture.electronicEnergy,
      symmetry: SYMMETRY.get(name),
    });
    const digits = -Math.log10(
      FREE_ENERGY_BUDGET * roundingSigma(fixture.wavenumbers.length),
    );
    expect(result.totalEnthalpy).toBeCloseTo(fixture.totalEnthalpy, digits);
    expect(result.totalFreeEnergy).toBeCloseTo(fixture.totalFreeEnergy, digits);
    expect(result.gibbsCorrection).toBeCloseTo(fixture.gibbsCorrection, digits);
    expect(result.gibbsCorrection - result.zeroPointEnergy).toBeCloseTo(
      fixture.gibbsWithoutZeroPoint,
      digits,
    );
  },
);

test.each(FIXTURE_NAMES)('%s reports the symmetry it was given', (name) => {
  const fixture = readReferenceFixture(name);
  const detected = SYMMETRY.get(name) as DetectedSymmetry;
  const result = thermochemistry({
    geometry: fixture.geometry,
    masses: fixture.masses,
    wavenumbers: fixture.wavenumbers,
    electronicEnergy: fixture.electronicEnergy,
    symmetry: detected,
  });
  expect(result.pointGroup).toBe(detected.pointGroup);
  expect(result.symmetryNumber).toBe(detected.symmetryNumber);
  expect(result.isLinear).toBe(false);
  expect(result.skippedImaginaryModes).toBe(0);
  expect(result.temperature).toBe(298.15);
  expect(result.pressure).toBe(101_325);
});

test('every reported total is consistent with its correction', () => {
  const fixture = readReferenceFixture('benzene');
  const result = thermochemistry({
    geometry: fixture.geometry,
    masses: fixture.masses,
    wavenumbers: fixture.wavenumbers,
    electronicEnergy: fixture.electronicEnergy,
    symmetry: SYMMETRY.get('benzene'),
  });
  expect(result.totalEnthalpy - fixture.electronicEnergy).toBeCloseTo(
    result.enthalpyCorrection,
    14,
  );
  expect(result.totalFreeEnergy - fixture.electronicEnergy).toBeCloseTo(
    result.gibbsCorrection,
    14,
  );
  expect(result.enthalpyCorrection - 298.15 * result.entropy).toBeCloseTo(
    result.gibbsCorrection,
    14,
  );
  expect(result.zeroPointEnergy + result.thermalCorrection).toBeCloseTo(
    result.enthalpyCorrection,
    14,
  );
});

test('the caller can override the detected symmetry number', () => {
  const fixture = readReferenceFixture('benzene');
  const options = {
    geometry: fixture.geometry,
    masses: fixture.masses,
    wavenumbers: fixture.wavenumbers,
    electronicEnergy: fixture.electronicEnergy,
    symmetry: SYMMETRY.get('benzene'),
  };
  const asDetected = thermochemistry(options);
  const asOverridden = thermochemistry({ ...options, symmetryNumber: 1 });
  expect(asOverridden.symmetryNumber).toBe(1);
  expect(asOverridden.pointGroup).toBe('D6h');
  // Dropping σ from 12 to 1 adds R·ln 12 of entropy, so G falls by RT·ln 12.
  expect(
    (asOverridden.gibbsCorrection - asDetected.gibbsCorrection) *
      KCAL_PER_MOL_PER_HARTREE,
  ).toBeCloseTo(-1.4723, 4);
});

/**
 * The accumulated uncertainty the stored two-decimal frequencies imply for an
 * energy that is half their sum, in Hartree. Each wavenumber is rounded
 * independently, so the standard deviation of the sum grows as √n.
 * @param modeCount - Number of stored wavenumbers.
 * @returns One standard deviation of the rounding noise, Eh.
 */
function roundingSigma(modeCount: number): number {
  return (
    (0.5 * Math.sqrt(modeCount / 3) * FREQUENCY_HALF_WIDTH) /
    WAVENUMBER_PER_HARTREE
  );
}
