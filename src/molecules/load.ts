import { parse as parseSdf } from 'sdf-parser';

import type { Molecule, MoleculeSource } from '../types/index.ts';

import { moleculeFromStructure } from './build.ts';
import { geometryInOclOrder } from './molfileGeometry.ts';
import { getOcl } from './ocl.ts';

/** Everything one file yielded, plus what went wrong along the way. */
export interface LoadedMolecules {
  molecules: Molecule[];
  /** Non-fatal problems: skipped records, missing element columns, guessed charges. */
  warnings: string[];
}

/**
 * Read one molfile, V2000 or V3000.
 *
 * A molfile that carries 3D coordinates — a non-zero z, or a header that says
 * so — keeps every coordinate exactly as written, reordered only where
 * openchemlib indexes its atoms differently. A 2D one gets a generated
 * conformer, reported as a warning so the user knows the geometry is not
 * theirs.
 * @param molfile - The molfile text.
 * @param label - Human-readable name shown in the UI.
 * @param seed - Conformer generator seed, used only for a 2D molfile.
 * @param source - Provenance. Defaults to a plain molfile.
 * @returns The single molecule it describes.
 */
export async function loadMolfile(
  molfile: string,
  label: string,
  seed: number,
  source?: MoleculeSource,
): Promise<LoadedMolecules> {
  const ocl = await getOcl();
  const structure = ocl.Molecule.fromMolfile(molfile);
  if (structure.getAllAtoms() === 0) {
    // fromMolfile answers unparseable text with an empty molecule rather than
    // throwing, so an unusable record would otherwise become an empty molecule.
    throw new Error(`"${label}" is not a readable molfile: it has no atoms`);
  }
  const is3d = structure.is3D() || declaresThreeDimensions(molfile);

  const built = await moleculeFromStructure(structure, {
    label,
    source: source ?? { kind: 'molfile', molfile },
    seed,
    molfile,
    geometry: is3d ? geometryInOclOrder(molfile, structure) : undefined,
  });
  if (!is3d) {
    built.warnings.push(
      `"${label}" has no 3D coordinates, so a conformer was generated with seed ${seed} and minimized with MMFF94s`,
    );
  }
  return { molecules: [built.molecule], warnings: built.warnings };
}

/**
 * Read the records of a multi-record SDF.
 *
 * Records are returned in file order, so the caller can offer a choice rather
 * than silently picking the first, and a record that fails to parse is skipped
 * with a warning instead of failing the whole file. Only the first
 * `maxRecords` are built: a conformer costs tens of milliseconds, so a catalogue
 * SDF would otherwise freeze the tab for minutes before showing anything.
 * @param text - The SDF contents.
 * @param fileName - The file name, used in labels and provenance.
 * @param seed - Conformer generator seed for records without 3D coordinates.
 * @param maxRecords - How many records to build.
 * @returns Every record that parsed, up to the limit.
 */
export async function loadSdf(
  text: string,
  fileName: string,
  seed: number,
  maxRecords = 200,
): Promise<LoadedMolecules> {
  const { molecules: records } = parseSdf(text, { mixedEOL: true });
  const molecules: Molecule[] = [];
  const warnings: string[] = [];
  const limit = Math.min(records.length, maxRecords);
  if (records.length > limit) {
    warnings.push(
      `${fileName} holds ${records.length} records; loaded the first ${limit}`,
    );
  }

  for (let record = 0; record < limit; record++) {
    const entry = records[record];
    if (entry === undefined) continue;
    const label = sdfLabel(entry, fileName, record);
    try {
      /* eslint-disable-next-line no-await-in-loop -- conformer generation is
         CPU-bound and single-threaded, so building records concurrently would
         not be faster and would hold every conformer in memory at once */
      const loaded = await loadMolfile(entry.molfile, label, seed, {
        kind: 'sdf',
        molfile: entry.molfile,
        fileName,
        record,
      });
      molecules.push(...loaded.molecules);
      warnings.push(...loaded.warnings);
    } catch (error) {
      warnings.push(
        `skipped record ${record + 1} of ${fileName}: ${(error as Error).message}`,
      );
    }
  }

  if (molecules.length === 0) {
    throw new Error(`${fileName} contains no readable record`);
  }
  return { molecules, warnings };
}

/**
 * Read a `.smi` file: one SMILES per line, with an optional name after it.
 * @param text - The file contents.
 * @param seed - Conformer generator seed.
 * @returns One molecule per non-empty line.
 */
export async function loadSmilesLines(
  text: string,
  seed: number,
): Promise<LoadedMolecules> {
  const ocl = await getOcl();
  const lines = text.split(/\r?\n/);
  const molecules: Molecule[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] as string).trim();
    if (line === '' || line.startsWith('#')) continue;
    const [smiles, ...rest] = line.split(/\s+/);
    const label = rest.length > 0 ? rest.join(' ') : (smiles as string);
    try {
      /* eslint-disable-next-line no-await-in-loop -- conformer generation is
         CPU-bound and single-threaded, so building lines concurrently would not
         be faster and would hold every conformer in memory at once */
      const built = await moleculeFromStructure(
        ocl.Molecule.fromSmiles(smiles as string),
        {
          label,
          source: { kind: 'smiles', smiles: smiles as string, seed },
          seed,
        },
      );
      molecules.push(built.molecule);
      warnings.push(...built.warnings);
    } catch (error) {
      warnings.push(
        `skipped line ${index + 1} ("${line}"): ${(error as Error).message}`,
      );
    }
  }

  if (molecules.length === 0) {
    throw new Error('no line of this file parsed as a SMILES');
  }
  return { molecules, warnings };
}

/**
 * Whether a molfile header declares that its coordinates are three-dimensional.
 *
 * `is3D()` only looks at the z values, so a planar molecule — benzene,
 * formaldehyde, any flat aromatic — reads as 2D and would have the geometry the
 * user supplied thrown away and replaced by a conformer. The dimensional code
 * at columns 21-22 of the header line is what every 3D writer sets, and it
 * settles the one case the coordinates cannot.
 * @param molfile - The molfile text.
 * @returns `true` when the header's dimensional code is `3D`.
 */
function declaresThreeDimensions(molfile: string): boolean {
  return molfile.split(/\r?\n/, 2)[1]?.slice(20, 22) === '3D';
}

/**
 * Pick a label for one SDF record.
 * @param entry - The parsed record, with its data fields.
 * @param fileName - The file name, for the fallback label.
 * @param record - Zero-based record index, for the fallback label.
 * @returns The first recognisable name field, or a positional label.
 */
function sdfLabel(
  entry: Record<string, unknown>,
  fileName: string,
  record: number,
): string {
  for (const field of NAME_FIELDS) {
    const value = entry[field];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return `${fileName} record ${record + 1}`;
}

const NAME_FIELDS = [
  'NAME',
  'Name',
  'name',
  'TITLE',
  'Title',
  'title',
  'ID',
  'id',
];
