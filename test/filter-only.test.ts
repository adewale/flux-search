/**
 * RED test: filter-only queries like "before:2024" should return results.
 */

import { describe, it, expect } from 'vitest';
import { parseQuery, isFilterOnly } from '../src/lib/query-parser';

describe('filter-only queries', () => {
  it('before:2024 has a filter but no free text', () => {
    const parsed = parseQuery('before:2024');
    expect(parsed.freeText).toBe('');
    expect(parsed.phrases).toEqual([]);
    expect(parsed.filters.before).toBe('2024-01-01');
  });

  it('year:2023 has a filter but no free text', () => {
    const parsed = parseQuery('year:2023');
    expect(parsed.freeText).toBe('');
    expect(parsed.filters.year).toBe(2023);
  });

  it('section:signposts has a filter but no free text', () => {
    const parsed = parseQuery('section:signposts');
    expect(parsed.freeText).toBe('');
    expect(parsed.filters.section).toBe('signposts');
  });

  it('isFilterOnly correctly identifies filter-only queries', () => {
    expect(isFilterOnly(parseQuery('before:2024'))).toBe(true);
    expect(isFilterOnly(parseQuery('trust before:2024'))).toBe(false);
    expect(isFilterOnly(parseQuery('"phrase" year:2023'))).toBe(false);
    expect(isFilterOnly(parseQuery('year:2023'))).toBe(true);
    expect(isFilterOnly(parseQuery('section:lens'))).toBe(true);
  });
});
