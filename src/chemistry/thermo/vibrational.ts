/**
 * Grimme's modified rigid-rotor/harmonic-oscillator treatment of the
 * vibrational degrees of freedom, as xtb's `thermodyn` implements it.
 *
 * Every mode contributes a harmonic-oscillator term and a free-rotor term to
 * the entropy and the heat capacity, mixed by the Chai–Head-Gordon switching
 * function. The enthalpy and the zero-point energy stay purely harmonic — xtb
 * damps only the two quantities that diverge as ν → 0.
 */

import {
  BOLTZMANN_J_PER_K,
  BOLTZMANN_WAVENUMBER_PER_K,
  GAS_CONSTANT,
  LIGHT_M_PER_S,
  PLANCK_J_S,
} from '../constants.ts';

/** ħ, J·s. */
const HBAR_J_S = PLANCK_J_S / (2 * Math.PI);

/** Vibrational thermodynamics of one set of real modes, per mole. */
export interface VibrationalContribution {
  /** Zero-point vibrational energy, J/mol. */
  zeroPointEnergy: number;
  /** Thermal vibrational energy above the zero point, J/mol. */
  thermalEnergy: number;
  /** Vibrational entropy, J/(mol·K). */
  entropy: number;
  /** Vibrational heat capacity, J/(mol·K). */
  heatCapacity: number;
}

/** Everything the mRRHO mixing needs beyond the frequencies themselves. */
export interface VibrationalOptions {
  /** Temperature, K. */
  temperature: number;
  /**
   * Interpolation threshold in cm⁻¹: the wavenumber at which the entropy is a
   * half-and-half mixture of oscillator and free rotor. xtb's `sthr`.
   */
  rotorThreshold: number;
  /**
   * Mean principal moment of inertia in kg·m². It caps the free rotor's moment
   * at roughly a third of the whole molecule's, which is what keeps the
   * free-rotor entropy finite as ν → 0. xtb's `avmom`.
   */
  averageMoment: number;
}

/**
 * Sum the mRRHO vibrational contributions over a list of real modes.
 * @param wavenumbers - Strictly positive harmonic wavenumbers in cm⁻¹, as
 * `filterThermoModes` produces them.
 * @param options - Temperature, rotor threshold and average moment of inertia.
 * @returns Zero-point energy, thermal energy, entropy and heat capacity per mole.
 * @throws RangeError when a wavenumber is not strictly positive; the free-rotor
 * moment `ħ²/2E` would otherwise diverge and silently poison the sums with NaN.
 */
export function vibrationalContribution(
  wavenumbers: Float64Array,
  options: VibrationalOptions,
): VibrationalContribution {
  const { temperature, rotorThreshold, averageMoment } = options;
  const kelvinPerWavenumber = 1 / BOLTZMANN_WAVENUMBER_PER_K;

  let zeroPointEnergy = 0;
  let thermalEnergy = 0;
  let entropy = 0;
  let heatCapacity = 0;

  const modeCount = wavenumbers.length;
  for (let index = 0; index < modeCount; index++) {
    const wavenumber = wavenumbers[index] as number;
    if (!(wavenumber > 0)) {
      throw new RangeError(
        `every wavenumber must be strictly positive, received ${wavenumber} at index ${index}`,
      );
    }
    const vibrationalTemperature = kelvinPerWavenumber * wavenumber;
    const reducedTemperature = vibrationalTemperature / temperature;
    const boltzmannFactor = Math.exp(-reducedTemperature);
    const occupation = boltzmannFactor / (1 - boltzmannFactor);

    zeroPointEnergy += 0.5 * GAS_CONSTANT * vibrationalTemperature;
    thermalEnergy += GAS_CONSTANT * vibrationalTemperature * occupation;

    const oscillatorEntropy =
      GAS_CONSTANT *
      (reducedTemperature * occupation - Math.log(1 - boltzmannFactor));
    const oscillatorHeatCapacity =
      GAS_CONSTANT *
      reducedTemperature *
      reducedTemperature *
      boltzmannFactor *
      (1 / ((1 - boltzmannFactor) * (1 - boltzmannFactor)));

    const oscillatorWeight = headGordonWeight(wavenumber, rotorThreshold);
    const rotorWeight = 1 - oscillatorWeight;

    entropy +=
      oscillatorWeight * oscillatorEntropy +
      rotorWeight * freeRotorEntropy(wavenumber, temperature, averageMoment);
    heatCapacity +=
      oscillatorWeight * oscillatorHeatCapacity +
      rotorWeight * 0.5 * GAS_CONSTANT;
  }

  return { zeroPointEnergy, thermalEnergy, entropy, heatCapacity };
}

/**
 * The Chai–Head-Gordon switching function, `1 / (1 + (sthr/ν)⁴)`: the weight
 * the harmonic oscillator keeps. It is ½ at ν = sthr, tends to 1 well above it
 * and to 0 well below it, and the exponent 4 is xtb's, not a free parameter.
 * @param wavenumber - Harmonic wavenumber in cm⁻¹, strictly positive.
 * @param rotorThreshold - Interpolation threshold in cm⁻¹.
 * @returns The harmonic-oscillator weight in [0, 1].
 */
export function headGordonWeight(
  wavenumber: number,
  rotorThreshold: number,
): number {
  if (rotorThreshold < 0) return 1;
  const ratio = rotorThreshold / wavenumber;
  const squared = ratio * ratio;
  return 1 / (1 + squared * squared);
}

/**
 * Entropy of a one-dimensional free rotor whose moment is the vibration's own
 * moment `ħ²/2E` damped towards the molecule's average moment.
 * @param wavenumber - Harmonic wavenumber in cm⁻¹, strictly positive.
 * @param temperature - Temperature, K.
 * @param averageMoment - Mean principal moment of inertia, kg·m².
 * @returns The free-rotor entropy of that mode, J/(mol·K).
 */
function freeRotorEntropy(
  wavenumber: number,
  temperature: number,
  averageMoment: number,
): number {
  const energy = PLANCK_J_S * LIGHT_M_PER_S * 100 * wavenumber;
  const bareMoment = (HBAR_J_S * HBAR_J_S) / (2 * energy);
  const moment =
    averageMoment > 0
      ? (bareMoment * averageMoment) / (bareMoment + averageMoment)
      : bareMoment;
  const partition = Math.sqrt(
    (2 * Math.PI * moment * BOLTZMANN_J_PER_K * temperature) /
      (HBAR_J_S * HBAR_J_S),
  );
  return GAS_CONSTANT * (0.5 + Math.log(partition));
}
