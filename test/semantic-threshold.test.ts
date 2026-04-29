/**
 * Tests demonstrating the value of the semantic score threshold.
 *
 * Without SEMANTIC_MIN_SCORE (0.75), Vectorize always returns results —
 * even for queries with no genuine semantic match. These "noise" results
 * have cosine similarity 0.5-0.7, look relevant at a glance but aren't.
 *
 * The threshold prevents vector-only results with weak scores from
 * reaching the user. These tests verify the threshold works correctly
 * and document WHY it exists with real examples.
 */
import { describe, it, expect } from 'vitest';
import { rankResults, type RankedResult } from '../src/lib/hybrid-ranker';
import type { FtsSearchResult } from '../src/db/queries';
import type { SemanticCandidate } from '../src/lib/vector-search';
import type { ParsedQuery } from '../src/lib/query-parser';
import type { IssueRow } from '../src/db/types';

function makeIssue(id: string, title: string): IssueRow {
  return { id, title, issue_number: 1, published_at: '2023-01-01', year: 2023, month: 1 } as IssueRow;
}

function makeFtsResult(id: string, title: string, rank: number): FtsSearchResult {
  return {
    issue: makeIssue(id, title),
    rank,
    highlightSnippet: title + ' snippet text',
  };
}

function makeSemanticCandidate(issueId: string, title: string, rank: number, topScore: number): SemanticCandidate {
  return {
    issueId,
    issue: makeIssue(issueId, title),
    rank,
    topScore,
    topChunkSection: 'lead_essay',
    topChunkText: title + ' chunk text',
    chunkCount: 1,
  };
}

const defaultEnv = {
  LEXICAL_WEIGHT: '1.0',
  SEMANTIC_WEIGHT: '0.55',
  RRF_K: '40',
} as any;

const simpleQuery: ParsedQuery = {
  freeText: 'qwan',
  phrases: [],
  filters: {},
  operators: [],
};

