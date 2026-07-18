import { defineConfig } from 'vitest/config';

const isCI = process.env.CI === 'true';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Nine test files exercise the deployed Worker. Running them in parallel
    // can overload the shared live endpoint and exhaust Vitest's 5s default.
    maxWorkers: isCI ? 1 : undefined,
    testTimeout: isCI ? 15_000 : 5_000,
  },
});
