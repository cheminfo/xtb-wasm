/**
 * The native-xtb reference fixtures this library is validated against, shipped
 * with it.
 *
 * Ten GFN2 calculations produced by xtb 6.7.1 — geometry, energies,
 * frequencies, IR intensities, Hessian invariants and thermochemistry — so that
 * any consumer can re-run the validation rather than take the claim on trust.
 * They are behind the `xtb-wasm/reference` subpath so the ~190 kB of JSON never
 * reaches a bundle that only wants to compute a spectrum.
 *
 * The provenance — the scripts, the container, the logs and the tolerance study
 * that produced them — is in `experiments/reference/` in the repository.
 */

import aceticAcid from './fixtures/acetic_acid.json' with { type: 'json' };
import aspirin from './fixtures/aspirin.json' with { type: 'json' };
import benzene from './fixtures/benzene.json' with { type: 'json' };
import caffeine from './fixtures/caffeine.json' with { type: 'json' };
import cholesterol from './fixtures/cholesterol.json' with { type: 'json' };
import ibuprofen from './fixtures/ibuprofen.json' with { type: 'json' };
import methanol from './fixtures/methanol.json' with { type: 'json' };
import paracetamol from './fixtures/paracetamol.json' with { type: 'json' };
import toluene from './fixtures/toluene.json' with { type: 'json' };
import water from './fixtures/water.json' with { type: 'json' };
import tolerances from './tolerances.json' with { type: 'json' };

/** One reference calculation, as the generator wrote it. */
export type ReferenceFixtureJson = Record<string, unknown>;

/**
 * Every fixture, keyed by the molecule name — which is the name native xtb was
 * run on, so the keys are data rather than identifiers and keep their file
 * spelling.
 */
export const REFERENCE_FIXTURES: Readonly<
  Record<string, ReferenceFixtureJson>
> = Object.fromEntries([
  ['acetic_acid', aceticAcid],
  ['aspirin', aspirin],
  ['benzene', benzene],
  ['caffeine', caffeine],
  ['cholesterol', cholesterol],
  ['ibuprofen', ibuprofen],
  ['methanol', methanol],
  ['paracetamol', paracetamol],
  ['toluene', toluene],
  ['water', water],
] as ReadonlyArray<readonly [string, ReferenceFixtureJson]>);

/** The names of every shipped fixture, sorted. */
export const REFERENCE_FIXTURE_IDS: readonly string[] =
  Object.keys(REFERENCE_FIXTURES).toSorted();

/**
 * The agreement a browser result must reach to count as reproducing native
 * xtb, measured rather than assumed — see the tolerance study in
 * `experiments/reference/`.
 */
export const REFERENCE_TOLERANCES = tolerances as Record<string, unknown>;
