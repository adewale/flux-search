import { defineConfig } from 'vitest/config';

// One set of budgets for local runs and CI: no `process.env.CI` branches.
// Tests of the deployed Worker are not in this config: they live in
// test/live/ and run via `npm run test:live` (vitest.live.config.ts), so
// `npm test` never depends on production.
//
// Budgets are sized from measured durations on a 4-CPU machine (2026-09):
//   slowest unit test (properties "source_url always matches input URL",
//   dominated by fast-check webUrl set-up): 2.2 s idle, 5.2 s at load avg 15
//   slowest corpus test (corpus-chunks, re-chunks all 234 issues):
//   4.1 s idle, 10.1 s at load avg 15, 16.2 s at load avg 21
//   (the old 5 s local budget failed 9 corpus tests at load avg 19-31).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/live/**', 'test/corpus-*.test.ts'],
          setupFiles: ['test/setup/no-network.ts'],
          // The budget CI already used; now local runs get it too.
          testTimeout: 15_000,
        },
      },
      {
        test: {
          name: 'corpus',
          include: ['test/corpus-*.test.ts'],
          setupFiles: ['test/setup/no-network.ts'],
          // Preserve the existing 15 s CI budget; do not raise it to absorb
          // machine contention or broaden the recurring corpus workload.
          testTimeout: 15_000,
        },
      },
    ],
  },
});
