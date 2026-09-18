import { loadOCC } from '@peterspackman/occjs';

import type { OccModule } from './occTypes.ts';

/**
 * occ's own log level. Anything below 6 prints the whole SCF trace and a
 * per-atom multipole table for every one of the 6N displacements.
 */
const LOG_LEVEL = 6;

/**
 * occ's internal thread count. It stays at 1, and COOP/COEP headers are
 * deliberately NOT added, for three measured reasons:
 *
 * 1. Without cross-origin isolation `SharedArrayBuffer` is undefined in Chrome,
 *    Safari and Firefox alike, and occjs gates thread creation on exactly that
 *    (`_emscripten_has_threading_support = () => typeof SharedArrayBuffer !=
 *    'undefined'`), so `setNumThreads(n > 1)` cannot spawn a thread at all.
 * 2. Where threads *are* available they are worth only ~1.19-1.20x at four
 *    threads and are neutral-to-harmful at eight (benzene Hessian: 294 ms at
 *    one thread, 250 ms at two, 334 ms at four, 684 ms at eight).
 * 3. occ instantiates `parallel_for` only for the DFT/HF/integral kernels and
 *    the *periodic* xTB kernels; the molecular GFN2 path has none, so even that
 *    1.2x comes from TBB/Eigen inside the dense linear algebra.
 *
 * Parallelism therefore comes from `occPool.ts` — several independent module
 * instances, one per Web Worker — which is worth 2.5x-4.3x instead.
 */
const THREAD_COUNT = 1;

/** How a module instance gets at the wasm and the packaged data files. */
export interface OccModuleOptions {
  /** URL of `occjs.wasm`. Omit in Node, where occjs resolves it itself. @default undefined */
  wasmPath?: string;
  /** URL of `occjs.data`. Omit in Node, where occjs resolves it itself. @default undefined */
  dataPath?: string;
  /**
   * A `WebAssembly.Module` compiled once and structured-cloned to every pool
   * worker, so the 21.5 MB binary is compiled once instead of K times.
   * Measured: K=8 warm-up 339 ms → 197 ms, per-worker load 220-257 ms → 73-113 ms.
   * @default undefined
   */
  wasmModule?: WebAssembly.Module;
  /**
   * The bytes of `occjs.data`, fetched once and handed to each worker through
   * emscripten's `getPreloadedPackage` hook so the 8.6 MB package is not
   * downloaded K times. Unverified in a real browser: when the hook is not
   * honoured the worker simply fetches the package as before.
   * @default undefined
   */
  dataPackage?: ArrayBuffer;
}

/**
 * Load one occjs module instance and put it in the state every caller expects:
 * quiet, single-threaded, data directory mounted.
 * @param options - Where the wasm and data live, plus the pool sharing hooks.
 * @returns The loaded module, typed with the members this app uses.
 */
export async function loadOccModule(
  options: OccModuleOptions = {},
): Promise<OccModule> {
  const module = (await loadOCC({
    wasmPath: options.wasmPath,
    dataPath: options.dataPath,
    env: environmentFor(options),
  } as Parameters<typeof loadOCC>[0])) as unknown as OccModule;
  module.setLogLevel(LOG_LEVEL);
  module.setNumThreads(THREAD_COUNT);
  return module;
}

/**
 * Turn an embind failure into a readable message.
 *
 * A C++ exception reaches JavaScript in one of two shapes and both stringify to
 * something meaningless — a bare integer, or `[object Object]`. Which shape
 * arrives is a property of the emscripten the module was compiled with: 4
 * throws the raw pointer, 5 throws a `CppException` wrapper carrying `excPtr`.
 * Both are decoded here, so a toolchain change upstream cannot silently turn
 * every occ message into `[object Object]`. Either way `getExceptionMessage`
 * wants the thrown value itself: handing it the unwrapped `excPtr` reads out of
 * bounds and takes down the module.
 *
 * Getting this wrong is not cosmetic. The optimizer recognises a collapsed
 * trust radius by matching occ's own message, so an undecoded exception turns a
 * recoverable stationary point into a hard failure.
 * @param module - The module that threw, needed to decode the pointer.
 * @param error - Whatever was thrown.
 * @returns A human-readable message.
 */
export function describeOccError(module: OccModule, error: unknown): string {
  if (!isOccException(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  try {
    const parts = module.getExceptionMessage(error);
    return parts[1] ?? parts[0] ?? `occ threw ${String(error)}`;
  } catch {
    return `occ threw ${String(error)}`;
  }
}

/** Whether a thrown value is a C++ exception `getExceptionMessage` can decode. */
function isOccException(error: unknown): boolean {
  if (typeof error === 'number') return true;
  return typeof error === 'object' && error !== null && 'excPtr' in error;
}

/** The emscripten `Module` overrides `loadOCC` spreads into its own config. */
function environmentFor(options: OccModuleOptions): Record<string, unknown> {
  const environment: Record<string, unknown> = {
    print: () => undefined,
    printErr: () => undefined,
  };

  const shared = options.wasmModule;
  if (shared !== undefined) {
    environment.instantiateWasm = (
      imports: WebAssembly.Imports,
      onInstance: (
        instance: WebAssembly.Instance,
        module: WebAssembly.Module,
      ) => void,
    ) => {
      const instance = new WebAssembly.Instance(shared, imports);
      onInstance(instance, shared);
      return instance.exports;
    };
  }

  const dataPackage = options.dataPackage;
  if (dataPackage !== undefined) {
    environment.getPreloadedPackage = (_name: string, size: number) =>
      dataPackage.byteLength === size ? dataPackage : null;
  }

  return environment;
}
