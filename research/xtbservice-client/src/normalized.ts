import type { DataXY } from './spectrum.ts';
import type { ModeType, XtbMethod } from './types.ts';

/** One atom's equilibrium position and displacement vector within a mode. */
export interface ModeDisplacement {
  symbol: string;
  /** Equilibrium position in angstrom. */
  x: number;
  y: number;
  z: number;
  /** Displacement vector (dimensionless, mass-weighted eigenvector component). */
  dx: number;
  dy: number;
  dz: number;
}

/** A single vibrational mode, engine-independent. */
export interface VibrationalMode {
  /** Position in the engine's own mode ordering (0-based). */
  index: number;
  /** Magnitude of the wavenumber in cm^-1; always positive. */
  wavenumber: number;
  /** True when the mode is imaginary (negative Hessian eigenvalue). */
  imaginary: boolean;
  /** IR intensity in (D/Å)^2 amu^-1. */
  intensity: number;
  /** Raman intensity in (D/Å)^2 amu^-1, or null when unavailable. */
  ramanIntensity: number | null;
  /**
   * How the mode was classified. occjs has no such classifier, so a local engine
   * should report `vibration` for the 3N-6 it keeps and omit the rest.
   */
  modeType: ModeType;
  /** Per-atom displacements, parsed from the XYZ payload. Null when not requested or unavailable. */
  displacements: ModeDisplacement[] | null;
  /** Atom indices (0-based) sorted by displacement norm, descending. Null when the engine cannot supply it. */
  mostDisplacedAtoms: number[] | null;
}

/**
 * The common shape both the server client and a local occjs engine produce, so
 * the two can be A/B compared field by field.
 */
export interface IrResult {
  /** Which engine produced this result. */
  source: 'xtbservice' | 'occjs';
  method: XtbMethod;
  /** Real vibrational modes only (3N-6, or 3N-5 when linear). */
  modes: VibrationalMode[];
  /** Every mode the engine produced, including translations and rotations. */
  allModes: VibrationalMode[];
  /** Folded IR spectrum on the shared 0..4000 cm^-1 / 10001-point grid. */
  spectrum: DataXY;
  /** Folded Raman spectrum, or null when the engine does not compute Raman. */
  ramanSpectrum: DataXY | null;
  /** Zero-point energy in eV, summed over vibrational modes only. */
  zeroPointEnergyEv: number | null;
  /** Zero-point energy in Hartree, summed over vibrational modes only. */
  zeroPointEnergyHartree: number | null;
  /**
   * Zero-point energy exactly as the engine reported it, in eV. For xtbservice
   * this includes the spurious translation/rotation modes and so is inflated
   * (water: 0.5809 eV reported vs 0.5476 eV over vibrations alone).
   */
  reportedZeroPointEnergyEv: number | null;
  /** Total electronic energy in Hartree. xtbservice never returns one, so it is null there. */
  energyHartree: number | null;
  isLinear: boolean;
  /** Recomputed over vibrational modes only, unlike the server's contaminated flag. */
  hasImaginaryFrequency: boolean;
  /** True when a vibrational mode is imaginary by more than `imaginaryThreshold` cm^-1. */
  hasLargeImaginaryFrequency: boolean;
  /** Moments of inertia in amu*angstrom^2, or null. */
  momentsOfInertia: number[] | null;
  /** Number of atoms, when the engine reports enough to infer it. */
  atomCount: number | null;
  /** Wall-clock milliseconds the result took to obtain. */
  durationMs: number;
  /** Anything engine-specific worth keeping for the A/B view. */
  raw?: unknown;
}
