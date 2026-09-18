import type * as OclTypes from 'openchemlib';

import type { OclModule } from './ocl.ts';

/**
 * Total charge of a structure, in units of e.
 *
 * Read from the atoms rather than asked of the user, because it is a property
 * of the structure: an `M  CHG` block or a `[O-]` in a SMILES already says it.
 * @param structure - The structure to inspect.
 * @returns The sum of every atom's formal charge.
 */
export function structureCharge(structure: OclTypes.Molecule): number {
  let charge = 0;
  const atoms = structure.getAllAtoms();
  for (let atom = 0; atom < atoms; atom++) {
    charge += structure.getAtomCharge(atom);
  }
  return charge;
}

/**
 * Unpaired electrons implied by a structure's radical atoms.
 *
 * openchemlib stores a per-atom radical state; a doublet centre carries one
 * unpaired electron and a triplet centre two, and a polyradical is taken to be
 * high-spin, which is what GFN2's `numUnpairedElectrons` expects.
 * @param structure - The structure to inspect.
 * @param ocl - The openchemlib module, for its radical-state constants.
 * @returns The total number of unpaired electrons.
 */
export function structureUnpairedElectrons(
  structure: OclTypes.Molecule,
  ocl: OclModule,
): number {
  const { Molecule } = ocl;
  let unpaired = 0;
  const atoms = structure.getAllAtoms();
  for (let atom = 0; atom < atoms; atom++) {
    const state = structure.getAtomRadical(atom);
    if (state === Molecule.cAtomRadicalStateD) unpaired += 1;
    else if (state === Molecule.cAtomRadicalStateT) unpaired += 2;
  }
  return unpaired;
}

/**
 * Molecular formula of a structure, with its charge, ready for `react-mf`.
 *
 * openchemlib's formula omits the charge, and `mf-parser` only reads a charge
 * written in parentheses — a trailing `C2H3O2-` parses as neutral.
 * @param structure - The structure to name.
 * @param charge - Total charge in units of e.
 * @returns A formula string such as `C2H3O2(-)` or `C8H10N4O2`.
 */
export function formulaWithCharge(
  structure: OclTypes.Molecule,
  charge: number,
): string {
  const base = structure.getMolecularFormula().formula;
  return charge === 0 ? base : `${base}(${chargeSuffix(charge)})`;
}

/**
 * Molecular formula of a bare geometry: carbon, hydrogen, then the rest
 * alphabetically.
 *
 * An XYZ or PDB file carries no connectivity, so openchemlib cannot name it;
 * counting the element symbols is all the information there is. Hydrogen keeps
 * second place even in a carbon-free formula, where strict Hill order would
 * sort it with the rest and write hydrogen chloride `ClH`.
 * @param elements - Element symbols, one per atom.
 * @returns A formula string such as `C2H6O`.
 */
export function formulaFromElements(elements: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const element of elements) {
    counts.set(element, (counts.get(element) ?? 0) + 1);
  }

  const rest = [...counts.keys()]
    .filter((element) => element !== 'C' && element !== 'H')
    .toSorted();
  const ordered: string[] = [];
  if (counts.has('C')) ordered.push('C');
  if (counts.has('H')) ordered.push('H');
  ordered.push(...rest);

  let formula = '';
  for (const element of ordered) {
    const count = counts.get(element) as number;
    formula += count === 1 ? element : `${element}${count}`;
  }
  return formula;
}

/**
 * Render a charge the way `mf-parser` reads it.
 * @param charge - Total charge in units of e, never zero.
 * @returns `-`, `+`, `2-`, `3+`, and so on.
 */
function chargeSuffix(charge: number): string {
  const sign = charge > 0 ? '+' : '-';
  const magnitude = Math.abs(charge);
  return magnitude === 1 ? sign : `${magnitude}${sign}`;
}
