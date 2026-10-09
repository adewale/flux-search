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
import { seedIssue } from './helpers-d1';
import { searchDb, searchRoute, fakeAi, fakeVectorize, type VectorMatch } from './helpers-search-route';

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

  describe('search route: threshold in action (Vectorize double)', () => {
    async function env(issues: Array<{ id: string; n: number; title: string; body: string }>, matches: VectorMatch[]) {
      const db = searchDb();
      for (const i of issues) {
        await seedIssue(db, {
          id: i.id, issue_number: i.n, title: i.title, full_text_plain: i.body,
          source_url: `https://example.com/p/${i.n}`,
        });
      }
      return { DB: db, AI: fakeAi(), VECTORIZE: fakeVectorize(matches) };
    }
    const vec = (issueId: string, score: number): VectorMatch =>
      ({ id: `${issueId}-0`, score, metadata: { issue_id: issueId, section_label: 'lead_essay', chunk_text: `${issueId} chunk` } });

    it('"qwan" returns only FTS-confirmed results (no semantic noise)', async () => {
      // One lexical match; the double also returns a vector-only neighbour
      // that clears Vectorize's 0.72 prefilter but not the 0.75 threshold.
      const e = await env([
        { id: 'qwan', n: 1, title: 'Quality without a name', body: 'The qwan of a place.' },
        { id: 'noise', n: 2, title: 'Pattern languages', body: 'Alexander wrote about places.' },
      ], [vec('qwan', 0.9), vec('noise', 0.73)]);
      const { status, body } = await searchRoute(e, 'qwan', { debug: 'true' });
      expect(status).toBe(200);
      expect(body.results.map((r: any) => r.issue_id)).toEqual(['qwan']);
      for (const r of body.results) {
        const hasFts = r.matched_by.includes('fts');
        const highSemantic = r.debug?.semantic_score >= 0.75;
        expect(hasFts || highSemantic,
          `#${r.issue_number} (${r.title}) has no FTS and sem=${r.debug?.semantic_score}`
        ).toBe(true);
      }
    });

    it('"trust" has co-matched results with agreement boost', async () => {
      const e = await env([
        { id: 't1', n: 1, title: 'Institutional trust', body: 'Trust erodes.' },
        { id: 't2', n: 2, title: 'Networks', body: 'Trust in networks.' },
      ], [vec('t1', 0.88)]);
      const { status, body } = await searchRoute(e, 'trust', { debug: 'true', limit: '20' });
      expect(status).toBe(200);
      const coMatched = body.results.filter((r: any) =>
        r.matched_by.includes('vector') && r.matched_by.includes('fts'));
      expect(coMatched.map((r: any) => r.issue_id)).toEqual(['t1']);
      for (const r of coMatched) {
        expect(r.debug.applied_boosts).toContain('lexical_semantic_agreement');
      }
    });

    it('no result has semantic_only_penalty AND high confidence', async () => {
      // Three lexical matches make lexical evidence "strong", so an
      // above-threshold vector-only result is penalised.
      const e = await env([
        { id: 'c1', n: 1, title: 'Crypto one', body: 'crypto' },
        { id: 'c2', n: 2, title: 'Crypto two', body: 'crypto' },
        { id: 'c3', n: 3, title: 'Crypto three', body: 'crypto' },
        { id: 'v1', n: 4, title: 'Ledgers', body: 'distributed ledgers' },
      ], [vec('v1', 0.8)]);
      const { status, body } = await searchRoute(e, 'crypto', { debug: 'true', limit: '50' });
      expect(status).toBe(200);
      const penalised = body.results.filter((r: any) =>
        r.debug?.applied_penalties?.includes('semantic_only_penalty'));
      // Precondition: the invariant is checked on at least one penalised row.
      expect(penalised.map((r: any) => r.issue_id)).toEqual(['v1']);
      for (const r of penalised) {
        expect(r.confidence).toBe('low');
      }
    });
  });
});
