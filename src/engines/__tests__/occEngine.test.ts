import { beforeAll, expect, test } from 'vitest';

import type { Geometry } from '../../types/index.ts';
import { DEFAULT_OUTPUTS } from '../../types/index.ts';
import { assembleModes } from '../occModes.ts';
import { loadOccModule } from '../occModule.ts';
import { runVibrational } from '../occRun.ts';
import { createHandleScope } from '../occScope.ts';
import { prepareSystem } from '../occSetup.ts';
import { STEP_BOHR, createSweepContext, sweepColumns } from '../occSweep.ts';
import { detectPointGroup } from '../occSymmetry.ts';
import type { OccModule } from '../occTypes.ts';
import { symmetrizeHessian } from '../occVibrations.ts';

import { GAS_PHASE_SETTINGS, loadFixture } from './fixtures.ts';

const methane: Geometry = {
  elements: ['C', 'H', 'H', 'H', 'H'],
  coordinates: new Float64Array([
    0, 0, 0, 0.629, 0.629, 0.629, -0.629, -0.629, 0.629, -0.629, 0.629, -0.629,
    0.629, -0.629, -0.629,
  ]),
};

const hydroxyl: Geometry = {
  elements: ['O', 'H'],
  coordinates: new Float64Array([0, 0, 0, 0, 0, 0.97]),
};

const methyl: Geometry = {
  elements: ['C', 'H', 'H', 'H'],
  coordinates: new Float64Array([
    0, 0, 0, 1.08, 0, 0, -0.54, 0.935, 0, -0.54, -0.935, 0,
  ]),
};

let module: OccModule;

beforeAll(async () => {
  module = await loadOccModule();
}, 120_000);

test('the fused sweep reproduces occ own Hessian to round-off', () => {
  const { geometry } = loadFixture('water');
  const size = geometry.elements.length * 3;
  const mine = symmetrizeHessian(sweptHessian(geometry, size), size);
  // Each calculator must be fresh: a sweep leaves the density at its last
  // displaced point, and occ's own `hessian` warm-starts from whatever it
  // finds, which is worth ~8e-6 on its own.
  const reference = occHessian(geometry, size);

  let largest = 0;
  for (let index = 0; index < mine.length; index++) {
    const difference = Math.abs(
      (reference[index] as number) - (mine[index] as number),
    );
    if (difference > largest) largest = difference;
  }
  // occ returns an already-symmetrized matrix; the raw sweep's two triangles
  // differ by ~1.3e-5 for water, so the comparison is of symmetrized values.
  expect(largest).toBeLessThan(1e-15);
}, 120_000);

test('every eigenvector is unit-norm mass-weighted', () => {
  const { geometry } = loadFixture('water');
  const raw = runVibrational(module, {
    geometry,
    settings: GAS_PHASE_SETTINGS,
    outputs: DEFAULT_OUTPUTS,
  });
  const modes = assembleModes({
    atoms: 3,
    masses: raw.masses,
    frequencies: raw.frequencies,
    normalModes: raw.normalModes,
    dipoleDerivatives: raw.dipoleDerivatives,
  });
  expect(modes).toHaveLength(3);
  for (const mode of modes) {
    let sum = 0;
    for (const value of mode.eigenvector) {
      sum += value * value;
    }
    expect(sum).toBeCloseTo(1, 12);
  }
  // The bend is the lowest mode; its reduced mass is just above 1 amu because
  // the two hydrogens carry almost all of the displacement.
  expect(modes[0]?.reducedMass).toBeCloseTo(1.0851, 3);
  // k = 4π²c²ν²μ: the O–H stretch force constants bracket the experimental
  // 8.45 mDyn/Å, which is what pins the force-constant conversion.
  expect(modes[1]?.forceConstant).toBeCloseTo(8.1568, 3);
  expect(modes[2]?.forceConstant).toBeCloseTo(8.5222, 3);
}, 120_000);

test('charge and unpaired electrons change the energy', () => {
  const neutral = energyOf(hydroxyl, { charge: 0, unpairedElectrons: 1 });
  const anion = energyOf(hydroxyl, { charge: -1, unpairedElectrons: 0 });
  // The closed-shell anion reproduces to the full 10 decimals.
  expect(anion).toBeCloseTo(-4.681_611_446_369_915, 10);
  // The OH· doublet is pinned one order looser: its open-shell SCF is only
  // reproducible to ~1.3e-8 Eh, an SCF landing on a marginally different fixed
  // point. That measurement sets the tolerance; it was not relaxed until the
  // test passed. CH3· and triplet O2 do not move at all.
  expect(neutral).toBeCloseTo(-4.443_205_6, 7);
  // 6.5 eV: binding the extra electron is worth far more than any SCF path
  // difference, which is the thing this test actually exists to prove.
  expect(Math.abs(anion - neutral)).toBeGreaterThan(0.2);
}, 120_000);

