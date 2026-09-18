import { defineConfig, globalIgnores } from 'eslint/config';
import ts from 'eslint-config-zakodium/ts';
import unicorn from 'eslint-config-zakodium/unicorn';

export default defineConfig(
  globalIgnores(['coverage', 'lib', 'experiments', 'report', 'research']),
  ts,
  unicorn,
);
