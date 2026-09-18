/** A molecule file format this app can read. */
export type MoleculeFormat = 'smiles' | 'molfile' | 'sdf' | 'xyz' | 'pdb';

/**
 * Work out which format a dropped file or a pasted block of text is in.
 *
 * The extension decides when there is one, because it is what the chemist
 * meant; otherwise the contents are sniffed. Sniffing never falls back to
 * "assume SMILES and let openchemlib try": `Molecule.fromText` parses
 * `hello world!!` into a 26-atom molecule rather than failing, so text that
 * looks like nothing recognisable is rejected here instead.
 * @param text - The file contents.
 * @param fileName - The file name, when one is known.
 * @returns The detected format.
 */
export function detectFormat(text: string, fileName?: string): MoleculeFormat {
  const byExtension =
    fileName === undefined ? undefined : formatFromExtension(fileName);
  if (byExtension !== undefined) return byExtension;

  const lines = text.split(/\r?\n/);
  if (hasSdfDelimiter(lines)) return 'sdf';
  if (hasPdbAtomRecord(lines)) return 'pdb';
  if (looksLikeMolfile(lines)) return 'molfile';
  if (looksLikeXyz(lines)) return 'xyz';
  if (looksLikeSmiles(lines)) return 'smiles';

  throw new Error(
    'could not tell what format this is; name the file .mol, .sdf, .xyz, .pdb or .smi',
  );
}

const EXTENSIONS = new Map<string, MoleculeFormat>([
  ['smi', 'smiles'],
  ['smiles', 'smiles'],
  ['mol', 'molfile'],
  ['mdl', 'molfile'],
  ['sdf', 'sdf'],
  ['sd', 'sdf'],
  ['xyz', 'xyz'],
  ['pdb', 'pdb'],
  ['ent', 'pdb'],
]);

/**
 * Map a file name to a format by its extension.
 * @param fileName - The file name.
 * @returns The format, or `undefined` for an extension we do not know.
 */
function formatFromExtension(fileName: string): MoleculeFormat | undefined {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return undefined;
  return EXTENSIONS.get(fileName.slice(dot + 1).toLowerCase());
}

/**
 * Whether the text carries an SDF record delimiter.
 * @param lines - The text split into lines.
 * @returns `true` when a line is exactly `$$$$`.
 */
function hasSdfDelimiter(lines: string[]): boolean {
  for (const line of lines) {
    if (line.trimEnd() === '$$$$') return true;
  }
  return false;
}

/**
 * Whether the text carries a PDB coordinate record.
 * @param lines - The text split into lines.
 * @returns `true` when a line starts with `ATOM  ` or `HETATM`.
 */
function hasPdbAtomRecord(lines: string[]): boolean {
  for (const line of lines) {
    const record = line.slice(0, 6);
    if (record === 'ATOM  ' || record === 'HETATM') return true;
  }
  return false;
}

/**
 * Whether the text has a molfile counts line where one belongs.
 * @param lines - The text split into lines.
 * @returns `true` when line four counts atoms and bonds.
 */
function looksLikeMolfile(lines: string[]): boolean {
  const counts = lines[3];
  return counts !== undefined && /^\s*\d+\s+\d+/.test(counts);
}

/**
 * Whether the text starts with an atom count followed by atom lines.
 * @param lines - The text split into lines.
 * @returns `true` when line one is a count and line three is an atom line.
 */
function looksLikeXyz(lines: string[]): boolean {
  const count = Number.parseInt((lines[0] ?? '').trim(), 10);
  if (!Number.isInteger(count) || count <= 0) return false;
  const first = lines[2];
  return (
    first !== undefined && /^\s*[A-Za-z]{1,3}(?:\s+[-+\d.eE]+){3}/.test(first)
  );
}

/**
 * Whether the text is one or more SMILES lines and nothing else.
 *
 * Every non-empty line has to be a single SMILES token. A `.smi` file may name
 * its molecules after the SMILES, but a line with a space in it is not enough
 * evidence to guess SMILES from the contents alone — that is how prose would
 * slip through.
 * @param lines - The text split into lines.
 * @returns `true` when every non-empty line is one SMILES token.
 */
function looksLikeSmiles(lines: string[]): boolean {
  let found = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (!/^[A-Za-z0-9@+\-[\]()=#$:/\\%.*]+$/.test(line)) return false;
    found++;
  }
  return found > 0;
}
