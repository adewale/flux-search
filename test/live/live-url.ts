/**
 * Base URL of the deployment the live tests exercise.
 *
 * Live tests check a *deployed* Worker (response invariants, relevance,
 * topic quality over the real corpus), so they are not part of `npm test`
 * and never run on PRs. Run them after a deploy, or on a schedule:
 *
 *   SEARCH_URL=https://flux-search.adewale-883.workers.dev npm run test:live
 *
 * There is deliberately no default: a missing SEARCH_URL is an error rather
 * than a silent fallback to production.
 */
export const SEARCH_URL: string = (() => {
  const url = process.env.SEARCH_URL;
  if (!url) {
    throw new Error('SEARCH_URL is not set. Live tests need an explicit deployment URL, e.g. SEARCH_URL=https://flux-search.adewale-883.workers.dev npm run test:live');
  }
  return url.replace(/\/+$/, '');
})();
