/** A molecular geometry: element symbols plus flat Cartesian coordinates in Angstrom. */
export interface Geometry {
  /** Element symbols, one per atom. */
  elements: string[];
  /** Flat Cartesian coordinates in Angstrom, length `3 * elements.length`. */
  coordinates: Float64Array;
}

/** Where a molecule came from, so provenance survives into the result. */
export type MoleculeSource =
  | { kind: 'smiles'; smiles: string; seed: number }
  | { kind: 'molfile'; molfile: string }
  | { kind: 'sdf'; molfile: string; fileName: string; record: number }
  | { kind: 'xyz'; text: string; fileName?: string }
  | { kind: 'pdb'; fileName: string }
  | { kind: 'drawn'; idCode: string }
  | { kind: 'collection'; collectionId: string; entryId: string }
  | { kind: 'fixture'; fixtureId: string };

/** A geometry plus its identity: what an engine is actually handed. */
export interface Molecule extends Geometry {
  /** Stable identifier, unique within a session. */
  id: string;
  /** Human-readable name. */
  label: string;
  /** Molecular formula. */
  formula: string;
  /** How this molecule entered the app. */
  source: MoleculeSource;
  /**
   * Total charge in units of e, summed from the structure's atom charges.
   * Carried on the molecule because it is a property of the structure, not of
   * the calculation the user asks for.
   */
  charge: number;
  /**
   * Unpaired electrons implied by the structure's radical atoms. `1` for a
   * doublet such as CH₃•.
   */
  unpairedElectrons: number;
  /**
   * Isomeric SMILES, when one is available. Always produced with
   * `toIsomericSmiles()`, never the deprecated `toSmiles()`.
   * @default undefined
   */
  smiles?: string;
  /**
   * OpenChemLib idCode of the structure, when one exists. Lets the structure be
   * redrawn and highlighted without re-deriving connectivity from coordinates.
   * @default undefined
   */
  idCode?: string;
  /**
   * Molfile of the structure, when one exists. This is what the depiction is
   * drawn from.
   *
   * Its atom block is NOT guaranteed to be in `elements` order: when the
   * molecule came from a file, this is that file's own text, and openchemlib
   * moves hydrogens to the end as it reads a V2000 atom block. Use `bonds` for
   * anything that has to index into `elements`.
   * @default undefined
   */
  molfile?: string;
  /**
   * Bonded atom pairs, as indices into `elements`.
   *
   * Captured when the structure is read, from the openchemlib molecule that
   * fixes the element order, so a consumer never has to re-derive connectivity
   * and never has to reconcile two atom orderings. Absent when the molecule
   * arrived as a bare geometry with no connectivity to read — an XYZ or a PDB.
   * @default undefined
   */
  bonds?: ReadonlyArray<readonly [number, number]>;
}
