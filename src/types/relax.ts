import type { XtbMethod } from './calculation.ts';
import type { EnergyBreakdown } from './engine.ts';
import type { Geometry } from './molecule.ts';

/**
 * Everything that changes the physics of a relaxation. A relaxation is a
 * geometry optimization and nothing else, so the thermochemistry settings of a
 * {@link CalculationSettings} have no counterpart here.
 */
export interface RelaxSettings {
  /** @default 'GFN2' */
  method: XtbMethod;
  /** Total molecular charge in units of e. @default 0 */
  charge: number;
  /** `nAlpha - nBeta`; 0 is closed shell, 1 a doublet radical. @default 0 */
  unpairedElectrons: number;
  /** Maximum optimizer cycles. @default 250 */
  maxCycles: number;
}

/** Defaults of a relaxation: GFN2 on a neutral closed shell. */
export const DEFAULT_RELAX_SETTINGS: RelaxSettings = {
  method: 'GFN2',
  charge: 0,
  unpairedElectrons: 0,
  maxCycles: 250,
};

/** One structure to relax. */
export interface RelaxRequest {
  /** Elements and starting coordinates, in Å. Not modified. */
  geometry: Geometry;
  /**
   * What to override of {@link DEFAULT_RELAX_SETTINGS}.
   * @default DEFAULT_RELAX_SETTINGS
   */
  settings?: Partial<RelaxSettings>;
}

/** What a relaxation produced. */
export interface RelaxResult {
  /**
   * The relaxed geometry, flat `x,y,z` per atom in Å, in the input's atom
   * order, translated onto the centre of mass.
   */
  coordinates: Float64Array;
  /**
   * The energy terms in Eh **at `coordinates`**, from a single point taken
   * there. `dispersion` is the D4 term, which is the part a force field of the
   * MMFF94 era does not have at all.
   */
  energy: EnergyBreakdown;
  /** Optimizer cycles spent. `0` for a structure with nothing to relax. */
  cycles: number;
  /** Whether the optimizer met its convergence criteria. */
  converged: boolean;
  /** Wall-clock duration of this relaxation, in milliseconds. */
  elapsedMs: number;
  /** Plain sentences about anything the caller should know. */
  warnings: string[];
}

/** How a relaxation reports progress and gets cancelled. */
export interface RelaxOptions {
  /**
   * Called after each optimizer cycle of each structure.
   * @default undefined
   */
  onCycle?: (cycle: number, energy: number) => void;
  /** @default undefined */
  signal?: AbortSignal;
}
