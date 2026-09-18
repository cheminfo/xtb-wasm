import type {
  CalculationSettings,
  OutputSelection,
  XtbMethod,
} from './calculation.ts';
import type { Geometry, Molecule } from './molecule.ts';
import type { Thermochemistry, VibrationalMode } from './vibration.ts';

/** Wall-clock timings of a calculation, in milliseconds. */
export interface Timings {
  /** Geometry relaxation. */
  optimize: number;
  /** The displacement sweep that yields the Hessian and the dipole derivatives. */
  hessian: number;
  /** Mode assembly, Raman activities and thermochemistry. */
  analyse: number;
  total: number;
}

/** Which stage of a run is in flight. */
export type EngineStage = 'init' | 'optimize' | 'hessian' | 'analyse';

/** How far along a running calculation is. */
export interface EngineProgress {
  stage: EngineStage;
  /** Fraction in [0, 1], or `null` when the stage has no measurable progress. */
  fraction: number | null;
  message: string;
}

/** A complete, self-contained description of one calculation to run. */
export interface VibrationalRequest {
  molecule: Molecule;
  settings: CalculationSettings;
  outputs: OutputSelection;
}

/** The energy decomposition an engine reports, all in Hartree. */
export interface EnergyBreakdown {
  total: number;
  /** Self-consistent-charge term. */
  scc: number | null;
  repulsion: number | null;
  dispersion: number | null;
}

/** The result of a vibrational calculation, whatever engine produced it. */
export interface VibrationalResult {
  /** Stable id of this result, so a consumer can key and label it. */
  id: string;
  /** Id of the engine that produced this result. */
  engineId: string;
  /** The request, echoed back, so a stored result is self-describing. */
  request: VibrationalRequest;
  /** The geometry the Hessian was computed at, i.e. after optimization. */
  geometry: Geometry;
  energy: EnergyBreakdown;
  /** Normal modes, sorted by ascending wavenumber. */
  modes: VibrationalMode[];
  /** Modes with a negative wavenumber. Non-zero means it is not a minimum. */
  imaginaryCount: number;
  /** RRHO block, or `null` when it was not requested or not possible. */
  thermochemistry: Thermochemistry | null;
  timings: Timings;
  /** Anything the user should know: unconverged, saddle point, model caveats. */
  warnings: string[];
}

/**
 * What an engine can actually do. Every optional feature is advertised here so
 * the UI can disable a control rather than offer one that silently lies.
 */
export interface EngineCapabilities {
  /** Methods this build really runs. */
  methods: readonly XtbMethod[];
  /** IR intensities from dipole derivatives. */
  ir: boolean;
  /** Which Raman model is available, or `null` when there is none. */
  raman: 'bond-polarizability' | 'analytic-polarizability' | null;
  thermochemistry: boolean;
  /** Non-zero total charge. */
  charge: boolean;
  /** Open-shell (unpaired electrons). */
  openShell: boolean;
  /** Frozen-atom constraints during optimization. */
  constraints: boolean;
}

/** Control-plane options: these never affect the physics, only how a run is driven. */
export interface EngineRunOptions {
  /** @default undefined */
  signal?: AbortSignal;
  /** @default undefined */
  onProgress?: (progress: EngineProgress) => void;
}

/**
 * A source of vibrational calculations. Every engine declares what it can do,
 * and must reject — never silently ignore — a request it cannot honour.
 */
export interface VibrationalEngine {
  id: string;
  label: string;
  /** One line describing what actually runs, shown in the UI. */
  description: string;
  /** Where the computation happens. */
  location: 'browser' | 'server' | 'fixture';
  capabilities: EngineCapabilities;
  /** Whether this engine can run right now: module loaded, service reachable. */
  isAvailable: () => Promise<boolean>;
  /**
   * Reasons this engine cannot run the request, empty when it can. Callers must
   * check this before `compute`, which throws on the same conditions.
   * @param request - The calculation to check.
   * @returns Human-readable refusals, e.g. "GFN-FF is not available".
   */
  validate: (request: VibrationalRequest) => string[];
  compute: (
    request: VibrationalRequest,
    options: EngineRunOptions,
  ) => Promise<VibrationalResult>;
}
