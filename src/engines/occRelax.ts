import type { CalculationSettings } from '../types/index.ts';
import { DEFAULT_SETTINGS } from '../types/index.ts';
import type {
  RelaxOptions,
  RelaxRequest,
  RelaxResult,
  RelaxSettings,
} from '../types/relax.ts';
import { DEFAULT_RELAX_SETTINGS } from '../types/relax.ts';

import { loadOccModule } from './occModule.ts';
import { optimizeGeometry } from './occOptimize.ts';
import { createHandleScope } from './occScope.ts';
import { prepareSystem } from './occSetup.ts';
import type { OccModule } from './occTypes.ts';

/**
 * Relax one geometry on this thread and report the energy **at the geometry it
 * returns**.
 *
 * The optimizer's own last energy belongs to the cycle before the final step,
 * so a single point is taken at the relaxed coordinates rather than reusing it:
 * that one extra SCF is a few milliseconds against an optimization of tens to
 * hundreds, and it is what makes the returned energy and the returned geometry
 * describe the same molecule. It also yields the term breakdown, dispersion
 * included.
 *
 * A structure with fewer than two atoms has nothing to relax, so it comes back
 * unchanged with its single-point energy, converged, in zero cycles, rather
 * than through an optimizer whose step direction is undefined.
 *
 * Exported for the Node path and for the worker handler, which is the same code
 * one thread over.
 * @param module - The loaded occjs module.
 * @param request - Geometry and what to override of the defaults.
 * @param options - Progress and cancellation.
 * @returns The relaxed geometry, its energy and what the optimizer did.
 * @throws When the method is not GFN2, when the SCF fails, or on cancellation.
 */
export function relaxInProcess(
  module: OccModule,
  request: RelaxRequest,
  options: RelaxOptions = {},
): RelaxResult {
  const startedAt = performance.now();
  const settings = resolveRelaxSettings(request.settings);
  const problems = relaxRefusals(request.geometry.elements.length, settings);
  if (problems.length > 0) throw new Error(problems.join(' '));

  const full = calculationSettings(settings);
  const warnings: string[] = [];
  let coordinates = request.geometry.coordinates;
  let cycles = 0;
  let converged = true;

  if (request.geometry.elements.length > 1) {
    const scope = createHandleScope();
    try {
      const system = prepareSystem(module, request.geometry, full, scope);
      const relaxed = optimizeGeometry(
        module,
        system.molecule,
        system.calculator,
        {
          maxCycles: settings.maxCycles,
          signal: options.signal,
          onCycle: options.onCycle,
        },
      );
      coordinates = relaxed.coordinates;
      cycles = relaxed.cycles;
      converged = relaxed.converged;
    } finally {
      scope.release();
    }
  }

  if (!converged) {
    warnings.push(
      `The optimizer stopped after ${cycles} cycles without converging, so this geometry is not a stationary point and its energy is an upper bound.`,
    );
  }

  const scope = createHandleScope();
  try {
    const final = prepareSystem(
      module,
      { elements: request.geometry.elements, coordinates },
      full,
      scope,
    );
    warnings.push(...final.warnings);
    return {
      coordinates: final.coordinates,
      energy: final.energy,
      cycles,
      converged,
      elapsedMs: performance.now() - startedAt,
      warnings,
    };
  } finally {
    scope.release();
  }
}

/**
 * Fill a partial relaxation setting set from {@link DEFAULT_RELAX_SETTINGS}.
 * @param settings - What the caller chose, if anything.
 * @returns Every setting, resolved.
 */
export function resolveRelaxSettings(
  settings?: Partial<RelaxSettings>,
): RelaxSettings {
  return { ...DEFAULT_RELAX_SETTINGS, ...settings };
}

/**
 * Every reason this build cannot relax a structure.
 *
 * A single atom is not refused: it is relaxed in zero cycles.
 * @param atoms - How many atoms the structure has.
 * @param settings - The resolved settings.
 * @returns One sentence per problem, empty when there is none.
 */
export function relaxRefusals(
  atoms: number,
  settings: RelaxSettings,
): string[] {
  const problems: string[] = [];
  if (settings.method !== 'GFN2') {
    problems.push(
      `This WebAssembly build only implements GFN2; ${settings.method} is not available.`,
    );
  }
  if (atoms < 1) problems.push('A structure with no atoms cannot be relaxed.');
  if (!Number.isInteger(settings.charge)) {
    problems.push('The charge must be an integer number of electrons.');
  }
  if (
    !Number.isInteger(settings.unpairedElectrons) ||
    settings.unpairedElectrons < 0
  ) {
    problems.push(
      'The number of unpaired electrons must be a non-negative integer.',
    );
  }
  if (!Number.isInteger(settings.maxCycles) || settings.maxCycles < 1) {
    problems.push('The cycle budget must be a positive whole number.');
  }
  return problems;
}

/** The `CalculationSettings` that `prepareSystem` reads charge and spin from. */
function calculationSettings(settings: RelaxSettings): CalculationSettings {
  return {
    ...DEFAULT_SETTINGS,
    method: settings.method,
    charge: settings.charge,
    unpairedElectrons: settings.unpairedElectrons,
    maxCycles: settings.maxCycles,
  };
}

/**
 * Relax a geometry on the current thread, loading occ on first use.
 *
 * The pooled {@link relaxGeometries} needs `Worker` and the bundler-resolved
 * wasm URL, so it is a browser-only path. This one works wherever the module
 * loads — Node, a test run, or inside a worker the caller already owns — at the
 * cost of blocking the thread it is called on. The module is loaded once per
 * realm and kept.
 * @param request - Geometry and what to override of the defaults.
 * @param options - Progress and cancellation.
 * @returns The relaxed geometry, its energy and what the optimizer did.
 * @throws When the method is not GFN2, when the SCF fails, or on cancellation.
 */
export async function relaxGeometryInProcess(
  request: RelaxRequest,
  options: RelaxOptions = {},
): Promise<RelaxResult> {
  loaded ??= loadOccModule().catch((error: unknown) => {
    // A failed load must not poison every later call of the session.
    loaded = null;
    throw error;
  });
  return relaxInProcess(await loaded, request, options);
}

let loaded: Promise<OccModule> | null = null;
