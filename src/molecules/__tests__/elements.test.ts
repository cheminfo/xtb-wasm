import { expect, test } from 'vitest';

import { canonicalElement, elementSymbols } from '../elements.ts';
import { getOcl } from '../ocl.ts';

import { OCL_TIMEOUT } from './oclTimeout.ts';

test('the symbol table is the periodic table up to oganesson', () => {
  const symbols = elementSymbols();

  expect(symbols).toHaveLength(118);
  expect(symbols[0]).toBe('H');
  expect(symbols[5]).toBe('C');
  expect(symbols[25]).toBe('Fe');
  expect(symbols[85]).toBe('Rn');
  expect(symbols[117]).toBe('Og');
});

test(
  'the symbol table agrees with openchemlib atom by atom',
  async () => {
    const ocl = await getOcl();
    const symbols = elementSymbols();
    const fromOcl: string[] = [];
    for (let atomicNumber = 1; atomicNumber <= 118; atomicNumber++) {
      fromOcl.push(ocl.Molecule.cAtomLabel[atomicNumber] as string);
    }

    expect(symbols).toStrictEqual(fromOcl);
  },
  OCL_TIMEOUT,
);

test('resolves an element symbol whatever its casing or padding', () => {
  expect(canonicalElement('CL')).toBe('Cl');
  expect(canonicalElement('cl')).toBe('Cl');
  expect(canonicalElement('Cl')).toBe('Cl');
  expect(canonicalElement(' FE ')).toBe('Fe');
  expect(canonicalElement('C')).toBe('C');
  expect(canonicalElement('c')).toBe('C');
});

test('rejects anything that is not an element', () => {
  expect(canonicalElement('')).toBeUndefined();
  expect(canonicalElement(' ')).toBeUndefined();
  expect(canonicalElement('\t')).toBeUndefined();
  expect(canonicalElement('Xx')).toBeUndefined();
  expect(canonicalElement('CA1')).toBeUndefined();
  expect(canonicalElement('Hm')).toBeUndefined();
});

test('deuterium is not an element symbol, so PDB maps it separately', () => {
  expect(canonicalElement('D')).toBeUndefined();
  expect(canonicalElement('T')).toBeUndefined();
});
