import { expect, test } from 'vitest';

import type {
  CalculationSettings,
  Molecule,
  VibrationalRequest,
} from '../../types/index.ts';
import { DEFAULT_OUTPUTS, DEFAULT_SETTINGS } from '../../types/index.ts';
import { occjsEngine, occjsSerialEngine } from '../occjs.ts';

/** A neutral three-atom stand-in; validation never looks at the coordinates. */
const water: Molecule = {
  id: 'water',
  label: 'water',
  formula: 'H2O',
  source: { kind: 'smiles', smiles: 'O', seed: 42 },
  charge: 0,
  unpairedElectrons: 0,
  elements: ['O', 'H', 'H'],
  coordinates: new Float64Array([
    0, 0, 0.1173, 0, 0.7572, -0.4692, 0, -0.7572, -0.4692,
  ]),
};

/**
 * One request to validate.
 * @param settings - Overrides on top of the gas-phase defaults.
 * @param molecule - The molecule to ask about.
 * @returns The request.
 * @default settings {}
 * @default molecule water
 */
function request(
  settings: Partial<CalculationSettings> = {},
  molecule: Molecule = water,
): VibrationalRequest {
  return {
    molecule,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    outputs: DEFAULT_OUTPUTS,
  };
}

test('this build advertises GFN2 alone, with charge and open shell', () => {
  expect(occjsEngine.capabilities.methods).toStrictEqual(['GFN2']);
  expect(occjsEngine.capabilities.charge).toBe(true);
  expect(occjsEngine.capabilities.openShell).toBe(true);
  expect(occjsEngine.capabilities.raman).toBe('bond-polarizability');
});

test('a gas-phase closed-shell request is accepted', () => {
  expect(occjsEngine.validate(request())).toStrictEqual([]);
  expect(occjsSerialEngine.validate(request({ charge: -1 }))).toStrictEqual([]);
  expect(occjsEngine.validate(request({ unpairedElectrons: 1 }))).toStrictEqual(
    [],
  );
});

test('a method this build does not implement is refused', () => {
  const refusals = occjsEngine.validate(request({ method: 'GFN-FF' }));
  expect(refusals).toStrictEqual([
    'This WebAssembly build only implements GFN2; GFN-FF is not available.',
  ]);
});

test('nonsense settings are refused one message at a time', () => {
  expect(
    occjsEngine.validate(request({ charge: 0.5, temperature: 0 })),
  ).toStrictEqual([
    'The charge must be an integer number of electrons.',
    'The temperature must be above 0 K.',
  ]);
  expect(
    occjsEngine.validate(request({ unpairedElectrons: -1 })),
  ).toStrictEqual([
    'The number of unpaired electrons must be a non-negative integer.',
  ]);
  expect(
    occjsEngine.validate(
      request(
        {},
        { ...water, elements: ['O'], coordinates: new Float64Array(3) },
      ),
    ),
  ).toStrictEqual(['A single atom has no vibrations.']);
});
