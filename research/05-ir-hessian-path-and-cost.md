## SUMMARY
xtb's IR path is a two-sided finite-difference Hessian over analytic GFN2 gradients: exactly 6N+1 single-point energy+gradient evaluations for N atoms (src/type/calculator.f90:151-186), with IR intensities obtained for free from the SCF dipole already computed at each displaced point (dipgrad at calculator.f90:177, contracted into intensities at src/hessian.F90:521-533). There is no analytic Hessian and no analytic dipole derivative anywhere in xtb. The dominant cost is the SCF diagonalization: dsygst + dsyevd + dtrsm on an nao x nao matrix every SCC iteration (src/mctc/lapack/eigensolve.f90:230-244), so total cost is ~O(N * nao^3) ≈ O(N^4); memory is trivial by browser standards (~0.7 MB at N=20, ~4 MB at N=50, ~16 MB at N=100 for drug-like organics). A minimum viable subset — GFN2 only, gas phase, D4 only, ANCopt + numerical Hessian + frequency/IR analysis — is a 139-file / 58.6k-line closure out of 177,366 lines in src (33%); dropping GFN1 alone removes 24.5k lines of D3 reference tables. Nine files are written to disk during a default --ohess run but none is read back, so MEMFS is sufficient. xtb's own C API already exposes xtb_hessian with dipole gradients (include/xtb.h:243-252), which bypasses the entire CLI/driver layer. tblite v0.7.0 (55.6k lines, 0 submodules, 0 execute_command_line, no goto outside its fitting module) can supply GFN2 energy+gradient+dipole through tblite_get_singlepoint, and its API auto-enables the "molmom" post-processing so the dipole is available without extra setup — but it has no Hessian, no optimizer, and its dipole is the CAMM sum rather than xtb's AO-integral contraction, so intensities will not be bit-identical to xtb.

## BLOCKERS
[]

## DETAILS
All paths are relative to `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/xtb` (xtb main @ `a45f05d`, 2026-08-09) and `.../scratchpad/tblite` (tblite main @ `133f91e`, 2026-08-04, `fpm.toml` version 0.7.0).

---

## 1. The `--ohess` code path, stage by stage

