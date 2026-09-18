import { beforeAll, expect, test } from 'vitest';

import type { VibrationalMode } from '../../types/index.ts';
import { DEFAULT_OUTPUTS } from '../../types/index.ts';
import { assembleModes } from '../occModes.ts';
import { loadOccModule } from '../occModule.ts';
import { runVibrational } from '../occRun.ts';
import type { OccModule } from '../occTypes.ts';

import { GAS_PHASE_SETTINGS, loadFixture } from './fixtures.ts';

/**
 * These tolerances are NOT the ones in `src/reference/tolerances.json`:
 * those were derived for a WebAssembly build of xtb 6.7.1 itself, whereas OCC is
 * an independent reimplementation of GFN2 and the fixture geometries are xtb's
 * stationary points, not OCC's. The values below are the agreement actually
 * measured on the three fixtures asserted here — water 0.11 cm⁻¹ / 0.35 %,
 * methanol 0.47 cm⁻¹ / 3.7 %, benzene 0.59 cm⁻¹ / 2.9 % — with roughly a factor
 * of two of headroom, so a real regression still fails.
 *
 * They do NOT generalize to every fixture, and must not be widened until one
 * does: acetic acid is measured at 2.9 cm⁻¹ on its 113 cm⁻¹ torsion and 10.9 %
 * on one band. Soft low-frequency modes are where OCC and xtb diverge most, so
 * a fixture is added here only once its own agreement has been measured.
 */
const FREQUENCY_TOLERANCE_CM = 1.2;
const STRONG_INTENSITY_TOLERANCE = 0.06;
const WEAK_INTENSITY_TOLERANCE_KM_PER_MOL = 0.35;
const ENERGY_TOLERANCE_HARTREE = 1e-5;
const INVARIANT_TOLERANCE = 5e-4;

let module: OccModule;

beforeAll(async () => {
  module = await loadOccModule();
}, 120_000);

test('water reproduces the native xtb tier-1 reference', () => {
  expectFixture('water');
}, 120_000);

test('methanol reproduces the native xtb tier-1 reference', () => {
  expectFixture('methanol');
}, 300_000);

test('benzene reproduces the native xtb tier-1 reference', () => {
  expectFixture('benzene');
}, 300_000);

/** Run one fixture at its stored geometry and check every tier-1 quantity. */
function expectFixture(name: string): void {
  const { geometry, reference } = loadFixture(name);
  const raw = runVibrational(module, {
    geometry,
    settings: GAS_PHASE_SETTINGS,
    outputs: DEFAULT_OUTPUTS,
  });
  const modes = assembleModes({
    atoms: geometry.elements.length,
    masses: raw.masses,
    frequencies: raw.frequencies,
    normalModes: raw.normalModes,
    dipoleDerivatives: raw.dipoleDerivatives,
  });

  expect(modes).toHaveLength(reference.modeCount);
  // An explicit absolute bound, because `toBeCloseTo(value, 5)` would assert
  // 5e-6 rather than the 1e-5 the constant names, and benzene sits at 4.1e-6.
  expect(
    Math.abs(raw.energy.total - reference.totalEnergy),
    'total energy',
  ).toBeLessThan(ENERGY_TOLERANCE_HARTREE);

  let imaginary = 0;
  for (const mode of modes) if (mode.wavenumber < 0) imaginary++;
  expect(imaginary).toBe(reference.imaginaryCount);

  for (let index = 0; index < modes.length; index++) {
    const mode = modes[index] as VibrationalMode;
    const expectedFrequency = reference.frequencies[index] as number;
    expect(
      Math.abs(mode.wavenumber - expectedFrequency),
      `mode ${index} at ${expectedFrequency} cm⁻¹`,
    ).toBeLessThan(FREQUENCY_TOLERANCE_CM);

    const expectedIntensity = reference.irIntensities[index] as number;
    const actual = mode.irIntensity as number;
    if (expectedIntensity > 1) {
      expect(
        Math.abs(actual - expectedIntensity) / expectedIntensity,
        `intensity of mode ${index}`,
      ).toBeLessThan(STRONG_INTENSITY_TOLERANCE);
    } else {
      expect(
        Math.abs(actual - expectedIntensity),
        `weak intensity of mode ${index}`,
      ).toBeLessThan(WEAK_INTENSITY_TOLERANCE_KM_PER_MOL);
    }
  }

  expectInvariants(raw.hessian, geometry.elements.length * 3, reference);
}

/** The rotation-invariant scalars of the Hessian, which cover every element. */
function expectInvariants(
  hessian: Float64Array,
  size: number,
  reference: { frobeniusNorm: number; trace: number },
): void {
  let frobeniusSquared = 0;
  let trace = 0;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const value = hessian[row * size + column] as number;
      frobeniusSquared += value * value;
      if (row === column) trace += value;
    }
  }
  const frobenius = Math.sqrt(frobeniusSquared);
  expect(
    Math.abs(frobenius - reference.frobeniusNorm) / reference.frobeniusNorm,
  ).toBeLessThan(INVARIANT_TOLERANCE);
  expect(
    Math.abs(trace - reference.trace) / Math.abs(reference.trace),
  ).toBeLessThan(INVARIANT_TOLERANCE);
}
