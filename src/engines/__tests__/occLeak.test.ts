import { beforeAll, expect, test } from 'vitest';

import type { Geometry } from '../../types/index.ts';
import { DEFAULT_SETTINGS } from '../../types/index.ts';
import { loadOccModule } from '../occModule.ts';
import { createHandleScope } from '../occScope.ts';
import { prepareSystem } from '../occSetup.ts';
import { createSweepContext, sweepColumns } from '../occSweep.ts';
import type { OccModule } from '../occTypes.ts';

/**
 * Displacement budget of the leak probe. The implementation this replaced leaked
 * an embind handle per point — a Molecule, an XtbCalculator, a Wavefunction, an
 * IntegralEngine and the Vec/Mat they return, ~104 kB in all — and died with
 * `std::bad_alloc` after 11428 water points at 1190 MB of resident memory. At
 * that rate this loop alone would add ~320 MB.
 */
const DISPLACEMENTS = 3060;
const GROWTH_LIMIT_MB = 128;

const water: Geometry = {
  elements: ['O', 'H', 'H'],
  coordinates: new Float64Array([
    0, 0, 0.1173, 0, 0.7572, -0.4692, 0, -0.7572, -0.4692,
  ]),
};

let module: OccModule;

beforeAll(async () => {
  module = await loadOccModule();
}, 120_000);

test('a few thousand displacements do not grow the heap', () => {
  const settings = { ...DEFAULT_SETTINGS, optimize: false };
  const scope = createHandleScope();
  try {
    const system = prepareSystem(module, water, settings, scope);
    const size = system.atoms * 3;
    const columns = new Int32Array(size);
    for (let column = 0; column < size; column++) columns[column] = column;
    const output = {
      hessian: new Float64Array(size * size),
      dipole: new Float64Array(size * 3),
    };
    const context = createSweepContext(
      module,
      system.molecule,
      system.calculator,
      true,
      scope,
    );

    // One warm-up sweep, so the growth measured afterwards excludes the wasm
    // heap the first SCF legitimately claims and never returns.
    sweepColumns(context, columns, output);
    const baseline = process.memoryUsage().rss;
    const sweeps = Math.ceil(DISPLACEMENTS / (2 * size));
    for (let sweep = 0; sweep < sweeps; sweep++) {
      sweepColumns(context, columns, output);
    }
    const growthMb = (process.memoryUsage().rss - baseline) / 1024 / 1024;
    expect(sweeps * 2 * size).toBeGreaterThanOrEqual(DISPLACEMENTS);
    expect(growthMb).toBeLessThan(GROWTH_LIMIT_MB);
  } finally {
    scope.release();
  }
}, 300_000);

test('repeated prepare and release does not grow the heap', () => {
  const settings = { ...DEFAULT_SETTINGS, optimize: false };
  runCycle(settings);
  const baseline = process.memoryUsage().rss;
  for (let cycle = 0; cycle < 30; cycle++) {
    runCycle(settings);
  }
  const growthMb = (process.memoryUsage().rss - baseline) / 1024 / 1024;
  expect(growthMb).toBeLessThan(GROWTH_LIMIT_MB);
}, 300_000);

/** One full build-sweep-release cycle, as a run does it. */
function runCycle(settings: typeof DEFAULT_SETTINGS): void {
  const scope = createHandleScope();
  try {
    const system = prepareSystem(module, water, settings, scope);
    const size = system.atoms * 3;
    const columns = new Int32Array(size);
    for (let column = 0; column < size; column++) columns[column] = column;
    sweepColumns(
      createSweepContext(
        module,
        system.molecule,
        system.calculator,
        true,
        scope,
      ),
      columns,
      {
        hessian: new Float64Array(size * size),
        dipole: new Float64Array(size * 3),
      },
    );
  } finally {
    scope.release();
  }
}
