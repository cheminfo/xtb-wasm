/**
 * Lippincott–Stutman bond-polarizability parameters, taken from the
 * `polarizability` branch of kjappelbaum/ase (commit 8232a3d7d7), which
 * extends the table to 36 elements including the halogens. Upstream ASE still
 * ships only the ten elements of the original paper, which is why the table
 * lives here instead of in a dependency.
 *
 * Sources: Lippincott and Stutman, J. Phys. Chem. 68 (1964) 2926–2940,
 * DOI 10.1021/j100792a033; Marinov and Zotov, Phys. Rev. B 55 (1997)
 * 2938–2944, DOI 10.1103/PhysRevB.55.2938.
 */

/** Atomic polarizability α in Å³, keyed by element symbol. 37 elements. */
export const ATOMIC_POLARIZABILITY: Readonly<Record<string, number>> = {
  H: 0.592,
  Li: 6.993,
  Be: 3.802,
  B: 1.358,
  C: 0.978,
  N: 0.743,
  O: 0.592,
  F: 0.49,
  Na: 12.884,
  Mg: 8.37,
  Al: 3.918,
  Si: 2.988,
  P: 2.367,
  S: 1.82,
  Cl: 1.388,
  K: 21.593,
  Ca: 15.4756,
  Ga: 5.635,
  Ge: 3.848,
  As: 3.302,
  Se: 2.524,
  Br: 1.941,
  Kr: 5.256,
  Rb: 25.239,
  Sr: 18.242,
  In: 7.867,
  Sn: 5.256,
  Sb: 4.864,
  Te: 3.802,
  I: 2.972,
  Cs: 35.717,
  Ba: 24.584,
  Tl: 17.118,
  Pb: 13.609,
  Bi: 12.175,
  Po: 9.334,
  At: 7.928,
};

/**
 * Reduced electronegativity (Lippincott and Stutman, Table I), dimensionless.
 * 36 elements: Kr has an atomic polarizability but no reduced
 * electronegativity, so krypton is outside the model in the fork too.
 */
export const REDUCED_ELECTRONEGATIVITY: Readonly<Record<string, number>> = {
  H: 1,
  Li: 0.439,
  Be: 0.538,
  B: 0.758,
  C: 0.846,
  N: 0.927,
  O: 1,
  F: 1.056,
  Na: 0.358,
  Mg: 0.414,
  Al: 0.533,
  Si: 0.583,
  P: 0.63,
  S: 0.688,
  Cl: 0.753,
  K: 0.302,
  Ca: 0.337,
  Ga: 0.472,
  Ge: 0.536,
  As: 0.564,
  Se: 0.617,
  Br: 0.633,
  Rb: 0.286,
  Sr: 0.319,
  In: 0.422,
  Sn: 0.483,
  Sb: 0.496,
  Te: 0.538,
  I: 0.584,
  Cs: 0.255,
  Ba: 0.289,
  Tl: 0.326,
  Pb: 0.352,
  Bi: 0.365,
  Po: 0.399,
  At: 0.421,
};

const supported: string[] = [];
for (const element of Object.keys(ATOMIC_POLARIZABILITY)) {
  if (element in REDUCED_ELECTRONEGATIVITY) supported.push(element);
}

/**
 * Elements the model can treat: the intersection of the two tables, computed
 * rather than transcribed so it can never drift out of step with them.
 */
export const SUPPORTED_ELEMENTS: readonly string[] = supported;
