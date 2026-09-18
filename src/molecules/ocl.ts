import type * as OclTypes from 'openchemlib';

/** The openchemlib module namespace. */
export type OclModule = typeof OclTypes;

/**
 * Load openchemlib and register its static resources, once per session.
 *
 * Conformer generation throws "static resources must be registered first"
 * without them. Loading it lazily keeps ~1.5 MB off the initial page.
 * `registerFromUrl` is the browser path; it fails under Node (no `fetch` for
 * `file:` URLs), where the synchronous Node reader is the only option.
 * @returns The openchemlib module, resources already registered.
 */
export async function getOcl(): Promise<OclModule> {
  oclPromise ??= loadOcl();
  return oclPromise;
}

let oclPromise: Promise<OclModule> | null = null;

/**
 * Import openchemlib and register its resources.
 * @returns The ready-to-use module.
 */
async function loadOcl(): Promise<OclModule> {
  const module = await import('openchemlib');
  try {
    // With no argument this resolves relative to openchemlib's own module URL,
    // which Vite rewrites to the emitted asset. Deep-importing resources.json
    // instead fails: the package `exports` map does not expose it.
    await module.Resources.registerFromUrl();
  } catch (error) {
    try {
      module.Resources.registerFromNodejs();
    } catch {
      throw error;
    }
  }
  return module;
}
