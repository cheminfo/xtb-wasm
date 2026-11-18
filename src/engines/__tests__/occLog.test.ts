import { FifoLogger } from 'fifo-logger';
import { expect, test } from 'vitest';

import { logEntries } from '../../__tests__/logEntries.ts';
import type { LogMessage } from '../occLog.ts';
import { createRelayLogger, replayLog } from '../occLog.ts';

test('a relay logger posts each entry with its level and command id', () => {
  const posted: LogMessage[] = [];
  const relay = createRelayLogger(7, (message) => posted.push(message));

  relay.info('the sweep ran on 6 parallel instances');
  relay.warn({ cycles: 250 }, 'the optimizer did not converge');
  relay.error(new Error('the Raman analysis failed'));

  expect(posted).toStrictEqual([
    {
      type: 'log',
      id: 7,
      level: 'info',
      message: 'the sweep ran on 6 parallel instances',
    },
    {
      type: 'log',
      id: 7,
      level: 'warn',
      message: 'the optimizer did not converge',
      meta: { cycles: 250 },
    },
    {
      type: 'log',
      id: 7,
      level: 'error',
      message: 'the Raman analysis failed',
    },
  ]);
});

test('a relayed entry is logged again on the caller logger, with the context added', () => {
  const logger = new FifoLogger();

  replayLog(logger, { type: 'log', id: 1, level: 'warn', message: 'no σ' });
  replayLog(
    logger,
    {
      type: 'log',
      id: 2,
      level: 'info',
      message: 'open shell',
      meta: { spin: 1 },
    },
    { structure: 3 },
  );

  expect(logEntries(logger)).toStrictEqual([
    { level: 'warn', message: 'no σ' },
    { level: 'info', message: 'open shell' },
  ]);
  expect(logger.getLogs()[1]?.meta).toStrictEqual({ structure: 3, spin: 1 });
});

test('replaying without a logger reports nothing and does not throw', () => {
  expect(() => {
    replayLog(undefined, {
      type: 'log',
      id: 1,
      level: 'error',
      message: 'dropped',
    });
  }).not.toThrow();
});
