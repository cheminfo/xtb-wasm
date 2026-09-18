import { expect, test } from 'vitest';

import { symmetricEigenvalues3 } from '../eigen3.ts';

test('a diagonal matrix returns its diagonal, sorted', () => {
  const eigenvalues = symmetricEigenvalues3({
    xx: 4,
    yy: 1,
    zz: 9,
    xy: 0,
    xz: 0,
    yz: 0,
  });
  expect(Array.from(eigenvalues)).toStrictEqual([1, 4, 9]);
});

test('the doubly degenerate matrix [[2,1,1],[1,2,1],[1,1,2]] gives 1, 1, 4', () => {
  const eigenvalues = symmetricEigenvalues3({
    xx: 2,
    yy: 2,
    zz: 2,
    xy: 1,
    xz: 1,
    yz: 1,
  });
  expect(eigenvalues[0]).toBeCloseTo(1, 12);
  expect(eigenvalues[1]).toBeCloseTo(1, 12);
  expect(eigenvalues[2]).toBeCloseTo(4, 12);
});

test('a 2x2 block plus an isolated axis gives -1, 3, 5', () => {
  const eigenvalues = symmetricEigenvalues3({
    xx: 1,
    yy: 1,
    zz: 5,
    xy: 2,
    xz: 0,
    yz: 0,
  });
  expect(eigenvalues[0]).toBeCloseTo(-1, 12);
  expect(eigenvalues[1]).toBeCloseTo(3, 12);
  expect(eigenvalues[2]).toBeCloseTo(5, 12);
});

test('the trace and the determinant are preserved', () => {
  const matrix = { xx: 7.5, yy: -2.25, zz: 3.125, xy: 1.5, xz: -0.75, yz: 2.5 };
  const eigenvalues = symmetricEigenvalues3(matrix);
  const trace = matrix.xx + matrix.yy + matrix.zz;
  const determinant =
    matrix.xx * (matrix.yy * matrix.zz - matrix.yz * matrix.yz) -
    matrix.xy * (matrix.xy * matrix.zz - matrix.yz * matrix.xz) +
    matrix.xz * (matrix.xy * matrix.yz - matrix.yy * matrix.xz);
  const sum =
    (eigenvalues[0] as number) +
    (eigenvalues[1] as number) +
    (eigenvalues[2] as number);
  const product =
    (eigenvalues[0] as number) *
    (eigenvalues[1] as number) *
    (eigenvalues[2] as number);
  expect(sum).toBeCloseTo(trace, 12);
  expect(product).toBeCloseTo(determinant, 11);
});

test('a triply degenerate matrix returns the same eigenvalue three times', () => {
  const eigenvalues = symmetricEigenvalues3({
    xx: 3,
    yy: 3,
    zz: 3,
    xy: 0,
    xz: 0,
    yz: 0,
  });
  expect(Array.from(eigenvalues)).toStrictEqual([3, 3, 3]);
});
