/** A spectrum as parallel x/y arrays, the shape used across ml-spectra-processing. */
export interface DataXY {
  x: Float64Array;
  y: Float64Array;
}

/**
 * eV per cm^-1, defined exactly as ASE's `ase.units.invcm`
 * (`100 * c * h / e`, all three exact SI constants), so a zero-point energy
 * recomputed here matches the service's to ~1e-8 eV.
 */
export const CM1_TO_EV = (100 * 299792458 * 6.62607015e-34) / 1.602176634e-19;

/** Hartree per eV, from the CODATA 2018 Hartree energy of 27.211386245988 eV. */
export const EV_TO_HARTREE = 1 / 27.211386245988;
