import type { Geometry } from '../types/index.ts';

import { canonicalElement } from './elements.ts';

/** A geometry read from a PDB file, with whatever had to be dropped or guessed. */
export interface PdbReadResult {
  geometry: Geometry;
  /** Non-fatal problems: skipped altLocs, guessed elements, extra models. */
  warnings: string[];
}

/**
 * Read the atoms of a PDB file, in file order.
 *
 * Only the first `MODEL` is kept, alternate locations other than the first are
 * dropped, and `TER`/`END`/`CONECT` and every header record are ignored.
 * Atom order is the order of the `ATOM`/`HETATM` records, which is what the
 * bond-to-mode mapping downstream relies on.
 * @param text - The PDB file contents.
 * @returns The geometry and any non-fatal problems found.
 */
export function geometryFromPdb(text: string): PdbReadResult {
  const lines = text.split(/\r?\n/);
  const elements: string[] = [];
  const values: number[] = [];
  const warnings: string[] = [];

  let models = 0;
  let inLaterModel = false;
  let skippedAltLoc = 0;
  let guessedElement = 0;
  let isotopeLabels = 0;
  let unreadable = 0;

  for (const line of lines) {
    const record = line.slice(0, 6);

    if (record === 'MODEL ') {
      models++;
      inLaterModel = models > 1;
      continue;
    }
    if (record.startsWith('ENDMDL')) continue;
    if (record.startsWith('END')) break;
    if (record !== 'ATOM  ' && record !== 'HETATM') continue;
    if (inLaterModel) continue;

    if (line.length < 54) {
      unreadable++;
      continue;
    }

    const altLoc = line[16] as string;
    if (altLoc !== ' ' && altLoc !== 'A' && altLoc !== '1') {
      skippedAltLoc++;
      continue;
    }

    const x = Number.parseFloat(line.slice(30, 38));
    const y = Number.parseFloat(line.slice(38, 46));
    const z = Number.parseFloat(line.slice(46, 54));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      unreadable++;
      continue;
    }

    const declared = line.slice(76, 78).trim();
    let element = canonicalElement(declared);
    let guessed = false;
    if (element === undefined) {
      element = HYDROGEN_ISOTOPES.get(declared.toUpperCase());
      if (element !== undefined) isotopeLabels++;
    }
    if (element === undefined) {
      element = elementFromAtomName(line);
      guessed = element !== undefined;
    }
    if (element === undefined) {
      unreadable++;
      continue;
    }
    if (guessed) guessedElement++;

    elements.push(element);
    values.push(x, y, z);
  }

  if (models > 1) {
    warnings.push(`kept the first of ${models} models`);
  }
  if (skippedAltLoc > 0) {
    warnings.push(
      `dropped ${plural(skippedAltLoc, 'alternate-location atom')}`,
    );
  }
  if (guessedElement > 0) {
    warnings.push(
      `guessed the element of ${plural(guessedElement, 'atom')} from the atom name, because columns 77-78 were empty or unknown`,
    );
  }
  if (isotopeLabels > 0) {
    warnings.push(
      `treated ${plural(isotopeLabels, 'deuterium or tritium atom')} as hydrogen, because GFN2 has no isotope support`,
    );
  }
  if (unreadable > 0) {
    warnings.push(
      `dropped ${plural(unreadable, 'unreadable ATOM/HETATM record')}`,
    );
  }
  if (elements.length === 0) {
    throw new Error('the PDB file contains no readable ATOM or HETATM record');
  }

  return {
    geometry: { elements, coordinates: new Float64Array(values) },
    warnings,
  };
}

const HYDROGEN_ISOTOPES = new Map([
  ['D', 'H'],
  ['T', 'H'],
]);

/**
 * Derive an element from a PDB atom name when columns 77-78 are unusable.
 *
 * The name occupies columns 13-16 with the element right-justified in 13-14,
 * so a blank or a digit in column 13 means a one-character symbol. A two-letter
 * guess that names no element is retried as its first letter, which is what
 * rescues names such as `HMAA` on a hydrogen.
 * @param line - A full `ATOM` or `HETATM` line.
 * @returns The canonical element symbol, or `undefined` when none fits.
 */
function elementFromAtomName(line: string): string | undefined {
  const first = line[12] ?? ' ';
  const candidate =
    first === ' ' || (first >= '0' && first <= '9')
      ? (line[13] ?? '')
      : line.slice(12, 14);
  return (
    canonicalElement(candidate) ??
    canonicalElement(candidate.trim().slice(0, 1))
  );
}

/**
 * Count a noun so a warning reads correctly for one item as well as many.
 * @param count - How many there are.
 * @param noun - The singular noun.
 * @returns The count followed by the noun, pluralized when needed.
 */
function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
