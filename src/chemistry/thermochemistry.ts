/**
 * xtb's modified rigid-rotor/harmonic-oscillator thermochemistry.
 *
 * The assembly order is xtb's: filter the frequency list, classify the rotor,
 * resolve σ, then sum the vibrational, rotational and translational partition
 * functions. Energies come out in Hartree so they line up digit for digit with
 * `src/reference/fixtures/*.json`.
 *
 * Two deliberate departures from xtb are documented where they happen: the
 * electronic degeneracy 2S+1 is included (xtb omits it, and it is zero for the
 * closed-shell default), and `heatCapacity` is the constant-volume Cv where
 * xtb prints Cp = Cv + R.
 */

import type { Geometry, Thermochemistry } from '../types/index.ts';

import {
  AVOGADRO,
  GAS_CONSTANT,
  HARTREE_J,
  STANDARD_PRESSURE_PA,
} from './constants.ts';
import type { DetectedSymmetry } from './symmetry.ts';
import { resolveSymmetry } from './symmetry.ts';
import { inertiaAnalysis, isLinearRotor } from './thermo/inertia.ts';
import { filterThermoModes } from './thermo/modeFilter.ts';
import {
  rotationalContribution,
  translationalContribution,
} from './thermo/rigidRotor.ts';
import { vibrationalContribution } from './thermo/vibrational.ts';

/** Everything the mRRHO block needs. */
export interface ThermochemistryOptions {
  /** Element symbols and Cartesian coordinates in Angstrom. */
  geometry: Geometry;
  /** Atomic masses in amu — the ones the Hessian was diagonalized with. */
  masses: Float64Array;
  /**
   * Harmonic wavenumbers in cm⁻¹, translations/rotations already removed. A
   * `Float64Array` is accepted so the engine's own array is read in place
   * rather than copied into a plain array just to be scanned.
   */
  wavenumbers: readonly number[] | Float64Array;
  /** Electronic energy in Hartree. */
  electronicEnergy: number;
  /** @default 298.15 */
  temperature?: number;
  /** @default 101325 */
  pressure?: number;
  /** Detected point group and σ; σ is overridable by the caller. @default undefined */
  symmetry?: DetectedSymmetry;
  /** Caller override for σ, e.g. from the UI. @default null */
  symmetryNumber?: number | null;
  /** Unpaired electrons, for the electronic degeneracy 2S+1. @default 0 */
  unpairedElectrons?: number;
  /** mRRHO interpolation threshold in cm⁻¹. @default 50 */
  rotorThreshold?: number;
}

/** J/mol per Hartree, the only conversion this module performs. */
const JOULE_PER_MOLE_PER_HARTREE = HARTREE_J * AVOGADRO;

/** Point-group label used when the caller supplied no detection. */
const UNKNOWN_POINT_GROUP = 'unknown';

/**
 * Rigid-rotor/harmonic-oscillator thermochemistry with Grimme's low-mode
 * damping, matching xtb's `print_thermo`.
 * @param options - Geometry, masses, frequencies, electronic energy and state.
 * @returns The filled thermochemistry block, all energies in Hartree.
 */
export function thermochemistry(
  options: ThermochemistryOptions,
): Thermochemistry {
  const {
    geometry,
    masses,
    wavenumbers,
    electronicEnergy,
    temperature = 298.15,
    pressure = STANDARD_PRESSURE_PA,
    symmetry,
    symmetryNumber = null,
    unpairedElectrons = 0,
    rotorThreshold = 50,
  } = options;

  if (!(temperature > 0)) {
    throw new RangeError(
      `temperature must be positive, received ${temperature}`,
    );
  }
  if (!(pressure > 0)) {
    throw new RangeError(`pressure must be positive, received ${pressure}`);
  }
  if (!Number.isInteger(unpairedElectrons) || unpairedElectrons < 0) {
    throw new RangeError(
      `unpairedElectrons must be a non-negative integer, received ${unpairedElectrons}`,
    );
  }

  const modes = filterThermoModes(wavenumbers);
  const rotor = inertiaAnalysis(geometry, masses);
  const resolved = resolveSymmetry(
    geometry,
    masses,
    symmetry ?? { pointGroup: UNKNOWN_POINT_GROUP, symmetryNumber: 1 },
  );
  const sigma = symmetryNumber ?? resolved.symmetryNumber;
  if (!(sigma >= 1)) {
    throw new RangeError(
      `symmetry number must be at least 1, received ${sigma}`,
    );
  }

  // xtb tests linearity on the unit-mass tensor but zeroes principal moments on
  // the mass-weighted one, so the two can disagree for a nearly linear rotor.
  // Taking the non-linear branch then divides by a zero moment and returns an
  // infinite free energy, so a zeroed moment forces the linear treatment.
  const isLinear =
    !rotor.isAtom &&
    (isLinearRotor(geometry) || rotor.hasZeroedMoment) &&
    (rotor.moments[2] as number) > 0;

  const vibration = vibrationalContribution(modes.wavenumbers, {
    temperature,
    rotorThreshold,
    averageMoment: rotor.averageMoment,
  });
  const translation = translationalContribution(
    rotor.totalMass,
    temperature,
    pressure,
  );
  const rotation = rotor.isAtom
    ? { enthalpy: 0, entropy: 0, heatCapacity: 0 }
    : rotationalContribution(rotor.moments, temperature, sigma, isLinear);

  // xtb's own thermodyn has no electronic term at all. It is added here
  // because a doublet radical really does carry R·ln 2, and it vanishes for the
  // closed-shell default, so fixture agreement is unaffected.
  const multiplicity = unpairedElectrons + 1;
  const electronicEntropy = GAS_CONSTANT * Math.log(multiplicity);

  const thermal =
    vibration.thermalEnergy + rotation.enthalpy + translation.enthalpy;
  const enthalpy = vibration.zeroPointEnergy + thermal;
  const entropy =
    vibration.entropy +
    rotation.entropy +
    translation.entropy +
    electronicEntropy;
  const heatCapacity =
    vibration.heatCapacity + rotation.heatCapacity + translation.heatCapacity;

  const zeroPointEnergy = toHartree(vibration.zeroPointEnergy);
  const enthalpyCorrection = toHartree(enthalpy);
  const entropyHartree = toHartree(entropy);
  const gibbsCorrection = enthalpyCorrection - temperature * entropyHartree;

  return {
    temperature,
    pressure,
    zeroPointEnergy,
    thermalCorrection: toHartree(thermal),
    enthalpyCorrection,
    entropy: entropyHartree,
    gibbsCorrection,
    totalFreeEnergy: electronicEnergy + gibbsCorrection,
    totalEnthalpy: electronicEnergy + enthalpyCorrection,
    heatCapacity: toHartree(heatCapacity),
    symmetryNumber: sigma,
    pointGroup: resolved.pointGroup,
    isLinear,
    skippedImaginaryModes: modes.imaginaryCount,
  };
}

/**
 * Convert a molar quantity to atomic units.
 * @param joulePerMole - A value in J/mol or J/(mol·K).
 * @returns The same value in Eh or Eh/K.
 */
function toHartree(joulePerMole: number): number {
  return joulePerMole / JOULE_PER_MOLE_PER_HARTREE;
}
