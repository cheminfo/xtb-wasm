import type {
  CalculationSettings,
  EnergyBreakdown,
  Geometry,
} from '../types/index.ts';

import {
  atomicNumbersOf,
  buildMolecule,
  readCoordinates,
} from './occGeometry.ts';
import { describeOccError } from './occModule.ts';
import type { HandleScope } from './occScope.ts';
import type { OccModule, OccMolecule, OccXtbCalculator } from './occTypes.ts';

/** A molecule, a converged calculator on it, and what the SCF reported. */
export interface PreparedSystem {
  molecule: OccMolecule;
  calculator: OccXtbCalculator;
  atoms: number;
  /** The geometry the calculator holds, centred, flat `x,y,z` per atom in Å. */
  coordinates: Float64Array;
  energy: EnergyBreakdown;
  /** Whether occ actually ran a spin-unrestricted SCF. */
  isUnrestricted: boolean;
  /** The GFN2 spin-polarization energy, Eh. Exactly 0 for a closed shell. */
  spinEnergy: number;
  warnings: string[];
}

/**
 * Build a centred molecule and a converged GFN2 calculator on it, with the
 * request's charge and unpaired electrons applied.
 *
 * `charge` and `numUnpairedElectrons` are accessor properties on
 * `XtbCalculator`, so assigning them before the first SCF is what changes the
 * physics: OH⁻ at charge −1 gives −4.68161144637 Eh against −4.44320562018 Eh
 * for the neutral radical.
 * @param module - The loaded occjs module.
 * @param geometry - Elements and Cartesian coordinates in Å.
 * @param settings - Charge and spin; the rest is ignored here.
 * @param scope - Scope owning the molecule and the calculator.
 * @returns The prepared system.
 * @throws When the electron count and the unpaired-electron count disagree in
 * parity, or when the SCF fails.
 */
export function prepareSystem(
  module: OccModule,
  geometry: Geometry,
  settings: CalculationSettings,
  scope: HandleScope,
): PreparedSystem {
  const atomicNumbers = atomicNumbersOf(module, geometry.elements);
  const molecule = buildMolecule(
    module,
    atomicNumbers,
    geometry.coordinates,
    scope,
  );
  const atoms = atomicNumbers.length;
  const calculator = scope.keep(module.XtbCalculator.fromMolecule(molecule));
  calculator.charge = settings.charge;
  calculator.numUnpairedElectrons = settings.unpairedElectrons;

  try {
    calculator.singlePoint();
  } catch (error) {
    throw new Error(describeOccError(module, error), { cause: error });
  }

  const warnings: string[] = [];
  const isUnrestricted = calculator.isUnrestricted();
  if (settings.unpairedElectrons > 0 && !isUnrestricted) {
    warnings.push(
      `${settings.unpairedElectrons} unpaired electron(s) were requested but occ ran a spin-restricted SCF, so the result describes a closed shell.`,
    );
  }
  if (isUnrestricted) {
    warnings.push(
      'Open-shell GFN2: occ runs a spin-polarized SCF with its own spin constants, which is not what xtb --uhf does, so frequencies may differ from a native xtb reference by more than the closed-shell tolerance.',
    );
  }

  return {
    molecule,
    calculator,
    atoms,
    coordinates: readAngstromCoordinates(molecule, atoms, scope),
    energy: {
      total: calculator.totalEnergy(),
      scc: calculator.sccEnergy(),
      repulsion: calculator.repulsionEnergy(),
      dispersion: calculator.dispersionEnergy(),
    },
    isUnrestricted,
    spinEnergy: calculator.spinEnergy(),
    warnings,
  };
}

/** The molecule's own coordinates, i.e. after centring, in Å. */
function readAngstromCoordinates(
  molecule: OccMolecule,
  atoms: number,
  scope: HandleScope,
): Float64Array {
  return readCoordinates(scope.keep(molecule.positions()), atoms);
}
