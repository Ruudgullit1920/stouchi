import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  /* JSX → Preact; no HMR runtime inside tests */
  plugins: [preact({ prefreshEnabled: false, devToolsEnabled: false })],
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/db/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90 },
    },
  },
});
