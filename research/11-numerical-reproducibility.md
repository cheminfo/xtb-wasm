## SUMMARY
The numerics risk is much lower than the "scientific code port" prior suggests, and the evidence is quantitative rather than hand-wavy. xtb's own CI (`.github/workflows/fortran-build.yml`) already spans gfortran 10/11/12/13/14/15, ifort 2022.1, ifx 2024.1/2025.1/2025.2, netlib LAPACK + OpenBLAS + MKL, x86-64 + aarch64 (ubuntu-24.04-arm, macOS Apple Silicon) + MinGW, and OMP_NUM_THREADS of 1 and 2 — i.e. it already absorbs FMA-contraction differences, LAPACK-backend substitution, libm differences and serial-vs-threaded reduction order. WebAssembly is strictly *more* constrained than any of those natives: round-to-nearest-ties-to-even only, no x87 extended precision, no scalar FMA in the core spec (so `a*b+c` always rounds twice — I verified locally that native arm64 emits 8 `fmla` in a dot loop where wasm emits none), and no FP-reduction reassociation even under `-msimd128` (verified bit-identical). The only wasm nondeterminism is NaN payload bits, which xtb never inspects. I measured emscripten's libm against native macOS arm64 libm over 200k points: `sqrt` 0% divergent, `log` 0.034%, `pow` 0.178%, `exp` 0.190%, `sin` 4.3% (all ≤1 ULP), `erf` 20.7% (≤3 ULP), `erfc` 31.8% (≤6 ULP). Against that ≤6 ULP input noise, every xtb assertion tolerance — including the tightest one in the suite, `test_gfnff.f90:154` `thr = 1000*epsilon(1.0_wp)` = 2.22e-13 — is worth ≥1e4 ULP of relative headroom. My calibrated estimate: 0–4 of the 136 testdrive unit cases (<3%) are at real risk of failing on numerics alone, concentrated in `xtb/hessian`, `xtb/gfnff`, and `ptb/polarizability`. The dominant realistic failure mode is not float rounding at all: it is latent uninitialized-variable UB (xtb issue #1109 broke 7 tests under GCC 14.1 and was fixed by PR #1121 "removes uninitialised but used stmp", not by a tolerance change) plus SCF iteration-count divergence at a discrete threshold.

## BLOCKERS
["Toolchain-dependent libm binding: my ≤6 ULP measurement is emscripten's musl libm via clang. If the Fortran front end is LLVM Flang or LFortran, its runtime may route `exp`/`erf` differently than emcc's C libm, and the measurement must be redone against the actual toolchain. (Toolchain choice is the other study's scope.)", "Latent uninitialised-variable UB in xtb: precedent is issue #1109 (7 tests broken under GCC 14.1, fixed by PR #1121 removing an uninitialised `stmp`) and issue #276 (GFN-FF halogen-bond energy varying by 1.39e-8 Eh run-to-run). Wasm's zeroed linear memory is a third initialisation behaviour. This must be cleared natively with `-finit-real=snan -ffpe-trap=...` before any wasm result is trusted.", "LAPACK backend must be netlib reference 3.12 compiled to wasm. Substituting any other BLAS/LAPACK (a JS implementation, a hand-rolled DSYGVD) changes the divide-and-conquer eigensolver's deflation behaviour and invalidates the CI evidence base.", "Acceptance-criterion ambiguity: 'all the tests of the original project' is not what upstream CI runs. Upstream runs `--suite xtb` / `-R 'xtb/*'` and explicitly excludes `tblite/gfn1-xtb` (fortran-build.yml:90); the six subprojects' own suites are not fully exercised. This needs pinning with cheminfo/EPFL before it becomes a contractual test.", '`xtb/symmetry` (4 cases) is stochastic by construction — `rattle()` at test_symmetry.f90:234-250 uses unseeded `random_number`, so upstream CI runs a different geometry every time. It cannot be made deterministic without editing the test, so it can never be a reliable pass/fail gate.', "`xtb/random` (3 cases) requires the wasm Fortran runtime to implement `random_seed(size=/get=/put=)` correctly. If the chosen Fortran-to-wasm toolchain's runtime stubs these, those tests fail for a non-numerical reason."]

## DETAILS
## Will xtb's own tests pass against a wasm build? Quantified answer

### Short version

The tolerances are not the problem. Every assertion in the suite carries at least ~10⁴ ULP of relative headroom, and the measured numerical divergence between wasm and native is ≤6 ULP. WebAssembly is *more* deterministic than the natives xtb's CI already covers. The realistic failure modes are latent undefined behaviour and SCF iteration-count divergence — both discrete, both fixable, neither requiring a tolerance change.

---

## 1. What "all tests" actually means

| Layer | Count | Where |
|---|---|---|
| ctest/meson test collections | 29 (`xtb/atomlist` … `xtb/cpx`, `xtb/ptb`) | `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/xtb/test/unit/meson.build:36-70`, `test/unit/CMakeLists.txt:22-49` |
| testdrive unit cases inside them | **136** | `grep -h 'new_unittest(' test/unit/test_*.f90 test/unit/test_ptb.F90 \| wc -l` |
| `call check(` source sites | 558 | same directory |
| Runtime assertions (loops expanded) | ~1500–2500 | e.g. `xtb/hessian` alone = 216 |
| C API test | 1 | `test/api/c_api_example.c` (76 `check(...)` calls) |
| CLI smoke tests | 5 | `test/unit/meson.build:88-105` |

Note two scoping traps before you sign an acceptance criterion:

- Upstream CI runs **only xtb's own suite** — `meson test --suite xtb` (`fortran-build.yml:55`) and `ctest -R 'xtb/*'` (`:90`). The six subprojects (mctc-lib 0.5.1, tblite 0.6.0, dftd4 4.2.0, multicharge 0.5.0, CPCM-X 1.1.0, test-drive 0.5.0) ship their own suites that upstream does not fully run.
- `fortran-build.yml:90` explicitly *excludes* `tblite/gfn1-xtb` with `-E`. So "all tests of the original project" is already, upstream, not literally all tests.

---

## 2. The tolerance landscape

All comparisons are **absolute**, never relative. `test-drive` v0.5.0 `check_float_dp` (`/private/tmp/…/scratchpad/test-drive/src/testdrive.F90:637-656`):

```fortran
if (present(thr)) then ; threshold = thr ; else ; threshold = epsilon(expected) ; end if
if (present(rel)) then ; relative  = rel ; else ; relative  = .false.        ; end if
...
diff = abs(actual - expected)
```

`grep -rn 'rel=\.true\.' test/unit/` → **zero hits**. Where `thr` is omitted the threshold is machine epsilon, but every such site compares integers, strings, logicals, or exactly-representable synthetic values.

Distribution of declared thresholds across the suite:

| thr | count | typical quantity |
|---|---|---|
| 1.0e-10 | 32 | analytic vs finite-difference gradients/σ of classical terms |
| 1.0e-8 | 21 | GFN-FF energies, thermo state functions |
| 1.0e-7 | 13 | **Hessian, dipole gradients**, ONIOM, PTB, SCC component energies |
| 1.0e-9 | 12 | SCF total energies, HL gaps, ‖gradient‖ |
| 1.0e-5 (thr2) | 6 | Mulliken charges, multipole moments, moments of inertia |
| 1.0e-3 / 1.0e-2 / 1.0e-1 | 7 | GFN-FF cross-path, IP/EA, PTB polarizability |
| `1000*epsilon` = 2.22e-13 | 1 | **tightest in the suite** — GFN-FF harmonic |

### Converted to ULP of relative headroom (the number that matters)

| Test | Assertion | thr | value | ULP budget |
|---|---|---|---|---|
| `test_gfnff.f90:154,180` | `norm2(gradient)` | 2.22e-13 | 0.0478776 | **2.1×10⁴** ← tightest |
| `test_gfnff.f90:154,179` | energy | 2.22e-13 | 0.0047628 | 2.1×10⁵ |
| `test_hessian.f90:54` | Hessian element | 1.0e-7 | ≤0.654 | 9×10⁸ (but see §5) |
| `test_gfn2.f90:229` | energy | 1.0e-9 | −8.38248 | 5.4×10⁵ |
| `test_gfn2.f90:228` | HL gap (eV) | 1.0e-9 | 7.00059 | 6.4×10⁵ |
| `test_thermo.f90:52` | moment of inertia | 1.0e-5 | 484991.8 | 9.3×10⁴ |
| `c_api_example.c:105` | energy | 1.0e-9 | −8.38248 | 5.4×10⁵ |

**No assertion in the suite is tighter than ~2×10⁴ ULP.** That is the single most important number in this report.

---

## 3. Is wasm more or less deterministic than native? — More.

Per the [WebAssembly core spec, Numerics](https://webassembly.github.io/spec/core/exec/numerics.html):

- "Floating-point arithmetic follows the IEEE 754 standard."
- "All operators use round-to-nearest ties-to-even, except where otherwise specified."
- "Non-default directed rounding attributes are not supported."
- The only nondeterminism is the NaN payload/sign: "the payload is picked non-deterministically among all arithmetic NaNs."

Four concrete consequences, three of which are *advantages*:

**(a) No x87 extended precision.** Cannot happen on wasm. Can still happen on 32-bit x86 natives.

**(b) No scalar FMA → no expression contraction.** Core wasm has `f64.add/sub/mul/div/sqrt` but no `f64.fma`; FMA exists only in the *relaxed SIMD* proposal (explicitly nondeterministic, off by default in emcc). Meanwhile **gfortran defaults to `-ffp-contract=fast`**, so xtb's aarch64 CI builds *do* contract. I verified the mechanism on this machine (`/private/tmp/…/scratchpad/fptest/`):

```
fma_probe  native arm64: bc30000000000000  (= -2^-60, one rounding — FMA)
fma_probe  wasm:         0000000000000000  (two roundings)
otool -tv on a 10007-element dot loop: 8 × fmla natively, 0 on wasm
```

So wasm ≈ "x86-64 without `-march=x86-64-v3`", which is exactly what `ubuntu-latest` gfortran CI builds. Both FMA and non-FMA configurations are already green in xtb CI (`ubuntu-24.04-arm` + `macos-latest` Apple Silicon vs `ubuntu-latest` x86-64). This matters: [Reference-LAPACK #732](https://github.com/Reference-LAPACK/lapack/issues/732) shows FMA/vectorization breaking 4376 LAPACK self-tests (0.106%), resolved by loosening tolerances — wasm sits on the safe side of that.

**(c) No FP-reduction reassociation.** LLVM will not vectorize an FP reduction without `-ffast-math`. Verified: a 10007-element dot product is bit-identical at `-O3`, `-O3 -msimd128`, and native.

**(d) NaN payloads.** Irrelevant here — xtb uses only `ieee_is_finite` (3 sites) and `ieee_value/ieee_positive_inf` (2 sites), no payload inspection, no `transfer()` bit tricks in numeric paths.

---

## 4. Measured libm divergence (the one real wasm-specific source)

Emscripten's libm is musl-derived; native gfortran on Linux uses glibc, on macOS Apple's libm. I swept 200 000 points and compared raw IEEE bit patterns (`/private/tmp/…/scratchpad/fptest/x.c`, `e.c`):

| function | xtb call sites | % differing | max ULP |
|---|---|---|---|
| `sqrt` | 691 | **0.000 %** | 0 |
| `log` | 74 | 0.034 % | 1 |
| `pow` | — | 0.178 % | 1 |
| `exp` | 215 | 0.190 % | 1 |
| `sin` | 69 | 4.293 % | 1 |
| `cos` | 95 | (same class) | 1 |
| `erf` | 47 | **20.68 %** | **3** |
| `erfc` | 3 | **31.84 %** | **6** |

`sqrt` is exactly rounded by IEEE mandate, so xtb's single most-used math function is bit-identical — a large and underappreciated win. `exp`/`log`/`pow` agree because musl and glibc both adopted the ARM optimized-routines implementations. `erf`/`erfc` are the outlier (fdlibm-derived, diverging paths), and they appear in the EEQ / Klopman–Ohno / Gaussian Coulomb kernels and PTB's `ncoord_erf`.

**Worst-case input noise: 6 ULP ≈ 1.3×10⁻¹⁵ relative. Tightest budget: 2×10⁴ ULP. The calculation would have to amplify the noise by >10³ to break a test.** Note also that glibc-vs-Apple-libm `erf` already differs, and both are green in CI.

---

## 5. LAPACK / BLAS substitution

- SCF: `lapack_sygvd` (DSYGVD, divide-and-conquer) on the **first** iteration only; later iterations use xtb's own `pseudodiag` (`src/scc_core.f90:930-940`, `:970`).
- Frequencies: `dsyev` on the mass-weighted Hessian (`src/hessian.F90:389`).
- GFN-FF QM block: `dsyev` / `DSYGVD` (`src/gfnff/gfnff_qm.f90:53,59,66`).

DSYGVD's divide-and-conquer path is the most implementation-sensitive routine in LAPACK (deflation tolerances, arbitrary eigenvector phase). But **no xtb test asserts on an eigenvector component**. Tests assert on:

- the total energy and component energies — built from the density `P = C n Cᵀ`, invariant to eigenvector sign;
- Mulliken charges / multipoles — same;
- eigen*values* (`wfn%emo(ihomo)`, `hl_gap`) — well-conditioned even in near-degenerate subspaces (error ~ε‖H‖).

The one near-degenerate eigenproblem in the suite is `test_thermo.f90:79-81`: moments of inertia 484991.786527778 and 485024.382510520 differ by only 32.6 (6.7×10⁻⁵ relative), asserted at `thr2 = 1e-5`. Eigenvalues remain accurate to ~ε‖A‖ ≈ 1.1×10⁻¹⁰ there, so the 9×10⁴ ULP budget holds. The eigen*vectors* of that near-degenerate pair (`evec4` from `axisvec`) are ill-conditioned but are not asserted on.

**Mitigation:** compile **netlib reference LAPACK 3.12 + reference BLAS** to wasm. That is byte-for-byte the same algorithm as the `-Dlapack=netlib` CI job (`fortran-build.yml:50`), reducing the difference to compiler codegen. Do *not* substitute a hand-rolled or JS BLAS.

---

## 6. OpenMP → serial

757 `!$omp` directive lines, **58 `reduction(+:…)` clauses** whose accumulation order is thread-count dependent — `src/gfnff/gfnff_eg.f90` (`reduction(+:erep,g,sigma)`, `(+:eangl,g,sigma)`, …), `src/disp/dftd4.F90` (`(+:energies,gradient,sigma,dEdcn,dEdq)`), `src/eeq_model.f90`, `src/xtb/hamiltonian.F90`, `src/peeq_module.f90`.

This is a solved problem: CI already runs the full suite at **`OMP_NUM_THREADS: 1`** (`fortran-build.yml:205`, mingw job) and `2,1` everywhere else. A serial wasm build (`-Dopenmp=false`) reproduces the 1-thread code path, which is already green. Risk ≈ 0.

---

## 7. The two tests that actually worry me

### 7a. `xtb/hessian` — the IR-critical one, and the most fragile

`test_hessian.f90:54,150` — `thr = 1.0e-7_wp`, `step = 1.0e-6_wp`, 2 tests × (27 dipole-gradient + 81 Hessian) = **216 assertions**. Central differences with h = 10⁻⁶ bohr amplify gradient noise by 1/(2h) = **5×10⁵**.

`src/scf_module.F90:271-272` says so out loud:

```fortran
!  exit if E < scfconv, Hessian sensitive to this
   scfconv=1.d-6*acc
```

Error budget: 1e-7 × 2 × 1e-6 = **2×10⁻¹³ Eh/bohr per gradient component** (~1.4×10⁴ ULP on a 0.1-magnitude gradient). The shipped reference data tells you the real noise floor: elements that are zero by C₂ᵥ symmetry are stored as `-5.183734810089242E-12`, `1.269389491007523E-11` (`test_hessian.f90:70-100`), and one dipole-gradient entry is `-4.440892098500626E-10` = exactly 2ε/step — a single-ULP dipole difference amplified by the FD denominator. So observed noise ≈ 2×10⁻¹¹ against a 10⁻⁷ threshold: **~5000× margin**, provided the SCF path is the same.

### 7b. `xtb/gfnff` harmonic — the tightest tolerance, in the module with a nondeterminism history

`test_gfnff.f90:154` `thr = 1000*epsilon(1.0_wp)` = 2.22e-13, on energy 0.00476278587765942 and `norm2(gradient)` 0.0478776130669465. Pure force field — no SCF, no LAPACK — so it is a deterministic sum of analytic terms; the only inputs are `exp`, `sqrt`, `erf` and summation order. Budget 2.1×10⁴ ULP vs ≤6 ULP libm noise: fine on paper. But GFN-FF is precisely the module of [xtb issue #276](https://github.com/grimme-lab/xtb/issues/276), where the halogen-bonding energy of remdesivir alternated between −0.004644067452 and −0.004644053515 Eh (**1.39×10⁻⁸ Eh spread**) on ~25 % of runs, GCC-only, from memory initialisation. `test_gfnff.f90:739` still carries a deliberately loose `thr2 = 3.0e-3_wp` (used at `:927`).

---

## 8. Risks that turn out to be non-risks

**Geometry-optimizer path dependence: zero.** No test in the unit suite runs an optimization. `relaxation_engine.f90` is dead code — absent from the `tests` list in `test/unit/meson.build`, and its body reaches `call terminate(afail+1)` at line 53.

**~900–1000 assertions are self-consistency, not reference values.** `test_coulomb`, `test_dftd3`, `test_dftd4`, `test_eeq`, `test_repulsion` all use

```fortran
real(wp), parameter :: step = 1.0e-5_wp, step2 = 0.5_wp/step
...
call check(error, gradient(jj, ii), (er - el)*step2, thr=thr)
```

(`test_dftd4.f90:121,214,336,426`; `test_coulomb.f90:97,160,186,332,360,503`). Both sides are computed in the *same* build, so a platform-wide shift cancels. The residual constraint is FD cancellation noise: for `E_disp ≈ −0.05` Eh, ε|E|/2h = 5.6×10⁻¹³ against thr = 10⁻¹⁰ — a ~180× margin. These are the second-tightest category in practice but they are structurally self-correcting.

**`xtb/symmetry` is stochastic by design, and already flaky natively.** `rattle()` (`test_symmetry.f90:234-250`) perturbs every geometry using unseeded `random_number`, so CI already tests a *different* geometry each run. The C20 case (`:222-230`) is knife-edge: the same rattled geometry must classify `c2` at desy = 0.1 and `c2v` at desy = 0.2. Treat any failure here as pre-existing flake, not a wasm regression.

**`xtb/detrotra` asserts exact FP equality** — `check(error, count(eig == 0.0_wp), 5)` and `check(error, eig(6), 0.0_wp)` at default ε (`test_detrotra.f90:62-63,84-85,109-110,131-133`) — but on synthetic literal 0/±1 Hessians, so it is bit-deterministic.

**`xtb/random` (3 cases)** only asserts seed *replay* (`all(first == second)`), not specific values — but it does require `random_seed(put=)` to work in the wasm Fortran runtime.

---

## 9. The failure mode that actually bites: undefined behaviour

This is the historical record, and it is unambiguous. [xtb issue #1109](https://github.com/grimme-lab/xtb/issues/1109) — "xTB + GCC 14.1: multiple test fails" — broke **7 tests**: `param`, `EXE_Argparser_print_help`, `xtb/CAPI`, `xtb/gfn1`, `xtb/gfn2`, `xtb/hessian`, `xtb/oniom`. The fix, PR #1121 (`gh api repos/grimme-lab/xtb/pulls/1121`):

> "This patch removes uninitialised but used `stmp` that leads to bugs with novel GCC's. All cmake tests for xtb were passed."

**No tolerance was changed.** Every cross-compiler test failure in xtb's recent history has been UB, not rounding. On wasm, linear memory starts deterministically zeroed while stack slots hold whatever emscripten's shadow stack last held — a *third* behaviour, different from both glibc and MSVCRT.

**Action before you ever look at a tolerance:** build natively with `gfortran -finit-real=snan -finit-integer=-99999999 -finit-logical=true -ffpe-trap=invalid,zero,overflow` and run the suite. Any test that fails there is latent UB that would surface unpredictably in wasm.

---

## 10. Calibrated risk estimate

| Tier | Collections | Unit cases | Risk of numerics-only failure |
|---|---|---|---|
| **1 — FD of an SCF quantity** | `xtb/hessian` | 2 | **Moderate.** 216 assertions @1e-7, 5×10⁵ FD amplification, discrete SCF-iteration dependence |
| **2 — tightest absolute tolerance** | `xtb/gfnff` (harmonic case) | 1 of 11 | **Moderate.** 2.22e-13; module with a nondeterminism history |
| **3 — single precision + numerical derivatives** | `xtb/ptb` (polarizability, sp cases) | ~3 of 18 | **Low-moderate.** Upstream already loosened to 1e-1 |
| **4 — SCF reference values @1e-9** | `gfn0/1/2`, `peeq`, `tblite`, `oniom`, `cpx`, `dipro`, `docking`, CAPI | ~50 | **Low.** 5×10⁵ ULP budget; risk is iteration-count parity only |
| **5 — analytic self-consistency** | `coulomb`, `dftd3`, `dftd4`, `eeq`, `repulsion`, `coordinationnumber` | ~19 | **Very low.** Both sides move together |
| **6 — non-numeric / stochastic** | `atomlist`, `molecule`, `pbc-tools`, `wsc`, `latticepoint`, `thermo`, `detrotra`, `random`, `symmetry` | ~28 | **Nil**, except `symmetry`'s pre-existing flake |

**Bottom line: 0–4 of 136 unit cases (<3 %) at real risk of failing on numerics alone**, and **none of them because of wasm's floating-point semantics**, which are strictly tighter than the natives already in CI. Probability the suite is green on the first *successful compile*: ~40 %. After clearing latent UB and pinning the LAPACK backend to netlib reference: ~80 %.

If something does fail, the expected remedy in ~80 % of cases is a code or configuration fix (uninitialised variable, LAPACK backend, `-ffp-contract`), not a tolerance relaxation. If a tolerance genuinely must move, expect it to be `test_hessian.f90:54,150` from `1.0e-7` to `1.0e-6`, which would still be 100× tighter than the observed noise floor — but that edits xtb's own test source and therefore **violates the stated acceptance criterion**, so it should be escalated rather than done quietly.

---

## 11. Recommended de-risking order

1. **Before any wasm work**, run the native suite with `-finit-real=snan -ffpe-trap=invalid,zero,overflow`. Fix everything it finds. This is where the historical failures live.
2. **Pin the numerical environment**: netlib reference LAPACK/BLAS 3.12 compiled to wasm, `-Dopenmp=false`, no `-ffast-math`, no relaxed SIMD.
3. **Instrument SCF iteration counts.** Add a temporary print of the per-iteration `eel`, `eel-eold`, `rmsq` sequence (`src/scc_core.f90:555,568,622`) and diff native vs wasm. If the iteration counts match, the energies will agree to ~10⁻¹² and everything downstream passes. If they diverge, that is your root cause, not rounding.
4. **Run `xtb/hessian` first** — it is both the IR-relevant test and the canary.
5. **Treat `xtb/symmetry` failures as pre-existing flake** (unseeded `random_number`); re-run before investigating.
6. **Decide the acceptance scope now**: xtb's own 29 collections + C API, or also the six subprojects' suites? Upstream CI does the former and even excludes `tblite/gfn1-xtb`.
