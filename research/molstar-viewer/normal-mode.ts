/**
 * Pure, DOM-free helpers that turn an equilibrium geometry plus one normal-mode
 * eigenvector into the animation frames Mol* consumes.
 */

export type Vector = Float32Array | Float64Array | number[];

export interface NormalMode {
  /** Cartesian displacement, length 3 * atomCount, atom-major (x0,y0,z0,x1,...). */
  readonly eigenvector: Vector;
  /** Harmonic wavenumber in cm^-1. Used for labels only. */
  readonly frequency: number;
}

export interface Geometry {
  /** Element symbols, one per atom. */
  readonly symbols: readonly string[];
  /** Equilibrium coordinates in Angstrom, length 3 * atomCount, atom-major. */
  readonly coordinates: Vector;
}

/**
 * Scale factor that makes the largest single-atom displacement of `eigenvector`
 * equal to `maxDisplacement` Angstrom, so a stiff C-H stretch and a soft torsion
 * animate with a comparable visual amplitude.
 * @param eigenvector Cartesian displacement, atom-major.
 * @param maxDisplacement Peak excursion of the most-displaced atom, in Angstrom.
 */
export function normalizeAmplitude(
  eigenvector: Vector,
  maxDisplacement: number,
): number {
  let maxNormSquared = 0;
  for (let i = 0; i < eigenvector.length; i += 3) {
    const dx = eigenvector[i] as number;
    const dy = eigenvector[i + 1] as number;
    const dz = eigenvector[i + 2] as number;
    const normSquared = dx * dx + dy * dy + dz * dz;
    if (normSquared > maxNormSquared) maxNormSquared = normSquared;
  }
  if (maxNormSquared === 0) return 0;
  return maxDisplacement / Math.sqrt(maxNormSquared);
}

/**
 * Displace `coordinates` along `eigenvector` over one full vibration period.
 * Frame f uses cos(2*pi*f/frameCount), so frame 0 is the outer turning point and
 * the sequence is periodic — Mol*'s `loop` mode plays it seamlessly.
 * @param geometry Equilibrium geometry.
 * @param eigenvector Cartesian displacement, atom-major.
 * @param scale Amplitude in the units of `eigenvector` (see `normalizeAmplitude`).
 * @param frameCount Number of frames in one period.
 * @default frameCount 20
 */
export function buildModeFrames(
  geometry: Geometry,
  eigenvector: Vector,
  scale: number,
  frameCount = 20,
): Float32Array[] {
  const { coordinates } = geometry;
  const size = coordinates.length;
  if (eigenvector.length !== size) {
    throw new RangeError(
      `eigenvector has ${eigenvector.length} components but the geometry has ${size}`,
    );
  }
  const frames = new Array<Float32Array>(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const s = scale * Math.cos((2 * Math.PI * f) / frameCount);
    const frame = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      frame[i] = (coordinates[i] as number) + s * (eigenvector[i] as number);
    }
    frames[f] = frame;
  }
  return frames;
}

/**
 * Serialize frames as a multi-model XYZ document, the format Mol*'s built-in
 * `xyz` trajectory provider reads.
 * @param symbols Element symbols, one per atom.
 * @param frames Coordinate frames in Angstrom, atom-major.
 */
export function framesToXyz(
  symbols: readonly string[],
  frames: readonly Float32Array[],
): string {
  const atomCount = symbols.length;
  const lines: string[] = [];
  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f] as Float32Array;
    lines.push(String(atomCount), `frame ${f + 1}`);
    for (let i = 0; i < atomCount; i++) {
      const k = 3 * i;
      lines.push(
        `${symbols[i]} ${(frame[k] as number).toFixed(6)} ${(frame[k + 1] as number).toFixed(6)} ${(frame[k + 2] as number).toFixed(6)}`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Parse a single- or multi-model XYZ document into symbols plus frames. */
export function parseXyzFrames(xyz: string): {
  symbols: string[];
  frames: Float32Array[];
} {
  const lines = xyz.split('\n');
  const symbols: string[] = [];
  const frames: Float32Array[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const header = (lines[cursor] ?? '').trim();
    if (header === '') {
      cursor++;
      continue;
    }
    const atomCount = Number.parseInt(header, 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) {
      throw new SyntaxError(`line ${cursor + 1}: expected an atom count, got "${header}"`);
    }
    const frame = new Float32Array(3 * atomCount);
    for (let i = 0; i < atomCount; i++) {
      const raw = lines[cursor + 2 + i];
      if (raw === undefined) throw new SyntaxError(`truncated XYZ at line ${cursor + 2 + i}`);
      const parts = raw.trim().split(/\s+/);
      if (frames.length === 0) symbols.push(parts[0] as string);
      const k = 3 * i;
      frame[k] = Number.parseFloat(parts[1] as string);
      frame[k + 1] = Number.parseFloat(parts[2] as string);
      frame[k + 2] = Number.parseFloat(parts[3] as string);
    }
    frames.push(frame);
    cursor += atomCount + 2;
  }
  return { symbols, frames };
}
