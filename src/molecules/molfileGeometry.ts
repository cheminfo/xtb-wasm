import type * as OclTypes from 'openchemlib';

import type { Geometry } from '../types/index.ts';

import { canonicalElement } from './elements.ts';

/**
 * Read the atom block of a V2000 or V3000 molfile verbatim.
 *
 * openchemlib negates y and z when it reads a molfile and rescales every
 * coordinate when it writes one, so a molfile that already carries a 3D
 * geometry has to be read from the text to be used exactly as given. Atom order
 * is the order of the atom block, which is not always openchemlib's own order —
 * `geometryInOclOrder` is what reconciles the two.
 * @param molfile - The molfile text.
 * @returns The geometry exactly as written in the file.
 */
export function geometryFromMolfile(molfile: string): Geometry {
  const lines = molfile.split(/\r?\n/);
  const countsLine = lines[3];
  if (countsLine === undefined) {
    throw new Error('a molfile needs at least four lines');
  }
  return countsLine.includes('V3000')
    ? readV3000(lines)
    : readV2000(lines, countsLine);
}

/**
 * Read a molfile atom block into openchemlib's atom order.
 *
 * openchemlib's V2000 parser moves hydrogens to the end of the atom list, so a
 * file that interleaves them — the order a geometry optimizer writes — indexes
 * its atoms differently from the structure parsed out of it. `Molecule.molfile`
 * is that file text, and the depiction and the bond-to-mode mapping read atom
 * `i` out of it, so the geometry has to be permuted into the same order or atom
 * `i` means two different things. Coordinates stay the file's own values;
 * openchemlib's copy is only used to work out which atom went where.
 * @param molfile - The molfile text.
 * @param structure - The same molfile, as openchemlib parsed it.
 * @returns The file's coordinates, atom for atom in openchemlib's order.
 */
export function geometryInOclOrder(
  molfile: string,
  structure: OclTypes.Molecule,
): Geometry {
  const file = geometryFromMolfile(molfile);
  const atoms = structure.getAllAtoms();
  if (file.elements.length !== atoms) {
    throw new Error(
      `the molfile atom block holds ${file.elements.length} atoms but openchemlib read ${atoms}`,
    );
  }

  const elements = new Array<string>(atoms);
  const coordinates = new Float64Array(atoms * 3);
  const used = new Uint8Array(atoms);
  for (let atom = 0; atom < atoms; atom++) {
    const element = structure.getAtomLabel(atom);
    // openchemlib turns a molfile 180 degrees about x as it reads it, so its
    // copy of the coordinates has to be turned back before the two can match.
    const source = findSourceAtom(
      file,
      used,
      element,
      structure.getAtomX(atom),
      0 - structure.getAtomY(atom),
      0 - structure.getAtomZ(atom),
    );
    if (source === -1) {
      throw new Error(
        `openchemlib atom ${atom} (${element}) matches no atom of the molfile atom block`,
      );
    }
    used[source] = 1;
    elements[atom] = element;
    coordinates[atom * 3] = file.coordinates[source * 3] as number;
    coordinates[atom * 3 + 1] = file.coordinates[source * 3 + 1] as number;
    coordinates[atom * 3 + 2] = file.coordinates[source * 3 + 2] as number;
  }
  return { elements, coordinates };
}

/**
 * Find the unused atom-block atom that an openchemlib atom came from.
 * @param file - The geometry in atom-block order.
 * @param used - One flag per atom-block atom, set once it has been claimed.
 * @param element - The openchemlib atom's element symbol.
 * @param x - Its x coordinate, in the file's frame.
 * @param y - Its y coordinate, in the file's frame.
 * @param z - Its z coordinate, in the file's frame.
 * @returns The atom-block index, or `-1` when nothing matches.
 */
function findSourceAtom(
  file: Geometry,
  used: Uint8Array,
  element: string,
  x: number,
  y: number,
  z: number,
): number {
  const { elements, coordinates } = file;
  for (let atom = 0; atom < elements.length; atom++) {
    if (used[atom] === 1 || elements[atom] !== element) continue;
    const dx = (coordinates[atom * 3] as number) - x;
    const dy = (coordinates[atom * 3 + 1] as number) - y;
    const dz = (coordinates[atom * 3 + 2] as number) - z;
    if (dx * dx + dy * dy + dz * dz <= MATCH_TOLERANCE * MATCH_TOLERANCE) {
      return atom;
    }
  }
  return -1;
}

/** How far apart, in Angstrom, two copies of one atom may sit and still be it. */
const MATCH_TOLERANCE = 1e-6;

/**
 * Read the fixed-column atom block of a V2000 molfile.
 * @param lines - The molfile split into lines.
 * @param countsLine - The counts line, line four of the file.
 * @returns The geometry.
 */
function readV2000(lines: string[], countsLine: string): Geometry {
  const count = Number.parseInt(countsLine.slice(0, 3), 10);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(
      `the counts line of a V2000 molfile must start with an atom count, found "${countsLine.slice(0, 3)}"`,
    );
  }
  const elements = new Array<string>(count);
  const coordinates = new Float64Array(count * 3);
  for (let atom = 0; atom < count; atom++) {
    const line = lines[4 + atom];
    if (line === undefined || line.length < 34) {
      throw new Error(
        `the atom block of a V2000 molfile ends after ${atom} of ${count} atoms`,
      );
    }
    elements[atom] = requireElement(line.slice(31, 34), atom);
    coordinates[atom * 3] = requireNumber(line.slice(0, 10), atom);
    coordinates[atom * 3 + 1] = requireNumber(line.slice(10, 20), atom);
    coordinates[atom * 3 + 2] = requireNumber(line.slice(20, 30), atom);
  }
  return { elements, coordinates };
}

/**
 * Read the whitespace-separated atom block of a V3000 molfile.
 * @param lines - The molfile split into lines.
 * @returns The geometry.
 */
function readV3000(lines: string[]): Geometry {
  const elements: string[] = [];
  const values: number[] = [];
  let inAtomBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'M  V30 BEGIN ATOM') {
      inAtomBlock = true;
      continue;
    }
    if (line === 'M  V30 END ATOM') break;
    if (!inAtomBlock) continue;

    const fields = line.slice('M  V30'.length).trim().split(/\s+/);
    if (fields.length < 5) {
      throw new Error(`malformed V3000 atom line: "${line}"`);
    }
    const atom = elements.length;
    elements.push(requireElement(fields[1] as string, atom));
    values.push(
      requireNumber(fields[2] as string, atom),
      requireNumber(fields[3] as string, atom),
      requireNumber(fields[4] as string, atom),
    );
  }
  if (elements.length === 0) {
    throw new Error('the V3000 molfile has no atom block');
  }
  return { elements, coordinates: new Float64Array(values) };
}

/**
 * Resolve one atom-block element symbol.
 * @param raw - The raw symbol field.
 * @param atom - Zero-based atom index, for the error message.
 * @returns The canonical element symbol.
 */
function requireElement(raw: string, atom: number): string {
  const element = canonicalElement(raw);
  if (element === undefined) {
    throw new Error(`atom ${atom} of the molfile has no element: "${raw}"`);
  }
  return element;
}

/**
 * Parse one atom-block coordinate.
 * @param raw - The raw coordinate field.
 * @param atom - Zero-based atom index, for the error message.
 * @returns The coordinate in Angstrom.
 */
function requireNumber(raw: string, atom: number): number {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new Error(
      `atom ${atom} of the molfile has a non-numeric coordinate: "${raw}"`,
    );
  }
  return value;
}
