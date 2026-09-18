/**
 * Squared length of a bond vector.
 *
 * Every caller takes `Math.sqrt` of this rather than `Math.hypot`, for two
 * reasons: `Math.hypot`'s overflow-safe scaling costs several times more per
 * bond in a loop that runs `6·atoms` times per finite-difference sweep, and it
 * does not round the same way as the `sqrt` of a dot product, which is what
 * ASE's `np.linalg.norm` computes and what these numbers are compared against.
 * @param x - First component in Å.
 * @param y - Second component in Å.
 * @param z - Third component in Å.
 * @returns `x² + y² + z²` in Å².
 */
export function squaredLength(x: number, y: number, z: number): number {
  return x * x + y * y + z * z;
}

/**
 * Rejects a bond list whose atom indices cannot address the geometry.
 *
 * An out-of-range index reads past the coordinate array, and the model then
 * propagates `NaN` through the tensor into the activity of every mode without
 * any other symptom. The classic source is a molfile bond block, whose atom
 * numbers are 1-based: passing them through unshifted addresses one atom past
 * the end; it is caught here rather than surfacing as a blank spectrum.
 * @param bonds - Atom-index pairs.
 * @param atomCount - Number of atoms the geometry holds.
 * @throws When an index is not an integer in `[0, atomCount)`, naming the pair.
 */
export function validateBondIndices(
  bonds: ReadonlyArray<readonly [number, number]>,
  atomCount: number,
): void {
  for (const pair of bonds) {
    const first = pair[0];
    const second = pair[1];
    if (!inRange(first, atomCount) || !inRange(second, atomCount)) {
      throw new Error(
        `the bond [${first}, ${second}] is outside the ${atomCount} atoms of the geometry`,
      );
    }
  }
}

function inRange(index: number, atomCount: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < atomCount;
}
