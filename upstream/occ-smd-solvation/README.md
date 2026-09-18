# GFN2-xTB SMD solvation for occ — an unsubmitted upstream patch

**This directory is not part of the build.** Nothing here is compiled, imported
or shipped; the app depends on the published `@peterspackman/occjs`. These three
patches are a contribution to [peterspackman/occ](https://github.com/peterspackman/occ)
that has not been sent upstream yet, kept with the measurements that justify it.

They expose GFN2-xTB **SMD implicit solvation** to JavaScript. In occ as
published, `XtbCalculator::set_solvent()` is an unconditional stub
(`(void)name; return false;`) and the real entry point `set_solvation_model()`
was never bound.

## The patches

1. `0001-feat-solvent-add-has_smd_parameters-and-available_sm.patch` — adds
   `occ::solvent::has_smd_parameters()` and `available_smd_solvents()`.
2. `0002-feat-js-expose-GFN2-xTB-SMD-solvation-to-the-JavaScr.patch` — the
   bindings, plus a `solvent()` accessor on `SmdSolvationModel`.
3. `0003-build-js-export-getExceptionMessage-decrementExcepti.patch` — build fix.
   Upstream links `occjs` with `EXPORT_EXCEPTION_HANDLING_HELPERS=1` and with
   `EXPORTED_RUNTIME_METHODS=['FS']`. Under emscripten 5 the first is deprecated
   and exports nothing at `-O1` or above, so `getExceptionMessage` goes missing;
   separately the bracketed `['FS']` list is never parsed, so `FS` is missing as
   well. The patch names all three in the comma-separated form. **This one is
   worth upstreaming on its own, independently of solvation.**

## Building them

Base commit `6c455779e57789b84bfd76e15c9839b702d990bc` (`v0.9.3-13-g6c45577`).
The base matters: commit `9af8125` ("Drive the GFN2-xTB SMD reaction field from
the full CAMM multipole expansion") is what brings water's ΔG_solv to ≈ −5.6
kcal/mol; before it the same code gives only ≈ −3.5.

```sh
git clone https://github.com/peterspackman/occ && cd occ
git checkout 6c45577
git am path/to/000*.patch

export CPM_SOURCE_CACHE="$PWD/../cpm-cache"
export OCC_DATA_PATH="$PWD/share"

emcmake cmake . -Bwasm -DCMAKE_BUILD_TYPE=Release -DUSE_OPENMP=OFF -GNinja \
  -DCPACK_SYSTEM_NAME=wasm -DENABLE_JS_BINDINGS=ON -DUSE_SYSTEM_EIGEN=OFF \
  -DCMAKE_CXX_FLAGS="-msimd128 -include cstdlib" \
  -DCMAKE_C_FLAGS="-msimd128" \
  -DCMAKE_CXX_SCAN_FOR_MODULES=OFF

cmake --build wasm --target occjs -j 8
# -> wasm/src/occjs.{js,wasm,data}
```

Built with emscripten `5.0.7-git` (LLVM `clang 23.0.0git`), CMake 4.3.2, Ninja
1.13.2, on macOS arm64; validated under Node v26.0.0. Upstream's CI pins
emscripten **4.0.9**, where `-include cstdlib` is unnecessary — under 5.0.7,
fmt 11.1.0 calls `malloc`/`free` in `fmt/format.h` without including
`<cstdlib>` and the build fails at the first fmt translation unit.

## What was measured

### Gas phase does not move

All 10 fixtures in `experiments/reference/fixtures/`, at the stored geometry, no
optimizer, Hessian step 0.005 Bohr, against published 0.9.3 in a separate
process: **every quantity bit-identical** (strict `===`) — 10 total energies, 648
frequency values, 10 Hessian Frobenius norms, 10 traces, `n_imaginary` and
`n_vibrational_modes` 10/10. Water's `-5.070370524921436` Eh reproduces exactly.

### Solvated single points are sound

Water in water reproduces upstream's own `tests/xtb_native_tests.cpp` assertion
`REQUIRE(dg == Approx(-23.58).margin(0.5))`: ΔG_solv = **−23.5768 kJ/mol**
(−5.635 kcal/mol, ε = 78.355, 272 cavity elements). `clearSolvent()` restores the
gas energy with delta exactly 0.

ΔG_solv from two single points at a fixed geometry, kcal/mol. It is the
difference of the two total energies, so it also carries the cost of
polarizing the solute and is not the sum of the two columns beside it:

| solute    | charge | solvent  | ΔG_solv  | E_es     | E_cds  | experiment |
| --------- | ------ | -------- | -------- | -------- | ------ | ---------- |
| water     | 0      | water    | −5.510   | −7.630   | +1.479 | −6.31      |
| hydroxide | −1     | water    | −107.978 | −109.618 | +0.757 | ≈ −105     |
| ammonium  | +1     | water    | −76.113  | −79.187  | +3.046 | ≈ −81      |
| ammonia   | 0      | water    | −0.459   | −2.732   | +2.168 | −4.3       |
| methane   | 0      | water    | +2.204   | −0.479   | +2.675 | +2.00      |
| methane   | 0      | n-hexane | +0.069   | −0.225   | +0.291 | ≈ 0        |

Ions are stabilised ~20× more than neutrals, a nonpolar solute in a nonpolar
solvent costs nothing, and methane in water comes out **positive** with a
positive CDS term — the correct hydrophobic sign. Ammonia is the model's weak
case, an accuracy limit rather than a code fault.

The analytic solvated gradient agrees with finite differences to 6.28e-6 Ha/Bohr
for water in water and 1.20e-5 for methane in water, against upstream's own
`REQUIRE(max_abs < 2e-4)`.

### Solvated frequencies are invalid — the finding that matters

**The cavity is built from a Lebedev angular grid fixed in the laboratory
frame**, so the surviving surface-point set depends on the molecule's
orientation. Water optimized in water, then the _same_ geometry rigidly
re-oriented 12 ways with a deterministic seed, solvated Hessian recomputed each
time:

- **6 of 12 orientations gave an unusable spectrum**, worst frequency deviation
  **2.863e+4 cm⁻¹**.
- **Three produced a spurious imaginary mode** (e.g. −14235 cm⁻¹) where the
  reference orientation has none.
- Even the 6 usable ones scattered by 3.4 – 8.5 cm⁻¹, 7–17× the 0.5 cm⁻¹ tier-1
  frequency tolerance.

Translation is exact (5.3e-10 cm⁻¹ for a 10 Å displacement) and gas phase is
orientation-safe (worst 0.087 cm⁻¹), so this is the cavity and nothing else.
Scanning one Cartesian coordinate in 0.0025 Bohr steps, the reference
orientation gives a smooth d²E/dx² (0.515, 0.517, 0.528 Eh/Bohr², 272 cavity
elements throughout) while an orientation rotated 1.1 rad gives **−0.441,
−3.164, +21.74** as the cavity drops 275 → 274 mid-scan. The solvated energy is
effectively discontinuous at the ~1e-4 Eh level as atoms move, and a
central-difference Hessian across such a step returns garbage.
`smoothing_width_bohr = 0.1` is already active and does not prevent it.

The reference orientation alone looks perfect — 6 near-zero modes to 4.7e-5
cm⁻¹, no imaginary modes — which is the trap: testing one orientation passes.

Solvated geometry optimization fails for the same reason. Water converges;
acetone diverges, |g|max going 3.30e-2 → 1.05 → 3.05 → 29.9 Ha/Bohr while the
cavity element count oscillates (651, 661, 641, 653, 657, …).

**So a solvated Hessian, a solvated IR spectrum and a solvated optimization must
not be offered.** Fixing that means an orientation-independent cavity
construction, which is upstream work these patches do not attempt.
