/**
 * Topic-relevance harness.
 *
 * Pin a few representative queries → expected topics, then assert that:
 *   1. The topic-boosted issue out-ranks an FTS-only competitor.
 *   2. Removing the boost causes the topic-aligned issue to lose ground.
 *
 * The harness is offline — it builds a tiny synthetic corpus instead of
 * hitting the live worker, so it stays green in CI without network.
 *
 * It complements (not replaces) test/relevance.test.ts which hits the
 * deployed API.
 */
import { describe, it, expect } from 'vitest';
import { rankResults } from '../src/lib/hybrid-ranker';
import { parseQuery } from '../src/lib/query-parser';

const ENV = { LEXICAL_WEIGHT: '1.0', SEMANTIC_WEIGHT: '0.55', RRF_K: '40' } as any;

interface SyntheticIssue {
  id: string;
  title: string;
  topics: string[];
}

const ISSUES: SyntheticIssue[] = [
  // The topic-aligned issue. Neither the query nor its title contains
  // the keyword — the only signal of relevance is the topic assignment,
  // so the boost is what should win the ranking.
  { id: 'aligned', title: 'Notes from a fragile decade', topics: ['institutional trust', 'governance'] },
  // FTS-matched but unrelated. No title overlap, no topic alignment.
  { id: 'incidental', title: 'Random article body matches', topics: ['general history'] },
];

const CASES: Array<{ query: string; topic: string; expected: string }> = [
  { query: 'institutional trust', topic: 'institutional trust', expected: 'aligned' },
];

function makeIssueRow(id: string, title: string): any {
  return {
    id, issue_number: id === 'aligned' ? 1 : 2,
    title, subtitle: null, published_at: '2024-01-01',
    source_url: 'x://' + id, canonical_url: null,
    authors: null, contributors: null, summary: null,
    headings: null, lead_essay_title: null, opening_quote: null,
    full_text_markdown: null, full_text_plain: null,
    crawl_run_id: null, content_hash: null,
    ingested_at: '2024-01-01', word_count: 100,
    status: 'active', year: 2024, month: 1, has_semantic_chunks: 0,
  };
}

function fts(id: string, rank: number) {
  const issue = ISSUES.find(i => i.id === id)!;
  return { issue: makeIssueRow(id, issue.title), rank, bm25Score: -10, highlightSnippet: null };
}

function topicMatchesFor(query: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const lower = query.toLowerCase();
  for (const i of ISSUES) {
    for (const t of i.topics) {
      if (t === lower) {
        const set = out.get(t) ?? new Set();
        set.add(i.id);
        out.set(t, set);
      }
    }
  }
  return out;
}

describe('topic-relevance harness', () => {
  for (const c of CASES) {
    describe(`"${c.query}"`, () => {
      // Worst case for the topic-aligned issue: ranked second by FTS.
      const lex = [fts('incidental', 1), fts('aligned', 2)];

      it('topic boost promotes the aligned issue to first', () => {
        const ranked = rankResults(parseQuery(c.query), lex, [], ENV, {
          topicMatches: topicMatchesFor(c.query),
        });
        expect(ranked[0].issue.id).toBe(c.expected);
      });

      it('without the boost the aligned issue stays second (regression sentinel)', () => {
        const ranked = rankResults(parseQuery(c.query), lex, [], ENV);
        // No topic match map → no promotion. The lex-bad ranking persists.
        expect(ranked[0].issue.id).toBe('incidental');
      });

      it('the boost is reflected in applied_boosts', () => {
        const ranked = rankResults(parseQuery(c.query), lex, [], ENV, {
          topicMatches: topicMatchesFor(c.query),
        });
        const winner = ranked.find(r => r.issue.id === c.expected)!;
        expect(winner.debugMeta.applied_boosts).toContain('topic_match');
      });
    });
  }

  it('does not promote unaligned issues when the topic match is empty', () => {
    const ranked = rankResults(
      parseQuery('crypto'),
      [fts('incidental', 1), fts('aligned', 2)],
      [],
      ENV,
      { topicMatches: new Map() },
    );
    // No boost, nothing changes.
    expect(ranked[0].issue.id).toBe('incidental');
  });
});
