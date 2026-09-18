import { expect, test } from 'vitest';

import {
  FORCE_CONSTANT_MDYN_PER_ANGSTROM,
  IR_INTENSITY_KM_PER_MOL,
} from '../../chemistry/constants.ts';
import { TRANS_ROT_CUTOFF_CM, assembleModes } from '../occModes.ts';
import { symmetrizeHessian } from '../occVibrations.ts';

/**
 * A two-atom system with unit masses and one genuine mode: a z stretch whose
 * eigenvector is `(0,0,1/√2, 0,0,−1/√2)`. Unit masses make the Cartesian
 * displacement equal to the eigenvector, so every derived quantity is exact.
 */
function diatomicInput(withDipole: boolean) {
  const size = 6;
  const normalModes = new Float64Array(size * size);
  const root = Math.SQRT1_2;
  normalModes[2 * size + 5] = root;
  normalModes[5 * size + 5] = -root;
  const dipoleDerivatives = new Float64Array(size * 3);
  // dμz/dz of atom 0 is +1, of atom 1 is −1.
  dipoleDerivatives[2 * 3 + 2] = 1;
  dipoleDerivatives[5 * 3 + 2] = -1;
  return {
    atoms: 2,
    masses: new Float64Array([1, 1]),
    frequencies: new Float64Array([0, 0, 0, 0, 0, 1000]),
    normalModes,
    dipoleDerivatives: withDipole ? dipoleDerivatives : null,
  };
}

test('the projected translations and rotations are dropped', () => {
  expect(TRANS_ROT_CUTOFF_CM).toBe(1);
  const modes = assembleModes(diatomicInput(true));
  expect(modes).toHaveLength(1);
  expect(modes[0]?.wavenumber).toBe(1000);
});

test('the eigenvector is stored verbatim and the displacement is e/√m', () => {
  const modes = assembleModes(diatomicInput(false));
  const mode = modes[0];
  expect(mode?.eigenvector).toStrictEqual(
    new Float64Array([0, 0, Math.SQRT1_2, 0, 0, -Math.SQRT1_2]),
  );
  expect(mode?.cartesianDisplacement).toStrictEqual(mode?.eigenvector);
  expect(mode?.maxDisplacement).toBe(Math.SQRT1_2);
});

test('reduced mass and force constant follow the unit-norm eigenvector', () => {
  const mode = assembleModes(diatomicInput(false))[0];
  expect(mode?.reducedMass).toBeCloseTo(1, 15);
  expect(mode?.forceConstant).toBeCloseTo(
    FORCE_CONSTANT_MDYN_PER_ANGSTROM * 1e6,
    15,
  );
});

test('an imaginary mode reports a negative force constant', () => {
  const input = diatomicInput(false);
  input.frequencies = new Float64Array([0, 0, 0, 0, 0, -1000]);
  const mode = assembleModes(input)[0];
  expect(mode?.wavenumber).toBe(-1000);
  expect(mode?.forceConstant).toBeCloseTo(
    -FORCE_CONSTANT_MDYN_PER_ANGSTROM * 1e6,
    15,
  );
});

test('the IR intensity is the squared dipole derivative along the mode', () => {
  const withDipole = assembleModes(diatomicInput(true))[0];
  // dμz/dQ = 1·(1/√2) − 1·(−1/√2) = √2, so |dμ/dQ|² = 2.
  expect(withDipole?.irIntensity).toBeCloseTo(2 * IR_INTENSITY_KM_PER_MOL, 10);
  const without = assembleModes(diatomicInput(false))[0];
  expect(without?.irIntensity).toBeNull();
  expect(without?.ramanActivity).toBeNull();
  expect(without?.involvement).toBeNull();
});

test('symmetrizeHessian averages the two triangles', () => {
  // column-major blocks: entry [column · size + row].
  const raw = new Float64Array([1, 2, 4, 3]);
  expect(symmetrizeHessian(raw, 2)).toStrictEqual(
    new Float64Array([1, 3, 3, 3]),
  );
});
