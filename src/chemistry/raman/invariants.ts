/** The three rotational invariants of a Raman transition tensor. */
export interface RamanInvariants {
  /** ᾱ′², the isotropic (mean polarizability) invariant. */
  meanSquared: number;
  /** γ′², the anisotropy invariant. */
  anisotropySquared: number;
  /**
   * δ′², the asymmetric anisotropy. It vanishes for a symmetric tensor, and
   * the static bond-polarizability tensor is symmetric by construction, so it
   * is always zero here. Computed anyway because it is part of ASE's
   * `Raman._invariants`, and a caller comparing against the Baiardi–Barone
   * convention (`δ = 5`) needs it.
   */
  asymmetricAnisotropySquared: number;
}

/**
 * Rotational invariants of a 3×3 Raman transition tensor, transcribed from
 * ASE's `Raman._invariants` (Long, *The Raman Effect*, ISBN 0-471-49028-8).
 * @param tensor - Row-major 3×3 tensor, 9 elements.
 * @returns The three invariants, in the square of the tensor's own unit.
 */
export function ramanInvariants(tensor: Float64Array): RamanInvariants {
  const xx = tensor[0] as number;
  const xy = tensor[1] as number;
  const xz = tensor[2] as number;
  const yx = tensor[3] as number;
  const yy = tensor[4] as number;
  const yz = tensor[5] as number;
  const zx = tensor[6] as number;
  const zy = tensor[7] as number;
  const zz = tensor[8] as number;

  const trace = xx + yy + zz;
  const meanSquared = (trace * trace) / 9;

  const antisymmetricXY = xy - yx;
  const antisymmetricXZ = xz - zx;
  const antisymmetricYZ = yz - zy;
  const asymmetricAnisotropySquared =
    (3 / 4) *
    (antisymmetricXY * antisymmetricXY +
      antisymmetricXZ * antisymmetricXZ +
      antisymmetricYZ * antisymmetricYZ);

  const symmetricXY = xy + yx;
  const symmetricXZ = xz + zx;
  const symmetricYZ = yz + zy;
  const differenceXXYY = xx - yy;
  const differenceXXZZ = xx - zz;
  const differenceYYZZ = yy - zz;
  const anisotropySquared =
    (3 / 4) *
      (symmetricXY * symmetricXY +
        symmetricXZ * symmetricXZ +
        symmetricYZ * symmetricYZ) +
    (differenceXXYY * differenceXXYY +
      differenceXXZZ * differenceXXZZ +
      differenceYYZZ * differenceYYZZ) /
      2;

  return { meanSquared, anisotropySquared, asymmetricAnisotropySquared };
}

/**
 * Raman scattering activity, ASE's `get_absolute_intensities(delta=0)`.
 * @param invariants - Invariants of the mode's transition tensor.
 * @returns `45·ᾱ′² + 7·γ′²`, in Å⁴/amu when the tensor is in Å²/√amu.
 */
export function ramanActivity(invariants: RamanInvariants): number {
  return 45 * invariants.meanSquared + 7 * invariants.anisotropySquared;
}

/**
 * Depolarization ratio at 90° scattering for **linearly polarized** incident
 * radiation, `ρ(π/2; ⊥ˢ, ∥ⁱ)` in Long's notation — the laser case, and the
 * quantity a polarized Raman measurement reports. Natural (unpolarized)
 * incident radiation obeys `6γ′²/(45ᾱ′² + 7γ′²)` instead, with an upper bound
 * of 6/7; that form is not computed here.
 * @param invariants - Invariants of the mode's transition tensor.
 * @returns `3γ′² / (45ᾱ′² + 4γ′²)` in [0, 0.75], and 0 for a silent mode whose
 * transition tensor vanishes entirely.
 */
export function depolarizationRatio(invariants: RamanInvariants): number {
  const denominator =
    45 * invariants.meanSquared + 4 * invariants.anisotropySquared;
  if (denominator === 0) return 0;
  return (3 * invariants.anisotropySquared) / denominator;
}