test('a five-atom XY4 is corrected from occ D2 to Td', () => {
  const group = pointGroupOf(methane);
  expect(group.symmetryNumber).toBe(12);
  expect(group.label).toBe('Td');
  expect(group.warnings).toHaveLength(1);
  expect(group.warnings[0]).toContain('σ = 4');

  // Water must be left alone: it is a three-atom molecule, not an XY4.
  const water = pointGroupOf(loadFixture('water').geometry);
  expect(water.symmetryNumber).toBe(2);
  expect(water.label).toBe('C2v');
  expect(water.warnings).toStrictEqual([]);
}, 120_000);

test('an open-shell radical runs spin-unrestricted and says so', () => {
  const raw = runVibrational(module, {
    geometry: methyl,
    settings: { ...GAS_PHASE_SETTINGS, optimize: true, unpairedElectrons: 1 },
    outputs: DEFAULT_OUTPUTS,
  });
  expect(raw.isUnrestricted).toBe(true);
  // The GFN2 spin-polarization term is what makes it an open-shell answer
  // rather than a restricted one relabelled.
  expect(raw.spinEnergy).toBeLessThan(-0.01);
  expect(raw.warnings.some((warning) => warning.includes('Open-shell'))).toBe(
    true,
  );
  const modes = assembleModes({
    atoms: 4,
    masses: raw.masses,
    frequencies: raw.frequencies,
    normalModes: raw.normalModes,
    dipoleDerivatives: raw.dipoleDerivatives,
  });
  expect(modes).toHaveLength(6);
  expect(raw.pointGroup.label).toBe('D3h');
  expect(raw.pointGroup.symmetryNumber).toBe(6);
}, 300_000);

test('a parity mismatch fails with occ own message, not silently', () => {
  const { geometry } = loadFixture('water');
  expect(() =>
    runVibrational(module, {
      geometry,
      settings: { ...GAS_PHASE_SETTINGS, unpairedElectrons: 1 },
      outputs: DEFAULT_OUTPUTS,
    }),
  ).toThrow(/parity/);
}, 120_000);

/** The raw column-major Hessian of one fused sweep, on a fresh calculator. */
function sweptHessian(geometry: Geometry, size: number): Float64Array {
  const scope = createHandleScope();
  try {
    const system = prepareSystem(module, geometry, GAS_PHASE_SETTINGS, scope);
    const columns = new Int32Array(size);
    for (let column = 0; column < size; column++) columns[column] = column;
    const output = {
      hessian: new Float64Array(size * size),
      dipole: null as Float64Array | null,
    };
    sweepColumns(
      createSweepContext(
        module,
        system.molecule,
        system.calculator,
        false,
        scope,
      ),
      columns,
      output,
    );
    return output.hessian;
  } finally {
    scope.release();
  }
}

/** occ's own `XtbCalculator.hessian`, row-major, on a fresh calculator. */
function occHessian(geometry: Geometry, size: number): Float64Array {
  const scope = createHandleScope();
  try {
    const system = prepareSystem(module, geometry, GAS_PHASE_SETTINGS, scope);
    const matrix = scope.keep(system.calculator.hessian(STEP_BOHR));
    const out = new Float64Array(size * size);
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        out[row * size + column] = matrix.get(row, column);
      }
    }
    return out;
  } finally {
    scope.release();
  }
}

/** The detected point group of a geometry. */
function pointGroupOf(geometry: Geometry) {
  const scope = createHandleScope();
  try {
    const system = prepareSystem(module, geometry, GAS_PHASE_SETTINGS, scope);
    return detectPointGroup(
      module,
      system.molecule,
      geometry.elements,
      system.coordinates,
    );
  } finally {
    scope.release();
  }
}

/** The total energy of a geometry at a given charge and spin. */
function energyOf(
  geometry: Geometry,
  overrides: { charge: number; unpairedElectrons: number },
): number {
  const scope = createHandleScope();
  try {
    return prepareSystem(
      module,
      geometry,
      { ...GAS_PHASE_SETTINGS, ...overrides },
      scope,
    ).energy.total;
  } finally {
    scope.release();
  }
}
