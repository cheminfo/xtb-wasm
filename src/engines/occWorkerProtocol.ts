import type { EnergyBreakdown, EngineStage } from '../types/index.ts';

import type { RunInput } from './occRun.ts';
import type { PointGroupInfo } from './occSymmetry.ts';

/**
 * Load the occjs module. Sent once per worker, before anything else; the pool
 * passes the compiled `WebAssembly.Module` and the packaged data so the binary
 * is compiled once for the whole pool rather than once per worker.
 */
export interface LoadCommand {
  cmd: 'load';
  /** @default undefined */
  wasmPath?: string;
  /** @default undefined */
  dataPath?: string;
  /** @default undefined */
  wasmModule?: WebAssembly.Module;
  /** @default undefined */
  dataPackage?: ArrayBuffer;
}

/** Relax the geometry. Only ever sent to the primary worker. */
export interface OptimizeCommand {
  cmd: 'optimize';
  id: number;
  input: RunInput;
}

/**
 * Build the molecule, converge the SCF and capture the sweep state at a
 * geometry that is already final. Sent to every worker of the pool, so each one
 * owns a calculator warm-started at the reference geometry.
 */
export interface PrepareCommand {
  cmd: 'prepare';
  id: number;
  input: RunInput;
}

/** Compute these Hessian and dipole-derivative columns. */
export interface SweepCommand {
  cmd: 'sweep';
  id: number;
  columns: Int32Array;
}

/** Project and diagonalize an assembled Hessian. Only sent to the primary. */
export interface SolveCommand {
  cmd: 'solve';
  id: number;
  hessian: Float64Array;
}

export type WorkerCommand =
  LoadCommand | OptimizeCommand | PrepareCommand | SweepCommand | SolveCommand;

export interface LoadedMessage {
  type: 'loaded';
  loadMs: number;
}

export interface OptimizedMessage {
  type: 'optimized';
  id: number;
  /** The relaxed geometry, flat `x,y,z` per atom in Å. */
  coordinates: Float64Array;
  cycles: number;
  converged: boolean;
}

export interface PreparedMessage {
  type: 'prepared';
  id: number;
  atoms: number;
  /** The centred geometry the calculator holds, in Å. */
  coordinates: Float64Array;
  /** Standard atomic weights from occ's own table, amu. */
  masses: Float64Array;
  energy: EnergyBreakdown;
  pointGroup: PointGroupInfo;
  isUnrestricted: boolean;
  spinEnergy: number;
  warnings: string[];
}

export interface SweptMessage {
  type: 'swept';
  id: number;
  columns: Int32Array;
  /** `columns.length · 3N` values, block `i` being column `columns[i]`. */
  hessian: Float64Array;
  /** `columns.length · 3` values, or `null` when IR was not requested. */
  dipole: Float64Array | null;
}

export interface SolvedMessage {
  type: 'solved';
  id: number;
  frequencies: Float64Array;
  normalModes: Float64Array;
}

export interface ProgressMessage {
  type: 'progress';
  id: number;
  stage: EngineStage;
  fraction: number | null;
  message: string;
}

export interface FailureMessage {
  type: 'error';
  id: number;
  message: string;
}

export type WorkerMessage =
  | LoadedMessage
  | OptimizedMessage
  | PreparedMessage
  | SweptMessage
  | SolvedMessage
  | ProgressMessage
  | FailureMessage;
