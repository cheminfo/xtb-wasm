import {
  FORCE_CONSTANT_MDYN_PER_ANGSTROM,
  IR_INTENSITY_KM_PER_MOL,
} from '../chemistry/constants.ts';
import type { VibrationalMode } from '../types/index.ts';

/**
 * Modes whose wavenumber is below this in magnitude are the translations and
 * rotations the Eckart projection removed. They come out at ±0.000 cm⁻¹ because
 * the projection is algebraic (`Pᵀ H P`), not because the gradient vanishes, so
 * a fixed threshold is exact here — and 1.0 cm⁻¹ is bit-for-bit xtb's own
 * `vibthr` default.
 */
export const TRANS_ROT_CUTOFF_CM = 1;

/** The raw numbers a finished sweep hands to the mode assembly. */
export interface ModeAssemblyInput {
  atoms: number;
  /** One standard atomic weight per atom, in amu, from occ's own table. */
  masses: Float64Array;
  /** `3N` wavenumbers in cm⁻¹, ascending. */
  frequencies: Float64Array;
  /** `3N × 3N` row-major; column `mode` is its mass-weighted eigenvector. */
  normalModes: Float64Array;
  /**
   * `3N × 3` values, `[coordinate · 3 + axis]`, in e; or `null` when IR
   * intensities were not requested.
   */
  dipoleDerivatives: Float64Array | null;
}

/**
 * Turn the eigen-decomposition and the dipole derivatives into the app's normal
 * modes, dropping the projected translations and rotations. Raman activities and
 * the mode/structure involvement are left `null` for the analyse step.
 * @param input - Masses, wavenumbers, eigenvectors and dipole derivatives.
 * @returns The genuine vibrations, in ascending wavenumber order.
 */
export function assembleModes(input: ModeAssemblyInput): VibrationalMode[] {
  const { atoms, masses, frequencies, normalModes, dipoleDerivatives } = input;
  const size = atoms * 3;
  const inverseRootMass = new Float64Array(size);
  for (let coordinate = 0; coordinate < size; coordinate++) {
    inverseRootMass[coordinate] =
      1 / Math.sqrt(masses[(coordinate / 3) | 0] as number);
  }

  const modes: VibrationalMode[] = [];
  for (let index = 0; index < frequencies.length; index++) {
    const wavenumber = frequencies[index] as number;
    if (Math.abs(wavenumber) < TRANS_ROT_CUTOFF_CM) continue;

    const eigenvector = new Float64Array(size);
    const cartesianDisplacement = new Float64Array(size);
    let displacementSquared = 0;
    let derivativeX = 0;
    let derivativeY = 0;
    let derivativeZ = 0;

    for (let coordinate = 0; coordinate < size; coordinate++) {
      const weight = normalModes[coordinate * size + index] as number;
      eigenvector[coordinate] = weight;
      const displacement = weight * (inverseRootMass[coordinate] as number);
      cartesianDisplacement[coordinate] = displacement;
      displacementSquared += displacement * displacement;
      if (dipoleDerivatives !== null) {
        derivativeX +=
          (dipoleDerivatives[coordinate * 3] as number) * displacement;
        derivativeY +=
          (dipoleDerivatives[coordinate * 3 + 1] as number) * displacement;
        derivativeZ +=
          (dipoleDerivatives[coordinate * 3 + 2] as number) * displacement;
      }
    }

    // μ = 1 / Σᵢ (eᵢ/√mᵢ)², the standard reduced mass of a unit-norm
    // mass-weighted eigenvector: 1.0832 amu for the water bend.
    const reducedMass = 1 / displacementSquared;
    modes.push({
      wavenumber,
      irIntensity:
        dipoleDerivatives === null
          ? null
          : IR_INTENSITY_KM_PER_MOL *
            (derivativeX * derivativeX +
              derivativeY * derivativeY +
              derivativeZ * derivativeZ),
      ramanActivity: null,
      depolarizationRatio: null,
      eigenvector,
      cartesianDisplacement,
      maxDisplacement: largestAtomicDisplacement(cartesianDisplacement, atoms),
      reducedMass,
      // ν·|ν| rather than ν² so an imaginary mode reports a negative force
      // constant instead of a positive one, as xtb does.
      forceConstant:
        FORCE_CONSTANT_MDYN_PER_ANGSTROM *
        wavenumber *
        Math.abs(wavenumber) *
        reducedMass,
      involvement: null,
    });
  }
  return modes;
}

/** The largest single atomic displacement magnitude, i.e. a 3-vector norm. */
function largestAtomicDisplacement(
  displacement: Float64Array,
  atoms: number,
): number {
  let largestSquared = 0;
  for (let atom = 0; atom < atoms; atom++) {
    const x = displacement[atom * 3] as number;
    const y = displacement[atom * 3 + 1] as number;
    const z = displacement[atom * 3 + 2] as number;
    const magnitudeSquared = x * x + y * y + z * z;
    if (magnitudeSquared > largestSquared) largestSquared = magnitudeSquared;
  }
  return Math.sqrt(largestSquared);
}
