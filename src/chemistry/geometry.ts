import type * as OCLTypes from 'openchemlib';

import type { Geometry } from '../types/index.ts';

/**
 * Read element symbols and Cartesian coordinates out of an OpenChemLib molecule.
 * @param molecule - A molecule carrying 3D coordinates.
 * @returns Its geometry in Angstrom.
 */
export function geometryFromOcl(molecule: OCLTypes.Molecule): Geometry {
  const atoms = molecule.getAllAtoms();
  const elements = new Array<string>(atoms);
  const coordinates = new Float64Array(atoms * 3);
  for (let atom = 0; atom < atoms; atom++) {
    elements[atom] = molecule.getAtomLabel(atom);
    coordinates[atom * 3] = molecule.getAtomX(atom);
    coordinates[atom * 3 + 1] = molecule.getAtomY(atom);
    coordinates[atom * 3 + 2] = molecule.getAtomZ(atom);
  }
  return { elements, coordinates };
}

/**
 * Format a geometry as an XYZ file.
 * @param geometry - The geometry to format.
 * @param comment - Second line of the file.
 * @returns XYZ text, newline-terminated.
 * @default comment ''
 */
export function toXyz(geometry: Geometry, comment = ''): string {
  const { elements, coordinates } = geometry;
  const lines = new Array<string>(elements.length + 2);
  lines[0] = String(elements.length);
  lines[1] = comment;
  for (let atom = 0; atom < elements.length; atom++) {
    const x = coordinates[atom * 3] ?? 0;
    const y = coordinates[atom * 3 + 1] ?? 0;
    const z = coordinates[atom * 3 + 2] ?? 0;
    lines[atom + 2] =
      `${elements[atom]} ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`;
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Parse an XYZ file into a geometry.
 * @param text - XYZ file contents.
 * @returns The parsed geometry.
 */
export function fromXyz(text: string): Geometry {
  const lines = text.split(/\r?\n/);
  const count = Number.parseInt(lines[0] ?? '', 10);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('first line of an XYZ file must be the atom count');
  }
  const elements = new Array<string>(count);
  const coordinates = new Float64Array(count * 3);
  for (let atom = 0; atom < count; atom++) {
    const line = lines[atom + 2];
    if (line === undefined || line.trim() === '') {
      throw new Error(`XYZ file ends after ${atom} of ${count} atoms`);
    }
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) throw new Error(`malformed XYZ line: "${line}"`);
    elements[atom] = parts[0] as string;
    coordinates[atom * 3] = Number(parts[1]);
    coordinates[atom * 3 + 1] = Number(parts[2]);
    coordinates[atom * 3 + 2] = Number(parts[3]);
  }
  return { elements, coordinates };
}
