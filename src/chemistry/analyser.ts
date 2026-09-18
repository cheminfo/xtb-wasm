import type { VibrationalAnalyser } from '../engines/occAnalyse.ts';
import { setVibrationalAnalyser } from '../engines/occAnalyse.ts';

import { ramanActivities } from './raman/index.ts';
import { thermochemistry } from './thermochemistry.ts';

/**
 * Bind the pure-JavaScript analyses to the engine.
 *
 * The engine deliberately does not import `src/chemistry`, so that the worker
 * bundle carries only the wasm driver. Without this call a run still succeeds
 * but reports no Raman activities and no thermochemistry, and says so in its
 * warnings — which is exactly what happened before it existed, so call it once
 * at startup and never conditionally.
 */
export function installVibrationalAnalyser(): void {
  setVibrationalAnalyser(ANALYSER);
}

const ANALYSER: VibrationalAnalyser = {
  ramanActivities: (geometry, modes, masses, molecule) => {
    // Real connectivity is the default: ASE's d < 1.5·(rᵢ+rⱼ) rule invents
    // bonds — all six Cl···Cl pairs of CCl₄ count as bonds, which is why its
    // mean polarizability comes out ~8x too large — and rebuilding the list at
    // every displaced geometry makes the polarizability jump discontinuously
    // whenever a pair sits within the step of the threshold. A molecule read
    // from a bare geometry (XYZ, PDB) carries no bonds, and then that rule is
    // the only one left.
    const bonds = molecule?.bonds;
    const activities = ramanActivities(geometry, modes, masses, {
      bonds,
      connectivity: bonds === undefined ? 'ase-legacy' : 'graph',
    });
    const out = new Array<{
      ramanActivity: number;
      depolarizationRatio: number;
    }>(activities.length);
    for (let index = 0; index < activities.length; index++) {
      const entry = activities[index] as (typeof activities)[number];
      out[index] = {
        ramanActivity: entry.activity,
        depolarizationRatio: entry.depolarizationRatio,
      };
    }
    return out;
  },

  thermochemistry: (input) =>
    thermochemistry({
      geometry: input.geometry,
      masses: input.masses,
      wavenumbers: input.wavenumbers,
      electronicEnergy: input.electronicEnergy,
      temperature: input.temperature,
      pressure: input.pressure,
      symmetry: {
        pointGroup: input.pointGroup,
        symmetryNumber: input.symmetryNumber,
      },
    }),

  // `involvements` is deliberately left out: deriving it needs the depiction's
  // bond table, which belongs to whatever renders the structure. The same
  // answer falls out of `cartesianDisplacement` at the point of use, so filling
  // the field here would only duplicate it in the stored result.
};
