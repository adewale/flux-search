import { defineConfig } from 'vitest/config';

// Post-deploy checks against a running Worker. Not part of `npm test`.
//   SEARCH_URL=https://flux-search.adewale-883.workers.dev npm run test:live
if (!process.env.SEARCH_URL) {
  throw new Error('SEARCH_URL is required for the live project, e.g. SEARCH_URL=https://flux-search.adewale-883.workers.dev npm run test:live');
}

export default defineConfig({
  test: {
    name: 'live',
    include: ['test/live/**/*.test.ts'],
    // One file at a time so the suite does not load the shared deployment.
    fileParallelism: false,
    // Network round trips to a deployed Worker; tests that make several
    // sequential requests set their own larger budget.
    testTimeout: 15_000,
  },
});
