import { describe, it, expect } from 'vitest';
import { parseQuery } from '../src/lib/query-parser';

describe('parseQuery', () => {
  it('parses free text', () => {
    const result = parseQuery('institutional trust');
    expect(result.freeText).toBe('institutional trust');
    expect(result.phrases).toEqual([]);
    expect(result.filters).toEqual({});
    expect(result.operators).toEqual([]);
  });

  it('extracts quoted phrases', () => {
    const result = parseQuery('"just enough structure"');
    expect(result.phrases).toEqual(['just enough structure']);
    expect(result.freeText).toBe('');
  });

  it('extracts multiple quoted phrases', () => {
    const result = parseQuery('"phrase one" some text "phrase two"');
    expect(result.phrases).toEqual(['phrase one', 'phrase two']);
    expect(result.freeText).toBe('some text');
  });

  it('parses before: operator with full date', () => {
    const result = parseQuery('trust before:2024-01-15');
    expect(result.freeText).toBe('trust');
    expect(result.filters.before).toBe('2024-01-15');
    expect(result.operators).toEqual(['before:2024-01-15']);
  });

  it('parses after: operator with full date', () => {
    const result = parseQuery('coordination after:2023-06-01');
    expect(result.freeText).toBe('coordination');
    expect(result.filters.after).toBe('2023-06-01');
  });

  it('parses year: operator', () => {
    const result = parseQuery('year:2024 systems thinking');
    expect(result.filters.year).toBe(2024);
    expect(result.freeText).toBe('systems thinking');
  });

  it('parses issue: operator', () => {
    const result = parseQuery('issue:198');
    expect(result.filters.issueNumber).toBe(198);
    expect(result.freeText).toBe('');
  });

  it('handles year-only date in before:', () => {
    const result = parseQuery('before:2024');
    expect(result.filters.before).toBe('2024-01-01');
  });

  it('handles year-month date in after:', () => {
    const result = parseQuery('after:2023-06');
    expect(result.filters.after).toBe('2023-06-01');
  });

  it('ignores invalid year values', () => {
    const result = parseQuery('year:1899');
    expect(result.filters.year).toBeUndefined();
  });

  it('ignores invalid issue numbers', () => {
    const result = parseQuery('issue:0');
    expect(result.filters.issueNumber).toBeUndefined();
  });

  it('leaves unknown operators as free text', () => {
    const result = parseQuery('foo:bar trust');
    expect(result.freeText).toBe('foo:bar trust');
    expect(result.operators).toEqual([]);
  });

  it('handles combined operators and phrases', () => {
    const result = parseQuery('"just enough" after:2024-01-01 year:2024');
    expect(result.phrases).toEqual(['just enough']);
    expect(result.filters.after).toBe('2024-01-01');
    expect(result.filters.year).toBe(2024);
    expect(result.freeText).toBe('');
  });

  it('truncates input at MAX_QUERY_LENGTH', () => {
    const longQuery = 'a'.repeat(600);
    const result = parseQuery(longQuery);
    expect(result.freeText.length).toBeLessThanOrEqual(500);
  });

  it('handles empty input', () => {
    const result = parseQuery('');
    expect(result.freeText).toBe('');
    expect(result.phrases).toEqual([]);
    expect(result.filters).toEqual({});
  });

  it('handles whitespace-only input', () => {
    const result = parseQuery('   ');
    expect(result.freeText).toBe('');
  });

  it('normalizes extra whitespace in free text', () => {
    const result = parseQuery('some   extra    spaces');
    expect(result.freeText).toBe('some extra spaces');
  });
});
