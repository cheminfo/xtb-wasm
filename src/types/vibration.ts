/**
 * Which atoms and bonds a normal mode actually moves: the link between a band
 * on the spectrum, the mode, and the part of the structure that moves.
 */
export interface ModeInvolvement {
  /** Atom indices that carry the mode, ascending. */
  atoms: readonly number[];
  /** Bond indices (into the molecule's molfile bond order) that change length. */
  bonds: readonly number[];
  /** Fraction in [0, 1] of the mode's total displacement carried by `atoms`. */
  participation: number;
}

/** One normal mode of vibration. */
export interface VibrationalMode {
  /** Harmonic wavenumber in cm⁻¹. Negative values denote imaginary modes. */
  wavenumber: number;
  /** IR intensity in km/mol, or `null` when it was not computed. */
  irIntensity: number | null;
  /**
   * Raman scattering activity in Å⁴/amu — the Placzek quantity
   * `45·ᾱ′² + 7·γ′²`, independent of laser wavelength and temperature.
   * `null` when it was not computed.
   */
  ramanActivity: number | null;
  /**
   * Depolarization ratio of the Raman band for natural incident light,
   * `3γ′² / (45ᾱ′² + 4γ′²)`, in [0, 0.75]. `null` when not computed.
   */
  depolarizationRatio: number | null;
  /**
   * Raw mass-weighted eigenvector of the projected Hessian, length `3 · atoms`.
   * Already unit-normalized by the eigensolver, so it is stored exactly as the
   * engine returns it. Intensities, reduced masses and Raman activities are all
   * defined against THIS vector, never against a rescaled one.
   */
  eigenvector: Float64Array;
  /**
   * Cartesian displacement, `eigenvector[i] / √mᵢ`, length `3 · atoms`, in
   * amu^(−1/2). Comparable between modes, which is what the bond→mode mapping
   * needs. Divide by `maxDisplacement` to animate.
   */
  cartesianDisplacement: Float64Array;
  /**
   * Largest single atomic displacement magnitude in `cartesianDisplacement`.
   * The viewer scales by this so the animation amplitude is readable; it is kept
   * separate so no consumer ever sees a silently rescaled vector.
   */
  maxDisplacement: number;
  /** Reduced mass of the mode in amu. */
  reducedMass: number;
  /** Force constant in mDyn/Å. */
  forceConstant: number;
  /** Which atoms and bonds move, or `null` when connectivity was unavailable. */
  involvement: ModeInvolvement | null;
}

/**
 * Rigid-rotor / harmonic-oscillator thermochemistry with Grimme's modified
 * treatment of low-lying modes (mRRHO), matching xtb's own `print_thermo`.
 * Every energy is in Hartree so the numbers line up with
 * `src/reference/fixtures/*.json`.
 */
export interface Thermochemistry {
  /** Temperature the block was evaluated at, in K. */
  temperature: number;
  /** Pressure the block was evaluated at, in Pa. */
  pressure: number;
  /** Zero-point vibrational energy, Eh. */
  zeroPointEnergy: number;
  /** Thermal correction to the internal energy above the ZPVE, Eh. */
  thermalCorrection: number;
  /** H(T) − E_el, Eh. Includes ZPVE, the thermal correction and RT. */
  enthalpyCorrection: number;
  /** Total entropy, Eh/K. */
  entropy: number;
  /** G(T) − E_el, Eh. xtb prints this as `G(RRHO) contrib.`. */
  gibbsCorrection: number;
  /** E_el + `gibbsCorrection`, Eh. xtb prints this as `TOTAL FREE ENERGY`. */
  totalFreeEnergy: number;
  /** E_el + `enthalpyCorrection`, Eh. xtb prints this as `TOTAL ENTHALPY`. */
  totalEnthalpy: number;
  /** Constant-volume heat capacity, Eh/K. */
  heatCapacity: number;
  /** Rotational symmetry number actually used. */
  symmetryNumber: number;
  /** The detected point group, for the chemist to sanity-check σ against. */
  pointGroup: string;
  /** Whether the rotor was treated as linear (2 rotational degrees of freedom). */
  isLinear: boolean;
  /**
   * Imaginary modes excluded from the sums. Non-zero means these numbers
   * describe a saddle point and must be shown with that warning.
   */
  skippedImaginaryModes: number;
}
