/**
 * The unit and corpus tiers must not reach the network: tests of the
 * deployed Worker live in test/live/ and run via `npm run test:live`.
 * Any real fetch() here fails loudly instead of silently testing production.
 * Tests that need fetch stub it (vi.stubGlobal('fetch', ...)), which
 * overrides this guard for that file.
 */
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  throw new Error(
    `Network access is disabled in the unit/corpus test tiers (attempted fetch ${url}). ` +
    'Tests of a deployed Worker belong in test/live/ (npm run test:live).',
  );
}) as typeof fetch;
