import type {
  Molecule,
  VibrationalMode,
  VibrationalRequest,
  VibrationalResult,
} from '../types/index.ts';

import { getVibrationalAnalyser } from './occAnalyse.ts';
import { assembleModes } from './occModes.ts';
import type { RawVibrational } from './occRun.ts';

/** What `buildResult` needs beyond the raw numbers. */
export interface ResultInput {
  engineId: string;
  request: VibrationalRequest;
  raw: RawVibrational;
  /** `performance.now()` at the start of the run, for the total timing. */
  startedAt: number;
}

/**
 * Turn one engine's raw numbers into the app's `VibrationalResult`: assemble
 * the modes, run the pure-JavaScript analysis that is available, and collect
 * every warning the user has to see.
 * @param input - Engine id, the echoed request, the raw numbers and the start time.
 * @returns The finished result.
 */
export function buildResult(input: ResultInput): VibrationalResult {
  const { engineId, request, raw, startedAt } = input;
  const analyseStarted = performance.now();
  const atoms = request.molecule.elements.length;
  const modes = assembleModes({
    atoms,
    masses: raw.masses,
    frequencies: raw.frequencies,
    normalModes: raw.normalModes,
    dipoleDerivatives: raw.dipoleDerivatives,
  });

  const geometry = {
    elements: request.molecule.elements,
    coordinates: raw.coordinates,
  };
  const warnings = [...raw.warnings];
  const analyser = getVibrationalAnalyser();

  if (request.outputs.raman) {
    applyRaman(modes, geometry, raw.masses, request.molecule, warnings);
  }
  const involvements = analyser?.involvements?.(request.molecule, modes);
  if (involvements !== undefined) {
    for (let index = 0; index < modes.length; index++) {
      (modes[index] as VibrationalMode).involvement =
        involvements[index] ?? null;
    }
  }

  let imaginaryCount = 0;
  for (const mode of modes) {
    if (mode.wavenumber < 0) imaginaryCount++;
  }
  if (imaginaryCount > 0) {
    warnings.push(
      `${imaginaryCount} imaginary mode(s): this geometry is a saddle point, not a minimum, so the thermochemistry describes a transition state.`,
    );
  }

  const thermochemistry = buildThermochemistry(input, modes, warnings);
  const analyse = performance.now() - analyseStarted;
  return {
    id: crypto.randomUUID(),
    engineId,
    request,
    geometry,
    energy: {
      ...raw.energy,
    },
    modes,
    imaginaryCount,
    thermochemistry,
    timings: {
      optimize: raw.optimizeMs,
      hessian: raw.hessianMs,
      analyse,
      total: performance.now() - startedAt,
    },
    warnings,
  };
}

/** Fill the Raman fields in place, or explain why they stay null. */
function applyRaman(
  modes: VibrationalMode[],
  geometry: { elements: string[]; coordinates: Float64Array },
  masses: Float64Array,
  molecule: Molecule,
  warnings: string[],
): void {
  const compute = getVibrationalAnalyser()?.ramanActivities;
  if (compute === undefined) {
    warnings.push(
      'Raman activities were requested but no Raman analyser is installed, so they are not reported.',
    );
    return;
  }
  let activities: ReadonlyArray<{
    ramanActivity: number;
    depolarizationRatio: number;
  }>;
  try {
    activities = compute(geometry, modes, masses, molecule);
  } catch (error) {
    warnings.push(
      `Raman activities could not be computed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  for (let index = 0; index < modes.length; index++) {
    const analysis = activities[index];
    if (analysis === undefined) continue;
    const mode = modes[index] as VibrationalMode;
    mode.ramanActivity = analysis.ramanActivity;
    mode.depolarizationRatio = analysis.depolarizationRatio;
  }
}

/** The RRHO block, or null with a warning saying why. */
function buildThermochemistry(
  input: ResultInput,
  modes: readonly VibrationalMode[],
  warnings: string[],
): VibrationalResult['thermochemistry'] {
  const { request, raw } = input;
  if (!request.outputs.thermochemistry) return null;
  const compute = getVibrationalAnalyser()?.thermochemistry;
  if (compute === undefined) {
    warnings.push(
      'Thermochemistry was requested but no thermochemistry analyser is installed, so it is not reported.',
    );
    return null;
  }

  const wavenumbers = new Float64Array(modes.length);
  for (let index = 0; index < modes.length; index++) {
    wavenumbers[index] = (modes[index] as VibrationalMode).wavenumber;
  }
  const symmetryNumber =
    request.settings.symmetryNumber ?? raw.pointGroup.symmetryNumber;
  try {
    return compute({
      geometry: {
        elements: request.molecule.elements,
        coordinates: raw.coordinates,
      },
      masses: raw.masses,
      wavenumbers,
      electronicEnergy: raw.energy.total,
      temperature: request.settings.temperature,
      pressure: request.settings.pressure,
      symmetryNumber,
      pointGroup: raw.pointGroup.label,
    });
  } catch (error) {
    warnings.push(
      `Thermochemistry could not be computed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
