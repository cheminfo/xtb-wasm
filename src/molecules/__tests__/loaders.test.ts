import { expect, test } from 'vitest';

import { moleculeFromStructure } from '../build.ts';
import { loadXyz } from '../geometryLoaders.ts';
import {
  moleculeFromMolfile,
  moleculesFromFile,
  moleculesFromText,
} from '../index.ts';
import { loadSdf, loadSmilesLines } from '../load.ts';
import { getOcl } from '../ocl.ts';

import { OCL_TIMEOUT } from './oclTimeout.ts';
import { readFixture } from './readFixture.ts';

test(
  'reads a dropped file by its name',
  async () => {
    const file = new File([readFixture('water_3d.mol')], 'water_3d.mol');
    const loaded = await moleculesFromFile(file);

    expect(loaded.molecules).toHaveLength(1);
    expect(loaded.molecules[0]?.elements).toStrictEqual(['O', 'H', 'H']);
    expect(loaded.molecules[0]?.source).toMatchObject({ kind: 'molfile' });
  },
  OCL_TIMEOUT,
);

test(
  'reads a .smi file, one molecule per line, named after the line',
  async () => {
    const loaded = await moleculesFromText(
      '# a comment\nCCO ethanol\n\nCC(C)=O acetone\n',
      'list.smi',
    );

    expect(loaded.warnings).toStrictEqual([]);
    expect(loaded.molecules.map((molecule) => molecule.label)).toStrictEqual([
      'ethanol',
      'acetone',
    ]);
    expect(loaded.molecules.map((molecule) => molecule.formula)).toStrictEqual([
      'C2H6O',
      'C3H6O',
    ]);
    expect(loaded.molecules[0]?.source).toStrictEqual({
      kind: 'smiles',
      smiles: 'CCO',
      seed: 42,
    });
  },
  OCL_TIMEOUT,
);

test(
  'an unparseable SMILES line is skipped, the rest still load',
  async () => {
    const loaded = await loadSmilesLines('CCO\nC1CC\n', 42);

    expect(loaded.molecules).toHaveLength(1);
    expect(loaded.molecules[0]?.formula).toBe('C2H6O');
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain('skipped line 2 ("C1CC")');
  },
  OCL_TIMEOUT,
);

test(
  'a file with no usable SMILES line fails outright',
  async () => {
    await expect(loadSmilesLines('# only a comment\n', 42)).rejects.toThrow(
      'no line of this file parsed as a SMILES',
    );
  },
  OCL_TIMEOUT,
);

test(
  'only the first maxRecords records of an SDF are built',
  async () => {
    const loaded = await loadSdf(readFixture('three.sdf'), 'three.sdf', 42, 2);

    expect(loaded.molecules.map((molecule) => molecule.label)).toStrictEqual([
      'ethanol',
      'acetone',
    ]);
    expect(loaded.warnings[0]).toBe(
      'three.sdf holds 3 records; loaded the first 2',
    );
  },
  OCL_TIMEOUT,
);

test(
  'an unreadable SDF record is skipped with a warning',
  async () => {
    const good = readFixture('three.sdf').split('$$$$\n', 1)[0] as string;
    // A counts line with no atom block: sdf-parser keeps the record, and
    // openchemlib answers it with an empty molecule rather than throwing.
    const empty =
      'broken\n  no atom block\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n';
    const loaded = await loadSdf(
      `${good}$$$$\n${empty}$$$$\n`,
      'mixed.sdf',
      42,
    );

    expect(loaded.molecules).toHaveLength(1);
    expect(loaded.molecules[0]?.formula).toBe('C2H6O');
    expect(loaded.warnings).toContain(
      'skipped record 2 of mixed.sdf: "mixed.sdf record 2" is not a readable molfile: it has no atoms',
    );
  },
  OCL_TIMEOUT,
);

test(
  'an SDF whose every record is unreadable fails outright',
  async () => {
    await expect(loadSdf('junk\n$$$$\n', 'bad.sdf', 42)).rejects.toThrow(
      'bad.sdf contains no readable record',
    );
  },
  OCL_TIMEOUT,
);

