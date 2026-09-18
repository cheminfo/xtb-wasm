import { expect, test } from 'vitest';

import { geometryFromPdb } from '../pdb.ts';

import { readFixture } from './readFixture.ts';

test('reads a real PDB entry in file order, with no warnings', () => {
  const { geometry, warnings } = geometryFromPdb(readFixture('peptide.pdb'));

  expect(warnings).toStrictEqual([]);
  expect(geometry.elements).toHaveLength(50);
  expect(geometry.coordinates).toHaveLength(150);
  expect(geometry.elements.slice(0, 6)).toStrictEqual([
    'N',
    'C',
    'C',
    'O',
    'N',
    'C',
  ]);
  // ATOM      1  N   GLY A 300       0.958   0.885   3.506
  expect(geometry.coordinates.slice(0, 6)).toStrictEqual(
    new Float64Array([0.958, 0.885, 3.506, 2.189, 0.13, 3.261]),
  );
  expect(geometry.elements.at(-1)).toBe('O');
  expect(geometry.coordinates.slice(-3)).toStrictEqual(
    new Float64Array([12.554, -2.226, 0.065]),
  );
});

test('normalizes the element column, guesses it, and honours altLoc and MODEL', () => {
  const { geometry, warnings } = geometryFromPdb(readFixture('edge.pdb'));

  expect(geometry.elements).toStrictEqual(['N', 'C', 'Cl', 'H', 'H']);
  expect([...geometry.coordinates]).toStrictEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, -1.5, -2.5, -3.5,
  ]);
  expect(warnings).toStrictEqual([
    'kept the first of 2 models',
    'dropped 1 alternate-location atom',
    'guessed the element of 1 atom from the atom name, because columns 77-78 were empty or unknown',
    'treated 1 deuterium or tritium atom as hydrogen, because GFN2 has no isotope support',
  ]);
});

test('rejects a file with no coordinate record', () => {
  expect(() => geometryFromPdb('HEADER    NOTHING\nEND\n')).toThrow(
    'the PDB file contains no readable ATOM or HETATM record',
  );
});

test('drops an ATOM record that is truncated before its coordinates', () => {
  const truncated = 'ATOM      1  N   GLY A 300       0.958   0.885\nEND\n';

  expect(() => geometryFromPdb(truncated)).toThrow(
    'the PDB file contains no readable ATOM or HETATM record',
  );
});
