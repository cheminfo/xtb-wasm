import { expect, test } from 'vitest';

import { fromXyz, toXyz } from '../geometry.ts';

const WATER = {
  elements: ['O', 'H', 'H'],
  coordinates: new Float64Array([
    0, 0, 0.1173, 0, 0.7572, -0.4692, 0, -0.7572, -0.4692,
  ]),
};

test('formats an XYZ file', () => {
  const text = toXyz(WATER, 'water');
  const lines = text.trimEnd().split('\n');

  expect(lines).toHaveLength(5);
  expect(lines[0]).toBe('3');
  expect(lines[1]).toBe('water');
  expect(lines[2]).toBe('O 0.000000 0.000000 0.117300');
  expect(lines[4]).toBe('H 0.000000 -0.757200 -0.469200');
});

test('round-trips through XYZ', () => {
  const parsed = fromXyz(toXyz(WATER, 'water'));

  expect(parsed.elements).toStrictEqual(['O', 'H', 'H']);
  expect(parsed.coordinates).toHaveLength(9);
  for (let index = 0; index < WATER.coordinates.length; index++) {
    expect(parsed.coordinates[index]).toBeCloseTo(
      WATER.coordinates[index] as number,
      6,
    );
  }
});

test('rejects a file whose first line is not an atom count', () => {
  expect(() => fromXyz('not a number\ncomment\nO 0 0 0\n')).toThrow(
    'first line of an XYZ file must be the atom count',
  );
});

test('rejects a truncated file', () => {
  expect(() => fromXyz('3\ncomment\nO 0 0 0\n')).toThrow(
    'XYZ file ends after 1 of 3 atoms',
  );
});

test('rejects a malformed atom line', () => {
  expect(() => fromXyz('1\ncomment\nO 0 0\n')).toThrow('malformed XYZ line');
});
