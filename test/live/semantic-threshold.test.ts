/**
 * Semantic score threshold against a deployed Worker (real Workers AI
 * embeddings + Vectorize scores). test/semantic-threshold.test.ts checks the
 * same invariants offline through the route with a Vectorize double.
 */
import { describe, it, expect } from 'vitest';
import { SEARCH_URL } from './live-url';

describe('live API: threshold in action', () => {
  it('"qwan" returns only FTS-confirmed results (no semantic noise)', async () => {
    const resp = await fetch(`${SEARCH_URL}/search?q=qwan&debug=true`);
    const data = await resp.json() as any;

    // So specific that all results must have FTS confirmation or high semantic score
    for (const r of data.results) {
      const hasFts = r.matched_by.includes('fts');
      const highSemantic = r.debug?.semantic_score >= 0.75;
      expect(hasFts || highSemantic,
        `#${r.issue_number} (${r.title}) has no FTS and sem=${r.debug?.semantic_score}`
      ).toBe(true);
    }
  });

  it('"trust" has co-matched results with agreement boost', async () => {
    const resp = await fetch(`${SEARCH_URL}/search?q=trust&debug=true&limit=20`);
    const data = await resp.json() as any;

    const semanticResults = data.results.filter((r: any) =>
      r.matched_by.includes('vector')
    );
    if (semanticResults.length === 0) {
      // Live Vectorize can be unavailable or empty during rebuilds. This
      // test's invariant is about co-matched rows when semantic results
      // are present, not about Cloudflare service availability.
      return;
    }

    const coMatched = semanticResults.filter((r: any) =>
      r.matched_by.includes('fts')
    );
    expect(coMatched.length).toBeGreaterThan(0);
    for (const r of coMatched) {
      expect(r.debug.applied_boosts).toContain('lexical_semantic_agreement');
    }
  });

  it('no result has semantic_only_penalty AND high confidence', async () => {
    const resp = await fetch(`${SEARCH_URL}/search?q=crypto&debug=true&limit=50`);
    const data = await resp.json() as any;

    for (const r of data.results) {
      if (r.debug?.applied_penalties?.includes('semantic_only_penalty')) {
        expect(r.confidence).toBe('low');
      }
    }
  });
});