test('an XYZ atom that names no element is rejected', () => {
  expect(() => loadXyz('1\ncomment\nQq 0 0 0\n')).toThrow(
    'atom 0 of the XYZ file has no element: "Qq"',
  );
});

test('an XYZ file with an upper-case element symbol is normalized', () => {
  const loaded = loadXyz('2\n\nCL 0 0 0\nNA 1 0 0\n', 'salt.xyz');

  expect(loaded.molecules[0]?.elements).toStrictEqual(['Cl', 'Na']);
  expect(loaded.molecules[0]?.label).toBe('salt.xyz');
  expect(loaded.molecules[0]?.formula).toBe('ClNa');
});

test(
  'a 3D molfile missing its hydrogens keeps its atoms and says so',
  async () => {
    const loaded = await moleculesFromText(
      readFixture('ethanol_3d_noh.mol'),
      'ethanol_3d_noh.mol',
    );
    const molecule = loaded.molecules[0];

    expect(molecule?.elements).toStrictEqual(['C', 'C', 'O']);
    expect(molecule?.coordinates).toStrictEqual(
      new Float64Array([1.2023, 0, -0.1519, 0, 0, 0.7525, -1.175, 0, -0.048]),
    );
    expect(molecule?.formula).toBe('C2H6O');
    expect(loaded.warnings).toStrictEqual([
      'the file has 6 implicit hydrogens with no coordinates, so they are missing from the geometry',
    ]);
  },
  OCL_TIMEOUT,
);

test(
  'a geometry that does not match the structure is refused',
  async () => {
    const ocl = await getOcl();
    const structure = ocl.Molecule.fromMolfile(readFixture('water_3d.mol'));

    await expect(
      moleculeFromStructure(structure, {
        label: 'mismatch',
        source: { kind: 'molfile', molfile: '' },
        geometry: { elements: ['O'], coordinates: new Float64Array(3) },
      }),
    ).rejects.toThrow('the geometry has 1 atoms but the structure has 3');
  },
  OCL_TIMEOUT,
);

test(
  'a 3D molfile that interleaves its hydrogens still indexes one set of atoms',
  async () => {
    const ocl = await getOcl();
    const molfile = readFixture('methanol_interleaved.mol');
    const molecule = await moleculeFromMolfile(molfile, 'methanol');

    // molecule.molfile is the file text, and the depiction and the bond-to-mode
    // mapping read atom i out of it, so it has to name the same atom as
    // molecule.elements[i] does.
    const structure = ocl.Molecule.fromMolfile(molecule.molfile as string);
    const labels: string[] = [];
    for (let atom = 0; atom < structure.getAllAtoms(); atom++) {
      labels.push(structure.getAtomLabel(atom));
    }

    expect(molecule.elements).toStrictEqual(labels);
    expect(molecule.elements).toStrictEqual(['C', 'O', 'H', 'H', 'H', 'H']);
    expect(molecule.coordinates.slice(0, 6)).toStrictEqual(
      new Float64Array([-0.748, 0, 0.033, 0.671, 0, -0.041]),
    );
    expect(molecule.formula).toBe('CH4O');
  },
  OCL_TIMEOUT,
);

test(
  'a planar molecule whose header declares 3D keeps its own geometry',
  async () => {
    const loaded = await moleculesFromText(
      readFixture('benzene_planar_3d.mol'),
      'benzene_planar_3d.mol',
    );
    const molecule = loaded.molecules[0];

    expect(loaded.warnings).toStrictEqual([]);
    expect(molecule?.formula).toBe('C6H6');
    expect(molecule?.coordinates).toStrictEqual(
      new Float64Array([
        1.397, 0, 0, 0.6985, 1.2098, 0, -0.6985, 1.2098, 0, -1.397, 0, 0,
        -0.6985, -1.2098, 0, 0.6985, -1.2098, 0, 2.481, 0, 0, 1.2405, 2.1487, 0,
        -1.2405, 2.1487, 0, -2.481, 0, 0, -1.2405, -2.1487, 0, 1.2405, -2.1487,
        0,
      ]),
    );
  },
  OCL_TIMEOUT,
);
