/*
 * `test-only` runs vitest with the v8 coverage provider, which takes V8 precise
 * coverage over every loaded module — openchemlib included. Loading it and
 * generating one conformer then costs seconds rather than milliseconds, well
 * past vitest's 5 s default, so every test that touches openchemlib carries an
 * explicit timeout.
 */

/** Timeout for a test that loads openchemlib or builds a few conformers. */
export const OCL_TIMEOUT = 60_000;

/** Timeout for the test that builds all 36 collection conformers. */
export const COLLECTION_TIMEOUT = 300_000;
