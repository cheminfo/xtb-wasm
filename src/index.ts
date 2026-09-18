/**
 * GFN2-xTB vibrational spectroscopy in the browser.
 *
 * Give it a structure and it returns the harmonic frequencies, the IR
 * intensities, the Raman activities and the RRHO thermochemistry, computed on
 * the machine the page is open on. The quantum chemistry is OCC — an
 * independent C++17 implementation of GFN2-xTB compiled to WebAssembly — driven
 * from a pool of Web Workers.
 */

export {
  AMU_KG,
  ANGSTROM_PER_BOHR,
  AVOGADRO,
  BOHR_M,
  BOLTZMANN_HARTREE_PER_K,
  BOLTZMANN_J_PER_K,
  BOLTZMANN_WAVENUMBER_PER_K,
  CALORIE_J,
  FORCE_CONSTANT_MDYN_PER_ANGSTROM,
  GAS_CONSTANT,
  GAS_CONSTANT_HARTREE_PER_K,
  HARTREE_EV,
  HARTREE_J,
  IR_INTENSITY_KM_PER_MOL,
  KCAL_PER_MOL_PER_HARTREE,
  KJ_PER_MOL_PER_HARTREE,
  KM_PER_MOL_PER_DEBYE_ANGSTROM_AMU,
  LIGHT_M_PER_S,
  PLANCK_J_S,
  STANDARD_PRESSURE_PA,
  WAVENUMBER_PER_HARTREE,
} from './chemistry/constants.ts';
export { installVibrationalAnalyser } from './chemistry/analyser.ts';
export { fromXyz, geometryFromOcl, toXyz } from './chemistry/geometry.ts';
export type {
  DetectedSymmetry,
  ResolvedSymmetry,
} from './chemistry/symmetry.ts';
export { principalMoments, resolveSymmetry } from './chemistry/symmetry.ts';
export type { ThermochemistryOptions } from './chemistry/thermochemistry.ts';
export { thermochemistry } from './chemistry/thermochemistry.ts';
export type {
  ConnectivityComparison,
  RamanActivity,
  RamanOptions,
  RamanSupport,
} from './chemistry/raman/index.ts';
export {
  SUPPORTED_ELEMENTS,
  bondPolarizability,
  compareConnectivity,
  ramanActivities,
  ramanSupport,
} from './chemistry/raman/index.ts';
export {
  ENGINES,
  createOccjsEngine,
  disposeOccPool,
  getEngine,
  occPoolWorkerCount,
  occjsEngine,
  occjsSerialEngine,
} from './engines/index.ts';
export type {
  BuildOptions,
  BuiltMolecule,
  LoadedMolecules,
  MoleculeFormat,
  OclModule,
} from './molecules/index.ts';
export {
  DEFAULT_SEED,
  canonicalElement,
  detectFormat,
  elementSymbols,
  geometryFromPdb,
  getOcl,
  moleculeFromGeometry,
  moleculeFromIdCode,
  moleculeFromMolfile,
  moleculeFromSmiles,
  moleculeFromStructure,
  moleculesFromFile,
  moleculesFromText,
} from './molecules/index.ts';
export type {
  CalculationSettings,
  EnergyBreakdown,
  EngineCapabilities,
  EngineProgress,
  EngineRunOptions,
  EngineStage,
  Geometry,
  ModeInvolvement,
  Molecule,
  MoleculeSource,
  OutputSelection,
  Thermochemistry,
  Timings,
  VibrationalEngine,
  VibrationalMode,
  VibrationalRequest,
  VibrationalResult,
  XtbMethod,
} from './types/index.ts';
export { DEFAULT_OUTPUTS, DEFAULT_SETTINGS } from './types/index.ts';
