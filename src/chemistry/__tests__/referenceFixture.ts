/**
 * Reader for the native-xtb reference fixtures under
 * `src/reference/fixtures`.
 *
 * The JSON keys are snake_case and untyped, so they are read once here through
 * checked accessors and handed on as a camelCase record. Each fixture carries
 * two frequency sets and they are not interchangeable: the top-level
 * `vibrations` block comes from `--ohess`, which relaxed the geometry a little
 * further before its Hessian, and is the one the `energies_hartree` enthalpy and
 * free energy belong to. The `tier1_hess_at_optimized_geometry` block is a
 * `--hess` run at exactly the stored coordinates, and is the one its own
 * zero-point energy belongs to.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Geometry } from '../../types/index.ts';

/** Standard atomic weights as occ's `Molecule.atomicMasses()` reports them. */
const MASS: Record<string, number> = {
  H: 1.0079400539,
  C: 12.0107002258,
  N: 14.0066995621,
  O: 15.9994001389,
};

/** One reference fixture, in the shape the thermochemistry block consumes. */
export interface ReferenceFixture {
  geometry: Geometry;
  masses: Float64Array;
  /** `--ohess` wavenumbers in cm⁻¹, matching the energies below. */
  wavenumbers: number[];
  electronicEnergy: number;
  totalEnthalpy: number;
  totalFreeEnergy: number;
  gibbsCorrection: number;
  gibbsWithoutZeroPoint: number;
  /** `--hess` wavenumbers at exactly the stored coordinates, cm⁻¹. */
  tierOneWavenumbers: number[];
  tierOneElectronicEnergy: number;
  tierOneZeroPointEnergy: number;
}

/**
 * Read and normalize one reference fixture.
 * @param name - Fixture base name, without the extension.
 * @returns The fixture's geometry, masses, frequencies and reference energies.
 */
export function readReferenceFixture(name: string): ReferenceFixture {
  const path = join(
    import.meta.dirname,
    '../../reference/fixtures',
    `${name}.json`,
  );
  const root = asRecord(
    JSON.parse(new TextDecoder().decode(readFileSync(path))),
    name,
  );
  const energies = childRecord(root, 'energies_hartree');
  const tierOne = childRecord(root, 'tier1_hess_at_optimized_geometry');

  return {
    ...readGeometry(childRecord(root, 'optimized_geometry_xyz')),
    wavenumbers: numberList(childRecord(root, 'vibrations'), 'frequencies'),
    electronicEnergy: numberAt(energies, 'total_energy'),
    totalEnthalpy: numberAt(energies, 'total_enthalpy'),
    totalFreeEnergy: numberAt(energies, 'total_free_energy'),
    gibbsCorrection: numberAt(energies, 'g_rrho_contribution'),
    gibbsWithoutZeroPoint: numberAt(energies, 'g_rrho_without_zpve'),
    tierOneWavenumbers: numberList(tierOne, 'frequencies'),
    tierOneElectronicEnergy: numberAt(tierOne, 'total_energy_hartree'),
    tierOneZeroPointEnergy: numberAt(tierOne, 'zero_point_energy_hartree'),
  };
}

/**
 * Turn a fixture's XYZ block into a geometry and a matching mass vector.
 * @param block - The `optimized_geometry_xyz` record.
 * @returns The geometry and the masses.
 */
function readGeometry(block: Record<string, unknown>): {
  geometry: Geometry;
  masses: Float64Array;
} {
  const atoms = block.atoms;
  if (!Array.isArray(atoms)) {
    throw new TypeError('the fixture geometry has no atom list');
  }
  const elements: string[] = [];
  const coordinates = new Float64Array(3 * atoms.length);
  const masses = new Float64Array(atoms.length);
  for (let atom = 0; atom < atoms.length; atom++) {
    const record = asRecord(atoms[atom], `atom ${atom}`);
    const symbol = record.symbol;
    if (typeof symbol !== 'string' || !(symbol in MASS)) {
      throw new TypeError(`unsupported element ${String(symbol)}`);
    }
    elements.push(symbol);
    masses[atom] = MASS[symbol] as number;
    coordinates[3 * atom] = numberAt(record, 'x');
    coordinates[3 * atom + 1] = numberAt(record, 'y');
    coordinates[3 * atom + 2] = numberAt(record, 'z');
  }
  return { geometry: { elements, coordinates }, masses };
}

/**
 * Narrow an unknown value to a plain record.
 * @param value - The value to narrow.
 * @param label - What the value was supposed to be, for the error message.
 * @returns The value as a record.
 */
function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Read a nested record.
 * @param record - The parent record.
 * @param key - The key to read.
 * @returns The nested record.
 */
function childRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return asRecord(record[key], key);
}

/**
 * Read a number.
 * @param record - The record to read from.
 * @param key - The key to read.
 * @returns The number.
 */
function numberAt(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number') {
    throw new TypeError(`${key} is not a number`);
  }
  return value;
}

/**
 * Read an array of numbers.
 * @param record - The record to read from.
 * @param key - The key to read.
 * @returns The numbers.
 */
function numberList(record: Record<string, unknown>, key: string): number[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new TypeError(`${key} is not an array`);
  }
  for (let index = 0; index < value.length; index++) {
    if (typeof value[index] !== 'number') {
      throw new TypeError(`${key}[${index}] is not a number`);
    }
  }
  return value as number[];
}
