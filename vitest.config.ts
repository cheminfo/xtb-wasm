import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // research/ and experiments/ hold research artifacts and reference data, not
    // application code.
    exclude: [...defaultExclude, 'research/**', 'experiments/**', 'report/**'],
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
    },
    snapshotFormat: {
      maxOutputLength: Number.MAX_SAFE_INTEGER,
    },
  },
});
