import { expect, test } from 'vitest';

import { ramanActivities } from '../index.ts';
import { placzekActivities } from '../placzek.ts';

import {
  agreement,
  aseReference,
  caseGeometry,
  caseModes,
} from './aseReference.ts';

/** The one reference case ASE's own neighbour-list flicker corrupts. */
const FLICKERING = 'CH3COCH3/emt-relaxed';

test('the reference modes satisfy the mass-weighted normalization the API documents', () => {
  for (const testCase of aseReference().intensityCases) {
    const modes = caseModes(testCase);
    expect(modes).toHaveLength(testCase.masses.length * 3);
    for (const mode of modes) {
      let norm = 0;
      for (const value of mode.eigenvector) {
        norm += value * value;
      }
      expect(norm).toBeCloseTo(1, 12);
    }
  }
});

test('legacy finite difference reproduces ASE get_absolute_intensities to 1e-8', () => {
  const cases = aseReference().intensityCases;
  expect(cases).toHaveLength(8);
  for (const testCase of cases) {
    const activities = ramanActivities(
      caseGeometry(testCase),
      caseModes(testCase),
      new Float64Array(testCase.masses),
      {
        connectivity: 'ase-legacy',
        derivative: 'finite-difference',
        step: testCase.delta,
      },
    );
    const computed = new Float64Array(activities.length);
    for (let mode = 0; mode < activities.length; mode++) {
      computed[mode] = (activities[mode] as { activity: number }).activity;
    }
    const measured = agreement(testCase.activitiesA4PerAmu, computed);
    expect(measured.relative).toBeLessThan(1e-8);
    expect(measured.maxNormalized).toBeLessThan(1e-11);
  }
});

test('the analytic path reproduces ASE to 3e-4 max-normalized where ASE is sound', () => {
  for (const testCase of aseReference().intensityCases) {
    if (testCase.name === FLICKERING) continue;
    const activities = ramanActivities(
      caseGeometry(testCase),
      caseModes(testCase),
      new Float64Array(testCase.masses),
      { connectivity: 'ase-legacy' },
    );
    const computed = new Float64Array(activities.length);
    for (let mode = 0; mode < activities.length; mode++) {
      computed[mode] = (activities[mode] as { activity: number }).activity;
    }
    const measured = agreement(testCase.activitiesA4PerAmu, computed);
    expect(measured.maxNormalized).toBeLessThan(3e-4);
  }
});

test('the rebuilt list reports a 1.6e5 A^4/amu band where the frozen list gives 2.7e3', () => {
  const testCase = aseReference().intensityCases.find(
    (entry) => entry.name === FLICKERING,
  );
  if (testCase === undefined) throw new Error('the acetone case is missing');
  const geometry = caseGeometry(testCase);
  const modes = caseModes(testCase);
  const masses = new Float64Array(testCase.masses);

  let asePeak = 0;
  for (const value of testCase.activitiesA4PerAmu) {
    if (value > asePeak) asePeak = value;
  }
  const analytic = ramanActivities(geometry, modes, masses, {
    connectivity: 'ase-legacy',
  });
  let analyticPeak = 0;
  for (const entry of analytic) {
    if (entry.activity > analyticPeak) analyticPeak = entry.activity;
  }
  expect(asePeak).toBeCloseTo(159_548.34066, 4);
  expect(analyticPeak).toBeCloseTo(2672.40502_031, 8);
});

test("CO2's symmetric stretch has a depolarization ratio of exactly 1/3", () => {
  const testCase = aseReference().intensityCases.find(
    (entry) => entry.name === 'CO2/g2',
  );
  if (testCase === undefined) throw new Error('the CO2 case is missing');
  const activities = ramanActivities(
    caseGeometry(testCase),
    caseModes(testCase),
    new Float64Array(testCase.masses),
    { connectivity: 'ase-legacy' },
  );

  // alpha_perp carries no length, so dalpha/dQ of the symmetric stretch is
  // c*zz^T: 45*alphaBar'^2 = 5c^2, 7*gamma'^2 = 7c^2, rho = 3c^2/(5c^2+4c^2).
  // The model therefore cannot produce a strongly polarized symmetric stretch,
  // where experiment puts CO2's 1388 cm^-1 band near rho = 0.
  const stretch = activities[7];
  if (stretch === undefined) throw new Error('mode 7 is missing');
  expect(stretch.activity).toBeCloseTo(12.01660_71314, 9);
  expect(stretch.depolarizationRatio).toBeCloseTo(0.333_333_333_3, 9);
});

