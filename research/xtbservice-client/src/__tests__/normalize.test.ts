import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { normalizeLocalEngine, normalizeXtbService, parseDisplacementXyz } from '../normalize.ts';
import { CM1_TO_EV, EV_TO_HARTREE } from '../spectrum.ts';
import type { XtbServiceIrResult } from '../types.ts';

function load(name: string): XtbServiceIrResult {
  return JSON.parse(readFileSync(join(import.meta.dirname, name), 'utf8')) as XtbServiceIrResult;
}

test('water keeps only the 3 real vibrations out of 9 modes', () => {
  const result = normalizeXtbService(load('water.json'), 'GFN2xTB');
  expect(result.allModes).toHaveLength(9);
  expect(result.modes).toHaveLength(3);
  expect(result.atomCount).toBe(3);
  expect(result.modes.map((m) => Number(m.wavenumber.toFixed(3)))).toStrictEqual([
    1538.588, 3643.435, 3651.679,
  ]);
});

test('the reported zero-point energy is inflated by the spurious modes', () => {
  const raw = load('water.json');
  const result = normalizeXtbService(raw, 'GFN2xTB');
  expect(result.reportedZeroPointEnergyEv).toBe(0.5808952214974684);
  expect(result.zeroPointEnergyEv).toBeCloseTo(0.547620, 6);
  expect(result.zeroPointEnergyEv).toBeLessThan(result.reportedZeroPointEnergyEv as number);
});

test('the service zero-point energy is eV, reproduced by summing non-imaginary modes', () => {
  const raw = load('eth_GFN2xTB.json');
  let sum = 0;
  for (const mode of raw.modes) {
    if (!mode.imaginary) sum += mode.wavenumber;
  }
  // eV agrees to ~1e-8; Hartree would be off by a factor of 27, so this pins the unit.
  expect(0.5 * sum * CM1_TO_EV).toBeCloseTo(raw.zeroPointEnergy, 7);
  expect(0.5 * sum * CM1_TO_EV * EV_TO_HARTREE).not.toBeCloseTo(raw.zeroPointEnergy, 2);
});

test('the imaginary-frequency flags are recomputed over vibrations only', () => {
  const raw = load('benzene.json');
  expect(raw.hasImaginaryFrequency).toBe(true);
  const result = normalizeXtbService(raw, 'GFN2xTB');
  expect(result.hasImaginaryFrequency).toBe(false);
  expect(result.hasLargeImaginaryFrequency).toBe(false);
});

test('xtbservice never reports a total energy', () => {
  expect(normalizeXtbService(load('water.json'), 'GFN2xTB').energyHartree).toBeNull();
});

test('a local engine reproduces the service spectrum from the same modes', () => {
  const raw = load('eth_GFN2xTB.json');
  const server = normalizeXtbService(raw, 'GFN2xTB');
  const wavenumbers: number[] = [];
  const intensities: number[] = [];
  for (const mode of server.modes) {
    wavenumbers.push(mode.wavenumber);
    intensities.push(mode.intensity);
  }

  const local = normalizeLocalEngine({ method: 'GFN2xTB', wavenumbers, intensities, atomCount: 9 });
  expect(local.source).toBe('occjs');
  expect(local.modes).toHaveLength(21);
  expect(local.spectrum.x).toHaveLength(10001);

  let maxAbsolute = 0;
  for (let i = 0; i < local.spectrum.y.length; i++) {
    const delta = Math.abs((local.spectrum.y[i] as number) - (server.spectrum.y[i] as number));
    if (delta > maxAbsolute) maxAbsolute = delta;
  }
  expect(maxAbsolute).toBeLessThan(1e-12);
  expect(local.zeroPointEnergyEv).toBeCloseTo(server.zeroPointEnergyEv as number, 12);
});

test('a local engine without dipole derivatives yields a flat spectrum but correct positions', () => {
  const local = normalizeLocalEngine({
    method: 'GFN2xTB',
    wavenumbers: [1573.9, 3573.6, 3668.0],
    atomCount: 3,
  });
  expect(local.modes.map((m) => m.intensity)).toStrictEqual([0, 0, 0]);
  let sum = 0;
  for (let i = 0; i < local.spectrum.y.length; i++) sum += local.spectrum.y[i] as number;
  expect(sum).toBe(0);
  expect(local.zeroPointEnergyEv).toBeCloseTo(0.5 * (1573.9 + 3573.6 + 3668.0) * CM1_TO_EV, 12);
});

test('displacement blocks parse into per-atom positions and vectors', () => {
  const raw = load('water.json');
  const atoms = parseDisplacementXyz(raw.modes[8]?.displacements as string);
  expect(atoms).toHaveLength(3);
  expect(atoms[0]?.symbol).toBe('O');
  expect(atoms[0]?.x).toBe(0.00839);
  expect(atoms[1]?.symbol).toBe('H');
  expect(atoms[1]?.dx).toBe(0.55661);
});
