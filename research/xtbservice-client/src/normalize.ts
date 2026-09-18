import { foldSpectrum } from './fold.ts';
import type { IrResult, ModeDisplacement, VibrationalMode } from './normalized.ts';
import { CM1_TO_EV, EV_TO_HARTREE } from './spectrum.ts';
import type { XtbMethod, XtbServiceIrResult, XtbServiceMode } from './types.ts';

export interface NormalizeOptions {
  /** Imaginary wavenumber above which a mode counts as a failed optimization, in cm^-1. @default 10 */
  imaginaryThreshold?: number;
  /** Parse each mode's XYZ displacement block. Costly for large molecules. @default false */
  parseDisplacements?: boolean;
  /** Wall-clock duration to record on the result. @default 0 */
  durationMs?: number;
}

/**
 * Convert a raw xtbservice payload into the engine-independent {@link IrResult}.
 *
 * Two corrections are applied so the result is comparable with a local engine:
 * the mode list is filtered to `modeType === 'vibration'` (the service returns
 * all 3N modes), and the zero-point energy is recomputed over those modes alone
 * (the service sums over every non-imaginary mode, including the spurious
 * rotations, which inflates it — 0.5809 eV vs 0.5476 eV for water).
 *
 * @param raw - The payload from {@link fetchIrSpectrum}.
 * @param method - The method the payload was requested with; the service does not echo it back.
 * @param options - Normalization options.
 * @returns The normalized result.
 */
export function normalizeXtbService(
  raw: XtbServiceIrResult,
  method: XtbMethod,
  options: NormalizeOptions = {},
): IrResult {
  const {
    imaginaryThreshold = 10,
    parseDisplacements = false,
    durationMs = 0,
  } = options;

  const allModes: VibrationalMode[] = [];
  for (let i = 0; i < raw.modes.length; i++) {
    allModes.push(toMode(raw.modes[i] as XtbServiceMode, i, parseDisplacements));
  }

  const modes: VibrationalMode[] = [];
  for (const mode of allModes) {
    if (mode.modeType === 'vibration') modes.push(mode);
  }

  let zpeCm1 = 0;
  let hasImaginary = false;
  let hasLargeImaginary = false;
  for (const mode of modes) {
    if (mode.imaginary) {
      hasImaginary = true;
      if (mode.wavenumber > imaginaryThreshold) hasLargeImaginary = true;
    } else {
      zpeCm1 += mode.wavenumber;
    }
  }
  const zeroPointEnergyEv = 0.5 * zpeCm1 * CM1_TO_EV;

  const spectrum = { x: Float64Array.from(raw.wavenumbers), y: Float64Array.from(raw.intensities) };
  const ramanSpectrum = raw.ramanIntensities
    ? { x: Float64Array.from(raw.wavenumbers), y: Float64Array.from(raw.ramanIntensities) }
    : null;

  return {
    source: 'xtbservice',
    method,
    modes,
    allModes,
    spectrum,
    ramanSpectrum,
    zeroPointEnergyEv,
    zeroPointEnergyHartree: zeroPointEnergyEv * EV_TO_HARTREE,
    reportedZeroPointEnergyEv: raw.zeroPointEnergy,
    // xtbservice computes a total energy during optimization but never returns it.
    energyHartree: null,
    isLinear: raw.isLinear,
    hasImaginaryFrequency: hasImaginary,
    hasLargeImaginaryFrequency: hasLargeImaginary,
    momentsOfInertia: raw.momentsOfInertia ?? null,
    atomCount: raw.modes.length > 0 ? raw.modes.length / 3 : null,
    durationMs,
    raw,
  };
}

/**
 * Build the same normalized shape from bare mode data, for a local engine such
 * as occjs that yields only wavenumbers (and, if dipole derivatives ever land,
 * intensities). The spectrum is folded with the server's exact convention so the
 * two curves land on an identical grid.
 *
 * @param input - Mode data from the local engine.
 * @returns The normalized result.
 */
