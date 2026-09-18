import type {
  Geometry,
  ModeInvolvement,
  Molecule,
  Thermochemistry,
  VibrationalMode,
} from '../types/index.ts';

/** The two Placzek quantities of one mode, in the bond-polarizability model. */
export interface RamanAnalysis {
  /** `45·ᾱ′² + 7·γ′²`, in Å⁴/amu. */
  ramanActivity: number;
  /** `3γ′² / (45ᾱ′² + 4γ′²)`, in [0, 0.75]. */
  depolarizationRatio: number;
}

/** Everything the RRHO block needs, all of it produced by the engine. */
export interface ThermochemistryInput {
  /** The geometry the Hessian was built at, centred, in Å. */
  geometry: Geometry;
  /** Standard atomic weights from occ's own table, amu. */
  masses: Float64Array;
  /** Wavenumbers of the genuine vibrations only, cm⁻¹, ascending. */
  wavenumbers: Float64Array;
  /** Electronic energy the corrections are added to, Eh. */
  electronicEnergy: number;
  temperature: number;
  pressure: number;
  /** σ actually to be used — the request's override, or the detected one. */
  symmetryNumber: number;
  /** The detected point group, for the result to display. */
  pointGroup: string;
}

/**
 * The pure-JavaScript analysis the engine delegates to, so that Raman
 * activities, the RRHO block and the mode/structure mapping stay out of the
 * wasm worker and out of `src/engines`.
 *
 * Keeping it behind this seam is what lets `src/engines` stay free of
 * `src/chemistry` and `src/molecules`, so the worker bundle carries the wasm
 * driver and nothing else. `installVibrationalAnalyser()` in
 * `src/chemistry/analyser.ts` binds the real implementations; a consumer calls
 * it once at startup.
 *
 * Every member is optional; whatever is missing simply leaves the corresponding
 * field `null` on the result instead of inventing a number.
 */
export interface VibrationalAnalyser {
  /**
   * Raman activity and depolarization ratio per mode, from the
   * bond-polarizability model. Purely geometric, so it costs no quantum
   * chemistry; the whole 6N sweep measured 0.4 ms for ibuprofen.
   * @default undefined
   */
  ramanActivities?: (
    geometry: Geometry,
    modes: readonly VibrationalMode[],
    masses: Float64Array,
    /** The molecule, when one is known, so real connectivity can be used. */
    molecule: Molecule | null,
  ) => readonly RamanAnalysis[];
  /**
   * The RRHO thermochemistry block.
   * @default undefined
   */
  thermochemistry?: (input: ThermochemistryInput) => Thermochemistry;
  /**
   * Which atoms and bonds each mode moves. Needs the molecule's molfile, which
   * is the only representation whose atom and bond indices round-trip.
   * @default undefined
   */
  involvements?: (
    molecule: Molecule,
    modes: readonly VibrationalMode[],
  ) => ReadonlyArray<ModeInvolvement | null>;
}

let analyser: VibrationalAnalyser | null = null;

/**
 * Install the analysis functions every engine's `compute` will use.
 * @param next - The analyser, or `null` to remove it.
 */
export function setVibrationalAnalyser(next: VibrationalAnalyser | null): void {
  analyser = next;
}

/**
 * The installed analyser.
 * @returns The analyser, or `null` when none has been installed.
 */
export function getVibrationalAnalyser(): VibrationalAnalyser | null {
  return analyser;
}
