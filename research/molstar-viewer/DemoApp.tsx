import { useState } from 'react';
import { MoleculeViewer } from './MoleculeViewer.tsx';

const WATER_XYZ = `3
water GFN2
O  0.000000  0.000000  0.117300
H  0.000000  0.757200 -0.469200
H  0.000000 -0.757200 -0.469200
`;

const BENZENE_XYZ = (() => {
  const lines = ['12', 'benzene'];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    lines.push(`C ${(1.397 * Math.cos(a)).toFixed(6)} ${(1.397 * Math.sin(a)).toFixed(6)} 0.000000`);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    lines.push(`H ${(2.481 * Math.cos(a)).toFixed(6)} ${(2.481 * Math.sin(a)).toFixed(6)} 0.000000`);
  }
  return `${lines.join('\n')}\n`;
})();

const BEND = new Float64Array([0, 0, -0.07, 0, 0.42, 0.556, 0, -0.42, 0.556]);
const BENZENE_OOP = Float64Array.from({ length: 36 }, (_, i) =>
  i % 3 === 2 ? (Math.floor(i / 3) % 2 === 0 ? 0.5 : -0.5) : 0,
);

const CASES = [
  {
    label: 'water bend 1573.9',
    xyz: WATER_XYZ,
    mode: { eigenvector: BEND, frequency: 1573.9 },
    bonds: { from: [0, 0], to: [1, 2] },
  },
  {
    label: 'benzene out-of-plane',
    xyz: BENZENE_XYZ,
    mode: { eigenvector: BENZENE_OOP, frequency: 675 },
    bonds: {
      from: [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5],
      to: [1, 2, 3, 4, 5, 0, 6, 7, 8, 9, 10, 11],
      order: [2, 1, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1],
    },
  },
];

export function App() {
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useState(0);
  const [dark, setDark] = useState(false);
  const [arrows, setArrows] = useState(false);
  const current = CASES[index]!;
  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <button id="toggle" type="button" onClick={() => setPlaying((p) => !p)}>
        {playing ? 'pause' : 'play'}
      </button>
      <button id="swap" type="button" onClick={() => setIndex((i) => (i + 1) % CASES.length)}>
        {current.label}
      </button>
      <button id="theme" type="button" onClick={() => setDark((d) => !d)}>
        {dark ? 'dark' : 'light'}
      </button>
      <button id="arrows" type="button" onClick={() => setArrows((a) => !a)}>
        {arrows ? 'arrows on' : 'arrows off'}
      </button>
      <MoleculeViewer
        xyz={current.xyz}
        mode={current.mode}
        bonds={current.bonds}
        playing={playing}
        dark={dark}
        showArrows={arrows}
        height="480px"
      />
    </div>
  );
}
