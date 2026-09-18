import { createHandleScope } from './occScope.ts';
import type { OccModule, OccMolecule } from './occTypes.ts';

/** Tetrahedral σ, used for the XY₄ correction below. */
const TETRAHEDRAL_SYMMETRY_NUMBER = 12;
/** Tolerance on the XY₄ distance tests, in Å. A relaxed XY₄ is regular to ~1e-6. */
const REGULAR_TOLERANCE_ANGSTROM = 1e-3;

/** The rotational symmetry the thermochemistry needs, plus what to display. */
export interface PointGroupInfo {
  /**
   * A display label such as `C2v` or `D6h`. occ can return labels that are not
   * in its own exported `PointGroup` enum (`D3d`, `Dooh`, `Coov`), so it is a
   * string and never a discriminant.
   */
  label: string;
  /** Rotational symmetry number σ, the value that enters `−R·ln σ`. */
  symmetryNumber: number;
  /** Anything the chemist must know about the assignment. */
  warnings: string[];
}

/**
 * Detect the molecular point group and its rotational symmetry number.
 *
 * `symmetryNumber` is the source of truth and the label is only shown, because
 * occ's own σ is what it derives its rotational partition function from. One
 * verified defect is corrected here: a five-atom XY₄ (CH₄, CF₄, SiH₄, CCl₄) is
 * assigned D2 with σ=4 instead of Td with σ=12, which is 0.65 kcal/mol of G at
 * 298 K. Larger tetrahedral systems are assigned correctly (P₄ → Td σ=12,
 * neopentane → T σ=12, SF₆ → Oh σ=24), so the correction is deliberately
 * narrow.
 * @param module - The loaded occjs module.
 * @param molecule - The molecule to classify, at its final geometry.
 * @param elements - Element symbols, one per atom.
 * @param coordinates - Flat Cartesian coordinates in Å, `3 · atoms` values.
 * @returns The label, σ, and any warning about the assignment.
 */
export function detectPointGroup(
  module: OccModule,
  molecule: OccMolecule,
  elements: readonly string[],
  coordinates: Float64Array,
): PointGroupInfo {
  const scope = createHandleScope();
  let label = 'C1';
  let symmetryNumber = 1;
  const warnings: string[] = [];
  try {
    const group = scope.keep(new module.MolecularPointGroup(molecule));
    label = group.getPointGroupString();
    symmetryNumber = group.symmetryNumber;
  } catch {
    warnings.push(
      'The point group could not be detected; σ = 1 was used, which overestimates the rotational entropy of a symmetric molecule.',
    );
    return { label, symmetryNumber, warnings };
  } finally {
    scope.release();
  }

  if (
    symmetryNumber !== TETRAHEDRAL_SYMMETRY_NUMBER &&
    isRegularXY4(elements, coordinates)
  ) {
    warnings.push(
      `occ assigns this XY₄ molecule ${label} with σ = ${symmetryNumber}; it is tetrahedral, so σ = ${TETRAHEDRAL_SYMMETRY_NUMBER} was used instead.`,
    );
    return {
      label: 'Td',
      symmetryNumber: TETRAHEDRAL_SYMMETRY_NUMBER,
      warnings,
    };
  }
  return { label, symmetryNumber, warnings };
}

/**
 * Whether the geometry is one central atom with four identical ligands at equal
 * distances and equal ligand-ligand distances, which can only be a regular
 * tetrahedron.
 */
function isRegularXY4(
  elements: readonly string[],
  coordinates: Float64Array,
): boolean {
  if (elements.length !== 5) return false;

  let centre = -1;
  for (let atom = 0; atom < 5; atom++) {
    let matches = 0;
    for (let other = 0; other < 5; other++) {
      if (elements[other] === elements[atom]) matches++;
    }
    if (matches === 1) {
      if (centre !== -1) return false;
      centre = atom;
    } else if (matches !== 4) {
      return false;
    }
  }
  if (centre === -1) return false;

  const ligands = new Int32Array(4);
  let found = 0;
  for (let atom = 0; atom < 5; atom++) {
    if (atom !== centre) ligands[found++] = atom;
  }

  const bond = distance(coordinates, centre, ligands[0] as number);
  for (let index = 1; index < 4; index++) {
    const other = distance(coordinates, centre, ligands[index] as number);
    if (Math.abs(other - bond) > REGULAR_TOLERANCE_ANGSTROM) return false;
  }

  const edge = distance(
    coordinates,
    ligands[0] as number,
    ligands[1] as number,
  );
  for (let first = 0; first < 4; first++) {
    for (let second = first + 1; second < 4; second++) {
      const other = distance(
        coordinates,
        ligands[first] as number,
        ligands[second] as number,
      );
      if (Math.abs(other - edge) > REGULAR_TOLERANCE_ANGSTROM) return false;
    }
  }
  return true;
}

/** Euclidean distance between two atoms of a flat coordinate array. */
function distance(
  coordinates: Float64Array,
  first: number,
  second: number,
): number {
  const x =
    (coordinates[second * 3] as number) - (coordinates[first * 3] as number);
  const y =
    (coordinates[second * 3 + 1] as number) -
    (coordinates[first * 3 + 1] as number);
  const z =
    (coordinates[second * 3 + 2] as number) -
    (coordinates[first * 3 + 2] as number);
  return Math.hypot(x, y, z);
}
