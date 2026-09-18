/**
 * occjs 0.9.3 ships an `index.d.ts` that omits every class this app depends on.
 * `XtbCalculator`, `BernyOptimizer`, `ConvergenceCriteria`, `IntegralEngine`,
 * `MolecularPointGroup`, `Mat`, `Mat3N`, `IVec` and
 * `computeVibrationalModesFromMolecule` exist only on the runtime module
 * returned by `loadOCC()`. These describe the members actually used; the module
 * is cast once, where it is loaded.
 */

/** Anything embind hands back: it owns wasm heap until `delete()` is called. */
export interface OccHandle {
  delete?: () => void;
}

export interface OccVector extends OccHandle {
  get: (index: number) => number;
  size: () => number;
}

export interface OccMatrix extends OccHandle {
  get: (row: number, column: number) => number;
  set: (row: number, column: number, value: number) => void;
  rows: () => number;
  cols: () => number;
}

/** A 3 × N coordinate matrix: row is the axis, column the atom. */
export type OccMat3N = OccMatrix;

export interface OccVec3 extends OccHandle {
  /** The x component. A method, not a property — `vec.x` is the function. */
  x: () => number;
  y: () => number;
  z: () => number;
}

export interface OccMolecule extends OccHandle {
  size: () => number;
  /** 3 × N, in Angstrom — unlike `XtbCalculator.positions()`, which is Bohr. */
  positions: () => OccMat3N;
  /** Standard atomic weights, the same table xtb uses. */
  atomicMasses: () => OccVector;
  atomicNumbers: () => OccVector;
  centerOfMass: () => OccVec3;
  centered: (origin: unknown) => OccMolecule;
}

export interface OccVibrationalModes extends OccHandle {
  /** Wavenumbers in cm⁻¹, ascending, `3N` entries including the projected ones. */
  frequenciesCm: OccVector;
  /** `3N × 3N`; the columns are unit-norm mass-weighted eigenvectors. */
  normalModes: OccMatrix;
}

export interface OccWavefunction extends OccHandle {
  basis: unknown;
  molecularOrbitals: unknown;
}

export interface OccEnergyAndGradient extends OccHandle {
  energy: number;
  /** 3 × N, Eh/Bohr. */
  gradient: OccMat3N;
}

export interface OccXtbCalculator extends OccHandle {
  /** Accessor property: assigning it changes the SCC and the energy. */
  charge: number;
  /** Accessor property: `nAlpha − nBeta`. */
  numUnpairedElectrons: number;
  /** Scale on the GFN2 spin coupling; 0 gives the common-Fock treatment. */
  spinPolarization: number;
  numAtoms: () => number;
  isUnrestricted: () => boolean;
  singlePoint: () => unknown;
  singlePointEnergy: () => number;
  totalEnergy: () => number;
  sccEnergy: () => number;
  repulsionEnergy: () => number;
  dispersionEnergy: () => number;
  spinEnergy: () => number;
  gradient: () => OccMat3N;
  energyAndGradient: () => OccEnergyAndGradient;
  /** 3 × N, in Bohr. */
  positions: () => OccMat3N;
  atomicNumbers: () => OccVector;
  /** Replaces the geometry in place, keeping charge, spin and the SCF guess. */
  updateStructure: (positionsBohr: OccMat3N) => void;
  toMolecule: () => OccMolecule;
  toWavefunction: () => OccWavefunction;
  /** `3N × 3N` Cartesian Hessian by central differences of the gradient. */
  hessian: (stepSizeBohr: number) => OccMatrix;
  /**
   * Finite-difference Hessian and normal modes.
   * @param stepSize - Displacement in Bohr.
   * @param projectTransRot - Apply the algebraic Eckart projection.
   */
  vibrationalModes: (
    stepSize: number,
    projectTransRot: boolean,
  ) => OccVibrationalModes;
}

export interface OccConvergenceCriteria extends OccHandle {
  gradientMax: number;
  gradientRms: number;
  stepMax: number;
  stepRms: number;
}

export interface OccBernyOptimizer extends OccHandle {
  getNextGeometry: () => OccMolecule;
  update: (energy: number, gradient: OccMat3N) => void;
  /** Returns true once the geometry is converged. */
  step: () => boolean;
  currentEnergy: () => number;
}

export interface OccIntegralEngine extends OccHandle {
  /**
   * The electronic multipole of the density, in atomic units. The nuclear term
   * is not included.
   * @param order - Multipole order; 1 is the dipole. It is an integer, not an
   * `Operator` — passing `Operator.Dipole` silently degrades to order 0.
   */
  multipole: (
    order: number,
    molecularOrbitals: unknown,
    origin: OccVec3,
  ) => OccVector;
}

export interface OccMolecularPointGroup extends OccHandle {
  /** A label such as `C2v`, `D6h`, `Dooh`. Reachable labels are not all in
   * the exported `PointGroup` enum, so this is a display string only. */
  getPointGroupString: () => string;
  /** Rotational symmetry number σ. A property — calling it throws. */
  symmetryNumber: number;
}

export interface OccModule {
  XtbCalculator: { fromMolecule: (molecule: OccMolecule) => OccXtbCalculator };
  Molecule: {
    fromXyzString: (xyz: string) => OccMolecule;
    new (atomicNumbers: OccVector, positionsAngstrom: OccMat3N): OccMolecule;
  };
  Mat: { create: (rows: number, columns: number) => OccMatrix };
  Mat3N: { create: (columns: number) => OccMat3N };
  IVec: { fromArray: (values: readonly number[]) => OccVector };
  ConvergenceCriteria: new () => OccConvergenceCriteria;
  BernyOptimizer: new (
    molecule: OccMolecule,
    criteria: OccConvergenceCriteria,
  ) => OccBernyOptimizer;
  IntegralEngine: new (basis: unknown) => OccIntegralEngine;
  MolecularPointGroup: new (molecule: OccMolecule) => OccMolecularPointGroup;
  Origin: { CENTEROFMASS: unknown };
  /**
   * Normal modes from a Cartesian Hessian the caller built, with the same
   * algebraic Eckart projection `XtbCalculator.vibrationalModes` applies.
   */
  computeVibrationalModesFromMolecule: (
    hessian: OccMatrix,
    molecule: OccMolecule,
    projectTransRot: boolean,
  ) => OccVibrationalModes;
  setLogLevel: (level: number) => void;
  setNumThreads: (count: number) => void;
  getNumThreads: () => number;
  /**
   * Turns whatever embind threw into `[type, message]`. It takes the thrown
   * value itself — an integer pointer under emscripten 4, a `CppException`
   * wrapper under emscripten 5 — never the unwrapped `excPtr`.
   */
  getExceptionMessage: (error: unknown) => string[];
}