| # | Stage | File:line |
|---|---|---|
| 1 | CLI flag → runtype | `src/prog/main.F90:1943-1944` (`case ('--ohess')` → `set_runtyp('ohess')`); constant `p_run_ohess = 7` at `src/setparam.f90:202`; `src/set_module.f90:1052-1053` |
| 2 | Flags that gate the run | `src/prog/main.F90:241` (`anyhess`), `:282` (`anyopt`) |
| 3 | Initial single point | `src/prog/main.F90:~700` → `calc%singlepoint` |
| 4 | **Geometry optimization** | `src/prog/main.F90:849-864` → `geometry_optimization` → `src/geoopt_driver.f90:148-153` (`case(p_engine_rf)` → `ancopt`) |
| 5 | ANCopt internals | `src/optimizer.f90`: model Hessian `:471` (`modhes`, defined `:1228-1308`) → default `p_modh_old` = Lindh 1995 `ddvopt` at `src/model_hessian.f90:2085`; trans/rot projection `:501-508`; ANC generation `:551` (`anc%new`, `src/type/anc.f90`); RFO/BFGS micro-iterations `:542` (`relax`) |
| 6 | **Numerical Hessian entry** | `src/prog/main.F90:955-971` → `call numhess(...)` |
| 7 | `numhess` | `src/hessian.F90:30`. Reference SP `:146`; gnorm sanity check `:159-166` (warns above 0.002); linearity via `axis` `:170`; accuracy switched to `accu_hess` `:174`; `call calc%hessian(env, mol, chk0, indx, step, h, dipd)` `:218` |
| 8 | **Finite-difference kernel** | `src/type/calculator.f90:114-197`. Loop `do kat = 1, size(list)` × `do ic = 1, 3` `:151-153`; `+step` `:164`, `−step` `:165`; **dipole gradient** `:177`; Hessian accumulation `:179-186`; runtime extrapolation printed after atom 3 `:188-195` |
| 9 | Displaced single point | `src/type/calculator.f90:201-228` — `mol%copy(mol0)`, displace one coordinate, `chk%copy(chk0)` (warm start), `self%singlepoint(...)`, `dipole = res%dipole` |
| 10 | GFN2 SP + analytic gradient | `src/xtb/calculator.f90:195` → `:258` `call scf(...)` → `src/scf_module.F90` |
| 11 | SCF/SCC loop | `src/scf_module.F90:620-635`; iterator `src/scc_core.f90:433`; diagonalization `:475`; density matrix `:513` (`dmat`, a `dgemm`); GFN2 CAMM `:526` (`mmompop`) |
| 12 | Eigensolver | `src/mctc/lapack/eigensolve.f90:218-245` — `dsygst` → `dsyevd` → `dtrsm`; Cholesky `dpotrf` at `:115-117` and again `src/scc_core.f90:411-413` |
| 13 | Dipole | `src/scf_module.F90:876-881` → `src/dipole.f90:94-128` (`calc_dipole`); stored `src/scf_module.F90:904` |
| 14 | Symmetrization | `src/hessian.F90:295-310` |
| 15 | **Trans/rot projection** | `src/hessian.F90:348` → `src/freq/project.f90:151` (`trproj`) → `:218` (`gtrprojm`) |
| 16 | Write `hessian` file | `src/hessian.F90:354` → `src/freq/io.f90:51` (`wrhess`, Turbomole `$hessian`) |
| 17 | **Mass weighting** | `src/hessian.F90:366-372` |
| 18 | Diagonalization | `src/hessian.F90:388-389` — `call dsyev('V','U',n3,res%hess,n3,res%freq,aux,lwork,info)`, `lwork = 1 + 6*n3 + 2*n3**2` |
| 19 | Frequencies, sorting | `src/hessian.F90:406-475` |
| 20 | Reduced masses | `src/hessian.F90:477-495` |
| 21 | **IR intensities** | `src/hessian.F90:521-533` |
| 22 | Raman (PTB only) | `src/hessian.F90:535-548` |
| 23 | Output driver | `src/main/property.F90:695-820` (`main_freq`) — `vibspectrum` `:755`, `g98.out` `:768`, thermo `:781`, `distort` `:806` |
| 24 | Writers | `src/freq/io.f90:190-281` (`write_tm_vibspectrum`), `:283-388` (`g98fake2`) |
| 25 | Imaginary-mode distortion | `src/hessian.F90:638-693` → `xtbhess.xyz` |

---

## 2. Numerical or analytical? How many gradients?

**Purely numerical.** Central (two-sided) differences of the analytic gradient:

```fortran
! src/type/calculator.f90:164-186
call hessian_point(self, env, mol0, chk0, iat, ic, +step, er, gr, sr, egap, dr, alphar)
call hessian_point(self, env, mol0, chk0, iat, ic, -step, el, gl, sl, egap, dl, alphal)
dipgrad(:, ii) = (dr - dl) * step2
...
hess(jj, ii) = hess(jj, ii) + (gr(jc, jat) - gl(jc, jat)) * step2
```

- **6N displaced single points + 1 reference SP = 6N+1** energy+gradient+dipole evaluations. `list` is every atom (`src/hessian.F90:217`), no symmetry reduction, no frozen-atom shortcut unless `$fix freeze` is used (then `6·nonfrozen`).
- Step `0.005 bohr` (`src/setparam.f90:343`), doubled only for MOPAC (`src/hessian.F90:141`).
- No analytic Hessian exists anywhere: `grep 'procedure :: hessian'` hits only the base class and the ONIOM/Turbomole/ORCA overrides (the latter two shell out to external programs).
- The `--ohess` run adds the optimizer's gradients on top: default `optlev=normal` caps at `3N` cycles (`src/optimizer.f90:86-91`), typically 15–60 for a drug-like molecule.

