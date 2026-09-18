import { expect, test } from 'vitest';

import {
  MIN_COLUMNS_PER_WORKER,
  PARALLEL_MIN_COORDINATES,
  poolSize,
} from '../occPoolSize.ts';

test('a molecule below the parallel threshold runs on one instance', () => {
  // Water is 3N = 9: the whole sweep is 19 ms, the pool costs ~200 ms to warm.
  expect(poolSize({ coordinates: 9, hardwareConcurrency: 8 })).toBe(1);
  expect(
    poolSize({
      coordinates: PARALLEL_MIN_COORDINATES - 1,
      hardwareConcurrency: 8,
    }),
  ).toBe(1);
});

test('benzene and caffeine get the measured worker counts on 8 logical cores', () => {
  expect(poolSize({ coordinates: 36, hardwareConcurrency: 8 })).toBe(6);
  expect(poolSize({ coordinates: 72, hardwareConcurrency: 8 })).toBe(7);
  expect(poolSize({ coordinates: 99, hardwareConcurrency: 8 })).toBe(7);
});

test('one logical core is left for the main thread', () => {
  expect(poolSize({ coordinates: 300, hardwareConcurrency: 4 })).toBe(3);
  expect(poolSize({ coordinates: 300, hardwareConcurrency: 2 })).toBe(1);
  expect(poolSize({ coordinates: 300, hardwareConcurrency: 1 })).toBe(1);
});

test('each worker gets at least MIN_COLUMNS_PER_WORKER columns', () => {
  expect(MIN_COLUMNS_PER_WORKER).toBe(6);
  expect(poolSize({ coordinates: 24, hardwareConcurrency: 16 })).toBe(4);
  expect(poolSize({ coordinates: 30, hardwareConcurrency: 16 })).toBe(5);
});

test('maxWorkers 1 pins the exactly reproducible path', () => {
  expect(
    poolSize({ coordinates: 300, hardwareConcurrency: 16, maxWorkers: 1 }),
  ).toBe(1);
  expect(
    poolSize({ coordinates: 300, hardwareConcurrency: 16, maxWorkers: 3 }),
  ).toBe(3);
});
