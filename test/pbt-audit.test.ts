/**
 * PBT tests targeting the 5 HIGH-priority bugs found by the test audit.
 * Each property encodes an invariant that the current code may violate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { parseQuery } from '../src/lib/query-parser';
import { chunkIssue } from '../src/lib/chunker';
import { normalizePage, computeContentHash } from '../src/lib/normalizer';
import { fetchPage } from '../src/crawler/crawl-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ========================
// 1. parseDate: non-null output must be a valid date
// ========================
describe('parseDate via parseQuery', () => {
  it('before: date is always valid or absent', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (dateStr) => {
        const result = parseQuery(`before:${dateStr}`);
        if (result.filters.before) {
          const d = new Date(result.filters.before);
          expect(d.getTime()).not.toBeNaN();
          // Month should be 01-12, day 01-31
          const parts = result.filters.before.split('-');
          expect(parts).toHaveLength(3);
          const month = parseInt(parts[1]);
          const day = parseInt(parts[2]);
          expect(month).toBeGreaterThanOrEqual(1);
          expect(month).toBeLessThanOrEqual(12);
          expect(day).toBeGreaterThanOrEqual(1);
          expect(day).toBeLessThanOrEqual(31);
        }
      }),
      { numRuns: 300 }
    );
  });

  it('year-month format produces valid months (1-12)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 0, max: 99 }),
        (year, month) => {
          const dateStr = `${year}-${String(month).padStart(2, '0')}`;
          const result = parseQuery(`before:${dateStr}`);
          if (result.filters.before) {
            const parts = result.filters.before.split('-');
            const m = parseInt(parts[1]);
            expect(m).toBeGreaterThanOrEqual(1);
            expect(m).toBeLessThanOrEqual(12);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('after: date is always valid or absent', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (dateStr) => {
        const result = parseQuery(`after:${dateStr}`);
        if (result.filters.after) {
          const d = new Date(result.filters.after);
          expect(d.getTime()).not.toBeNaN();
          const parts = result.filters.after.split('-');
          const month = parseInt(parts[1]);
          expect(month).toBeGreaterThanOrEqual(1);
          expect(month).toBeLessThanOrEqual(12);
        }
      }),
      { numRuns: 300 }
    );
  });
});

// ========================
// 2. htmlToSimpleMarkdown: no dangerous tags survive
// ========================
describe('htmlToSimpleMarkdown via fetchPage', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('output never contains script/style/nav/footer/header tags', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.string({ minLength: 0, maxLength: 200 }),
        async (safeContent, tagContent) => {
          const html = `<html><head><title>T</title></head><body>` +
            `<script>${tagContent}</script>` +
            `<style>${tagContent}</style>` +
            `<nav>${tagContent}</nav>` +
            `<footer>${tagContent}</footer>` +
            `<p>${safeContent}</p></body></html>`;

          mockFetch.mockResolvedValue(new Response(html, { status: 200 }));
          const result = await fetchPage('https://example.com/p/test');
          if (result) {
            expect(result.markdown).not.toMatch(/<script/i);
            expect(result.markdown).not.toMatch(/<style/i);
            expect(result.markdown).not.toMatch(/<nav/i);
            expect(result.markdown).not.toMatch(/<footer/i);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ========================
// 3. splitSectionIntoChunks: size and completeness invariants
// ========================
describe('chunker invariants', () => {
  const MAX_CHUNK_CHARS = 3200;

  it('no chunk exceeds MAX_CHUNK_CHARS', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10000 }),
        (body) => {
          const chunks = chunkIssue('id', 'Title', null, body);
          for (const chunk of chunks) {
            expect(chunk.chunk_text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS + 10); // small tolerance for boundary
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('no chunk is empty', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 5000 }),
        (body) => {
          const chunks = chunkIssue('id', 'Title', null, body);
          for (const chunk of chunks) {
            expect(chunk.chunk_text.trim().length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('chunk indices are contiguous from 0', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 8000 }),
        (body) => {
          const chunks = chunkIssue('id', 'Title', 'Summary', body);
          for (let i = 0; i < chunks.length; i++) {
            expect(chunks[i].chunk_index).toBe(i);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ========================
// 4. extractIssueNumber: /p/N always returns N
// ========================
describe('extractIssueNumber via normalizePage', () => {
  it('/p/N URL always extracts N', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        (num) => {
          const result = normalizePage({
            url: `https://read.fluxcollective.org/p/${num}`,
            markdown: '# Title\n\n' + 'Content. '.repeat(30),
            metadata: {},
          }, 'run-1');
          expect(result.issue.issue_number).toBe(num);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('/p/N-slug URL extracts N', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        fc.stringMatching(/^[a-z-]{1,30}$/),
        (num, slug) => {
          const result = normalizePage({
            url: `https://read.fluxcollective.org/p/${num}-${slug}`,
            markdown: '# Title\n\n' + 'Content. '.repeat(30),
            metadata: {},
          }, 'run-1');
          expect(result.issue.issue_number).toBe(num);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('/p/flux-review-ep-N-slug URL extracts N', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        (num) => {
          const result = normalizePage({
            url: `https://read.fluxcollective.org/p/the-flux-review-ep-${num}`,
            markdown: '# Title\n\n' + 'Content. '.repeat(30),
            metadata: {},
          }, 'run-1');
          expect(result.issue.issue_number).toBe(num);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ========================
// 5. cleanContent: plain text has no markdown syntax
// ========================
describe('cleanContent plain text output', () => {
  it('plain text never contains heading markers', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 500 }),
        (heading, body) => {
          const md = `## ${heading}\n\n${body}`;
          const result = normalizePage({
            url: 'https://example.com/p/test',
            markdown: md,
            metadata: {},
          }, 'run-1');
          if (result.issue.full_text_plain) {
            // No lines should start with # (heading markers)
            for (const line of result.issue.full_text_plain.split('\n')) {
              expect(line.trimStart()).not.toMatch(/^#{1,6}\s/);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('plain text never contains markdown link syntax', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (text) => {
          const md = `## Title\n\n[link text](https://example.com) and ${text}`;
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
      { numRuns: 100 }
    );
  });
});