test('a silent mode reports a zero activity and a zero ratio instead of NaN', () => {
  const masses = new Float64Array([15.999, 1.008, 1.008]);
  const gradient = new Float64Array(9 * 9);
  const eigenvector = new Float64Array(9);
  eigenvector[0] = 1;
  const activities = placzekActivities(gradient, [{ eigenvector }], masses);
  expect(activities).toStrictEqual([{ activity: 0, depolarizationRatio: 0 }]);
});

test('graph connectivity is the default and needs a bond list', () => {
  const testCase = aseReference().intensityCases[0];
  if (testCase === undefined) throw new Error('the reference file is empty');
  const geometry = caseGeometry(testCase);
  const modes = caseModes(testCase);
  const masses = new Float64Array(testCase.masses);

  expect(() => ramanActivities(geometry, modes, masses)).toThrow(
    "'graph' connectivity requires a bond list",
  );
  const graph = ramanActivities(geometry, modes, masses, {
    bonds: [
      [0, 1],
      [0, 2],
    ],
  });
  const legacy = ramanActivities(geometry, modes, masses, {
    connectivity: 'ase-legacy',
  });
  // Water's two rules agree, so the two paths must give identical numbers.
  expect(graph).toStrictEqual(legacy);
});

test('the graph and legacy paths diverge exactly where the invented bonds move', () => {
  const geometry = {
    elements: ['C', 'Cl', 'Cl', 'Cl', 'Cl'],
    coordinates: new Float64Array([
      0, 0, 0, 1.0196, 1.0196, 1.0196, 1.0196, -1.0196, -1.0196, -1.0196,
      1.0196, -1.0196, -1.0196, -1.0196, 1.0196,
    ]),
  };
  const masses = new Float64Array([12.011, 35.453, 35.453, 35.453, 35.453]);
  const graphBonds: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ];
  const activityOf = (
    coordinate: number,
    connectivity: 'graph' | 'ase-legacy',
  ) => {
    const eigenvector = new Float64Array(15);
    eigenvector[coordinate] = 1;
    const result = ramanActivities(geometry, [{ eigenvector }], masses, {
      connectivity,
      bonds: graphBonds,
    });
    const first = result[0];
    if (first === undefined) throw new Error('no activity was returned');
    return first.activity;
  };

  // The six Cl...Cl contacts the legacy rule invents do not touch the carbon,
  // so a mode that only moves the carbon cannot tell the two rules apart.
  expect(activityOf(0, 'graph')).toBeCloseTo(30.86759_79834, 8);
  expect(activityOf(0, 'ase-legacy')).toBe(activityOf(0, 'graph'));

  // Move one chlorine and the invented bonds dominate: 122 times the activity.
  expect(activityOf(3, 'graph')).toBeCloseTo(8.54745_94146, 8);
  expect(activityOf(3, 'ase-legacy')).toBeCloseTo(1041.14717_51026, 7);
});

test('an unsupported element, a mass mismatch and a mode mismatch are all named', () => {
  const geometry = {
    elements: ['C', 'Kr'],
    coordinates: new Float64Array([0, 0, 0, 0, 0, 1.9]),
  };
  const eigenvector = new Float64Array(6);
  expect(() =>
    ramanActivities(geometry, [{ eigenvector }], new Float64Array([12, 83.8]), {
      bonds: [[0, 1]],
    }),
  ).toThrow('the Lippincott-Stutman tables do not cover Kr');

  const water = {
    elements: ['O', 'H', 'H'],
    coordinates: new Float64Array([0, 0, 0, 0, 0, 0.96, 0, 0.93, -0.24]),
  };
  const bonds: Array<[number, number]> = [
    [0, 1],
    [0, 2],
  ];
  expect(() =>
    ramanActivities(water, [], new Float64Array([15.999, 1.008]), { bonds }),
  ).toThrow('2 masses for 3 atoms');
  expect(() =>
    ramanActivities(
      water,
      [{ eigenvector: new Float64Array(6) }],
      new Float64Array([15.999, 1.008, 1.008]),
      { bonds },
    ),
  ).toThrow('mode 0 has 6 components, expected 9');
});

test('placzekActivities rejects a gradient sized for the wrong atom count', () => {
  expect(() =>
    placzekActivities(
      new Float64Array(9 * 9),
      [],
      new Float64Array([1, 1, 1, 1]),
    ),
  ).toThrow('the gradient holds 81 values, expected 108 for 4 atoms');
});
