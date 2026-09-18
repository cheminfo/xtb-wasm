import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { foldSpectrum } from '../fold.ts';
import { normalizeXtbService } from '../normalize.ts';
import type { XtbServiceIrResult } from '../types.ts';

function load(name: string): XtbServiceIrResult {
  return JSON.parse(readFileSync(join(import.meta.dirname, name), 'utf8')) as XtbServiceIrResult;
}

test('the fold grid matches the service grid exactly', () => {
  const raw = load('water.json');
  const { x } = foldSpectrum([1000], [1]);
  expect(x).toHaveLength(10001);
  expect(x[0]).toBe(0);
  expect(x[10000]).toBe(4000);
  expect(x.length).toBe(raw.wavenumbers.length);
  for (let i = 0; i < x.length; i++) {
    expect(x[i]).toBeCloseTo(raw.wavenumbers[i] as number, 12);
  }
});

test.each([
  ['water.json', 3],
  ['eth_GFN2xTB.json', 21],
  ['benzene.json', 30],
])('refolding %s reproduces the service spectrum to machine precision', (file, nbVibrations) => {
  const raw = load(file);
  const result = normalizeXtbService(raw, 'GFN2xTB');
  expect(result.modes).toHaveLength(nbVibrations);

  const wavenumbers: number[] = [];
  const intensities: number[] = [];
  for (const mode of result.modes) {
    if (!mode.imaginary) {
      wavenumbers.push(mode.wavenumber);
      intensities.push(mode.intensity);
    }
  }

  const { y } = foldSpectrum(wavenumbers, intensities);
  let maxAbsolute = 0;
  for (let i = 0; i < y.length; i++) {
    const delta = Math.abs((y[i] as number) - (raw.intensities[i] as number));
    if (delta > maxAbsolute) maxAbsolute = delta;
  }
  expect(maxAbsolute).toBeLessThan(1e-12);
});

test('mismatched input lengths throw', () => {
  expect(() => foldSpectrum([1, 2], [1])).toThrow(RangeError);
});
