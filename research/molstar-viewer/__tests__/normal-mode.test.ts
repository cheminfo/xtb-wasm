import { expect, test } from 'vitest';

import {
  buildModeFrames,
  framesToXyz,
  normalizeAmplitude,
  parseXyzFrames,
} from '../normal-mode.ts';

const WATER = {
  symbols: ['O', 'H', 'H'],
  coordinates: new Float64Array([0, 0, 0.1173, 0, 0.7572, -0.4692, 0, -0.7572, -0.4692]),
};
const BEND = new Float64Array([0, 0, -0.07, 0, 0.42, 0.556, 0, -0.42, 0.556]);

test('normalizeAmplitude scales the largest atomic displacement to the requested value', () => {
  const scale = normalizeAmplitude(BEND, 0.35);
  // largest per-atom norm is sqrt(0.42^2 + 0.556^2) = 0.6968...
  expect(scale).toBeCloseTo(0.35 / Math.hypot(0.42, 0.556), 12);
});

test('buildModeFrames returns a periodic cosine sweep starting at the turning point', () => {
  const frames = buildModeFrames(WATER, BEND, 1, 4);
  expect(frames).toHaveLength(4);
  // frame 0: cos(0) = 1
  expect(frames[0]![2]).toBeCloseTo(0.1173 - 0.07, 6);
  // frame 1: cos(pi/2) = 0 -> equilibrium
  expect(frames[1]![2]).toBeCloseTo(0.1173, 6);
  // frame 2: cos(pi) = -1
  expect(frames[2]![2]).toBeCloseTo(0.1173 + 0.07, 6);
  // frame 3: cos(3pi/2) = 0 -> equilibrium again
  expect(frames[3]![2]).toBeCloseTo(0.1173, 6);
});

test('buildModeFrames rejects an eigenvector of the wrong length', () => {
  expect(() => buildModeFrames(WATER, new Float64Array(6), 1, 4)).toThrow(
    'eigenvector has 6 components but the geometry has 9',
  );
});

test('framesToXyz / parseXyzFrames round-trip', () => {
  const frames = buildModeFrames(WATER, BEND, 0.5, 6);
  const round = parseXyzFrames(framesToXyz(WATER.symbols, frames));
  expect(round.symbols).toStrictEqual(['O', 'H', 'H']);
  expect(round.frames).toHaveLength(6);
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 9; i++) {
      expect(round.frames[f]![i]).toBeCloseTo(frames[f]![i]!, 5);
    }
  }
});
