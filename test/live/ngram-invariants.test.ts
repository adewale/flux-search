/**
 * Invariants from the n-gram investigation, checked against a deployed
 * Worker. The diagnostic comparisons (typos, substrings, spelling variants,
 * word order) are a report, not a test: `npm run report:ngram-cases`.
 */
import { describe, it, expect } from 'vitest';
import { SEARCH_URL } from './live-url';

async function totalHits(q: string): Promise<number> {
  const resp = await fetch(`${SEARCH_URL}/search?q=${encodeURIComponent(q)}`);
  expect(resp.status, `GET /search?q=${q}`).toBe(200);
  const data = await resp.json() as { total_hits: number };
  return data.total_hits;
}

describe('n-gram investigation invariants', () => {
  // The reference spellings the report compares typos and variants against:
  // if one of these has no hits, the report's comparison is meaningless.
  for (const q of ['coordination', 'resilience', 'hierarchy', 'organize', 'accountability', 'organization', 'behavior']) {
    it(`reference term "${q}" has hits in the corpus`, async () => {
      expect(await totalHits(q)).toBeGreaterThan(0);
    });
  }

  // A quoted phrase is a subset of the same words ANDed together, and both
  // queries share one embedding, so the phrase can never have more hits.
  for (const words of ['systems thinking', 'loose coupling', 'mental models']) {
    it(`"${words}" as a phrase has no more hits than the unquoted words`, async () => {
      const phrase = await totalHits(`"${words}"`);
      const unquoted = await totalHits(words);
      expect(phrase).toBeLessThanOrEqual(unquoted);
    });
  }
});
