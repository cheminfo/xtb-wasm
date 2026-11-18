import type { LightLogger } from 'cheminfo-types';

/** The levels a worker can relay. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/** One log entry, as a worker posts it to the pool. */
export interface LogMessage {
  type: 'log';
  id: number;
  level: LogLevel;
  message: string;
  /** @default undefined */
  meta?: Record<string, unknown>;
}

/**
 * A logger that posts every entry instead of keeping it, so that what a worker
 * logs reaches the caller's logger on the main thread.
 * @param id - The command the entries belong to.
 * @param post - How the worker answers the pool.
 * @returns The relaying logger.
 */
export function createRelayLogger(
  id: number,
  post: (message: LogMessage) => void,
): LightLogger {
  function relay(level: LogLevel) {
    return (value: unknown, message?: string): void => {
      post({ type: 'log', id, level, ...entryOf(value, message) });
    };
  }
  return {
    trace: relay('trace'),
    debug: relay('debug'),
    info: relay('info'),
    warn: relay('warn'),
    error: relay('error'),
  };
}

/**
 * Log a relayed entry again, on the caller's logger.
 * @param logger - Where the caller wants the entries, if anywhere.
 * @param entry - The entry a worker posted.
 * @param context - Fields the caller adds to every entry, e.g. which structure
 * of a batch it is about.
 */
export function replayLog(
  logger: LightLogger | undefined,
  entry: LogMessage,
  context?: Record<string, unknown>,
): void {
  if (logger === undefined) return;
  const meta =
    context === undefined ? entry.meta : { ...context, ...entry.meta };
  if (meta === undefined) {
    logger[entry.level](entry.message);
  } else {
    logger[entry.level](meta, entry.message);
  }
}

function entryOf(
  value: unknown,
  message: string | undefined,
): Pick<LogMessage, 'message' | 'meta'> {
  if (typeof value === 'string') return { message: value };
  if (value instanceof Error) return { message: message ?? value.message };
  if (typeof value === 'object' && value !== null) {
    return {
      message: message ?? '',
      meta: value as Record<string, unknown>,
    };
  }
  return { message: message ?? String(value) };
}
