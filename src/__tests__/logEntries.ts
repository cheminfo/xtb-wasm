import type { FifoLogger } from 'fifo-logger';

/**
 * The level and message of every entry a logger kept, in order.
 * @param logger - The logger a test passed to the code under test.
 * @returns One `{ level, message }` per entry.
 */
export function logEntries(logger: FifoLogger) {
  return logger
    .getLogs()
    .map(({ levelLabel, message }) => ({ level: levelLabel, message }));
}
