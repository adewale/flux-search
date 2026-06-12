/**
 * Date extraction integrity tests.
 *
 * Known constraints:
 * - FLUX Review started in May 2021 (issue #1 = 2021-05-02)
 * - All issues are between 2021 and present
 * - No issue predates 2021
 * - Dates should come from metadata or heading area, not body URLs
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizePage } from '../src/lib/normalizer';

function makePage(markdown: string, metadata: Record<string, string> = {}) {
  return {
    url: 'https://read.fluxcollective.org/p/test',
    markdown,
    metadata,
  };
}

describe('date extraction correctness', () => {
  it('extracts date from article:published_time metadata', () => {
    const result = normalizePage(makePage(
      '# Title\n\n' + 'Content. '.repeat(30),
      { 'article:published_time': '2023-01-05T00:00:00Z' }
    ), 'run-1');
    expect(result.issue.published_at).toBe('2023-01-05');
  });

  it('extracts date from human-readable heading like "January 5th, 2023"', () => {
    const result = normalizePage(makePage(
      '# Title\n\n### January 5th, 2023\n\nContent. ' + 'More. '.repeat(30)
    ), 'run-1');
    expect(result.issue.published_at).toBe('2023-01-05');
  });

  it('does NOT extract date from URL query parameters in body', () => {
    const result = normalizePage(makePage(
      '# Title\n\n### January 5th, 2023\n\n' +
      'Content with a [link](https://example.com?start=2012-01-01) here. ' + 'More. '.repeat(30)
    ), 'run-1');
    // Should get 2023-01-05 from the heading, NOT 2012-01-01 from the URL
    expect(result.issue.published_at).toBe('2023-01-05');
    expect(result.issue.published_at).not.toBe('2012-01-01');
  });

  it('does NOT extract date from URLs in markdown links', () => {
    const result = normalizePage(makePage(
      '# Title\n\n### March 15, 2024\n\n' +
      '[Graph](https://fred.stlouisfed.org/graph?start=1999-01-01&end=2023-12-31) shows data. ' + 'More. '.repeat(30)
    ), 'run-1');
    expect(result.issue.published_at).toBe('2024-03-15');
    expect(result.issue.year).toBe(2024);
  });

  it('issue #81 scenario: date in URL param should not override heading date', () => {
    const md = `# 🌀🗞 The FLUX Review, Ep. 81

### January 5th, 2023

Jan 06, 20234ShareContent here.

## Lead essay

Some content with a [link](https://example.com?period=1-year&start=2012-01-01) embedded.

More content. ` + 'Words. '.repeat(30);

    const result = normalizePage(makePage(md), 'run-1');
    expect(result.issue.published_at).toBe('2023-01-05');
    expect(result.issue.year).toBe(2023);
  });
});

describe('date range constraints', () => {
  it('PBT: all extracted dates are 2021 or later', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 2021, max: 2026 }),
        (month, day, year) => {
          const md = `# Title\n\n### ${month} ${day}, ${year}\n\nContent. ` + 'More. '.repeat(30);
          const result = normalizePage(makePage(md), 'run-1');
          if (result.issue.published_at) {
            const extractedYear = parseInt(result.issue.published_at.split('-')[0]);
            expect(extractedYear).toBeGreaterThanOrEqual(2021);
            expect(extractedYear).toBeLessThanOrEqual(2027);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('PBT: ISO dates embedded in URLs do not become published_at', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990, max: 2015 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (year, month, day) => {
          const oldDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const md = `# Title\n\n### March 15, 2024\n\n` +
            `See [data](https://example.com?start=${oldDate}) for context. ` + 'More. '.repeat(30);
          const result = normalizePage(makePage(md), 'run-1');
          expect(result.issue.published_at).toBe('2024-03-15');
          expect(result.issue.published_at).not.toBe(oldDate);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ========================
// Timezone-independent derived fields
// ========================
// year/month must be derived from the published_at STRING, not from local
// Date getters: `new Date('2024-01-01')` parses as UTC midnight, and
// `.getFullYear()` reads it in the process timezone. West of UTC that's
// 2023-12-31 — so corpus processing on a developer machine could shift
// year/month at boundaries. (Run with TZ=America/New_York to reproduce
// against the old implementation; these must pass in ANY timezone.)
describe('derived year/month match published_at in any timezone', () => {
  it('keeps year/month on the UTC date at the year boundary', () => {
    const result = normalizePage(makePage(
      '# Title\n\nContent. ' + 'More. '.repeat(30),
      { 'article:published_time': '2024-01-01T00:00:00Z' }
    ), 'run-1');
    expect(result.issue.published_at).toBe('2024-01-01');
    expect(result.issue.year).toBe(2024);
    expect(result.issue.month).toBe(1);
  });

  it('keeps year/month on the UTC date at a month boundary', () => {
    const result = normalizePage(makePage(
      '# Title\n\nContent. ' + 'More. '.repeat(30),
      { 'article:published_time': '2023-06-01T00:00:00Z' }
    ), 'run-1');
    expect(result.issue.year).toBe(2023);
    expect(result.issue.month).toBe(6);
  });

  it('PBT: year and month always equal the published_at string components', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2021, max: 2026 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (y, m, d) => {
          const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const result = normalizePage(makePage(
            '# Title\n\nContent. ' + 'More. '.repeat(30),
            { 'article:published_time': `${iso}T00:00:00Z` }
          ), 'run-1');
          expect(result.issue.published_at).toBe(iso);
          expect(result.issue.year).toBe(y);
          expect(result.issue.month).toBe(m);
        }
      ),
      { numRuns: 150 }
    );
  });
});