export function normalizeLocalEngine(input: {
  method: XtbMethod;
  /** Vibrational wavenumbers in cm^-1; magnitudes, with `imaginary` carrying the sign. */
  wavenumbers: readonly number[] | Float64Array;
  /** IR intensities in (D/Å)^2 amu^-1. Pass zeros when the engine has no dipole derivatives. */
  intensities?: readonly number[] | Float64Array;
  imaginary?: readonly boolean[];
  energyHartree?: number | null;
  isLinear?: boolean;
  momentsOfInertia?: number[] | null;
  atomCount?: number | null;
  durationMs?: number;
  imaginaryThreshold?: number;
}): IrResult {
  const {
    method,
    wavenumbers,
    imaginary,
    energyHartree = null,
    isLinear = false,
    momentsOfInertia = null,
    atomCount = null,
    durationMs = 0,
    imaginaryThreshold = 10,
  } = input;

  const nbModes = wavenumbers.length;
  const intensities = input.intensities ?? new Float64Array(nbModes);

  const modes: VibrationalMode[] = [];
  let zpeCm1 = 0;
  let hasImaginary = false;
  let hasLargeImaginary = false;

  for (let i = 0; i < nbModes; i++) {
    const isImaginary = imaginary?.[i] ?? false;
    const wavenumber = Math.abs(wavenumbers[i] ?? 0);
    if (isImaginary) {
      hasImaginary = true;
      if (wavenumber > imaginaryThreshold) hasLargeImaginary = true;
    } else {
      zpeCm1 += wavenumber;
    }
    modes.push({
      index: i,
      wavenumber,
      imaginary: isImaginary,
      intensity: intensities[i] ?? 0,
      ramanIntensity: null,
      modeType: 'vibration',
      displacements: null,
      mostDisplacedAtoms: null,
    });
  }

  const realWavenumbers = new Float64Array(modes.length);
  const realIntensities = new Float64Array(modes.length);
  let nbReal = 0;
  for (const mode of modes) {
    if (!mode.imaginary) {
      realWavenumbers[nbReal] = mode.wavenumber;
      realIntensities[nbReal] = mode.intensity;
      nbReal++;
    }
  }

  const zeroPointEnergyEv = 0.5 * zpeCm1 * CM1_TO_EV;

  return {
    source: 'occjs',
    method,
    modes,
    allModes: modes,
    spectrum: foldSpectrum(realWavenumbers.subarray(0, nbReal), realIntensities.subarray(0, nbReal)),
    ramanSpectrum: null,
    zeroPointEnergyEv,
    zeroPointEnergyHartree: zeroPointEnergyEv * EV_TO_HARTREE,
    reportedZeroPointEnergyEv: null,
    energyHartree,
    isLinear,
    hasImaginaryFrequency: hasImaginary,
    hasLargeImaginaryFrequency: hasLargeImaginary,
    momentsOfInertia,
    atomCount,
    durationMs,
  };
}

function toMode(raw: XtbServiceMode, index: number, parseDisplacements: boolean): VibrationalMode {
  return {
    index,
    wavenumber: raw.wavenumber,
    imaginary: raw.imaginary,
    intensity: raw.intensity,
    ramanIntensity: raw.ramanIntensity ?? null,
    modeType: raw.modeType,
    displacements: parseDisplacements ? parseDisplacementXyz(raw.displacements) : null,
    mostDisplacedAtoms: raw.mostDisplacedAtoms ?? null,
  };
}

/**
 * Parse the per-mode XYZ block: a count line, a comment line, then one line per
 * atom holding `symbol x y z dx dy dz`.
 *
 * @param xyz - The `displacements` string from a mode.
 * @returns One entry per atom.
 */
export function parseDisplacementXyz(xyz: string): ModeDisplacement[] {
  const lines = xyz.split('\n');
  const count = Number.parseInt(lines[0] ?? '', 10);
  const result: ModeDisplacement[] = [];
  for (let i = 0; i < count; i++) {
    const line = lines[i + 2];
    if (line === undefined) break;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;
    result.push({
      symbol: parts[0] as string,
      x: Number(parts[1]),
      y: Number(parts[2]),
      z: Number(parts[3]),
      dx: Number(parts[4]),
      dy: Number(parts[5]),
      dz: Number(parts[6]),
    });
  }
  return result;
}
