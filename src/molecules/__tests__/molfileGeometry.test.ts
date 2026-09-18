import { expect, test } from 'vitest';

import { geometryFromMolfile, geometryInOclOrder } from '../molfileGeometry.ts';
import { getOcl } from '../ocl.ts';

import { OCL_TIMEOUT } from './oclTimeout.ts';
import { readFixture } from './readFixture.ts';

test('reads a V2000 atom block exactly as written', () => {
  const geometry = geometryFromMolfile(readFixture('water_3d.mol'));

  expect(geometry.elements).toStrictEqual(['O', 'H', 'H']);
  expect([...geometry.coordinates]).toStrictEqual([
    0, 0, 0.1173, 0, 0.7572, -0.4692, 0, -0.7572, -0.4692,
  ]);
});

test(
  'openchemlib negates y and z, which is why the text is read directly',
  async () => {
    const ocl = await getOcl();
    const molfile = readFixture('water_3d.mol');
    const structure = ocl.Molecule.fromMolfile(molfile);
    const geometry = geometryFromMolfile(molfile);

    expect(structure.getAtomZ(0)).toBeCloseTo(-0.1173, 6);
    expect(structure.getAtomY(1)).toBeCloseTo(-0.7572, 6);
    expect(geometry.coordinates[2]).toBe(0.1173);
    expect(geometry.coordinates[4]).toBe(0.7572);
  },
  OCL_TIMEOUT,
);

test('reads a V3000 atom block', () => {
  const geometry = geometryFromMolfile(readFixture('caffeine_v3000.mol'));

  expect(geometry.elements).toStrictEqual([
    'C',
    'N',
    'C',
    'N',
    'C',
    'N',
    'C',
    'C',
    'O',
    'N',
    'C',
    'C',
    'O',
    'C',
  ]);
  expect(geometry.coordinates.slice(0, 6)).toStrictEqual(
    new Float64Array([0.866, 0, 0, 0, -0.5, 0]),
  );
});

test(
  'the atom block order is openchemlib atom order for heavy-atoms-first files',
  async () => {
    const ocl = await getOcl();
    for (const name of ['acetate.mol', 'caffeine_v3000.mol', 'water_3d.mol']) {
      const molfile = readFixture(name);
      const structure = ocl.Molecule.fromMolfile(molfile);
      const labels: string[] = [];
      for (let atom = 0; atom < structure.getAllAtoms(); atom++) {
        labels.push(structure.getAtomLabel(atom));
      }

      expect(labels).toStrictEqual(geometryFromMolfile(molfile).elements);
    }
  },
  OCL_TIMEOUT,
);

test('rejects a molfile that is too short to hold a counts line', () => {
  expect(() => geometryFromMolfile('one\ntwo\nthree\n')).toThrow(
    'the counts line of a V2000 molfile must start with an atom count',
  );
});

test('rejects a V2000 atom block that ends early', () => {
  const truncated =
    'x\n\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n' +
    '    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n';

  expect(() => geometryFromMolfile(truncated)).toThrow(
    'the atom block of a V2000 molfile ends after 1 of 3 atoms',
  );
});

test(
  'permutes an interleaved atom block into openchemlib atom order',
  async () => {
    const ocl = await getOcl();
    const molfile = readFixture('methanol_interleaved.mol');
    const structure = ocl.Molecule.fromMolfile(molfile);

    // The file lists C H H H O H; openchemlib's V2000 parser moves the
    // hydrogens to the end, so the two disagree on what atom 1 is.
    expect(geometryFromMolfile(molfile).elements).toStrictEqual([
      'C',
      'H',
      'H',
      'H',
      'O',
      'H',
    ]);

    const geometry = geometryInOclOrder(molfile, structure);
    const labels: string[] = [];
    for (let atom = 0; atom < structure.getAllAtoms(); atom++) {
      labels.push(structure.getAtomLabel(atom));
    }

    expect(labels).toStrictEqual(['C', 'O', 'H', 'H', 'H', 'H']);
    expect(geometry.elements).toStrictEqual(labels);
    // Every coordinate is still the file's own value, only moved.
    expect([...geometry.coordinates]).toStrictEqual([
      -0.748, 0, 0.033, 0.671, 0, -0.041, -1.159, 0.889, -0.444, -1.096, 0,
      1.065, -1.159, -0.889, -0.444, 1.023, 0, 0.848,
    ]);
  },
  OCL_TIMEOUT,
);

test(
  'leaves an atom block that already matches openchemlib untouched',
  async () => {
    const ocl = await getOcl();
    const molfile = readFixture('water_3d.mol');
    const structure = ocl.Molecule.fromMolfile(molfile);

    expect([
      ...geometryInOclOrder(molfile, structure).coordinates,
    ]).toStrictEqual([...geometryFromMolfile(molfile).coordinates]);
  },
  OCL_TIMEOUT,
);
