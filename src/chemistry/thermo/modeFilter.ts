/**
 * The frequency pre-processing xtb's `print_thermo` performs before any
 * partition function is evaluated.
 */

/** The frequency list the partition functions are allowed to see. */
export interface FilteredModes {
  /** Real wavenumbers in cm⁻¹, all strictly positive. */
  wavenumbers: Float64Array;
  /** Modes dropped for being too imaginary to invert. */
  imaginaryCount: number;
  /** Modes that were negative but shallow enough for xtb to flip in sign. */
  invertedCount: number;
}

/** Thresholds xtb applies to the frequency list, all in cm⁻¹. */
export interface ModeFilterOptions {
  /**
   * `|ν| ≤ threshold` is taken to be a projected-out translation or rotation
   * and discarded silently. This is xtb's `vibthr`.
   * @default 1
   */
  vibrationThreshold?: number;
  /**
   * A negative wavenumber above this value is an artefact of the numerical
   * Hessian and is inverted rather than dropped. This is xtb's `thermo_ithr`.
   * @default -20
   */
  inversionThreshold?: number;
}

/**
 * Turn a raw wavenumber list into the positive list xtb sums over.
 *
 * Three things happen, in xtb's order: everything within `vibrationThreshold`
 * of zero is discarded as a projected mode, a shallow negative mode is inverted
 * in sign, and whatever is still negative is dropped and counted as imaginary.
 * @param wavenumbers - Harmonic wavenumbers in cm⁻¹, in any order.
 * @param options - Thresholds; the defaults are xtb's own.
 * @returns The positive wavenumbers plus the counts of what was changed.
 */
export function filterThermoModes(
  wavenumbers: readonly number[] | Float64Array,
  options: ModeFilterOptions = {},
): FilteredModes {
  const { vibrationThreshold = 1, inversionThreshold = -20 } = options;

  const modeCount = wavenumbers.length;
  const kept = new Float64Array(modeCount);
  let keptCount = 0;
  let imaginaryCount = 0;
  let invertedCount = 0;

  for (let index = 0; index < modeCount; index++) {
    const wavenumber = wavenumbers[index] as number;
    if (Math.abs(wavenumber) <= vibrationThreshold) continue;
    if (wavenumber > 0) {
      kept[keptCount++] = wavenumber;
      continue;
    }
    if (wavenumber > inversionThreshold) {
      kept[keptCount++] = -wavenumber;
      invertedCount++;
      continue;
    }
    imaginaryCount++;
  }

  return {
    wavenumbers: kept.subarray(0, keptCount),
    imaginaryCount,
    invertedCount,
  };
}
