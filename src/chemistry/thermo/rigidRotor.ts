/**
 * Translational and rotational thermodynamics of an ideal gas of rigid rotors,
 * in the form xtb's `thermodyn` uses.
 *
 * The translational entropy is Sackur–Tetrode at the requested pressure; xtb
 * hard-codes 1 atm, and passing `STANDARD_PRESSURE_PA` reproduces it exactly.
 * The enthalpy carries the `PV = RT` term, so the translational enthalpy is
 * 5RT/2 while the translational heat capacity reported here is the
 * constant-volume 3R/2.
 */

import {
  AMU_KG,
  BOLTZMANN_J_PER_K,
  GAS_CONSTANT,
  PLANCK_J_S,
} from '../constants.ts';

/** One set of degrees of freedom's contribution, per mole. */
export interface RigidRotorContribution {
  /** Enthalpy above 0 K, J/mol. Translation includes `PV = RT`. */
  enthalpy: number;
  /** Entropy, J/(mol·K). */
  entropy: number;
  /** Constant-volume heat capacity, J/(mol·K). */
  heatCapacity: number;
}

/**
 * Translational contribution of an ideal gas.
 * @param molarMass - Total molecular mass, amu.
 * @param temperature - Temperature, K.
 * @param pressure - Pressure, Pa.
 * @returns Translational enthalpy, entropy and constant-volume heat capacity.
 */
export function translationalContribution(
  molarMass: number,
  temperature: number,
  pressure: number,
): RigidRotorContribution {
  const mass = molarMass * AMU_KG;
  const thermalEnergy = BOLTZMANN_J_PER_K * temperature;
  const partition =
    ((2 * Math.PI * mass * thermalEnergy) / (PLANCK_J_S * PLANCK_J_S)) ** 1.5 *
    (thermalEnergy / pressure);
  return {
    enthalpy: 2.5 * GAS_CONSTANT * temperature,
    entropy: GAS_CONSTANT * (Math.log(partition) + 2.5),
    heatCapacity: 1.5 * GAS_CONSTANT,
  };
}

/**
 * Rotational contribution of a rigid rotor.
 *
 * `moments` are xtb's already-zeroed principal moments, so a linear rotor
 * arrives as `[0, I, I]` and the linear branch uses the largest of the three —
 * exactly what xtb's `A = const2 / eig(3)` picks out.
 * @param moments - Principal moments in amu·Å², ascending.
 * @param temperature - Temperature, K.
 * @param symmetryNumber - Rotational symmetry number σ, at least 1.
 * @param isLinear - Treat the rotor as linear, i.e. two rotational degrees of freedom.
 * @returns Rotational enthalpy, entropy and heat capacity.
 */
export function rotationalContribution(
  moments: Float64Array,
  temperature: number,
  symmetryNumber: number,
  isLinear: boolean,
): RigidRotorContribution {
  const thermalEnergy = BOLTZMANN_J_PER_K * temperature;
  const scale = AMU_KG / 1e20;

  if (isLinear) {
    const moment = (moments[2] as number) * scale;
    const partition =
      (8 * Math.PI * Math.PI * moment * thermalEnergy) /
      (symmetryNumber * PLANCK_J_S * PLANCK_J_S);
    return {
      enthalpy: GAS_CONSTANT * temperature,
      entropy: GAS_CONSTANT * (Math.log(partition) + 1),
      heatCapacity: GAS_CONSTANT,
    };
  }

  const product =
    (moments[0] as number) *
    (moments[1] as number) *
    (moments[2] as number) *
    scale *
    scale *
    scale;
  const partition =
    (Math.sqrt(Math.PI) / symmetryNumber) *
    ((8 * Math.PI * Math.PI * thermalEnergy) / (PLANCK_J_S * PLANCK_J_S)) **
      1.5 *
    Math.sqrt(product);
  return {
    enthalpy: 1.5 * GAS_CONSTANT * temperature,
    entropy: GAS_CONSTANT * (Math.log(partition) + 1.5),
    heatCapacity: 1.5 * GAS_CONSTANT,
  };
}
