/**
 * Topic boost in the hybrid ranker.
 *
 * Bobbin equivalent: search-topics.applyTopicBoost adds +0.15 to chunks
 * whose assigned topic matches the query. flux's port operates on whole
 * issues and uses a boost in the same shape as titleOverlap so it remains
 * comparable to other RRF-scaled boosts.
 */
import { describe, it, expect } from 'vitest';
import { rankResults } from '../src/lib/hybrid-ranker';
import { parseQuery } from '../src/lib/query-parser';

const ENV = { LEXICAL_WEIGHT: '1.0', SEMANTIC_WEIGHT: '0.55', RRF_K: '40' } as any;

function makeIssue(id: string, title = 'Test'): any {
  return {
    id, issue_number: 1, title, subtitle: null, published_at: '2024-01-01',
    source_url: 'x://' + id, canonical_url: null, authors: null,
    contributors: null, summary: null, headings: null, lead_essay_title: null,
    opening_quote: null, full_text_markdown: null, full_text_plain: null,
    crawl_run_id: null, content_hash: null, ingested_at: '2024-01-01',
    word_count: 100, status: 'active', year: 2024, month: 1, has_semantic_chunks: 0,
  };
}

function fts(issueId: string, rank: number) {
  return { issue: makeIssue(issueId), rank, bm25Score: -10, highlightSnippet: null };
}

describe('topic boost in ranker', () => {
  it('promotes results whose topics match the query', () => {
    const parsed = parseQuery('institutional trust');
    const a = fts('a', 1);
    const b = fts('b', 2);
    const topicMatches = new Map<string, Set<string>>();
    topicMatches.set('institutional trust', new Set(['b']));

    const ranked = rankResults(parsed, [a, b], [], ENV, { topicMatches });

    // b had worse FTS rank but the topic boost should flip the order
    expect(ranked[0].issue.id).toBe('b');
    expect(ranked[0].debugMeta.applied_boosts).toContain('topic_match');
    expect(ranked[1].debugMeta.applied_boosts).not.toContain('topic_match');
  });

  it('is a no-op when no topic-matches map is provided', () => {
    const parsed = parseQuery('institutional trust');
    const ranked = rankResults(parsed, [fts('a', 1)], [], ENV);
    expect(ranked[0].debugMeta.applied_boosts).not.toContain('topic_match');
  });

  it('only boosts issues that actually carry the matched topic', () => {
    const parsed = parseQuery('governance');
    const topicMatches = new Map<string, Set<string>>();
    topicMatches.set('governance', new Set(['a']));

    const ranked = rankResults(parsed, [fts('a', 1), fts('b', 2)], [], ENV, { topicMatches });

    const aMeta = ranked.find(r => r.issue.id === 'a')!.debugMeta;
    const bMeta = ranked.find(r => r.issue.id === 'b')!.debugMeta;
    expect(aMeta.applied_boosts).toContain('topic_match');
    expect(bMeta.applied_boosts).not.toContain('topic_match');
  });

  it('boost is additive on top of lexical+semantic agreement', () => {
    const parsed = parseQuery('alignment');
    const topicMatches = new Map<string, Set<string>>();
    topicMatches.set('alignment', new Set(['a']));

    const lexical = fts('a', 1);
    const semantic = {
      issueId: 'a', issue: makeIssue('a'),
      topScore: 0.9, topChunkSection: null, topChunkText: 'body', chunkCount: 1, rank: 1,
    } as any;

    const withBoost = rankResults(parsed, [lexical], [semantic], ENV, { topicMatches });
    const withoutBoost = rankResults(parsed, [lexical], [semantic], ENV);

    expect(withBoost[0].debugMeta.final_score)
      .toBeGreaterThan(withoutBoost[0].debugMeta.final_score);
  });
});
