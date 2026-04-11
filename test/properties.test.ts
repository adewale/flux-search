import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseQuery } from '../src/lib/query-parser';
import { chunkIssue } from '../src/lib/chunker';
import { normalizePage } from '../src/lib/normalizer';
import { rankResults } from '../src/lib/hybrid-ranker';
import { makeIssue, makeFtsResult, makeSemanticCandidate, defaultEnv } from './helpers';

// ========================
// Query Parser Properties
// ========================
describe('parseQuery properties', () => {
  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = parseQuery(input);
        expect(result).toBeDefined();
        expect(result.freeText).toBeDefined();
        expect(result.phrases).toBeInstanceOf(Array);
        expect(result.filters).toBeDefined();
        expect(result.operators).toBeInstanceOf(Array);
      }),
      { numRuns: 500 }
    );
  });

  it('truncates input to at most 500 characters', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 2000 }), (input) => {
        const result = parseQuery(input);
        expect(result.freeText.length).toBeLessThanOrEqual(500);
      }),
      { numRuns: 200 }
    );
  });

  it('extracted phrases are substrings of original input', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => !s.includes('"')), // avoid nested quote edge cases
        (text) => {
          // Wrap some text in quotes
          const input = `"${text}" other words`;
          const result = parseQuery(input);
          for (const phrase of result.phrases) {
            expect(input).toContain(phrase);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('valid operators are removed from freeText', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('before', 'after', 'year', 'issue'),
        fc.stringMatching(/^[a-zA-Z0-9-]+$/),
        (op, value) => {
          const input = `${op}:${value} hello`;
          const result = parseQuery(input);
          expect(result.freeText).not.toContain(`${op}:`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('year filter is always in valid range or undefined', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = parseQuery(`year:${input}`);
        if (result.filters.year !== undefined) {
          expect(result.filters.year).toBeGreaterThanOrEqual(2000);
          expect(result.filters.year).toBeLessThanOrEqual(2100);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('issueNumber filter is always positive or undefined', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = parseQuery(`issue:${input}`);
        if (result.filters.issueNumber !== undefined) {
          expect(result.filters.issueNumber).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ========================
// Chunker Properties
// ========================
describe('chunkIssue properties', () => {
  it('always produces at least one chunk', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (title) => {
        const chunks = chunkIssue('issue-1', title, null, null);
        expect(chunks.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 200 }
    );
  });

  it('chunk indices are sequential starting from 0', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.option(fc.string()),
        fc.option(fc.string({ minLength: 10 })),
        (title, summary, body) => {
          const chunks = chunkIssue('issue-1', title, summary ?? null, body ?? null);
          for (let i = 0; i < chunks.length; i++) {
            expect(chunks[i].chunk_index).toBe(i);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('all chunks have the correct issue_id', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.string({ minLength: 1 }), (id, title) => {
        const chunks = chunkIssue(id, title, null, 'some body text');
        for (const chunk of chunks) {
          expect(chunk.issue_id).toBe(id);
          expect(chunk.id.startsWith(`${id}-chunk-`)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('first chunk is always title_summary', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.option(fc.string()),
        (title, body) => {
          const chunks = chunkIssue('id', title, null, body ?? null);
          expect(chunks[0].section_label).toBe('title_summary');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('token estimates are positive', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (title) => {
        const chunks = chunkIssue('id', title, null, null);
        for (const chunk of chunks) {
          expect(chunk.token_estimate).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('no chunk text is empty', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 10 }),
        (title, body) => {
          const chunks = chunkIssue('id', title, null, body);
          for (const chunk of chunks) {
            expect(chunk.chunk_text.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ========================
// Normalizer Properties
// ========================
describe('normalizePage properties', () => {
  it('never throws on arbitrary markdown', () => {
    fc.assert(
      fc.property(fc.string(), (markdown) => {
        const result = normalizePage(
          { url: 'https://read.fluxcollective.org/p/test', markdown },
          'run-1'
        );
        expect(result).toBeDefined();
        expect(result.issue).toBeDefined();
        expect(result.issue.id).toBeTruthy();
      }),
      { numRuns: 300 }
    );
  });

  it('issue ID is always a valid UUID', () => {
    fc.assert(
      fc.property(fc.string(), (markdown) => {
        const result = normalizePage(
          { url: 'https://read.fluxcollective.org/p/test', markdown },
          'run-1'
        );
        expect(result.issue.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      }),
      { numRuns: 100 }
    );
  });

  it('source_url always matches input URL', () => {
    fc.assert(
      fc.property(
        fc.webUrl().filter(u => u.includes('/p/')),
        fc.string(),
        (url, markdown) => {
          const result = normalizePage({ url, markdown }, 'run-1');
          expect(result.issue.source_url).toBe(url);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('word count is non-negative', () => {
    fc.assert(
      fc.property(fc.string(), (markdown) => {
        const result = normalizePage(
          { url: 'https://example.com/p/test', markdown },
          'run-1'
        );
        expect(result.issue.word_count).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 }
    );
  });

  it('contentType is always one of the valid types', () => {
    fc.assert(
      fc.property(fc.string(), (markdown) => {
        const result = normalizePage(
          { url: 'https://example.com/p/test', markdown },
          'run-1'
        );
        expect(['issue', 'non_issue_post', 'junk']).toContain(result.contentType);
      }),
      { numRuns: 200 }
    );
  });
});

// ========================
// Hybrid Ranker Properties
// ========================

// makeIssue, makeFtsResult, makeSemanticCandidate, defaultEnv imported from ./helpers

describe('rankResults properties', () => {
  it('output includes all lexical results and strong semantic results', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        (nLexical, nSemantic) => {
          const lexical: FtsSearchResult[] = Array.from({ length: nLexical }, (_, i) => {
            const issue = makeIssue({ title: `Lexical ${i}` });
            return { issue, bm25Score: -(i + 1), rank: i + 1, highlightSnippet: null };
          });
          const semantic: SemanticCandidate[] = Array.from({ length: nSemantic }, (_, i) => {
            const issue = makeIssue({ title: `Semantic ${i}` });
            return { issueId: issue.id, issue, topScore: 0.9 - i * 0.1, topChunkSection: null, topChunkText: '', chunkCount: 1, rank: i + 1 };
          });

          const parsed = { freeText: 'test', phrases: [], filters: {}, operators: [] };
          const ranked = rankResults(parsed, lexical, semantic, defaultEnv);

          // All lexical results always included
          expect(ranked.length).toBeGreaterThanOrEqual(nLexical);
          // Weak semantic-only results may be filtered
          expect(ranked.length).toBeLessThanOrEqual(nLexical + nSemantic);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('results are sorted by descending final score', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        (n) => {
          const lexical: FtsSearchResult[] = Array.from({ length: n }, (_, i) => {
            const issue = makeIssue();
            return { issue, bm25Score: -(i + 1), rank: i + 1, highlightSnippet: null };
          });

          const parsed = { freeText: 'test', phrases: [], filters: {}, operators: [] };
          const ranked = rankResults(parsed, lexical, [], defaultEnv);

          for (let i = 1; i < ranked.length; i++) {
            expect(ranked[i - 1].debugMeta.final_score).toBeGreaterThanOrEqual(ranked[i].debugMeta.final_score);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('every result has a non-empty matchedBy array', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (n) => {
          const lexical: FtsSearchResult[] = Array.from({ length: n }, (_, i) => {
            const issue = makeIssue();
            return { issue, bm25Score: -(i + 1), rank: i + 1, highlightSnippet: null };
          });

          const parsed = { freeText: 'test', phrases: [], filters: {}, operators: [] };
          const ranked = rankResults(parsed, lexical, [], defaultEnv);

          for (const r of ranked) {
            expect(r.matchedBy.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exact issue number match always ranks first', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        (num) => {
          const targetIssue = makeIssue({ issue_number: num, title: 'Target' });
          const otherIssue = makeIssue({ title: 'Other' });

          const lexical: FtsSearchResult[] = [
            { issue: otherIssue, bm25Score: -1, rank: 1, highlightSnippet: null },
            { issue: targetIssue, bm25Score: -2, rank: 2, highlightSnippet: null },
          ];

          const parsed = { freeText: '', phrases: [], filters: { issueNumber: num }, operators: [`issue:${num}`] };
          const ranked = rankResults(parsed, lexical, [], defaultEnv);

          expect(ranked[0].issue.id).toBe(targetIssue.id);
        }
      ),
      { numRuns: 50 }
    );
  });
});
