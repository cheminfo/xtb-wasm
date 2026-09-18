import type { OccHandle } from './occTypes.ts';

/**
 * Tracks embind handles and frees them together. Every object embind returns
 * owns wasm heap that the JavaScript garbage collector cannot reach, so a
 * displacement sweep that forgets one leaks per point: the previous dipole loop
 * leaked ~104 kB per displacement and died with `std::bad_alloc` after 11428
 * water points.
 */
export interface HandleScope {
  /**
   * Register a handle for deletion and return it, so a call can be wrapped in
   * place: `scope.keep(calculator.positions())`.
   */
  keep: <T extends OccHandle>(handle: T) => T;
  /** Delete every registered handle, most recent first, and empty the scope. */
  release: () => void;
}

/**
 * Run `body` with a scope whose handles are released even if it throws. This is
 * the only way handles should be created outside long-lived engine state.
 * @param body - Receives the scope; every handle it creates must be kept.
 * @returns Whatever `body` returns.
 */
export function withHandleScope<T>(body: (scope: HandleScope) => T): T {
  const scope = createHandleScope();
  try {
    return body(scope);
  } finally {
    scope.release();
  }
}

/**
 * A scope the caller releases itself. Used for the inner loop of a sweep, where
 * one scope is reused for thousands of points instead of allocating one per
 * point.
 * @returns An empty scope.
 */
export function createHandleScope(): HandleScope {
  const handles: OccHandle[] = [];
  return {
    keep(handle) {
      handles.push(handle);
      return handle;
    },
    release() {
      for (let index = handles.length - 1; index >= 0; index--) {
        // A handle embind has already reclaimed throws on a second delete, and
        // a partially built scope must still free the rest.
        try {
          handles[index]?.delete?.();
        } catch {
          continue;
        }
      }
      handles.length = 0;
    },
  };
}
