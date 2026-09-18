/** xtb methods accepted by the service, in increasing order of cost. */
export type XtbMethod = 'GFNFF' | 'GFN1xTB' | 'GFN2xTB';

/**
 * How the service classifies each of the 3N eigenvectors of the Hessian.
 * Only `vibration` modes are physically meaningful; the service folds the
 * spectrum from those alone.
 */
export type ModeType = 'translation' | 'rotation' | 'vibration';

/**
 * One row of `IRResult.modes`. The service returns all 3N modes, including
 * the 6 (5 if linear) spurious translation/rotation modes.
 *
 * Several fields are absent from the published OpenAPI schema but are always
 * present in the real payload (`wavenumber`, `modeType`, `mostContributingBonds`,
 * `centerOfMassDisplacement`, `totalChangeOfMomentOfInteria`, `displacementAlignment`).
 */
export interface XtbServiceMode {
  /** Index of the mode in the raw Hessian eigenvector ordering (0-based). Not the array position. */
  number: number;
  /** XYZ-format string: a count line, a comment line, then one line per atom with `symbol x y z dx dy dz`. */
  displacements: string;
  /** IR intensity in (D/Å)^2 amu^-1. */
  intensity: number;
  /** Raman intensity in (D/Å)^2 amu^-1, or null when the Raman step failed. */
  ramanIntensity: number | null;
  /** Magnitude of the wavenumber in cm^-1. Always positive; see `imaginary` for the sign. */
  wavenumber: number;
  /** True when the eigenvalue is negative, i.e. `wavenumber` is really `wavenumber`i. */
  imaginary: boolean;
  /** Atom indices (0-based) sorted by Euclidean displacement norm, descending. */
  mostDisplacedAtoms: number[];
  /** Atom indices (0-based) contributing most, by a distance criterion. */
  mostContributingAtoms: number[];
  /** Bonds as `[startAtom, endAtom]` index pairs (0-based). */
  mostContributingBonds: Array<[number, number]>;
  modeType: ModeType;
  centerOfMassDisplacement: number;
  /** Note: the service misspells "Inertia" as "Interia". Preserved verbatim. */
  totalChangeOfMomentOfInteria: number;
  displacementAlignment: number;
}

/** An entry of `IRResult.mostRelevantModesOfBonds`. */
export interface XtbServiceBondMode {
  startAtom: number;
  endAtom: number;
  mode: number;
  displacement: number;
}

/**
 * The exact JSON body returned by `GET|POST /v1/ir`.
 *
 * WARNING: `wavenumbers` and `intensities` are NOT per-mode arrays despite what
 * the OpenAPI descriptions suggest. They are a pre-folded spectrum on a fixed
 * grid of 10001 points spanning 0..4000 cm^-1 in 0.4 cm^-1 steps. Per-mode
 * values live in `modes[]`.
 */
export interface XtbServiceIrResult {
  /** Folded spectrum grid, 10001 points, 0..4000 cm^-1, step 0.4. */
  wavenumbers: number[];
  /** Folded IR spectrum, same length as `wavenumbers`. Units (D/Å)^2 amu^-1. */
  intensities: number[];
  /** Folded Raman spectrum, or null when the Raman step failed. */
  ramanIntensities: number[] | null;
  /**
   * Zero-point energy. The OpenAPI says "a.u."; it is actually **eV**, and it is
   * summed over every non-imaginary mode including the spurious rotation and
   * translation ones. Verified against water/ethanol/benzene/caffeine.
   */
  zeroPointEnergy: number;
  modes: XtbServiceMode[];
  /** Keyed by atom index (as a string); value is mode indices sorted by relevance. */
  mostRelevantModesOfAtoms: Record<string, number[]>;
  mostRelevantModesOfBonds: XtbServiceBondMode[] | null;
  /** Contaminated by near-zero translation/rotation modes; usually true. Prefer the recomputed flag. */
  hasImaginaryFrequency: boolean;
  isLinear: boolean;
  /** Moments of inertia in amu*angstrom^2. */
  momentsOfInertia: number[];
  /** Also contaminated; see `hasImaginaryFrequency`. */
  hasLargeImaginaryFrequency: boolean;
}

/** FastAPI 422 validation-error body. */
export interface FastApiValidationError {
  detail: Array<{ loc: string[]; msg: string; type: string }> | string;
}
