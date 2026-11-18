# Changelog

## [2.0.0](https://github.com/cheminfo/xtb-wasm/compare/v1.1.1...v2.0.0) (2026-11-18)


### ⚠ BREAKING CHANGES

* the `warnings` fields of VibrationalResult, RelaxResult, LoadedMolecules, BuiltMolecule and PdbReadResult are removed; pass a `logger` (LightLogger from cheminfo-types) to receive the messages at their level.

### Features

* compute vibrations in process, with no Worker or bundler ([256d42a](https://github.com/cheminfo/xtb-wasm/commit/256d42adb626d17573faa2b49f840b0b6153bc7f))
* report messages through an optional logger instead of warnings arrays ([a25125b](https://github.com/cheminfo/xtb-wasm/commit/a25125bb40d9d22b552f8c6bce2d13eff35ea973))


### Bug Fixes

* stop warning about the parallel sweep's ~0.02 cm⁻¹ reproducibility ([6ac488e](https://github.com/cheminfo/xtb-wasm/commit/6ac488e5a93f0e9e0f60e827ec3861daa078530e))

## [1.1.1](https://github.com/cheminfo/xtb-wasm/compare/v1.1.0...v1.1.1) (2026-10-24)


### Bug Fixes

* ship occjs 0.9.6, whose GFN2 D4 dispersion is self-consistent ([7423731](https://github.com/cheminfo/xtb-wasm/commit/7423731056e5fee422cf639464fb5a788d7b61e6))

## [1.1.0](https://github.com/cheminfo/xtb-wasm/compare/v1.0.0...v1.1.0) (2026-09-26)


### Features

* relax a geometry and its energy, without the Hessian ([962ba85](https://github.com/cheminfo/xtb-wasm/commit/962ba851b86a5bfbf92c85665c2bd54aab51e3dd))

## 1.0.0 (2026-09-18)


### Features

* compute GFN2-xTB IR and Raman spectra in the browser ([125173b](https://github.com/cheminfo/xtb-wasm/commit/125173bedb116012e64efb8e214b6f844df895c2))
