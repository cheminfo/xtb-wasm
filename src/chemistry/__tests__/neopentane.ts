/**
 * Neopentane's geometry, built rather than transcribed.
 *
 * The molecule is only used to check that the XY₄ symmetry guard stays away
 * from larger spherical tops, so ideal bond lengths and a perfect tetrahedral
 * frame are exactly what is wanted.
 */

import type { Geometry } from '../../types/index.ts';

/**
 * Place four methyl groups on a central carbon at ideal tetrahedral angles.
 * @param carbonMass - Mass of carbon in amu.
 * @param hydrogenMass - Mass of hydrogen in amu.
 * @returns Neopentane's geometry and the matching mass vector.
 */
export function buildNeopentane(
  carbonMass: number,
  hydrogenMass: number,
): { geometry: Geometry; masses: Float64Array } {
  const carbonCarbon = 1.535;
  const carbonHydrogen = 1.094;
  const tilt = Math.PI - (109.5 * Math.PI) / 180;
  const axes = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ];
  const elements = ['C'];
  const positions = [0, 0, 0];
  for (const seed of axes) {
    const axis = normalized(seed);
    const [first, second] = perpendicularPair(axis);
    const centre: number[] = [];
    for (let component = 0; component < 3; component++) {
      centre.push((axis[component] as number) * carbonCarbon);
    }
    elements.push('C');
    positions.push(...centre);
    for (let hydrogen = 0; hydrogen < 3; hydrogen++) {
      const phase = (2 * Math.PI * hydrogen) / 3;
      for (let component = 0; component < 3; component++) {
        const axisComponent =
          Math.cos(tilt) * (axis[component] as number) +
          Math.sin(tilt) *
            (Math.cos(phase) * (first[component] as number) +
              Math.sin(phase) * (second[component] as number));
        positions.push(
          (centre[component] as number) + carbonHydrogen * axisComponent,
        );
      }
      elements.push('H');
    }
  }
  const masses = new Float64Array(elements.length);
  for (let atom = 0; atom < masses.length; atom++) {
    masses[atom] = elements[atom] === 'C' ? carbonMass : hydrogenMass;
  }
  return {
    geometry: { elements, coordinates: Float64Array.from(positions) },
    masses,
  };
}

/**
 * Scale a vector to unit length.
 * @param vector - Any non-zero three-vector.
 * @returns A new unit vector.
 */
function normalized(vector: number[]): number[] {
  const length = Math.hypot(
    vector[0] as number,
    vector[1] as number,
    vector[2] as number,
  );
  return [
    (vector[0] as number) / length,
    (vector[1] as number) / length,
    (vector[2] as number) / length,
  ];
}

/**
 * Two unit vectors that complete an orthonormal frame with the given axis.
 * @param axis - A unit three-vector.
 * @returns The two remaining frame vectors.
 */
function perpendicularPair(axis: number[]): [number[], number[]] {
  const seed = Math.abs(axis[0] as number) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const first = normalized(cross(axis, seed));
  return [first, cross(axis, first)];
}

/**
 * Cross product of two three-vectors.
 * @param a - First vector.
 * @param b - Second vector.
 * @returns A new three-vector.
 */
function cross(a: number[], b: number[]): number[] {
  return [
    (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
    (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
    (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
  ];
}
