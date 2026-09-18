import { expect, test } from 'vitest';

import {
  moleculeFromIdCode,
  moleculeFromMolfile,
  moleculeFromSmiles,
} from '../index.ts';
import { getOcl } from '../ocl.ts';

import { OCL_TIMEOUT } from './oclTimeout.ts';
import { readFixture } from './readFixture.ts';

test(
  'reads the charge of an anion off the structure',
  async () => {
    const fromMolfile = await moleculeFromMolfile(
      readFixture('acetate.mol'),
      'acetate',
    );
    const fromSmiles = await moleculeFromSmiles('CC(=O)[O-]', 'acetate');

    expect(fromMolfile.charge).toBe(-1);
    expect(fromMolfile.formula).toBe('C2H3O2(-)');
    expect(fromMolfile.unpairedElectrons).toBe(0);
    expect(fromMolfile.elements).toStrictEqual([
      'C',
      'C',
      'O',
      'O',
      'H',
      'H',
      'H',
    ]);
    expect(fromSmiles.charge).toBe(-1);
    expect(fromSmiles.formula).toBe('C2H3O2(-)');
  },
  OCL_TIMEOUT,
);

test(
  'a cation keeps its positive charge in the formula',
  async () => {
    const molecule = await moleculeFromSmiles('[NH4+]', 'ammonium');

    expect(molecule.charge).toBe(1);
    expect(molecule.formula).toBe('H4N(+)');
    expect(molecule.elements).toStrictEqual(['N', 'H', 'H', 'H', 'H']);
  },
  OCL_TIMEOUT,
);

test(
  'a doublet radical reports one unpaired electron',
  async () => {
    const molecule = await moleculeFromMolfile(
      readFixture('methyl_radical.mol'),
      'methyl',
    );

    expect(molecule.formula).toBe('CH3');
    expect(molecule.charge).toBe(0);
    expect(molecule.unpairedElectrons).toBe(1);
    expect(molecule.elements).toStrictEqual(['C', 'H', 'H', 'H']);
  },
  OCL_TIMEOUT,
);

test(
  'a triplet carbene reports two unpaired electrons',
  async () => {
    const molecule = await moleculeFromMolfile(
      readFixture('methylene_triplet.mol'),
      'methylene',
    );

    expect(molecule.formula).toBe('CH2');
    expect(molecule.unpairedElectrons).toBe(2);
    expect(molecule.elements).toStrictEqual(['C', 'H', 'H']);
  },
  OCL_TIMEOUT,
);

test(
  'M  RAD 2 is the doublet state openchemlib calls 32',
  async () => {
    const ocl = await getOcl();
    const doublet = ocl.Molecule.fromMolfile(readFixture('methyl_radical.mol'));
    const triplet = ocl.Molecule.fromMolfile(
      readFixture('methylene_triplet.mol'),
    );

    expect(doublet.getAtomRadical(0)).toBe(ocl.Molecule.cAtomRadicalStateD);
    expect(doublet.getAtomRadical(0)).toBe(32);
    expect(triplet.getAtomRadical(0)).toBe(ocl.Molecule.cAtomRadicalStateT);
    expect(triplet.getAtomRadical(0)).toBe(48);
    expect(doublet.getAtomRadical(1)).toBe(ocl.Molecule.cAtomRadicalStateNone);
  },
  OCL_TIMEOUT,
);

test(
  'molecule.molfile indexes the same atoms as molecule.elements',
  async () => {
    const ocl = await getOcl();
    const molecules = [
      await moleculeFromSmiles('CCO', 'ethanol'),
      await moleculeFromMolfile(readFixture('acetate.mol'), 'acetate'),
      await moleculeFromMolfile(readFixture('methyl_radical.mol'), 'methyl'),
      await moleculeFromIdCode('daDH@@RVU[f@@@@', 'benzaldehyde'),
    ];

    for (const molecule of molecules) {
      const structure = ocl.Molecule.fromMolfile(molecule.molfile as string);
      const labels: string[] = [];
      for (let atom = 0; atom < structure.getAllAtoms(); atom++) {
        labels.push(structure.getAtomLabel(atom));
      }

      expect(labels).toStrictEqual(molecule.elements);
    }
  },
  OCL_TIMEOUT,
);
