/**
 * Resolve a case-insensitive element symbol to its canonical spelling.
 *
 * PDB files write element symbols upper-cased (`CL`, `FE`), and XYZ files
 * written by hand are inconsistent. Everything downstream — the engine, the
 * mass table, the viewer — expects the canonical form.
 * @param symbol - Element symbol in any casing, optionally padded.
 * @returns The canonical symbol, or `undefined` when it names no element.
 */
export function canonicalElement(symbol: string): string | undefined {
  const trimmed = symbol.trim();
  if (trimmed === '') return undefined;
  return BY_UPPERCASE.get(trimmed.toUpperCase());
}

/**
 * Every element symbol, indexed by atomic number minus one.
 * @returns The 118 canonical element symbols, hydrogen first.
 */
export function elementSymbols(): readonly string[] {
  return SYMBOLS;
}

/*
 * Kept as local data rather than read from openchemlib's `cAtomLabel`, because
 * `geometryFromPdb` is synchronous while openchemlib is loaded lazily to keep
 * ~1.5 MB off the initial page. A test pins this table against `cAtomLabel`.
 */
const SYMBOLS: readonly string[] = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca ' +
  'Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr ' +
  'Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd ' +
  'Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg ' +
  'Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm ' +
  'Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
).split(' ');

const BY_UPPERCASE = buildUppercaseIndex(SYMBOLS);

/**
 * Index the symbol table by its upper-cased form.
 * @param symbols - Canonical element symbols.
 * @returns A map from upper-cased symbol to canonical symbol.
 */
function buildUppercaseIndex(symbols: readonly string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const symbol of symbols) {
    index.set(symbol.toUpperCase(), symbol);
  }
  return index;
}
