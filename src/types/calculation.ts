/**
 * The GFN family member to run. `GFN2` is the only one the WebAssembly build
 * exposes — `m.XtbMethod` has a single value — so an engine advertises what it
 * really has in `EngineCapabilities.methods` and refuses the rest.
 */
export type XtbMethod = 'GFN2' | 'GFN1' | 'GFN0' | 'GFN-FF' | 'IPEA1';

/** Everything that changes the physics of a run. Two runs with equal settings must agree. */
export interface CalculationSettings {
  /** @default 'GFN2' */
  method: XtbMethod;
  /** Total molecular charge in units of e. @default 0 */
  charge: number;
  /** `nAlpha - nBeta`; 0 is closed shell, 1 a doublet radical. @default 0 */
  unpairedElectrons: number;
  /** Relax the geometry before the Hessian. @default true */
  optimize: boolean;
  /** Maximum optimizer cycles. @default 250 */
  maxCycles: number;
  /** Temperature for the thermochemistry block, in K. @default 298.15 */
  temperature: number;
  /** Pressure for the thermochemistry block, in Pa. @default 101325 */
  pressure: number;
  /**
   * Rotational symmetry number σ, or `null` to take it from the detected point
   * group. It enters the rotational entropy as −R·ln σ, so a wrong value is a
   * silent error in ΔG — benzene at σ=1 instead of 12 is ~1.5 kcal/mol out.
   * @default null
   */
  symmetryNumber: number | null;
}

/** Which derived quantities to compute. Each one costs extra, so each is opt-in. */
export interface OutputSelection {
  /** Dipole derivatives → IR intensities. @default true */
  ir: boolean;
  /**
   * Raman activities from the bond-polarizability model. Purely geometric, so
   * it adds no quantum-chemical work at all.
   * @default true
   */
  raman: boolean;
  /** RRHO thermochemistry from the frequencies. Costs nothing extra. @default true */
  thermochemistry: boolean;
}

/** Default settings: neutral, closed shell, relaxed, at 298.15 K. */
export const DEFAULT_SETTINGS: CalculationSettings = {
  method: 'GFN2',
  charge: 0,
  unpairedElectrons: 0,
  optimize: true,
  maxCycles: 250,
  temperature: 298.15,
  pressure: 101_325,
  symmetryNumber: null,
};

/** Default outputs: everything the browser engine can produce cheaply. */
export const DEFAULT_OUTPUTS: OutputSelection = {
  ir: true,
  raman: true,
  thermochemistry: true,
};
