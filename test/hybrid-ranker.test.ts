import { describe, it, expect } from 'vitest';
import { rankResults } from '../src/lib/hybrid-ranker';
import type { ParsedQuery } from '../src/lib/query-parser';
import { makeIssue, makeFtsResult, makeSemanticCandidate, defaultEnv } from './helpers';

const defaultParsed: ParsedQuery = {
  freeText: 'trust',
  phrases: [],
  filters: {},
  operators: [],
};

describe('rankResults', () => {
  it('returns empty for no results', () => {
    const ranked = rankResults(defaultParsed, [], [], defaultEnv);
    expect(ranked).toEqual([]);
  });

  it('ranks lexical-only results', () => {
    const issue1 = makeIssue({ title: 'Trust in Institutions' });
    const issue2 = makeIssue({ title: 'Building Systems' });

    const ranked = rankResults(
      defaultParsed,
      [makeFtsResult(issue1, 1), makeFtsResult(issue2, 2)],
      [],
      defaultEnv,
    );

    expect(ranked).toHaveLength(2);
    expect(ranked[0].issue.id).toBe(issue1.id);
    expect(ranked[0].matchedBy).toContain('fts');
  });

  it('ranks semantic-only results', () => {
    const issue1 = makeIssue({ title: 'Concept Match' });

    const ranked = rankResults(
      defaultParsed,
      [],
      [makeSemanticCandidate(issue1, 1)],
      defaultEnv,
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].matchedBy).toContain('vector');
  });

  it('boosts results appearing in both lexical and semantic', () => {
    const sharedIssue = makeIssue({ title: 'Trust and Systems' });
    const lexicalOnly = makeIssue({ title: 'Only Lexical' });
    const semanticOnly = makeIssue({ title: 'Only Semantic' });

    const ranked = rankResults(
      defaultParsed,
      [makeFtsResult(sharedIssue, 2), makeFtsResult(lexicalOnly, 1)],
      [makeSemanticCandidate(sharedIssue, 1), makeSemanticCandidate(semanticOnly, 2)],
      defaultEnv,
    );

    // Shared issue should get lexical_semantic_agreement boost
    const sharedResult = ranked.find(r => r.issue.id === sharedIssue.id)!;
    expect(sharedResult.debugMeta.applied_boosts).toContain('lexical_semantic_agreement');
  });

  it('penalizes semantic-only results when strong lexical matches exist', () => {
    const lexical1 = makeIssue({ title: 'Strong Lexical 1' });
    const lexical2 = makeIssue({ title: 'Strong Lexical 2' });
    const lexical3 = makeIssue({ title: 'Strong Lexical 3' });
    const semanticOnly = makeIssue({ title: 'Semantic Concept Match' });

    const ranked = rankResults(
      defaultParsed,
      [
        makeFtsResult(lexical1, 1),
        makeFtsResult(lexical2, 2),
        makeFtsResult(lexical3, 3),
      ],
      [makeSemanticCandidate(semanticOnly, 1)],
      defaultEnv,
    );

    const semanticResult = ranked.find(r => r.issue.id === semanticOnly.id)!;
    expect(semanticResult.debugMeta.applied_penalties).toContain('semantic_only_penalty');
  });

  it('phrase match in title beats semantic-only', () => {
    const phraseInTitle = makeIssue({ title: 'Just Enough Structure for Progress' });
    const semanticOnly = makeIssue({ title: 'Organization and Scaffolding' });
    // Also add 2 more lexical results so semantic penalty kicks in
    const filler1 = makeIssue({ title: 'Filler 1' });
    const filler2 = makeIssue({ title: 'Filler 2' });

    const parsed: ParsedQuery = {
      freeText: '',
      phrases: ['just enough structure'],
      filters: {},
      operators: [],
    };

    const ranked = rankResults(
      parsed,
      [
        makeFtsResult(phraseInTitle, 1),
        makeFtsResult(filler1, 2),
        makeFtsResult(filler2, 3),
      ],
      [makeSemanticCandidate(semanticOnly, 1)],
      defaultEnv,
    );

    expect(ranked[0].issue.id).toBe(phraseInTitle.id);
    const titleResult = ranked.find(r => r.issue.id === phraseInTitle.id)!;
    expect(titleResult.debugMeta.applied_boosts).toContain('phrase_title');
  });

  it('exact issue number match gets top boost', () => {
    const exactIssue = makeIssue({ issue_number: 198, title: 'Issue 198' });
    const otherIssue = makeIssue({ title: 'Something about 198' });

    const parsed: ParsedQuery = {
      freeText: '',
      phrases: [],
      filters: { issueNumber: 198 },
      operators: ['issue:198'],
    };

    const ranked = rankResults(
      parsed,
      [makeFtsResult(otherIssue, 1), makeFtsResult(exactIssue, 2)],
      [],
      defaultEnv,
    );

    expect(ranked[0].issue.id).toBe(exactIssue.id);
    expect(ranked[0].debugMeta.applied_boosts).toContain('exact_issue');
  });

  it('multi-chunk support gets a boost', () => {
    const multiChunk = makeIssue({ title: 'Multi Chunk Issue' });

    const candidate = makeSemanticCandidate(multiChunk, 1);
    candidate.chunkCount = 3;

    const ranked = rankResults(
      defaultParsed,
      [],
      [candidate],
      defaultEnv,
    );

    expect(ranked[0].debugMeta.applied_boosts).toContain('multi_chunk_support');
  });

  it('generates snippets from semantic chunk text', () => {
    const issue = makeIssue({ title: 'Test', summary: 'The summary' });
    const candidate = makeSemanticCandidate(issue, 1);
    candidate.topChunkText = 'This is the relevant chunk about trust.';

    const ranked = rankResults(defaultParsed, [], [candidate], defaultEnv);
    expect(ranked[0].snippet).toContain('relevant chunk about trust');
  });

  it('falls back to summary for snippet when no semantic match', () => {
    const issue = makeIssue({ title: 'Test', summary: 'A nice summary.' });

    const ranked = rankResults(
      defaultParsed,
      [makeFtsResult(issue, 1)],
      [],
      defaultEnv,
    );

    expect(ranked[0].snippet).toBe('A nice summary.');
  });

  it('prefers FTS highlight snippet over generated snippet', () => {
    const issue = makeIssue({ title: 'Test', summary: 'Generic summary here.' });

    const ranked = rankResults(
      defaultParsed,
      [makeFtsResult(issue, 1, '...the <mark>trust</mark> between institutions...')],
      [],
      defaultEnv,
    );

    expect(ranked[0].snippet).toContain('<mark>trust</mark>');
    expect(ranked[0].snippet).not.toContain('Generic summary');
  });
});
