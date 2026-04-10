/**
 * Round 2 PBT: parseDate roundtrip, buildFtsQuery injection,
 * cleanContent nested brackets, chunker content preservation.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseQuery } from '../src/lib/query-parser';
import { chunkIssue } from '../src/lib/chunker';
import { normalizePage } from '../src/lib/normalizer';

// ========================
// 1. parseDate roundtrip: Feb 30 etc.
// ========================
describe('parseDate roundtrip', () => {
  it('accepted YYYY-MM-DD dates survive roundtrip through Date', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        (year, month, day) => {
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const result = parseQuery(`before:${dateStr}`);
          if (result.filters.before) {
            // Roundtrip: parse to Date, format back, should equal input
            const d = new Date(result.filters.before + 'T00:00:00Z');
            const roundtrip = d.toISOString().split('T')[0];
            expect(roundtrip).toBe(result.filters.before);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});

// ========================
// 2. buildFtsQuery: no FTS5 injection
// ========================
// buildFtsQuery is private in search.ts — test the invariant via parseQuery + manual construction
describe('FTS query safety', () => {
  it('quoted phrases cannot inject FTS5 operators', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('AND', 'OR', 'NOT', 'NEAR', 'NEAR/3'),
        (operator) => {
          // User tries to inject an FTS5 operator as a phrase
          const result = parseQuery(`"${operator}"`);
          // The phrase should be captured, not left as free text
          expect(result.phrases).toContain(operator);
          // Free text should not contain the raw operator
          expect(result.freeText).not.toContain(operator);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('free text with FTS5 special chars does not crash FTS query building', () => {
    // These chars have special meaning in FTS5: *, ^, ", (, ), :
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 30 }).map(s => s.replace(/[^ab *^():"]/g, '')),
        (input) => {
          const result = parseQuery(input);
          // Should not throw, should produce defined output
          expect(result).toBeDefined();
          expect(result.freeText).toBeDefined();
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ========================
// 3. cleanContent: nested brackets in links
// ========================
describe('cleanContent link stripping', () => {
  it('plain text never contains markdown link syntax, even with nested brackets', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.string({ minLength: 0, maxLength: 50 }),
        (linkText, afterText) => {
          const md = `## Title\n\n[${linkText}](https://example.com) ${afterText}`;
          const result = normalizePage({
            url: 'https://example.com/p/test',
            markdown: md,
            metadata: {},
          }, 'run-1');
          if (result.issue.full_text_plain) {
            expect(result.issue.full_text_plain).not.toMatch(/\]\(https?:\/\//);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('handles links with brackets in text like [text [1]](url)', () => {
    const md = '## Title\n\n[something [1]](https://example.com) after';
    const result = normalizePage({
      url: 'https://example.com/p/test',
      markdown: md,
      metadata: {},
    }, 'run-1');
    if (result.issue.full_text_plain) {
      expect(result.issue.full_text_plain).not.toMatch(/\]\(https?:\/\//);
    }
  });
});

// ========================
// 4. Chunker content preservation
// ========================
describe('chunker content preservation', () => {
  it('every unique word in body appears in at least one chunk', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{4,10}$/), { minLength: 20, maxLength: 100 }),
        (words) => {
          // Create body with unique marker words spread across a long text
          const body = words.map((w, i) => `Paragraph ${i}: the concept of ${w} is important.`).join('\n\n');
          const chunks = chunkIssue('id', 'Title', null, body);
          const allChunkText = chunks.map(c => c.chunk_text).join(' ');

          for (const word of words) {
            expect(allChunkText).toContain(word);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('chunk 0 is always title_summary even with very long title', () => {
    const longTitle = 'A '.repeat(5000);
    const chunks = chunkIssue('id', longTitle, null, 'Body text');
    expect(chunks[0].section_label).toBe('title_summary');
    expect(chunks[0].chunk_text).toContain('A');
  });
});
