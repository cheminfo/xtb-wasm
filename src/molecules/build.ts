import type * as OclTypes from 'openchemlib';

import { geometryFromOcl } from '../chemistry/geometry.ts';
import type { Geometry, Molecule, MoleculeSource } from '../types/index.ts';

import type { OclModule } from './ocl.ts';
import { getOcl } from './ocl.ts';
import {
  formulaWithCharge,
  structureCharge,
  structureUnpairedElectrons,
} from './structure.ts';

/** What `moleculeFromStructure` needs besides the structure itself. */
export interface BuildOptions {
  /** Human-readable name shown in the UI. */
  label: string;
  /** How this molecule entered the app. */
  source: MoleculeSource;
  /**
   * A geometry to use exactly as given, for a file that already carries 3D
   * coordinates. Without one a conformer is generated and minimized.
   * @default undefined
   */
  geometry?: Geometry;
  /**
   * Molfile whose atom order matches the geometry. Defaults to one written from
   * the structure, which is index-faithful but not coordinate-faithful.
   * @default undefined
   */
  molfile?: string;
  /**
   * Conformer generator seed, so the same input always gives the same geometry.
   * Ignored when `geometry` is given.
   * @default 42
   */
  seed?: number;
}

/** A built molecule plus anything the user should know about how it was built. */
export interface BuiltMolecule {
  molecule: Molecule;
  warnings: string[];
}

/**
 * Turn an openchemlib structure into a `Molecule` the engines can run.
 *
 * A structure that already carries 3D coordinates keeps them verbatim; a 2D one
 * gets explicit hydrogens, one conformer, and an MMFF94s+ minimization so GFN2
 * starts from a sane geometry. Charge and unpaired electrons are read off the
 * structure either way, so an anion or a radical is no longer forced neutral
 * and closed-shell.
 * @param structure - The parsed structure. It is mutated by hydrogen addition.
 * @param options - Label, provenance, and the optional verbatim geometry.
 * @returns The molecule and any non-fatal warnings.
 */
export async function moleculeFromStructure(
  structure: OclTypes.Molecule,
  options: BuildOptions,
): Promise<BuiltMolecule> {
  const ocl = await getOcl();
  const warnings: string[] = [];

  const { final, geometry } =
    options.geometry === undefined
      ? generateConformer(structure, ocl, options.seed ?? 42, warnings)
      : { final: structure, geometry: options.geometry };

  if (geometry.elements.length !== final.getAllAtoms()) {
    throw new Error(
      `the geometry has ${geometry.elements.length} atoms but the structure has ${final.getAllAtoms()}`,
    );
  }
  if (options.geometry !== undefined) {
    warnAboutImplicitHydrogens(final, warnings);
  }

  const charge = structureCharge(final);
  return {
    molecule: {
      id: crypto.randomUUID(),
      label: options.label,
      formula: formulaWithCharge(final, charge),
      source: options.source,
      charge,
      unpairedElectrons: structureUnpairedElectrons(final, ocl),
      smiles: isomericSmiles(final),
      idCode: final.getIDCode(),
      molfile: options.molfile ?? final.toMolfile(),
      bonds: bondPairs(final),
      elements: geometry.elements,
      coordinates: geometry.coordinates,
    },
    warnings,
  };
}

/**
 * Build a molecule from a bare geometry, with no connectivity to read.
 * @param geometry - The geometry, used verbatim.
 * @param label - Human-readable name shown in the UI.
 * @param source - How this molecule entered the app.
 * @param formula - Molecular formula, counted from the elements.
 * @returns The molecule. Charge and spin are zero: the file did not say.
 */
export function moleculeFromGeometry(
  geometry: Geometry,
  label: string,
  source: MoleculeSource,
  formula: string,
): Molecule {
  return {
    id: crypto.randomUUID(),
    label,
    formula,
    source,
    charge: 0,
    unpairedElectrons: 0,
    elements: geometry.elements,
    coordinates: geometry.coordinates,
  };
}

/**
 * Add explicit hydrogens, generate one conformer, and minimize it.
 * @param structure - The 2D structure. Mutated by hydrogen addition.
 * @param ocl - The openchemlib module.
 * @param seed - Conformer generator seed.
 * @param warnings - Collects a note when the minimization could not run.
 * @returns The 3D structure and its geometry.
 */
function generateConformer(
  structure: OclTypes.Molecule,
  ocl: OclModule,
  seed: number,
  warnings: string[],
): { final: OclTypes.Molecule; geometry: Geometry } {
  structure.addImplicitHydrogens();
  const conformer = new ocl.ConformerGenerator(seed).getOneConformerAsMolecule(
    structure,
  );
  if (conformer === null) {
    throw new Error('could not generate a 3D conformer for this structure');
  }
  conformer.addImplicitHydrogens();

  try {
    new ocl.ForceFieldMMFF94(
      conformer,
      ocl.ForceFieldMMFF94.MMFF94S,
    ).minimise();
  } catch {
    // MMFF94 does not cover every element. The raw conformer is still usable —
    // GFN2 will simply need more optimization cycles.
    warnings.push(
      'MMFF94s does not cover this structure, so the starting geometry is the unminimized conformer',
    );
  }

  return { final: conformer, geometry: geometryFromOcl(conformer) };
}

/**
 * Warn when a verbatim 3D structure still has hydrogens without coordinates.
 * @param structure - The structure whose geometry is used as given.
 * @param warnings - Collects the note.
 */
function warnAboutImplicitHydrogens(
  structure: OclTypes.Molecule,
  warnings: string[],
): void {
  let implicit = 0;
  const atoms = structure.getAllAtoms();
  for (let atom = 0; atom < atoms; atom++) {
    implicit += structure.getImplicitHydrogens(atom);
  }
  if (implicit > 0) {
    warnings.push(
      `the file has ${implicit} implicit hydrogens with no coordinates, so they are missing from the geometry`,
    );
  }
}

/**
 * Isomeric SMILES of a structure, or `undefined` when it cannot be written.
 * @param structure - The structure to name.
 * @returns The SMILES, stereochemistry included.
 */
function isomericSmiles(structure: OclTypes.Molecule): string | undefined {
  try {
    return structure.toIsomericSmiles();
  } catch {
    return undefined;
  }
}

/**
 * The structure's bonds as indices into its openchemlib atom order, which is
 * the order `Molecule.elements` is built in.
 * @param structure - The molecule whose atom order the geometry follows.
 * @returns One pair per bond, in openchemlib's bond order.
 */
function bondPairs(
  structure: OclTypes.Molecule,
): ReadonlyArray<readonly [number, number]> {
  const count = structure.getAllBonds();
  const pairs = new Array<readonly [number, number]>(count);
  for (let bond = 0; bond < count; bond++) {
    pairs[bond] = [
      structure.getBondAtom(0, bond),
      structure.getBondAtom(1, bond),
    ];
  }
  return pairs;
}
