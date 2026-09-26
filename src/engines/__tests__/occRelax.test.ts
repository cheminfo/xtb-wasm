import { beforeAll, expect, test } from 'vitest';

import type { Geometry } from '../../types/index.ts';
import { loadOccModule } from '../occModule.ts';
import {
  relaxInProcess,
  relaxRefusals,
  resolveRelaxSettings,
} from '../occRelax.ts';
import { relaxPoolSize } from '../occRelaxPool.ts';
import type { OccModule } from '../occTypes.ts';

import { loadFixture } from './fixtures.ts';

/**
 * Every bond stretched by 3 %, which is far enough out that the optimizer has
 * real work to do and near enough that it cannot fall into another minimum.
 * @param geometry - The geometry to pull apart.
 * @returns A copy, scaled about the origin.
 */
function stretched(geometry: Geometry): Geometry {
  const coordinates = new Float64Array(geometry.coordinates.length);
  for (let index = 0; index < coordinates.length; index++) {
    coordinates[index] = (geometry.coordinates[index] as number) * 1.03;
  }
  return { elements: geometry.elements, coordinates };
}

let module: OccModule;

beforeAll(async () => {
  module = await loadOccModule();
}, 120_000);

test('a distorted water relaxes back onto native xtb 6.7.1 own minimum', () => {
  const water = loadFixture('water');
  const result = relaxInProcess(module, {
    geometry: stretched(water.geometry),
  });

  expect(result.converged).toBe(true);
  expect(result.cycles).toBeGreaterThan(0);
  expect(result.warnings).toStrictEqual([]);
  expect(result.coordinates).toHaveLength(9);
  // Native xtb optimized this molecule to -5.070544344175 Eh.
  expect(result.energy.total).toBeCloseTo(water.reference.totalEnergy, 6);
  expect(bondLength(result.coordinates, 0, 1)).toBeCloseTo(
    bondLength(water.geometry.coordinates, 0, 1),
    3,
  );
  // occ is an independent implementation of GFN2, so its minimum sits a
  // fraction of a degree from native xtb's even where the energies agree to
  // 1e-7 Eh: 107.227 deg against 107.296 deg.
  expect(
    Math.abs(
      angleDegrees(result.coordinates, 1, 0, 2) -
        angleDegrees(water.geometry.coordinates, 1, 0, 2),
    ),
  ).toBeLessThan(0.1);
}, 120_000);

test('a distorted benzene relaxes back onto native xtb own minimum', () => {
  const benzene = loadFixture('benzene');
  const result = relaxInProcess(module, {
    geometry: stretched(benzene.geometry),
  });

  expect(result.converged).toBe(true);
  expect(result.energy.total).toBeCloseTo(benzene.reference.totalEnergy, 5);
}, 120_000);

test('the energy reported is the one at the geometry returned, and relaxing lowers it', () => {
  const water = loadFixture('water');
  const start = stretched(water.geometry);
  const halted = relaxInProcess(module, {
    geometry: start,
    settings: { maxCycles: 1 },
  });
  const relaxed = relaxInProcess(module, { geometry: start });

  expect(relaxed.energy.total).toBeLessThan(halted.energy.total);
  expect(halted.converged).toBe(false);
  expect(halted.warnings).toStrictEqual([
    'The optimizer stopped after 1 cycles without converging, so this geometry is not a stationary point and its energy is an upper bound.',
  ]);

  // The energy must belong to the coordinates that came back, so a single point
  // taken there again reproduces it.
  const again = relaxInProcess(module, {
    geometry: { elements: start.elements, coordinates: relaxed.coordinates },
    settings: { maxCycles: 1 },
  });
  expect(again.energy.total).toBeCloseTo(relaxed.energy.total, 8);
}, 120_000);

test('GFN2 reports a dispersion term, which is what a force field of the MMFF94 era lacks', () => {
  const result = relaxInProcess(module, {
    geometry: {
      elements: ['C', 'H', 'H', 'H', 'H'],
      coordinates: new Float64Array([
        0, 0, 0, 0.63, 0.63, 0.63, -0.63, -0.63, 0.63, -0.63, 0.63, -0.63, 0.63,
        -0.63, -0.63,
      ]),
    },
  });
  expect(result.converged).toBe(true);
  expect(result.energy.dispersion).not.toBeNull();
  expect(result.energy.dispersion).toBeLessThan(0);
}, 120_000);

