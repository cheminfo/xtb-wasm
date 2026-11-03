import { expect, test } from 'vitest';

import { installVibrationalAnalyser } from '../../chemistry/analyser.ts';
import { moleculeFromGeometry } from '../../molecules/index.ts';
import type {
  EngineProgress,
  VibrationalMode,
  VibrationalRequest,
} from '../../types/index.ts';
import { DEFAULT_OUTPUTS } from '../../types/index.ts';
import { loadInProcessModule } from '../occModule.ts';
import {
  IN_PROCESS_ENGINE_ID,
  computeVibrationsInProcess,
} from '../occVibrationsInProcess.ts';

import { GAS_PHASE_SETTINGS, loadFixture } from './fixtures.ts';

/** The water fixture at native xtb's own minimum, as an engine request. */
function waterRequest(): {
  request: VibrationalRequest;
  reference: ReturnType<typeof loadFixture>['reference'];
} {
  const { geometry, reference } = loadFixture('water');
  const molecule = moleculeFromGeometry(
    geometry,
    'water',
    { kind: 'xyz', text: '' },
    'H2O',
  );
  return {
    request: {
      molecule,
      settings: GAS_PHASE_SETTINGS,
      outputs: DEFAULT_OUTPUTS,
    },
    reference,
  };
}

test('water reproduces the native xtb tier-1 reference on this thread', async () => {
  const { request, reference } = waterRequest();
  const progress: EngineProgress[] = [];
  const result = await computeVibrationsInProcess(request, {
    onProgress: (step) => progress.push(step),
  });

  expect(result.engineId).toBe(IN_PROCESS_ENGINE_ID);
  expect(result.modes).toHaveLength(reference.modeCount);
  expect(result.imaginaryCount).toBe(0);
  // The same bounds as occReference.test.ts, which documents where they come from.
  expect(Math.abs(result.energy.total - reference.totalEnergy)).toBeLessThan(
    1.5e-6,
  );
  for (let index = 0; index < result.modes.length; index++) {
    const mode = result.modes[index] as VibrationalMode;
    expect(
      Math.abs(mode.wavenumber - (reference.frequencies[index] as number)),
      `mode ${index}`,
    ).toBeLessThan(0.6);
  }
  expect(progress.at(-1)).toStrictEqual({
    stage: 'analyse',
    fraction: null,
    message: 'Projecting and diagonalizing…',
  });
  expect(progress).toContainEqual({
    stage: 'hessian',
    fraction: 1,
    message: 'Displacement 9 of 9',
  });
}, 120_000);

test('two runs of the same request give the same digits', async () => {
  const { request } = waterRequest();
  const first = await computeVibrationsInProcess(request);
  const second = await computeVibrationsInProcess(request);

  expect(second.energy.total).toBe(first.energy.total);
  for (let index = 0; index < first.modes.length; index++) {
    expect((second.modes[index] as VibrationalMode).wavenumber).toBe(
      (first.modes[index] as VibrationalMode).wavenumber,
    );
  }
}, 120_000);

test('Raman and thermochemistry are filled once the analyser is installed', async () => {
  installVibrationalAnalyser();
  const { request } = waterRequest();
  const result = await computeVibrationsInProcess(request);

  expect(result.thermochemistry?.temperature).toBe(298.15);
  expect(result.thermochemistry?.pressure).toBe(101_325);
  for (const mode of result.modes) {
    expect(mode.ramanActivity).toBeGreaterThan(0);
  }
}, 120_000);

test('a method this build does not implement is refused with the engine message', async () => {
  const { request } = waterRequest();

  await expect(
    computeVibrationsInProcess({
      ...request,
      settings: { ...request.settings, method: 'GFN-FF' },
    }),
  ).rejects.toThrow(
    'This WebAssembly build only implements GFN2; GFN-FF is not available.',
  );
});

test('relaxation and vibrations share one module instance', () => {
  expect(loadInProcessModule()).toBe(loadInProcessModule());
});
