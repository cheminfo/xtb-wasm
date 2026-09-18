import type { HandleScope } from './occScope.ts';
import { withHandleScope } from './occScope.ts';
import type { OccMat3N, OccModule, OccMolecule } from './occTypes.ts';

/**
 * Build an occ molecule from atomic numbers and Angstrom coordinates, centred
 * on its centre of mass. Going through the `Molecule(IVec, Mat3N)` constructor
 * rather than an XYZ string keeps every coordinate bit-exact: an XYZ round trip
 * at six decimals is a 1e-6 Å perturbation, which is worth ~0.04 cm⁻¹ on the
 * frequencies and ~1 % on the IR intensities.
 * @param module - The loaded occjs module.
 * @param atomicNumbers - One atomic number per atom.
 * @param coordinates - Flat `x,y,z` per atom, in Angstrom.
 * @param scope - Scope that owns the intermediate handles.
 * @returns The centred molecule, registered in `scope`.
 */
export function buildMolecule(
  module: OccModule,
  atomicNumbers: Int32Array,
  coordinates: Float64Array,
  scope: HandleScope,
): OccMolecule {
  const atoms = atomicNumbers.length;
  const numbers = new Array<number>(atoms);
  for (let atom = 0; atom < atoms; atom++) {
    numbers[atom] = atomicNumbers[atom] as number;
  }
  const positions = scope.keep(module.Mat3N.create(atoms));
  for (let atom = 0; atom < atoms; atom++) {
    for (let axis = 0; axis < 3; axis++) {
      positions.set(axis, atom, coordinates[atom * 3 + axis] as number);
    }
  }
  const raw = scope.keep(
    new module.Molecule(scope.keep(module.IVec.fromArray(numbers)), positions),
  );
  return scope.keep(raw.centered(module.Origin.CENTEROFMASS));
}

/**
 * Resolve element symbols to atomic numbers with occ's own periodic table, so
 * an unknown symbol fails here rather than deep inside the SCC.
 * @param module - The loaded occjs module.
 * @param elements - Element symbols, one per atom.
 * @returns One atomic number per atom.
 */
export function atomicNumbersOf(
  module: OccModule,
  elements: readonly string[],
): Int32Array {
  const lines = new Array<string>(elements.length + 2);
  lines[0] = String(elements.length);
  lines[1] = '';
  for (let atom = 0; atom < elements.length; atom++) {
    // The coordinates are irrelevant here, but two atoms on top of each other
    // make a degenerate molecule, so they are spread along x.
    lines[atom + 2] = `${elements[atom]} ${atom * 2} 0 0`;
  }
  return withHandleScope((scope) => {
    const molecule = scope.keep(
      module.Molecule.fromXyzString(lines.join('\n')),
    );
    if (molecule.size() !== elements.length) {
      throw new Error(
        `occ read ${molecule.size()} of ${elements.length} atoms; check the element symbols`,
      );
    }
    const numbers = scope.keep(molecule.atomicNumbers());
    const out = new Int32Array(elements.length);
    for (let atom = 0; atom < out.length; atom++) {
      out[atom] = numbers.get(atom);
    }
    return out;
  });
}

/**
 * Read a 3 × N coordinate matrix into a flat `x0,y0,z0,x1,…` array.
 * @param matrix - The matrix to read.
 * @param atoms - Number of columns to read.
 * @returns A new flat array of `3 · atoms` values.
 */
export function readCoordinates(matrix: OccMat3N, atoms: number): Float64Array {
  const out = new Float64Array(atoms * 3);
  for (let atom = 0; atom < atoms; atom++) {
    for (let axis = 0; axis < 3; axis++) {
      out[atom * 3 + axis] = matrix.get(axis, atom);
    }
  }
  return out;
}