Concretely: **N=20 → 121 SPs; N=50 → 301; N=100 → 601**, plus optimization.

---

## 3. Dominant cost

Per single point:
1. **Integrals** — `build_SDQH0` (S, dipole, quadrupole, H0) `src/scf_module.F90:553-560`; O(nshell²) pair loop with cutoff `intcut = max(20, 25 − 10·log10(acc))` = 30.2 at `acc=0.3`. Sub-dominant beyond ~30 atoms.
2. **SCC iterations — this dominates.** Every iteration does, on the full `nao × nao` matrix:
   - `dsygst` (reduce generalized → standard, using the pre-Cholesky'd S),
   - `dsyevd` (divide-and-conquer, eigenvectors),
   - `dtrsm` (back-transform),
   - `dmat` → `dgemm` for the density matrix, plus `mmompop` (O(9·nao²)) for GFN2 CAMM.

   That is roughly **8–12·nao³ flops per SCC cycle**. Note `src/scc_core.f90:504-506` computes a `fulldiag` flag and the old `solve(fulldiag,...)` call at `:473` is commented out — the **full** solver runs every iteration; there is no pseudo-diagonalization shortcut in the current code.
3. **Gradient** — `build_dSDQH0_noreset` (`src/scf_module.F90:719`), O(nao²) pair loop.
4. **Hessian assembly** — `src/type/calculator.f90:179-186` is O(N²) per displacement, i.e. O(N³) total. **Negligible.**
5. **Final Hessian diagonalization** — one `dsyev` on 3N×3N (`src/hessian.F90:389`). O((3N)³) once. At N=100 that's 2.7e7 → milliseconds. **Negligible.**

**Basis size.** From `param_gfn2-xtb.txt`: H = 1 AO (`ao=1s`), C/N/O/F = 4 (`ao=2s2p`), P/S/Cl/Br = 9 (`ao=3s3p3d`). A drug-like organic gives `nao ≈ 2.5·N`.

| molecule | N | nao | 3N | gradient evals |
|---|---|---|---|---|
| benzene C₆H₆ | 12 | 30 | 36 | 72 |
| caffeine C₈H₁₀N₄O₂ | 24 | 66 | 72 | 144 |
| penicillin G C₁₆H₁₈N₂O₄S | 41 | 115 | 123 | 246 |
| cholesterol C₂₇H₄₆O | 74 | 158 | 222 | 444 |
| taxol-sized C₄₇H₅₁NO₁₄ | 113 | 299 | 339 | 678 |

**Total scaling ≈ O(N · nao³) ≈ O(N⁴).** Going 20 → 50 atoms is ~40×; 50 → 100 is ~16×.

*Mitigating factor:* each displaced SCF warm-starts from the reference converged wavefunction (`chk%copy(chk0)`, `src/type/calculator.f90:218`), so displaced SCFs typically need ~4–8 cycles rather than 15–25.

*Aggravating factor:* `accu_hess = 0.3` (`src/setparam.f90:341`) tightens `scfconv` to 3e-7 Eh and `qconv` to 3e-5 e (`src/scf_module.F90:272-277`), and raises `intcut` — the Hessian SPs are more expensive than a plain `--sp`.

---

## 4. Peak memory

**GFN2 single point**, live `nao²` doubles (`src/scf_module.F90:324-330`, `:544-547`, `:668`, `:703`; `src/scc_core.f90:411`; `src/mctc/lapack/eigensolve.f90:111`):

| array | size in nao² |
|---|---|
| `qpint(6,nao,nao)` | 6 |
| `dpint(3,nao,nao)` | 3 |
| `S`, `X`, `wfn%C`, `wfn%P`, `S_factorized`, `Pew`, `H` | 7 |
| `H0` + `H0_noovlp` (packed) | 1 |
| eigensolver `dwork(1+6n+2n²)` | 2 |
| `matlist` (int32) | 0.5 |

≈ **18 nao² doubles ≈ 150·nao² bytes**.

**Hessian driver** (`src/hessian.F90:127-131`, `:388`): `hss`+`hsb` (1), `h`,`htb`,`hbias`,`h_dummy` (4), `res%hess` (1), `aux` (2) ≈ 7–9 (3N)² doubles ≈ **500–650·N² bytes**. `main_freq` adds one more (3N)².

| N | nao | SCF | Hessian | **peak total** |
|---|---|---|---|---|
| 20 | ~50 | 0.38 MB | 0.26 MB | **~0.7 MB** |
| 50 | ~125 | 2.3 MB | 1.6 MB | **~4 MB** |
| 100 | ~250 | 9.4 MB | 6.5 MB | **~16 MB** |

Heavy-atom-rich cases scale with nao, not N: 100 carbons (nao=400) → ~24 MB SCF alone; add sulfur/halogens (9 AOs each) and you approach ~35 MB. Add ~1.8 MB of static D3 tables **if you keep GFN1** (`reference_c6` = 94·94·5·5 doubles); D4's `alphaiw(23,7,118)` is only 0.15 MB.

**Verdict: memory is a non-issue for a 2 GB wasm heap.** Time is the constraint, not space. Caveat: if you thread the Hessian with pthreads, the SCF working set multiplies by thread count (each thread gets its own `mol`/`chk` and runs a full SCF — `src/type/calculator.f90:142-148`).

---

## 5. IR intensities: how

**Numerical dipole derivatives, free of charge.** The GFN2 SCF computes the molecular dipole in every single point (`src/scf_module.F90:876-881` — literally commented *"dipole calculation (always done because its free)"*), from the AO dipole integrals contracted with the density matrix plus the nuclear term (`src/dipole.f90:109-124`). `hessian_point` harvests it (`src/type/calculator.f90:224`), and the same ± displacements that build the Hessian build `dipgrad` (`:177`).

Intensities are then the transformation of the Cartesian dipole derivatives into normal coordinates:

```fortran
! src/hessian.F90:521-533
do i = 1, n3
   do k = 1, 3
      sum2 = 0.0_wp
      do j = 1, n3
         sum2 = sum2 + dipd(k,j)*(res%hess(j,i)*amass_au(j))
      end do
      trdip(k) = sum2
   end do
   res%dipt(i) = autokmmol*(trdip(1)**2+trdip(2)**2+trdip(3)**2)
end do
```

**Zero extra SCF cycles for IR.** Raman is different: `res%alpha` is only ever written by PTB (`src/ptb/calculator.F90:311`), so `--raman` requires the whole 10,148-line `src/ptb` tree plus mctc-lib and a *second* full 6N-point numerical differentiation (`src/hessian.F90:220-241`). **Drop Raman.**

**Reproduction gotcha:** xtb projects trans/rot out of the **non-mass-weighted** Hessian using the **unweighted centroid** (`src/freq/project.f90:186-208` averages coordinates with no masses), and only mass-weights afterwards (`src/hessian.F90:348` then `:366-372`). That is the reverse of the textbook order. Copy it exactly or your frequencies will differ in the third decimal.

---

## 6. Minimum viable subset

I computed real module-dependency closures (script at `scratchpad/dep2.py`, walking `module`/`use` declarations across all 347 source files).

| target | files | LOC | % of 177,366 |
|---|---|---|---|
| GFN2 single point + gradient only | 117 | **44,469** | 25% |
| + numerical Hessian + freq analysis + IR + writers | 125 | **47,028** | 27% |
| + ANCopt optimizer + thermochemistry | 139 | **58,607** | **33%** |

Exclusions modelled: GFN0/GFN1, PEEQ, D3 + D3 tables, all solvation, GFN-FF, PTB, tblite backend, external QM drivers, ONIOM, metadynamics, `local`, `sphereparam`, GPU Hamiltonian, docking params.

### KEEP
- `src/xtb/` minus `gfn0.f90`, `gfn1.f90`, `hamiltonian_gpu.f90` — GFN2 data, basis, Hamiltonian, repulsion, multipole, third-order, Coulomb (4,608 lines)
- `src/scf_module.F90`, `src/scc_core.f90`, `src/aespot.F90` (CAMM/AES), `src/intgrad.f90`, `src/intpack.f90`, `src/dipole.f90`
- `src/disp/dftd4.F90` + `dftd4_parameters.f90` + `param_ref.fh` + `ncoord.f90` + `coordinationnumber.F90`
- `src/coulomb/klopmanohno.F90`, `src/type/*`, `src/mctc/*` (BLAS/LAPACK interface wrappers — 8.2k lines of thin `interface` blocks, **not** implementations)
- `src/type/calculator.f90` (the FD Hessian), `src/hessian.F90`, `src/freq/*`
- Optimizer: `src/optimizer.f90`, `src/model_hessian.f90` (or just `ddvopt` + `mh_lindh`), `src/lindh.f90`, `src/type/anc.f90`, `src/bfgs.f90`, `src/david2.f90`, `src/detrotra.f90`, `src/ls_rmsd.f90`
- `src/setparam.f90` + `src/set_module.f90` — 3.5k lines of **global mutable state** that everything reads. Ugly for a library, unavoidable without surgery.

### DROP (with LOC)
| dropped | LOC |
|---|---|
| GFN1 + D3 + `dftd3_parameters.f90` | **24,510** (D3 table alone is 23,560 lines / 1.86 MB) |
| GFN-FF (`src/gfnff/`) | 15,409 |
| all solvation: GBSA/ALPB/COSMO/ddCOSMO/CPCM-X + Lebedev grids (`src/solv/`) | 12,087 |
| PTB (`src/ptb/`) — needed only for Raman | 10,148 |
| docking + `src/iff/` | 5,792 |
| MD, metadynamics, path finder, scan, mode following, cqpath, bias_path, screening, mdoptim | ~5,000 |
| ONIOM | 1,644 |
| external QM drivers (`src/extern/`) | 2,228 |
| GFN0/PEEQ | 2,639 |
| DIPRO, local orbitals, ESP/STM/cube, molden | ~2,800 |
| `symmetry/symmetry_i.c` (only for thermo's rotational symmetry number) | 2,009 C |
| CLI arg parser + `xhelp` (if API-driven) | ~2,000 |
| the 27 ALPB + 14 GBSA `.fh` parameter includes | ~0.9 MB of headers |

Also droppable: IPEA, VIP/VEA/Fukui, spin-polarization (`src/foden.f90`), periodic/PBC (`src/pbc*.f90`, `src/coulomb/ewald.f90`), `src/coffee.f90`.

**Dropping GFN1 is the single biggest and cheapest win**: 24.5k lines of source, 1.86 MB of Fortran the compiler must chew through, and 1.77 MB of runtime doubles. Verified: `src/scf_module.F90:530-536` calls `d3_gradient` only when `xtbData%level == 1`.

### Does the optimizer add much surface?

**No — ~11.6k lines in the closure, and only ~6.5k of real optimizer code.** The delta is `model_hessian.f90` (3,170) + `set_module.f90` (2,904) + `optimizer.f90` (1,548) + `gfnff/neighbor.f90` (685, only for the GFN-FF model-Hessian variant — deletable) + `ls_rmsd.f90` (560) + `type/atomlist.f90` (522) + `type/anc.f90` (504) + `david2.f90` (441) + `thermo.f90` (350) + `bfgs.f90` (186) + `detrotra.f90` (145). ANCopt is well-contained: build a Lindh model Hessian, project, diagonalize into approximate normal coordinates, run RFO/BFGS micro-iterations in that space.

---

## 7. Files written during `xtb --ohess mol.xyz`

Written (default settings):

| file | where | note |
|---|---|---|
| `xtbopt.xyz` (extension follows input type) | `src/prog/main.F90:1113-1118` | optimized geometry |
| `xtbopt.log` | `src/geoopt_driver.f90:121` | optimization trajectory |
| `.xtboptok` **or** `NOT_CONVERGED` | `:186` / `:183` | both deleted first at `:112-113` |
| `charges` | `src/main/property.F90:190` | `pr_charges = .true.` (`src/setparam.f90:404`) |
| `wbo` | `src/main/property.F90:229` | `pr_wiberg = .true.` (`src/setparam.f90:402`) |
| `hessian` | `src/hessian.F90:354` → `src/freq/io.f90:51` | non-mass-weighted, projected, Turbomole format |
| `vibspectrum` | `src/main/property.F90:755` | |
| `g98.out` | `src/main/property.F90:768` | |
| `xtbrestart` | `src/prog/main.F90:1248` | unless `--norestart` |
| `xtbhess.xyz` | `src/hessian.F90:684-690` | **only** if imaginary modes found |
| `.sccnotconverged` | `src/scf_module.F90:651` | only on SCC failure; deleted at `src/prog/main.F90:670` |

Flag-gated extras: `hessian.out` (`src/hessian.F90:318`), `xtbout.json` (`--json`), `vib_normal_modes` (`pr_nmtm`), `xtb_enso.json` (`--enso`), `.tmpxtbmodef` / `xtb_localmodes` / `g98l.out` (`pr_modef`), `fod`, `molden.input`.

Read at startup: the input geometry, `.CHRG` (`main.F90:305`), `.UHF` (`:319`), `.EFIELD` (`:335`), `xtbrestart` (`:677`), optionally `param_gfn2-xtb.txt` and `.xtbrc`/xcontrol.

**Nothing written is read back within the same run.** Emscripten MEMFS is entirely sufficient; no NODEFS, no IDBFS, no persistence needed. And `param_gfn2-xtb.txt` need not be shipped at all: `src/xtb/calculator.f90:150-160` falls back to the compiled-in parameter set when no file is found.

**No `execute_command_line`/`call system()` in this path** — all 26 hits are in `src/extern/*` (external QM drivers), `screening.f90`, `dipro.F90`, or are commented out (`src/modef.f90:90,435,518`).

---

## 8. Could tblite alone replace xtb?

### tblite's C API surface (`include/tblite/*.h`, 1,688 lines total)

```
// context.h        tblite_new_context, delete, check, get_context_error,
//                  set_context_logger/color/verbosity
// error.h          tblite_new_error, delete, check, clear, get, set
// structure.h      tblite_new_structure(error, natoms, numbers, positions,
//                                       charge, uhf, lattice, periodic)
//                  tblite_update_structure_geometry / _charge / _uhf
//                  tblite_delete_structure
// calculator.h     tblite_new_gfn2_calculator(ctx, mol, config)
//                  tblite_new_gfn1_calculator, tblite_new_ipea1_calculator
//                  tblite_new_xtb_calculator(ctx, mol, param, config)
//                  tblite_set_calculator_accuracy / _max_iter /
//                      _mixer_damping / _mixer_memory / _mixer /
//                      _temperature / _temperature_annealing /
//                      _guess / _save_integrals
//                  tblite_get_calculator_shell_count / _shell_map /
//                      _angular_momenta / _orbital_count / _orbital_map
//                  tblite_get_singlepoint(ctx, mol, calc, res)      <-- THE ONLY DRIVER
//                  tblite_push_back_post_processing_str / _param
// result.h         tblite_new_result, copy, delete
//                  tblite_get_result_energy / _energies / _gradient / _virial
//                  tblite_get_result_charges / _bond_orders
//                  tblite_get_result_dipole / _quadrupole
//                  tblite_get_result_orbital_energies / _occupations /
//                      _coefficients / _density_matrix / _overlap_matrix /
//                      _hamiltonian_matrix
//                  tblite_save_result_wavefunction / _load_result_wavefunction
// container.h      tblite_new_electric_field, tblite_new_spin_polarization,
//                  tblite_calculator_push_back
// solvation.h      tblite_new_gb_solvation_epsilon,
//                  tblite_new_alpb_solvation_solvent,
//                  tblite_new_ddx_solvation_epsilon / _solvent
// param.h          tblite_new_param, load, dump, delete
// table.h          TOML table/array builders (for param + post-processing config)
// double_dictionary.h  post-processing result access
// features.h       tblite_get_feature   version.h  tblite_get_version
```

### Answer: **yes, technically — but you write the Hessian and the optimizer yourself.**

**What works out of the box.** `tblite_get_singlepoint` always computes energy + gradient + virial, and — critically — it **auto-registers the `bond-orders` and `molmom` post-processors when none are configured**:

```fortran
! tblite/src/tblite/api/calculator.f90:668-675
if (calc%post_proc%npp == 0) then
   f_char = "bond-orders";  call add_post_processing(calc%post_proc, mol%ptr, f_char, error)
   f_char = "molmom";       call add_post_processing(calc%post_proc, mol%ptr, f_char, error)
```

So `tblite_get_result_dipole` works without any `push_back` call, and everything needed for a caller-side numerical Hessian **with** IR intensities is available. `tblite_update_structure_geometry` displaces atoms in place, and reusing one `tblite_result` across displacements warm-starts the SCF exactly like xtb (`api/calculator.f90:702-722` only reallocates the wavefunction when nat/nao/nsh/nspin change).

**What you must reimplement (caller side, ~400 lines of JS/C):**
1. The 6N central-difference loop over Cartesian displacements — trivial.
2. Trans/rot projection (`trproj`+`gtrprojm`, `src/freq/project.f90:151-320`, ~170 lines, no LAPACK).
3. Mass weighting + one `dsyev` on 3N×3N — at N=100 that's a 300×300 symmetric eigenproblem, perfectly fine in JS (`ml-matrix`) or a tiny wasm LAPACK.
4. The intensity contraction (13 lines, `src/hessian.F90:521-533`).
5. `vibspectrum` / `g98.out` writers — trivial.
6. **A geometry optimizer.** This is the real work. Options: (a) port ANCopt (~6.5k lines of Fortran), (b) implement L-BFGS on Cartesians in JS driving `tblite_get_singlepoint` — simpler but noticeably more gradient calls than ANC, and ANC's Lindh preconditioner is a large part of why xtb optimizations converge fast.

**What is actually lost:**
- **Bit-identical agreement with xtb.** tblite's dipole is the CAMM sum `Σ_A (R_A·q_A + μ_A)` (`tblite/src/tblite/wavefunction/mulliken.f90:140-143`); xtb's is the full AO dipole-integral contraction with the density matrix plus nuclear term (`src/dipole.f90:109-124`). Both derive from the same GFN2 density, so they should agree closely, but intensities will not match xtb's published numbers digit-for-digit. Validate against reference `--ohess` output before shipping.
- **Raman** — same as xtb without PTB: unavailable.
- **CPCM-X** — not in tblite. But tblite's solvation is otherwise *better* than xtb's: ALPB/GBSA with solvent names (`tblite_new_alpb_solvation_solvent`) plus CPCM via ddX (`tblite_new_ddx_solvation_epsilon/_solvent`). For gas-phase IR you drop all of it anyway.
- **`xtbrestart`, xcontrol, the CLI, the file writers, `.CHRG`/`.UHF`** — all gone, which for a browser build is a feature.

### Is tblite smaller and more modern? Emphatically yes.

| metric | xtb | tblite |
|---|---|---|
| Fortran LOC (`src/`) | **177,366** (347 files) | **55,571** (168 files) |
| fixed-form `.f` files | 8 files, 4,159 lines | **0** |
| `goto` statements | **261** | 43 (40 in `fit/newuoa.f90`, unused at runtime) |
| `implicit real/double/integer` | 53 | **0** |
| `common` blocks | 3 | 0 |
| Fortran submodules | 0 | 0 |
| preprocessed `.F90` | 51 | **6** |
| `execute_command_line`/`system()` | 26 | **0** |
| polymorphic `class(...)` decls | — | 415 (clean container/plugin architecture) |
| global mutable state | `setparam`+`set_module` (3.5k lines) touched everywhere | none — everything through `context`/`calculator` handles |
| latest release | v6.7.1 (2024-07-23); main @ a45f05d (2026-08-09) | **v0.7.0 (2026-07-13)** |

The C-API-only closure for tblite (GFN2 SP + gradient + dipole) is **37,554 lines / 133 files**, i.e. 68% of tblite. On top of that you need the subprojects: **mctc-lib 0.5.1 (12,335), dftd4 4.2.0 (12,079), multicharge 0.5.0 (5,247)** — and, if you support GFN2 only, **not** simple-dftd3 1.6.0, which is 85,327 lines (66,222 of them one reference table). toml-f 12,598 is needed only for the TOML param loader (`tblite_load_param`) — skippable if you stick to the built-in GFN2 parametrization.

So the two realistic stacks are roughly:

- **xtb minimal**: ~58.6k lines xtb + mctc-lib (12.3k, unavoidable — `TMolecule` depends on it) ≈ **71k lines**, plus the whole `setparam` global-state problem, plus `symmetry_i.c` if you want thermochemistry. You get the reference numbers exactly, and `xtb_hessian` in the C API already does the 6N loop for you.
- **tblite minimal**: ~37.6k tblite + 12.3k mctc-lib + 12.1k dftd4 + 5.2k multicharge ≈ **67k lines**, cleaner Fortran, no global state, no CLI — but you write the numerical Hessian, the frequency analysis and the optimizer yourself, and you accept small numerical differences from xtb.

The line counts are close; the *quality* difference is not. My read: tblite is the better port target for a browser, and the extra caller-side code (Hessian loop + projection + eigensolve + intensities) is small and lives in JS where you can debug it. The optimizer is the one piece worth thinking hard about.

### One more option worth flagging

xtb's **own C API already exposes the numerical Hessian with dipole gradients** — `include/xtb.h:243-252`, implemented at `src/api/interface.f90:310-454`:

```c
void xtb_hessian(xtb_TEnvironment, xtb_TMolecule, xtb_TCalculator, xtb_TResults,
                 double* hessian, int* atom_index_list, int* step_size,
                 double* dipole_gradient, double* polarizability_gradient);
```

It defaults to `step = 0.005` and all atoms (`interface.f90:396-408`), symmetrizes the result (`:434-440`), and never touches disk. It bypasses `main.F90`, `main_freq`, and every file writer. There is **no optimizer** in that API (`grep -i opt include/xtb.h` → nothing but the licence text), so the pre-optimization must come from ANCopt on the Fortran side (needs a small API addition) or from caller-side code. If the goal is "reproduce xtb reference IR spectra exactly with the least new code," that entry point plus a JS-side frequency analysis is the shortest path.

**Sources:**
- [xtb Hessian documentation](https://xtb-docs.readthedocs.io/en/latest/hessian.html)
- [grimme-lab/xtb issue #1195 (GFN2 timing)](https://github.com/grimme-lab/xtb/issues/1195)
- [xtb releases (GitHub API)](https://api.github.com/repos/grimme-lab/xtb/releases)
- [tblite releases (GitHub API)](https://api.github.com/repos/tblite/tblite/releases)
