import type { VibrationalEngine } from '../types/index.ts';

import { occjsEngine, occjsSerialEngine } from './occjs.ts';

/**
 * The engines offered by default. `occjsSerialEngine` is deliberately absent:
 * it is the same physics as `occjsEngine`, only slower and bit-reproducible, so
 * it is for reproducing exact digits rather than for everyday use.
 */
export const ENGINES: readonly VibrationalEngine[] = [occjsEngine];

/**
 * Look up an engine by id, including the ones absent from `ENGINES`.
 * @param id - Engine id.
 * @returns The engine, or `undefined` when the id is unknown.
 */
export function getEngine(id: string): VibrationalEngine | undefined {
  if (id === occjsSerialEngine.id) return occjsSerialEngine;
  for (const engine of ENGINES) {
    if (engine.id === id) return engine;
  }
  return undefined;
}

export type {
  RamanAnalysis,
  ThermochemistryInput,
  VibrationalAnalyser,
} from './occAnalyse.ts';
export {
  getVibrationalAnalyser,
  setVibrationalAnalyser,
} from './occAnalyse.ts';
export { createOccjsEngine, occjsEngine, occjsSerialEngine } from './occjs.ts';
export { disposeOccPool, occPoolWorkerCount } from './occPoolLifecycle.ts';
