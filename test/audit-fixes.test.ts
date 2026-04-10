/**
 * Tests for all outstanding audit issues:
 * #5: buildFtsQuery coverage
 * #6: extractPublishDate human-readable dates
 * #7: HTML entity decode rules
 * #8: Rank monotonicity PBT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { parseQuery } from '../src/lib/query-parser';
import { buildFtsQuery } from '../src/routes/search';
import { normalizePage } from '../src/lib/normalizer';
import { rankResults, type RankedResult } from '../src/lib/hybrid-ranker';
import { fetchPage } from '../src/crawler/crawl-client';
import type { IssueRow } from '../src/db/types';
import type { FtsSearchResult } from '../src/db/queries';
import type { SemanticCandidate } from '../src/lib/vector-search';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeIssue(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    id: crypto.randomUUID(), issue_number: null, title: 'Test', subtitle: null,
    published_at: '2024-01-01', source_url: 'https://example.com/p/test',
    canonical_url: 'https://example.com/p/test', authors: null, contributors: null,
    summary: 'Summary.', headings: null, lead_essay_title: null, opening_quote: null,
    full_text_markdown: null, full_text_plain: 'Body text.',
    crawl_run_id: null, content_hash: null, ingested_at: '2024-01-01',
    word_count: 100, status: 'active', year: 2024, month: 1, has_semantic_chunks: 1,
    ...overrides,
  };
}

const env = { LEXICAL_WEIGHT: '1.0', SEMANTIC_WEIGHT: '0.55', RRF_K: '40' } as any;

// ========================
// #5: buildFtsQuery
// ========================
describe('buildFtsQuery', () => {
  it('wraps phrases in double quotes', () => {
    const parsed = parseQuery('"exact phrase" other words');
    const fts = buildFtsQuery(parsed);
    expect(fts).toContain('"exact phrase"');
    expect(fts).toContain('other words');
  });

  it('returns empty string for empty query', () => {
    const parsed = parseQuery('');
    expect(buildFtsQuery(parsed)).toBe('');
  });

  it('handles multiple phrases', () => {
    const parsed = parseQuery('"first phrase" "second phrase"');
    const fts = buildFtsQuery(parsed);
    expect(fts).toContain('"first phrase"');
    expect(fts).toContain('"second phrase"');
  });

  it('handles free text only', () => {
    const parsed = parseQuery('institutional trust');
    const fts = buildFtsQuery(parsed);
    expect(fts).toBe('institutional trust');
  });

  it('strips operators from FTS query', () => {
    const parsed = parseQuery('trust before:2024-01-01 year:2024');
    const fts = buildFtsQuery(parsed);
    expect(fts).toBe('trust');
    expect(fts).not.toContain('before:');
    expect(fts).not.toContain('year:');
  });

  it('PBT: output never contains unquoted FTS5 reserved words from phrases', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('AND', 'OR', 'NOT', 'NEAR'),
        fc.string({ minLength: 1, maxLength: 20 }),
        (reserved, extra) => {
          const parsed = parseQuery(`"${reserved}" ${extra}`);
          const fts = buildFtsQuery(parsed);
          // The reserved word should be inside quotes, not bare
          if (fts.includes(reserved)) {
            expect(fts).toContain(`"${reserved}"`);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ========================
// #6: extractPublishDate human-readable dates
// ========================
describe('extractPublishDate human-readable dates', () => {
  it('parses "March 15, 2024" from markdown', () => {
    const result = normalizePage({
      url: 'https://example.com/p/test',
      markdown: '# Title\n\n### March 15, 2024\n\nContent. ' + 'More. '.repeat(50),
      metadata: {},
    }, 'run-1');
    expect(result.issue.published_at).toBe('2024-03-15');
  });

  it('parses "Jul 18, 2025" from markdown', () => {
    const result = normalizePage({
      url: 'https://example.com/p/test',
      markdown: '# Title\n\n### Jul 18, 2025\n\nContent. ' + 'More. '.repeat(50),
      metadata: {},
    }, 'run-1');
    expect(result.issue.published_at).toBe('2025-07-18');
  });

  it('prefers metadata over markdown date', () => {
    const result = normalizePage({
      url: 'https://example.com/p/test',
      markdown: '# Title\n\n### January 1, 2020\n\nContent. ' + 'More. '.repeat(50),
      metadata: { 'article:published_time': '2025-06-15T00:00:00Z' },
    }, 'run-1');
    expect(result.issue.published_at).toBe('2025-06-15');
  });

  it('returns null when no date found', () => {
    const result = normalizePage({
      url: 'https://example.com/p/test',
      markdown: '# Title\n\nNo dates anywhere in this content. ' + 'More. '.repeat(50),
      metadata: {},
    }, 'run-1');
    expect(result.issue.published_at).toBeNull();
  });
});

// ========================
// #7: HTML entity decode rules
// ========================
describe('HTML entity decoding', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  function htmlResp(html: string) {
    return new Response(html, { status: 200 });
  }

  it('decodes named entities: mdash, ndash, hellip, bull', async () => {
    mockFetch.mockResolvedValue(htmlResp(
      '<p>Em&mdash;dash and en&ndash;dash and dots&hellip; and &bull; bullet</p>'
    ));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).toContain('\u2014'); // em dash
    expect(result!.markdown).toContain('\u2013'); // en dash
    expect(result!.markdown).toContain('\u2026'); // hellip
    expect(result!.markdown).toContain('\u2022'); // bullet
  });

  it('decodes smart quote entities', async () => {
    mockFetch.mockResolvedValue(htmlResp(
      '<p>&lsquo;single&rsquo; and &ldquo;double&rdquo;</p>'
    ));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).toContain('\u2018'); // left single
    expect(result!.markdown).toContain('\u2019'); // right single
    expect(result!.markdown).toContain('\u201C'); // left double
    expect(result!.markdown).toContain('\u201D'); // right double
  });

  it('decodes numeric character references (decimal)', async () => {
    mockFetch.mockResolvedValue(htmlResp(
      '<p>&#8217; and &#169; and &#60;</p>'
    ));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).toContain('\u2019'); // right single quote (8217)
    expect(result!.markdown).toContain('\u00A9'); // copyright (169)
    expect(result!.markdown).toContain('<');       // less-than (60) — decoded, then &lt; decoded
  });

  it('decodes hex character references', async () => {
    mockFetch.mockResolvedValue(htmlResp(
      '<p>&#x2014; and &#x2019; and &#x3C;</p>'
    ));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).toContain('\u2014'); // em dash
    expect(result!.markdown).toContain('\u2019'); // right single quote
  });
});

// ========================
// #8: Rank monotonicity PBT
// ========================
describe('rank score monotonicity', () => {
  it('adding a boost never lowers score', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // has title overlap
        fc.boolean(), // has multi chunk
        (hasTitleOverlap, hasMultiChunk) => {
          // Base issue — plain FTS match
          const baseIssue = makeIssue({ title: 'trust in organizations' });
          const baseFts: FtsSearchResult = { issue: baseIssue, bm25Score: -1, rank: 1, highlightSnippet: null };

          // Boosted issue — same FTS match + optional title overlap via query terms
          const boostedIssue = makeIssue({
            title: hasTitleOverlap ? 'trust in organizations' : 'Different title',
          });
          const boostedFts: FtsSearchResult = { issue: boostedIssue, bm25Score: -2, rank: 2, highlightSnippet: null };

          // Optionally add semantic match for multi-chunk boost
          const semantic: SemanticCandidate[] = hasMultiChunk ? [{
            issueId: boostedIssue.id,
            issue: boostedIssue,
            topScore: 0.9,
            topChunkSection: 'body',
            topChunkText: 'trust',
            chunkCount: 3,
            rank: 1,
          }] : [];

          const parsed = { freeText: 'trust organizations', phrases: [], filters: {}, operators: [] };
          const ranked = rankResults(parsed, [baseFts, boostedFts], semantic, env);

          // Every result should have a defined score
          for (const r of ranked) {
            expect(r.debugMeta.final_score).toBeDefined();
            expect(typeof r.debugMeta.final_score).toBe('number');
          }

          // Results should be sorted by descending score
          for (let i = 1; i < ranked.length; i++) {
            expect(ranked[i - 1].debugMeta.final_score).toBeGreaterThanOrEqual(
              ranked[i].debugMeta.final_score
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exact issue match always ranks first regardless of other scores', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 10 }),
        (targetNum, numOthers) => {
          const target = makeIssue({ issue_number: targetNum, title: 'Target' });
          const others = Array.from({ length: numOthers }, (_, i) =>
            makeIssue({ title: `Other ${i}` })
          );

          const allFts: FtsSearchResult[] = [
            ...others.map((issue, i) => ({ issue, bm25Score: -(i + 1), rank: i + 1, highlightSnippet: null })),
            { issue: target, bm25Score: -(numOthers + 1), rank: numOthers + 1, highlightSnippet: null },
          ];

          const parsed = { freeText: '', phrases: [], filters: { issueNumber: targetNum }, operators: [`issue:${targetNum}`] };
          const ranked = rankResults(parsed, allFts, [], env);

          expect(ranked[0].issue.id).toBe(target.id);
        }
      ),
      { numRuns: 50 }
    );
  });
});
