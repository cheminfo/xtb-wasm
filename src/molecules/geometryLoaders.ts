import { fromXyz } from '../chemistry/geometry.ts';

import { moleculeFromGeometry } from './build.ts';
import { canonicalElement } from './elements.ts';
import type { LoadedMolecules } from './load.ts';
import { geometryFromPdb } from './pdb.ts';
import { formulaFromElements } from './structure.ts';

/**
 * Read an XYZ file. There is no connectivity, so charge and spin stay zero.
 * @param text - The XYZ contents.
 * @param fileName - The file name, when one is known.
 * @returns The single geometry it describes.
 */
export function loadXyz(text: string, fileName?: string): LoadedMolecules {
  const geometry = fromXyz(text);
  const { elements } = geometry;
  for (let atom = 0; atom < elements.length; atom++) {
    const element = canonicalElement(elements[atom] as string);
    if (element === undefined) {
      throw new Error(
        `atom ${atom} of the XYZ file has no element: "${elements[atom]}"`,
      );
    }
    elements[atom] = element;
  }

  const comment = (text.split(/\r?\n/, 2)[1] ?? '').trim();
  const label = comment === '' ? (fileName ?? 'XYZ geometry') : comment;
  return {
    molecules: [
      moleculeFromGeometry(
        geometry,
        label,
        { kind: 'xyz', text, fileName },
        formulaFromElements(elements),
      ),
    ],
    warnings: [],
  };
}

/**
 * Read a PDB file. There is no connectivity, so charge and spin stay zero.
 * @param text - The PDB contents.
 * @param fileName - The file name, used in the label and provenance.
 * @returns The single geometry it describes, plus what had to be dropped.
 */
export function loadPdb(text: string, fileName: string): LoadedMolecules {
  const { geometry, warnings } = geometryFromPdb(text);
  return {
    molecules: [
      moleculeFromGeometry(
        geometry,
        fileName,
        { kind: 'pdb', fileName },
        formulaFromElements(geometry.elements),
      ),
    ],
    warnings,
  };
}
