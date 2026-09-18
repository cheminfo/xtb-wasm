import { expect, test } from 'vitest';

import { detectFormat } from '../detect.ts';

import { readFixture } from './readFixture.ts';

test('the extension decides the format', () => {
  expect(detectFormat('CCO', 'input.smi')).toBe('smiles');
  expect(detectFormat('CCO', 'INPUT.SMILES')).toBe('smiles');
  expect(detectFormat('anything', 'a.mol')).toBe('molfile');
  expect(detectFormat('anything', 'a.mdl')).toBe('molfile');
  expect(detectFormat('anything', 'a.sdf')).toBe('sdf');
  expect(detectFormat('anything', 'a.sd')).toBe('sdf');
  expect(detectFormat('anything', 'a.xyz')).toBe('xyz');
  expect(detectFormat('anything', 'a.pdb')).toBe('pdb');
  expect(detectFormat('anything', 'a.ent')).toBe('pdb');
});

test('sniffs each format from its contents when the name says nothing', () => {
  expect(detectFormat(readFixture('three.sdf'))).toBe('sdf');
  expect(detectFormat(readFixture('peptide.pdb'))).toBe('pdb');
  expect(detectFormat(readFixture('edge.pdb'))).toBe('pdb');
  expect(detectFormat(readFixture('water_3d.mol'))).toBe('molfile');
  expect(detectFormat(readFixture('caffeine_v3000.mol'))).toBe('molfile');
  expect(detectFormat(readFixture('water.xyz'))).toBe('xyz');
  expect(detectFormat('CC(=O)Oc1ccccc1C(=O)O')).toBe('smiles');
});

test('an unknown extension falls back to sniffing the contents', () => {
  expect(detectFormat(readFixture('water.xyz'), 'geometry.txt')).toBe('xyz');
  expect(detectFormat(readFixture('three.sdf'), 'library.dat')).toBe('sdf');
});

test('rejects prose instead of parsing it as a SMILES', () => {
  // Molecule.fromText('hello world!!') returns a 26-atom C19H94N6 molecule
  // rather than failing, so the guard has to be here.
  expect(() => detectFormat('hello world!!')).toThrow(
    'could not tell what format this is',
  );
  expect(() => detectFormat('')).toThrow('could not tell what format this is');
  expect(() => detectFormat('two words here')).toThrow(
    'could not tell what format this is',
  );
});

test('an SDF is detected before the molfile its first record is', () => {
  expect(detectFormat(readFixture('three.sdf'))).not.toBe('molfile');
});
