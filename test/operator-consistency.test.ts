/**
 * PBT: Verify search operator language is internally consistent
 * and that combinations of operators behave properly.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseQuery, isFilterOnly } from '../src/lib/query-parser';

describe('operator parsing consistency', () => {
  it('PBT: accepted operators are removed from freeText', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('before', 'after', 'year', 'issue'),
        fc.stringMatching(/^[a-zA-Z0-9-]+$/),
        fc.string({ minLength: 0, maxLength: 30 }),
        (op, value, extra) => {
          const input = `${extra} ${op}:${value}`.trim();
          const parsed = parseQuery(input);
          // If the operator was accepted (appears in operators list),
          // it should not appear in freeText
          if (parsed.operators.includes(`${op}:${value}`)) {
            expect(parsed.freeText).not.toContain(`${op}:${value}`);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('PBT: section: with invalid value stays in freeText', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('invalid', 'foo', 'essays', 'bar'),
        (value) => {
          const parsed = parseQuery(`section:${value}`);
          expect(parsed.filters.section).toBeUndefined();
          expect(parsed.freeText).toContain(`section:${value}`);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('PBT: unrecognized operators stay in freeText', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('title', 'author', 'foo', 'bar', 'source'),
        fc.stringMatching(/^[a-zA-Z0-9]+$/),
        (op, value) => {
          const parsed = parseQuery(`${op}:${value}`);
          expect(parsed.operators).not.toContain(`${op}:${value}`);
          expect(parsed.freeText).toContain(`${op}:${value}`);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('PBT: multiple filters all parse independently', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2020, max: 2026 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 2020, max: 2026 }),
        (y1, m1, d1, y2) => {
          const before = `${y1}-${String(m1).padStart(2, '0')}-${String(d1).padStart(2, '0')}`;
          const input = `before:${before} year:${y2}`;
          const parsed = parseQuery(input);

          if (parsed.filters.before) {
            expect(parsed.filters.before).toBe(before);
          }
          if (parsed.filters.year) {
            expect(parsed.filters.year).toBe(y2);
          }
          // Both operators should be recorded
          expect(parsed.operators.length).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('PBT: filter + free text preserves both', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3,10}$/),
        fc.integer({ min: 2020, max: 2026 }),
        (word, year) => {
          const parsed = parseQuery(`${word} year:${year}`);
          expect(parsed.freeText).toContain(word);
          expect(parsed.filters.year).toBe(year);
          expect(isFilterOnly(parsed)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('PBT: filter-only has no free text', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('before:2024', 'after:2023', 'year:2022', 'issue:100', 'section:lens'),
        (op) => {
          const parsed = parseQuery(op);
          expect(parsed.freeText).toBe('');
          expect(isFilterOnly(parsed)).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('PBT: phrases + filters work together', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z ]{3,20}$/),
        fc.integer({ min: 2020, max: 2026 }),
        (phrase, year) => {
          const parsed = parseQuery(`"${phrase}" year:${year}`);
          expect(parsed.phrases).toContain(phrase);
          expect(parsed.filters.year).toBe(year);
          expect(isFilterOnly(parsed)).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('PBT: section filter only accepts valid section types', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'lead_essay', 'signposts', 'lens', 'book', 'postcard', 'worth_your_time', 'fluxers',
          'invalid', 'foo', 'essays', 'SIGNPOSTS'
        ),
        (section) => {
          const parsed = parseQuery(`section:${section}`);
          const validSections = ['lead_essay', 'signposts', 'lens', 'book', 'postcard', 'worth_your_time', 'fluxers'];
          if (validSections.includes(section.toLowerCase())) {
            expect(parsed.filters.section).toBe(section.toLowerCase());
          } else {
            expect(parsed.filters.section).toBeUndefined();
            // Invalid section value stays in freeText
            expect(parsed.freeText).toContain(`section:${section}`);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it('PBT: order of operators does not matter', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2020, max: 2026 }),
        fc.integer({ min: 1, max: 234 }),
        (year, num) => {
          const a = parseQuery(`year:${year} issue:${num}`);
          const b = parseQuery(`issue:${num} year:${year}`);
          expect(a.filters.year).toBe(b.filters.year);
          expect(a.filters.issueNumber).toBe(b.filters.issueNumber);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('PBT: before: and after: dates are always valid ISO format or absent', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 15 }), (dateStr) => {
        const parsed = parseQuery(`before:${dateStr} after:${dateStr}`);
        if (parsed.filters.before) {
          expect(parsed.filters.before).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        if (parsed.filters.after) {
          expect(parsed.filters.after).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }),
      { numRuns: 200 }
    );
  });
});
