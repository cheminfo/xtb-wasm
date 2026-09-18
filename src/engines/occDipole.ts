import type { HandleScope } from './occScope.ts';
import { createHandleScope } from './occScope.ts';
import type { OccModule, OccVec3, OccXtbCalculator } from './occTypes.ts';

/**
 * A fixed frame in which every displaced dipole is evaluated. The origin is
 * captured ONCE from the reference geometry and never recomputed: making the
 * multipole origin a function of the geometry adds a spurious `−q·mₐ/M` term to
 * dμ/dRₐ. That term is projected out with the translations, so it does no
 * measurable harm, but it is wrong in principle for an ion and there is no
 * reason to introduce it.
 */
export interface DipoleFrame {
  /** The multipole origin, in Bohr. Shared by the electronic and nuclear terms. */
  origin: OccVec3;
  /** `x, y, z` of `origin`, read once so the nuclear sum needs no handle. */
  originBohr: Float64Array;
  /** GFN2 effective nuclear charge per atom, in units of e. */
  valenceCharges: Float64Array;
}

/**
 * GFN2 is a valence-only method, so the "nuclei" carry the number of electrons
 * the basis actually describes, not the full atomic number. Checked against
 * occ's order-0 multipole: water returns exactly −8 electrons for 6 + 1 + 1.
 */
const VALENCE_CHARGE: Readonly<Record<number, number>> = {
  1: 1,
  2: 2,
  3: 1,
  4: 2,
  5: 3,
  6: 4,
  7: 5,
  8: 6,
  9: 7,
  10: 8,
  11: 1,
  12: 2,
  13: 3,
  14: 4,
  15: 5,
  16: 6,
  17: 7,
  18: 8,
  19: 1,
  20: 2,
  35: 7,
  53: 7,
};

/**
 * Capture the fixed dipole frame from the reference molecule.
 * @param module - The loaded occjs module.
 * @param calculator - A calculator already at the reference geometry.
 * @param centreOfMass - `molecule.centerOfMass()` of the reference molecule,
 * which is ~zero once the molecule has been centred. The handle is kept by
 * `scope`, not by this function.
 * @param scope - Scope that owns `centreOfMass` for the whole sweep.
 * @returns The frame every displaced point must use.
 * @throws When an element has no GFN2 valence charge in the table.
 */
export function createDipoleFrame(
  module: OccModule,
  calculator: OccXtbCalculator,
  centreOfMass: OccVec3,
  scope: HandleScope,
): DipoleFrame {
  const atoms = calculator.numAtoms();
  const valenceCharges = new Float64Array(atoms);
  const numbers = scope.keep(calculator.atomicNumbers());
  for (let atom = 0; atom < atoms; atom++) {
    const atomicNumber = numbers.get(atom);
    const charge = VALENCE_CHARGE[atomicNumber];
    if (charge === undefined) {
      throw new Error(
        `no GFN2 valence charge for element ${atomicNumber}; the IR intensity would be wrong`,
      );
    }
    valenceCharges[atom] = charge;
  }
  const originBohr = new Float64Array([
    centreOfMass.x(),
    centreOfMass.y(),
    centreOfMass.z(),
  ]);
  return { origin: centreOfMass, originBohr, valenceCharges };
}

/**
 * The total GFN2 dipole at the calculator's current geometry, in atomic units:
 * the AO multipole of the converged density plus the valence-nuclear sum, both
 * about the frame's fixed origin.
 * @param module - The loaded occjs module.
 * @param calculator - A calculator whose SCF has just converged.
 * @param frame - The fixed frame from `createDipoleFrame`.
 * @param positionsBohr - Absolute coordinates the calculator was updated with,
 * flat `x,y,z` per atom in Bohr. `updateStructure` stores them verbatim, so
 * reading them back from the calculator would only cost a handle.
 * @param out - Receives `μx, μy, μz`.
 */
export function readDipole(
  module: OccModule,
  calculator: OccXtbCalculator,
  frame: DipoleFrame,
  positionsBohr: Float64Array,
  out: Float64Array,
): void {
  const scope = createHandleScope();
  try {
    const wavefunction = scope.keep(calculator.toWavefunction());
    const integrals = scope.keep(new module.IntegralEngine(wavefunction.basis));
    const electronic = scope.keep(
      integrals.multipole(1, wavefunction.molecularOrbitals, frame.origin),
    );
    out[0] = electronic.get(0);
    out[1] = electronic.get(1);
    out[2] = electronic.get(2);
  } finally {
    scope.release();
  }

  const { valenceCharges, originBohr } = frame;
  const originX = originBohr[0] as number;
  const originY = originBohr[1] as number;
  const originZ = originBohr[2] as number;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (let atom = 0; atom < valenceCharges.length; atom++) {
    const charge = valenceCharges[atom] as number;
    sumX += charge * ((positionsBohr[atom * 3] as number) - originX);
    sumY += charge * ((positionsBohr[atom * 3 + 1] as number) - originY);
    sumZ += charge * ((positionsBohr[atom * 3 + 2] as number) - originZ);
  }
  out[0] += sumX;
  out[1] += sumY;
  out[2] += sumZ;
}