describe('semantic score threshold', () => {
  describe('filtering weak vector-only results', () => {
    it('vector-only results below 0.75 are removed', () => {
      // "qwan" appears in exactly 1 issue. Without the threshold,
      // Vectorize returns 5 semantically-similar-but-irrelevant results.
      const ftsResults = [
        makeFtsResult('correct', 'The issue about qwan', 1),
      ];
      const semanticResults = [
        makeSemanticCandidate('noise1', 'About quality in craft', 1, 0.68),
        makeSemanticCandidate('noise2', 'Software craftsmanship', 2, 0.65),
        makeSemanticCandidate('noise3', 'The art of making', 3, 0.62),
        makeSemanticCandidate('noise4', 'Excellence in practice', 4, 0.58),
        makeSemanticCandidate('noise5', 'Mastery and skill', 5, 0.55),
        makeSemanticCandidate('correct', 'The issue about qwan', 6, 0.70),
      ];

      const results = rankResults(simpleQuery, ftsResults, semanticResults, defaultEnv);

      // All 5 noise results filtered (vector-only, score < 0.75)
      const noiseIds = ['noise1', 'noise2', 'noise3', 'noise4', 'noise5'];
      for (const id of noiseIds) {
        expect(results.find(r => r.issue.id === id),
          `${id} should be filtered but wasn't`).toBeUndefined();
      }
      // Correct result survives (has FTS confirmation)
      expect(results.find(r => r.issue.id === 'correct')).toBeDefined();
      // Only 1 result total
      expect(results).toHaveLength(1);
    });

    it('vector-only results ABOVE 0.75 are kept', () => {
      const ftsResults = [makeFtsResult('fts1', 'FTS match', 1)];
      const semanticResults = [
        makeSemanticCandidate('good', 'Genuinely related', 1, 0.82),
        makeSemanticCandidate('noise', 'Weakly related', 2, 0.60),
      ];

      const results = rankResults(simpleQuery, ftsResults, semanticResults, defaultEnv);

      expect(results.find(r => r.issue.id === 'good')).toBeDefined();
      expect(results.find(r => r.issue.id === 'noise')).toBeUndefined();
    });

    it('the threshold is exactly 0.75 (boundary test)', () => {
      const ftsResults: FtsSearchResult[] = [];
      const at75 = [makeSemanticCandidate('at75', 'At threshold', 1, 0.75)];
      const below75 = [makeSemanticCandidate('below', 'Below threshold', 1, 0.749)];

      const resultsAt = rankResults(simpleQuery, ftsResults, at75, defaultEnv);
      const resultsBelow = rankResults(simpleQuery, ftsResults, below75, defaultEnv);

      expect(resultsAt).toHaveLength(1);
      expect(resultsBelow).toHaveLength(0);
    });
  });

  describe('co-matched results bypass the threshold', () => {
    it('FTS + vector result is kept regardless of semantic score', () => {
      const ftsResults = [makeFtsResult('both', 'Found by both', 1)];
      const semanticResults = [
        makeSemanticCandidate('both', 'Found by both', 3, 0.55), // well below threshold
      ];

      const results = rankResults(simpleQuery, ftsResults, semanticResults, defaultEnv);

      const result = results.find(r => r.issue.id === 'both');
      expect(result).toBeDefined();
      expect(result!.matchedBy).toContain('fts');
      expect(result!.matchedBy).toContain('vector');
      expect(result!.debugMeta.applied_boosts).toContain('lexical_semantic_agreement');
      expect(result!.debugMeta.applied_penalties).not.toContain('semantic_only_penalty');
    });
  });

  describe('semantic-only penalty (demotion, not filtering)', () => {
    it('above-threshold vector-only results are penalized when 3+ FTS results exist', () => {
      const ftsResults = [
        makeFtsResult('fts1', 'Strong 1', 1),
        makeFtsResult('fts2', 'Strong 2', 2),
        makeFtsResult('fts3', 'Strong 3', 3),
      ];
      const semanticResults = [
        makeSemanticCandidate('vector', 'Semantic only', 1, 0.80),
      ];

      const results = rankResults(simpleQuery, ftsResults, semanticResults, defaultEnv);

      const vectorResult = results.find(r => r.issue.id === 'vector');
      expect(vectorResult).toBeDefined();
      expect(vectorResult!.debugMeta.applied_penalties).toContain('semantic_only_penalty');
      expect(vectorResult!.confidence).toBe('low');

      // Penalized result ranks below all FTS results
      const vectorIdx = results.findIndex(r => r.issue.id === 'vector');
      expect(vectorIdx).toBe(results.length - 1);
    });

    it('above-threshold vector-only results are NOT penalized when <3 FTS results', () => {
      const ftsResults = [makeFtsResult('fts1', 'Only match', 1)];
      const semanticResults = [
        makeSemanticCandidate('vector', 'Semantic discovery', 1, 0.80),
      ];

      const results = rankResults(simpleQuery, ftsResults, semanticResults, defaultEnv);

      const vectorResult = results.find(r => r.issue.id === 'vector');
      expect(vectorResult).toBeDefined();
      expect(vectorResult!.debugMeta.applied_penalties).not.toContain('semantic_only_penalty');
    });
  });

  describe('live API: threshold in action', () => {
    it('"qwan" returns only FTS-confirmed results (no semantic noise)', async () => {
      const resp = await fetch('https://flux-search.adewale-883.workers.dev/search?q=qwan&debug=true');
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
      const resp = await fetch('https://flux-search.adewale-883.workers.dev/search?q=trust&debug=true&limit=20');
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
      const resp = await fetch('https://flux-search.adewale-883.workers.dev/search?q=crypto&debug=true&limit=50');
      const data = await resp.json() as any;

      for (const r of data.results) {
        if (r.debug?.applied_penalties?.includes('semantic_only_penalty')) {
          expect(r.confidence).toBe('low');
        }
      }
    });
  });
});
