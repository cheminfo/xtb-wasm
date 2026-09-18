import type { Molecule } from '../types/index.ts';

import { moleculeFromStructure } from './build.ts';
import { detectFormat } from './detect.ts';
import { loadPdb, loadXyz } from './geometryLoaders.ts';
import type { LoadedMolecules } from './load.ts';
import { loadMolfile, loadSdf, loadSmilesLines } from './load.ts';
import { getOcl } from './ocl.ts';

/** How a conformer is seeded when a file carries no 3D coordinates. */
export const DEFAULT_SEED = 42;

/**
 * Read a dropped file: detect its format, then parse it.
 *
 * Molecule files are ASCII, so the file is read as text. Binary spectra need
 * `arrayBuffer()` instead — that is a different loader.
 * @param file - The dropped file.
 * @returns Every molecule the file yielded, plus non-fatal warnings.
 */
export async function moleculesFromFile(file: File): Promise<LoadedMolecules> {
  return moleculesFromText(await file.text(), file.name);
}

/**
 * Detect the format of a block of text and parse it.
 * @param text - The molecule file contents, or a pasted SMILES.
 * @param fileName - The file name, when one is known. It decides the format.
 * @returns Every molecule the text yielded, plus non-fatal warnings.
 */
export async function moleculesFromText(
  text: string,
  fileName?: string,
): Promise<LoadedMolecules> {
  const format = detectFormat(text, fileName);
  switch (format) {
    case 'sdf':
      return loadSdf(text, fileName ?? 'pasted SDF', DEFAULT_SEED);
    case 'molfile':
      return loadMolfile(text, fileName ?? 'pasted molfile', DEFAULT_SEED);
    case 'xyz':
      return loadXyz(text, fileName);
    case 'pdb':
      return loadPdb(text, fileName ?? 'pasted PDB');
    case 'smiles':
      return loadSmilesLines(text, DEFAULT_SEED);
    default:
      throw new Error(`unhandled format "${format as string}"`);
  }
}

/**
 * Build a 3D molecule from a SMILES string.
 * @param smiles - The SMILES to parse.
 * @param label - Human-readable name shown in the UI. Defaults to the SMILES.
 * @param seed - Conformer generator seed, so the same input gives the same geometry.
 * @returns The molecule, ready to hand to an engine.
 */
export async function moleculeFromSmiles(
  smiles: string,
  label?: string,
  seed = DEFAULT_SEED,
): Promise<Molecule> {
  const ocl = await getOcl();
  const built = await moleculeFromStructure(ocl.Molecule.fromSmiles(smiles), {
    label: label ?? smiles,
    source: { kind: 'smiles', smiles, seed },
    seed,
  });
  return built.molecule;
}

/**
 * Build a molecule from a single V2000 or V3000 molfile.
 *
 * A molfile that already carries 3D coordinates keeps them exactly as written.
 * @param molfile - The molfile text.
 * @param label - Human-readable name shown in the UI.
 * @param seed - Conformer generator seed, used only for a 2D molfile.
 * @returns The molecule, ready to hand to an engine.
 */
export async function moleculeFromMolfile(
  molfile: string,
  label?: string,
  seed = DEFAULT_SEED,
): Promise<Molecule> {
  const loaded = await loadMolfile(molfile, label ?? 'molfile', seed);
  return loaded.molecules[0] as Molecule;
}

/**
 * Build a molecule from an OpenChemLib idCode.
 *
 * An idCode round-trip reorders atoms, so it is an identity, never a geometry:
 * the coordinates always come from a freshly generated conformer.
 * @param idCode - The idCode to parse.
 * @param label - Human-readable name shown in the UI. Defaults to the idCode.
 * @param seed - Conformer generator seed.
 * @returns The molecule, ready to hand to an engine.
 */
export async function moleculeFromIdCode(
  idCode: string,
  label?: string,
  seed = DEFAULT_SEED,
): Promise<Molecule> {
  const ocl = await getOcl();
  const built = await moleculeFromStructure(ocl.Molecule.fromIDCode(idCode), {
    label: label ?? idCode,
    source: { kind: 'drawn', idCode },
    seed,
  });
  return built.molecule;
}

export type { BuildOptions, BuiltMolecule } from './build.ts';
export { moleculeFromGeometry, moleculeFromStructure } from './build.ts';
export type { MoleculeFormat } from './detect.ts';
export { detectFormat } from './detect.ts';
export { loadPdb, loadXyz } from './geometryLoaders.ts';
export { canonicalElement, elementSymbols } from './elements.ts';
export type { LoadedMolecules } from './load.ts';
export { loadMolfile, loadSdf, loadSmilesLines } from './load.ts';
export { geometryFromMolfile, geometryInOclOrder } from './molfileGeometry.ts';
export type { OclModule } from './ocl.ts';
export { getOcl } from './ocl.ts';
export type { PdbReadResult } from './pdb.ts';
export { geometryFromPdb } from './pdb.ts';
export {
  formulaFromElements,
  formulaWithCharge,
  structureCharge,
  structureUnpairedElectrons,
} from './structure.ts';
