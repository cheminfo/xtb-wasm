import { expect, test } from 'vitest';

import {
  moleculeFromIdCode,
  moleculeFromMolfile,
  moleculeFromSmiles,
  moleculesFromText,
} from '../index.ts';

import { OCL_TIMEOUT } from './oclTimeout.ts';
import { readFixture } from './readFixture.ts';

test(
  'builds a 3D molecule from a SMILES',
  async () => {
    const molecule = await moleculeFromSmiles('CCO', 'ethanol');

    expect(molecule.label).toBe('ethanol');
    expect(molecule.formula).toBe('C2H6O');
    expect(molecule.smiles).toBe('CCO');
    expect(molecule.charge).toBe(0);
    expect(molecule.unpairedElectrons).toBe(0);
    expect(molecule.elements).toStrictEqual([
      'C',
      'C',
      'O',
      'H',
      'H',
      'H',
      'H',
      'H',
      'H',
    ]);
    expect(molecule.coordinates).toHaveLength(27);
    expect(molecule.source).toStrictEqual({
      kind: 'smiles',
      smiles: 'CCO',
      seed: 42,
    });
  },
  OCL_TIMEOUT,
);

test(
  'the same SMILES and seed give the same geometry',
  async () => {
    const first = await moleculeFromSmiles('CC(=O)O', 'acetic acid', 7);
    const second = await moleculeFromSmiles('CC(=O)O', 'acetic acid', 7);

    expect([...second.coordinates]).toStrictEqual([...first.coordinates]);
  },
  OCL_TIMEOUT,
);

test(
  'uses the coordinates of a 3D molfile without moving a single atom',
  async () => {
    const molecule = await moleculeFromMolfile(
      readFixture('water_3d.mol'),
      'water',
    );

    expect(molecule.formula).toBe('H2O');
    expect(molecule.elements).toStrictEqual(['O', 'H', 'H']);
    expect([...molecule.coordinates]).toStrictEqual([
      0, 0, 0.1173, 0, 0.7572, -0.4692, 0, -0.7572, -0.4692,
    ]);
  },
  OCL_TIMEOUT,
);

test(
  'generates and reports a conformer for a 2D molfile',
  async () => {
    const loaded = await moleculesFromText(
      readFixture('ethanol.mol'),
      'ethanol.mol',
    );
    const molecule = loaded.molecules[0];

    expect(loaded.molecules).toHaveLength(1);
    expect(molecule?.formula).toBe('C2H6O');
    expect(molecule?.elements).toHaveLength(9);
    expect(loaded.warnings).toStrictEqual([
      '"ethanol.mol" has no 3D coordinates, so a conformer was generated with seed 42 and minimized with MMFF94s',
    ]);
  },
  OCL_TIMEOUT,
);

test(
  'reads a V3000 molfile and adds the hydrogens it leaves implicit',
  async () => {
    const molecule = await moleculeFromMolfile(
      readFixture('caffeine_v3000.mol'),
      'caffeine',
    );

    expect(molecule.formula).toBe('C8H10N4O2');
    expect(molecule.elements).toHaveLength(24);
    expect(molecule.elements.slice(0, 14)).toStrictEqual([
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
  },
  OCL_TIMEOUT,
);

test(
  'returns every record of a multi-record SDF, in file order',
  async () => {
    const loaded = await moleculesFromText(
      readFixture('three.sdf'),
      'three.sdf',
    );

    expect(loaded.molecules).toHaveLength(3);
    expect(loaded.molecules.map((molecule) => molecule.label)).toStrictEqual([
      'ethanol',
      'acetone',
      'benzene',
    ]);
    expect(loaded.molecules.map((molecule) => molecule.formula)).toStrictEqual([
      'C2H6O',
      'C3H6O',
      'C6H6',
    ]);
    expect(
      loaded.molecules.map((molecule) => molecule.elements.length),
    ).toStrictEqual([9, 10, 12]);
    expect(loaded.molecules[2]?.source).toMatchObject({
      kind: 'sdf',
      fileName: 'three.sdf',
      record: 2,
    });
  },
  OCL_TIMEOUT,
);

test(
  'reads an XYZ geometry verbatim and names it from the comment line',
  async () => {
    const loaded = await moleculesFromText(
      readFixture('water.xyz'),
      'water.xyz',
    );
    const molecule = loaded.molecules[0];

    expect(loaded.molecules).toHaveLength(1);
    expect(molecule?.label).toBe('water, XYZ');
    expect(molecule?.formula).toBe('H2O');
    expect(molecule?.elements).toStrictEqual(['O', 'H', 'H']);
    expect([...(molecule?.coordinates ?? [])]).toStrictEqual([
      0, 0, 0.1173, 0, 0.7572, -0.4692, 0, -0.7572, -0.4692,
    ]);
  },
  OCL_TIMEOUT,
);

test(
  'reads a PDB, counting the formula from the elements it found',
  async () => {
    const loaded = await moleculesFromText(
      readFixture('peptide.pdb'),
      'peptide.pdb',
    );
    const molecule = loaded.molecules[0];

    expect(molecule?.formula).toBe('C24N11O15');
    expect(molecule?.elements).toHaveLength(50);
    expect(molecule?.charge).toBe(0);
    expect(molecule?.source).toStrictEqual({
      kind: 'pdb',
      fileName: 'peptide.pdb',
    });
  },
  OCL_TIMEOUT,
);

test(
  'an idCode is an identity, and its atom order is its own',
  async () => {
    const molecule = await moleculeFromIdCode(
      'daDH@@RVU[f@@@@',
      'benzaldehyde',
    );

    expect(molecule.formula).toBe('C7H6O');
    expect(molecule.elements).toStrictEqual([
      'O',
      'C',
      'C',
      'C',
      'C',
      'C',
      'C',
      'C',
      'H',
      'H',
      'H',
      'H',
      'H',
      'H',
    ]);
    expect(molecule.source).toStrictEqual({
      kind: 'drawn',
      idCode: 'daDH@@RVU[f@@@@',
    });
  },
  OCL_TIMEOUT,
);

test(
  'every molecule gets its own id',
  async () => {
    const first = await moleculeFromSmiles('CCO', 'ethanol');
    const second = await moleculeFromSmiles('CCO', 'ethanol');

    expect(first.id).not.toBe(second.id);
    expect(first.id).toHaveLength(36);
  },
  OCL_TIMEOUT,
);
