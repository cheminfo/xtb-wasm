/**
 * Physical constants, CODATA 2018 — the same set xtb and ASE use, so numbers
 * computed here can be compared with theirs digit for digit. Derived values are
 * computed from the primary ones rather than transcribed, because a
 * hand-copied conversion factor is the classic source of a plausible-but-wrong
 * energy.
 */

/** Bohr radius, m. */
export const BOHR_M = 5.291_772_109_03e-11;
/** Angstrom per Bohr. occ works in Bohr; the UI and XYZ use Angstrom. */
export const ANGSTROM_PER_BOHR = BOHR_M * 1e10;
/** Hartree energy, J. */
export const HARTREE_J = 4.359_744_722_206e-18;
/** Hartree energy, eV. */
export const HARTREE_EV = 27.211_386_245_988;
/** Avogadro constant, 1/mol. */
export const AVOGADRO = 6.022_140_76e23;
/** Boltzmann constant, J/K. */
export const BOLTZMANN_J_PER_K = 1.380_649e-23;
/** Molar gas constant, J/(mol·K). */
export const GAS_CONSTANT = BOLTZMANN_J_PER_K * AVOGADRO;
/** Planck constant, J·s. */
export const PLANCK_J_S = 6.626_070_15e-34;
/** Speed of light in vacuum, m/s. */
export const LIGHT_M_PER_S = 299_792_458;
/** Atomic mass constant, kg. */
export const AMU_KG = 1.660_539_066_6e-27;
/** Standard-state pressure, Pa. */
export const STANDARD_PRESSURE_PA = 101_325;
/** Thermochemical calorie, J. Exact by definition. */
export const CALORIE_J = 4.184;

/** Hartree to kJ/mol. */
export const KJ_PER_MOL_PER_HARTREE = (HARTREE_J * AVOGADRO) / 1000;
/** Hartree to kcal/mol. */
export const KCAL_PER_MOL_PER_HARTREE =
  (HARTREE_J * AVOGADRO) / (1000 * CALORIE_J);
/** Hartree to cm⁻¹. */
export const WAVENUMBER_PER_HARTREE =
  HARTREE_J / (PLANCK_J_S * LIGHT_M_PER_S * 100);
/**
 * Boltzmann constant in cm⁻¹/K — the `hc/k` factor that turns a wavenumber into
 * a temperature. `1.438776877...` K·cm is its reciprocal.
 */
export const BOLTZMANN_WAVENUMBER_PER_K =
  BOLTZMANN_J_PER_K / (PLANCK_J_S * LIGHT_M_PER_S * 100);
/** Boltzmann constant, Eh/K. */
export const BOLTZMANN_HARTREE_PER_K = BOLTZMANN_J_PER_K / HARTREE_J;
/** Molar gas constant, Eh/(mol·K) — i.e. k_B in Hartree per particle. */
export const GAS_CONSTANT_HARTREE_PER_K = BOLTZMANN_HARTREE_PER_K;

/**
 * IR intensity conversion: `I[km/mol] = IR_INTENSITY_KM_PER_MOL · |dμ/dQ|²`
 * with `dμ/dQ` in atomic units per √amu.
 */
export const IR_INTENSITY_KM_PER_MOL = 974.880_2;
/**
 * ASE's conversion between its IR intensity unit `(D/Å)²/amu` and km/mol.
 * Dividing a km/mol intensity by this gives the magnitude ASE's `Infrared`
 * reports, for comparison with results computed there.
 */
export const KM_PER_MOL_PER_DEBYE_ANGSTROM_AMU = 42.255;

/**
 * Force-constant conversion: `k[mDyn/Å] = FORCE_CONSTANT_MDYN_PER_ANGSTROM ·
 * ν̃[cm⁻¹]² · μ[amu]`. 1 mDyn/Å is exactly 100 N/m.
 */
export const FORCE_CONSTANT_MDYN_PER_ANGSTROM =
  (4 * Math.PI * Math.PI * (LIGHT_M_PER_S * 100) ** 2 * AMU_KG) / 100;
