import type { DipoleFrame } from './occDipole.ts';
import { createDipoleFrame, readDipole } from './occDipole.ts';
import type { HandleScope } from './occScope.ts';
import type {
  OccMat3N,
  OccModule,
  OccMolecule,
  OccXtbCalculator,
} from './occTypes.ts';

/**
 * Central-difference step in Bohr, for the Hessian and the dipole alike. This
 * is occ's own default and xtb's; changing it changes every reference number.
 */
export const STEP_BOHR = 0.005;

/**
 * Everything the 6N sweep reuses between displacements. One calculator, one
 * coordinate matrix, one dipole frame: the previous implementation rebuilt
 * `Molecule.fromXyzString` and `XtbCalculator.fromMolecule` at every point,
 * which measured 3.1 ms of pure setup per displacement at N=3 and 4.3 ms at
 * N=33 — more than the SCF itself for a small molecule.
 */
export interface SweepContext {
  module: OccModule;
  calculator: OccXtbCalculator;
  /** The reference molecule, needed later for the Eckart projection. */
  molecule: OccMolecule;
  /** Reused coordinate matrix, 3 × N, holding absolute Bohr coordinates. */
  positions: OccMat3N;
  /** The undisplaced geometry in Bohr, flat `x,y,z` per atom. */
  referenceBohr: Float64Array;
  atoms: number;
  /** `3 · atoms`, the number of displacement columns. */
  size: number;
  frame: DipoleFrame | null;
}

/** Where a sweep writes its columns. */
export interface SweepOutput {
  /**
   * `columns.length · size` values: block `i` is the Hessian column for
   * `columns[i]`, in Eh/Bohr².
   */
  hessian: Float64Array;
  /**
   * `columns.length · 3` values, or `null` when dipoles were not requested:
   * block `i` is `dμ/dx` for `columns[i]`, in e (atomic units per Bohr).
   */
  dipole: Float64Array | null;
}

/** How a sweep reports progress and gets cancelled. */
export interface SweepOptions {
  /** Called after each finished column with how many are done. @default undefined */
  onColumn?: (done: number, total: number) => void;
  /** @default undefined */
  signal?: AbortSignal;
}

/**
 * Run the fused displacement sweep: for each Cartesian coordinate, two
 * `energyAndGradient` calls on the persistent calculator, reading the dipole at
 * the same two displaced points. One sweep therefore produces the Hessian AND
 * the dipole derivatives, where the previous scheme ran two independent 6N
 * sweeps. Once symmetrized the Hessian matches `calculator.hessian(STEP_BOHR)`
 * to 1.1e-16, i.e. to double-precision round-off.
 * @param context - The reusable state from `createSweepContext`.
 * @param columns - Coordinate indices to compute, in `[0, 3·atoms)`.
 * @param output - Pre-allocated destination, sized for `columns.length`.
 * @param options - Progress and cancellation.
 * @throws When `options.signal` aborts, or when occ fails at a displaced point.
 */
export function sweepColumns(
  context: SweepContext,
  columns: Int32Array,
  output: SweepOutput,
  options: SweepOptions = {},
): void {
  const { calculator, positions, referenceBohr, size, frame } = context;
  const displacedBohr = Float64Array.from(referenceBohr);
  const gradientPlus = new Float64Array(size);
  const gradientMinus = new Float64Array(size);
  const dipolePlus = new Float64Array(3);
  const dipoleMinus = new Float64Array(3);
  const inverseInterval = 1 / (2 * STEP_BOHR);
  const wantDipole = output.dipole !== null && frame !== null;

  for (let index = 0; index < columns.length; index++) {
    if (options.signal?.aborted === true) {
      throw new Error('calculation cancelled');
    }
    const column = columns[index] as number;
    evaluatePoint(
      context,
      column,
      STEP_BOHR,
      displacedBohr,
      gradientPlus,
      wantDipole ? dipolePlus : null,
    );
    evaluatePoint(
      context,
      column,
      -STEP_BOHR,
      displacedBohr,
      gradientMinus,
      wantDipole ? dipoleMinus : null,
    );

    const offset = index * size;
    for (let row = 0; row < size; row++) {
      output.hessian[offset + row] =
        ((gradientPlus[row] as number) - (gradientMinus[row] as number)) *
        inverseInterval;
    }
    const dipole = output.dipole;
    if (dipole !== null && wantDipole) {
      for (let axis = 0; axis < 3; axis++) {
        dipole[index * 3 + axis] =
          ((dipolePlus[axis] as number) - (dipoleMinus[axis] as number)) *
          inverseInterval;
      }
    }

    // Leave the matrix and the mirror array exactly at the reference geometry,
    // so the next column only has to touch its own coordinate.
    displacedBohr[column] = referenceBohr[column] as number;
    positions.set(column % 3, (column / 3) | 0, displacedBohr[column]);
    options.onColumn?.(index + 1, columns.length);
  }

  // The calculator is otherwise left at the last displaced point, and its
  // density with it, which would silently move anything computed afterwards.
  calculator.updateStructure(positions);
}

/**
 * Build the reusable sweep state at a geometry that is already final.
 * @param module - The loaded occjs module.
 * @param molecule - The reference molecule, centred on its centre of mass.
 * @param calculator - A calculator on `molecule` whose SCF has converged, with
 * charge and unpaired electrons already applied.
 * @param wantDipole - Whether IR intensities are requested.
 * @param scope - Scope owning the handles this creates; it must outlive the sweep.
 * @returns The context every column evaluation shares.
 */
export function createSweepContext(
  module: OccModule,
  molecule: OccMolecule,
  calculator: OccXtbCalculator,
  wantDipole: boolean,
  scope: HandleScope,
): SweepContext {
  const atoms = calculator.numAtoms();
  const size = atoms * 3;
  const positions = scope.keep(calculator.positions());
  const referenceBohr = new Float64Array(size);
  for (let atom = 0; atom < atoms; atom++) {
    for (let axis = 0; axis < 3; axis++) {
      referenceBohr[atom * 3 + axis] = positions.get(axis, atom);
    }
  }
  const frame = wantDipole
    ? createDipoleFrame(
        module,
        calculator,
        scope.keep(molecule.centerOfMass()),
        scope,
      )
    : null;
  return {
    module,
    calculator,
    molecule,
    positions,
    referenceBohr,
    atoms,
    size,
    frame,
  };
}

/** One displaced point: move a single coordinate, re-converge, read out. */
function evaluatePoint(
  context: SweepContext,
  column: number,
  offset: number,
  displacedBohr: Float64Array,
  gradientOut: Float64Array,
  dipoleOut: Float64Array | null,
): void {
  const { module, calculator, positions, referenceBohr, atoms, frame } =
    context;
  const target = (referenceBohr[column] as number) + offset;
  displacedBohr[column] = target;
  positions.set(column % 3, (column / 3) | 0, target);
  calculator.updateStructure(positions);

  const result = calculator.energyAndGradient();
  const gradient = result.gradient;
  try {
    for (let atom = 0; atom < atoms; atom++) {
      for (let axis = 0; axis < 3; axis++) {
        gradientOut[atom * 3 + axis] = gradient.get(axis, atom);
      }
    }
  } finally {
    gradient.delete?.();
    result.delete?.();
  }

  if (dipoleOut !== null && frame !== null) {
    readDipole(module, calculator, frame, displacedBohr, dipoleOut);
  }
}
