/**
 * RED: Semantic-only results with low scores should be filtered out.
 * "qwan" returns 5 vector-only results at ~0.01 score — these are noise.
 */

import { describe, it, expect } from 'vitest';
import { rankResults } from '../src/lib/hybrid-ranker';
import { makeIssue, makeFtsResult, makeSemanticCandidate, defaultEnv } from './helpers';
import type { SemanticCandidate } from '../src/lib/vector-search';

describe('semantic score threshold', () => {
  it('filters out semantic-only results below the minimum score', () => {
    // Simulate weak semantic matches (score ~0.3 = noise)
    const weakMatch = makeIssue({ title: 'Unrelated' });
    const weakCandidate: SemanticCandidate = {
      issueId: weakMatch.id,
      issue: weakMatch,
      topScore: 0.5, // below threshold (0.75)
      topChunkSection: 'body',
      topChunkText: 'some vaguely related text',
      chunkCount: 1,
      rank: 1,
    };

    const parsed = { freeText: 'qwan', phrases: [], filters: {}, operators: [] };
    const ranked = rankResults(parsed, [], [weakCandidate], defaultEnv);

    expect(ranked).toHaveLength(0);
  });

  it('keeps semantic-only results above the minimum score', () => {
    const strongMatch = makeIssue({ title: 'Relevant' });
    const strongCandidate: SemanticCandidate = {
      issueId: strongMatch.id,
      issue: strongMatch,
      topScore: 0.85, // above threshold (0.75)
      topChunkSection: 'lead_essay',
      topChunkText: 'quality without a name is a concept',
      chunkCount: 2,
      rank: 1,
    };

    const parsed = { freeText: 'qwan', phrases: [], filters: {}, operators: [] };
    const ranked = rankResults(parsed, [], [strongCandidate], defaultEnv);

    expect(ranked).toHaveLength(1);
  });

  it('keeps weak semantic results when FTS also matches (agreement)', () => {
    // If FTS found it too, the semantic score doesn't matter
    const issue = makeIssue({ title: 'Quality design' });
    const weakCandidate: SemanticCandidate = {
      issueId: issue.id,
      issue: issue,
      topScore: 0.2,
      topChunkSection: 'body',
      topChunkText: 'text',
      chunkCount: 1,
      rank: 1,
    };

    const parsed = { freeText: 'quality', phrases: [], filters: {}, operators: [] };
    const ranked = rankResults(
      parsed,
      [makeFtsResult(issue, 1)],
      [weakCandidate],
      defaultEnv
    );

    // Should keep it — FTS confirmed the match
    expect(ranked).toHaveLength(1);
  });

  it('filters multiple weak semantic results, keeps strong ones', () => {
    const weak1 = makeIssue({ title: 'Weak 1' });
    const weak2 = makeIssue({ title: 'Weak 2' });
    const strong = makeIssue({ title: 'Strong' });

    const candidates: SemanticCandidate[] = [
      { issueId: weak1.id, issue: weak1, topScore: 0.4, topChunkSection: null, topChunkText: '', chunkCount: 1, rank: 1 },
      { issueId: strong.id, issue: strong, topScore: 0.9, topChunkSection: null, topChunkText: 'relevant', chunkCount: 1, rank: 2 },
      { issueId: weak2.id, issue: weak2, topScore: 0.3, topChunkSection: null, topChunkText: '', chunkCount: 1, rank: 3 },
    ];

    const parsed = { freeText: 'test', phrases: [], filters: {}, operators: [] };
    const ranked = rankResults(parsed, [], candidates, defaultEnv);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].issue.id).toBe(strong.id);
  });
});
