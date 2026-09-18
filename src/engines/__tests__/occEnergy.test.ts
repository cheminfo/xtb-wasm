import { beforeAll, expect, test } from 'vitest';

import type { Geometry } from '../../types/index.ts';
import { atomicNumbersOf, readCoordinates } from '../occGeometry.ts';
import { loadOccModule } from '../occModule.ts';
import type { HandleScope } from '../occScope.ts';
import { withHandleScope } from '../occScope.ts';
import { prepareSystem } from '../occSetup.ts';
import type { OccModule, OccMolecule } from '../occTypes.ts';

import { GAS_PHASE_SETTINGS } from './fixtures.ts';

/**
 * The water geometry the project's reference numbers are quoted at, exactly as
 * written: an O–H bond of 0.9584 Å and an angle of 104.45°, with the oxygen off
 * the origin so the molecule is not already centred.
 */
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

test('the reference water geometry gives its documented total energy', () => {
  // The app builds every molecule centred on its centre of mass, and that is
  // the number every other test and the browser both see. Translating the
  // molecule is not bit-neutral: it moves the last two bits of the total.
  const centred = withHandleScope(
    (scope) =>
      prepareSystem(module, water, GAS_PHASE_SETTINGS, scope).energy.total,
  );
  expect(centred).toBe(-5.070_370_524_921_434);

  const uncentred = withHandleScope((scope) => {
    const calculator = scope.keep(
      module.XtbCalculator.fromMolecule(rawMolecule(scope)),
    );
    calculator.charge = 0;
    calculator.numUnpairedElectrons = 0;
    calculator.singlePoint();
    return calculator.totalEnergy();
  });
  expect(uncentred).toBe(-5.070_370_524_921_436);
  expect(Math.abs(centred - uncentred)).toBeLessThan(1e-14);
}, 120_000);

test('centring moves the atoms but leaves the geometry rigid', () => {
  const centred = withHandleScope((scope) =>
    readCoordinates(
      scope.keep(
        prepareSystem(
          module,
          water,
          GAS_PHASE_SETTINGS,
          scope,
        ).molecule.positions(),
      ),
      3,
    ),
  );
  // The centre of mass sits on z, so only z moves, and by the same amount for
  // every atom.
  expect(centred[0]).toBe(0);
  expect(centred[1]).toBe(0);
  expect(centred[2]).toBeCloseTo(0.065_628_381_411_702_44, 15);
  const shift = (centred[2] as number) - 0.1173;
  expect((centred[5] as number) - -0.4692).toBeCloseTo(shift, 15);
  expect((centred[8] as number) - -0.4692).toBeCloseTo(shift, 15);
});

/** The same molecule as `buildMolecule`, without the centre-of-mass shift. */
function rawMolecule(scope: HandleScope): OccMolecule {
  const atomicNumbers = atomicNumbersOf(module, water.elements);
  const numbers = new Array<number>(atomicNumbers.length);
  for (let atom = 0; atom < atomicNumbers.length; atom++) {
    numbers[atom] = atomicNumbers[atom] as number;
  }
  const positions = scope.keep(module.Mat3N.create(atomicNumbers.length));
  for (let atom = 0; atom < atomicNumbers.length; atom++) {
    for (let axis = 0; axis < 3; axis++) {
      positions.set(axis, atom, water.coordinates[atom * 3 + axis] as number);
    }
  }
  return scope.keep(
    new module.Molecule(scope.keep(module.IVec.fromArray(numbers)), positions),
  );
}
