import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CalculationSettings, Geometry } from '../../types/index.ts';
import { DEFAULT_SETTINGS } from '../../types/index.ts';

/**
 * The `tier1_hess_at_optimized_geometry` block of a native-xtb fixture,
 * renamed. The JSON keys are snake_case, so they are read with bracket access
 * in `readTier1` rather than becoming property names here.
 */
export interface Tier1Reference {
  totalEnergy: number;
  modeCount: number;
  imaginaryCount: number;
  frequencies: number[];
  irIntensities: number[];
  frobeniusNorm: number;
  trace: number;
}

/** The tier-1 protocol: the Hessian at the stored geometry, with no optimizer. */
export const GAS_PHASE_SETTINGS: CalculationSettings = {
  ...DEFAULT_SETTINGS,
  optimize: false,
};

/**
 * Read one of the native-xtb reference fixtures.
 * @param name - Fixture file name without the extension, e.g. `water`.
 * @returns The stored optimized geometry and its tier-1 reference block.
 */
export function loadFixture(name: string): {
  geometry: Geometry;
  reference: Tier1Reference;
} {
  const path = join(
    import.meta.dirname,
    '../../reference/fixtures',
    `${name}.json`,
  );
  const parsed = JSON.parse(
    new TextDecoder().decode(readFileSync(path)),
  ) as Record<string, Record<string, unknown>>;
  const atoms = (parsed.optimized_geometry_xyz as { atoms: FixtureAtom[] })
    .atoms;
  const coordinates = new Float64Array(atoms.length * 3);
  const elements: string[] = [];
  for (let atom = 0; atom < atoms.length; atom++) {
    const entry = atoms[atom] as FixtureAtom;
    elements.push(entry.symbol);
    coordinates[atom * 3] = entry.x;
    coordinates[atom * 3 + 1] = entry.y;
    coordinates[atom * 3 + 2] = entry.z;
  }
  return {
    geometry: { elements, coordinates },
    reference: readTier1(
      parsed.tier1_hess_at_optimized_geometry as Record<string, unknown>,
    ),
  };
}

/** One atom of a fixture's stored geometry. */
interface FixtureAtom {
  symbol: string;
  x: number;
  y: number;
  z: number;
}

/** Rename the fixture's snake_case keys into the shape the assertions use. */
function readTier1(block: Record<string, unknown>): Tier1Reference {
  const invariants = block.hessian_invariants as Record<string, number>;
  return {
    totalEnergy: block.total_energy_hartree as number,
    modeCount: block.n_vibrational_modes as number,
    imaginaryCount: block.n_imaginary as number,
    frequencies: block.frequencies as number[],
    irIntensities: block.ir_intensities as number[],
    frobeniusNorm: invariants.frobenius_norm as number,
    trace: invariants.trace as number,
  };
}