test('a single atom is relaxed in zero cycles rather than sent through the optimizer', () => {
  const result = relaxInProcess(module, {
    geometry: { elements: ['Ne'], coordinates: new Float64Array([0, 0, 0]) },
  });
  expect(result.cycles).toBe(0);
  expect(result.converged).toBe(true);
  expect(result.coordinates).toStrictEqual(new Float64Array([0, 0, 0]));
  expect(Number.isFinite(result.energy.total)).toBe(true);
}, 120_000);

test('settings resolve against the defaults', () => {
  expect(resolveRelaxSettings()).toStrictEqual({
    method: 'GFN2',
    charge: 0,
    unpairedElectrons: 0,
    maxCycles: 250,
  });
  expect(resolveRelaxSettings({ charge: -1, maxCycles: 40 })).toStrictEqual({
    method: 'GFN2',
    charge: -1,
    unpairedElectrons: 0,
    maxCycles: 40,
  });
});

test('a request this build cannot honour is refused with a reason', () => {
  expect(relaxRefusals(3, resolveRelaxSettings())).toStrictEqual([]);
  expect(
    relaxRefusals(3, resolveRelaxSettings({ method: 'GFN-FF' })),
  ).toStrictEqual([
    'This WebAssembly build only implements GFN2; GFN-FF is not available.',
  ]);
  expect(relaxRefusals(0, resolveRelaxSettings())).toStrictEqual([
    'A structure with no atoms cannot be relaxed.',
  ]);
  expect(
    relaxRefusals(3, resolveRelaxSettings({ charge: 0.5, maxCycles: 0 })),
  ).toStrictEqual([
    'The charge must be an integer number of electrons.',
    'The cycle budget must be a positive whole number.',
  ]);
});

test('a refused request throws before any wasm work is done', () => {
  expect(() =>
    relaxInProcess(module, {
      geometry: loadFixture('water').geometry,
      settings: { method: 'GFN1' },
    }),
  ).toThrow('only implements GFN2');
});

test('the batch uses one instance per structure, one core below the machine', () => {
  expect(relaxPoolSize({ structures: 1, hardwareConcurrency: 8 })).toBe(1);
  expect(relaxPoolSize({ structures: 10, hardwareConcurrency: 8 })).toBe(7);
  expect(relaxPoolSize({ structures: 3, hardwareConcurrency: 8 })).toBe(3);
  expect(
    relaxPoolSize({ structures: 10, hardwareConcurrency: 8, maxWorkers: 2 }),
  ).toBe(2);
  expect(relaxPoolSize({ structures: 10, hardwareConcurrency: 1 })).toBe(1);
});

function bondLength(
  coordinates: Float64Array,
  first: number,
  second: number,
): number {
  const dx =
    (coordinates[first * 3] as number) - (coordinates[second * 3] as number);
  const dy =
    (coordinates[first * 3 + 1] as number) -
    (coordinates[second * 3 + 1] as number);
  const dz =
    (coordinates[first * 3 + 2] as number) -
    (coordinates[second * 3 + 2] as number);
  return Math.hypot(dx, dy, dz);
}

function angleDegrees(
  coordinates: Float64Array,
  first: number,
  vertex: number,
  second: number,
): number {
  const a = arm(coordinates, first, vertex);
  const b = arm(coordinates, second, vertex);
  const cosine =
    (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) /
    (Math.hypot(...a) * Math.hypot(...b));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function arm(
  coordinates: Float64Array,
  atom: number,
  vertex: number,
): [number, number, number] {
  return [
    (coordinates[atom * 3] as number) - (coordinates[vertex * 3] as number),
    (coordinates[atom * 3 + 1] as number) -
      (coordinates[vertex * 3 + 1] as number),
    (coordinates[atom * 3 + 2] as number) -
      (coordinates[vertex * 3 + 2] as number),
  ];
}
