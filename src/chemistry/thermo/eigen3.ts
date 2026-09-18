/**
 * Eigenvalues of a symmetric 3×3 matrix in closed form.
 *
 * An inertia tensor is always 3×3, and its degenerate cases have to be
 * resolved deliberately rather than approximately: a vanishing principal
 * moment is what marks a linear rotor, and xtb decides on it with a hard
 * threshold. The analytic solution returns those exactly, allocates only the
 * result, and needs no linear-algebra dependency.
 */

/** A symmetric 3×3 matrix, given by its six independent elements. */
export interface SymmetricMatrix3 {
  xx: number;
  yy: number;
  zz: number;
  xy: number;
  xz: number;
  yz: number;
}

/**
 * Eigenvalues of a symmetric 3×3 matrix.
 * @param matrix - The matrix, by its six independent elements.
 * @returns The three eigenvalues in ascending order.
 */
export function symmetricEigenvalues3(matrix: SymmetricMatrix3): Float64Array {
  const { xx, yy, zz, xy, xz, yz } = matrix;

  const offDiagonal = xy * xy + xz * xz + yz * yz;
  if (offDiagonal === 0) return ascending(xx, yy, zz);

  const mean = (xx + yy + zz) / 3;
  const dxx = xx - mean;
  const dyy = yy - mean;
  const dzz = zz - mean;
  const spread = Math.sqrt(
    (dxx * dxx + dyy * dyy + dzz * dzz + 2 * offDiagonal) / 6,
  );

  const b11 = dxx / spread;
  const b22 = dyy / spread;
  const b33 = dzz / spread;
  const b12 = xy / spread;
  const b13 = xz / spread;
  const b23 = yz / spread;
  const determinant =
    b11 * (b22 * b33 - b23 * b23) -
    b12 * (b12 * b33 - b23 * b13) +
    b13 * (b12 * b23 - b22 * b13);

  // Rounding can push the argument of acos outside [-1, 1] for a matrix that
  // is degenerate to machine precision, which is exactly the case this module
  // has to survive.
  let cosine = determinant / 2;
  if (cosine < -1) cosine = -1;
  if (cosine > 1) cosine = 1;

  const angle = Math.acos(cosine) / 3;
  const first = mean + 2 * spread * Math.cos(angle);
  const third = mean + 2 * spread * Math.cos(angle + (2 * Math.PI) / 3);
  return ascending(first, 3 * mean - first - third, third);
}

/**
 * Three numbers in ascending order.
 * @param a - First value.
 * @param b - Second value.
 * @param c - Third value.
 * @returns A new array holding the three values, ascending.
 */
function ascending(a: number, b: number, c: number): Float64Array {
  let low = a;
  let middle = b;
  let high = c;
  if (low > middle) [low, middle] = [middle, low];
  if (middle > high) [middle, high] = [high, middle];
  if (low > middle) [low, middle] = [middle, low];
  return Float64Array.of(low, middle, high);
}
