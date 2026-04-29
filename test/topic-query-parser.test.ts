import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildFtsQuery } from '../src/routes/search';
import { parseQuery } from '../src/lib/query-parser';

describe('topic: query operator', () => {
  it('extracts quoted topic before FTS sanitization', () => {
    const parsed = parseQuery('topic:"institutional trust" before:2024-01-01');
    expect(parsed.filters.topic).toBe('institutional trust');
    expect(parsed.filters.before).toBe('2024-01-01');
    expect(parsed.freeText).toBe('');
    expect(buildFtsQuery(parsed)).toBe('');
  });

  it('keeps apostrophes and punctuation out of normalized topic bind', () => {
    const parsed = parseQuery('topic:"leader\'s trust/accountability" governance');
    expect(parsed.filters.topic).toBe('leader s trust accountability');
    expect(parsed.freeText).toBe('governance');
    expect(buildFtsQuery(parsed)).toBe('governance');
  });

  it('PBT: topic operator never leaks into FTS query', () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 100 }), (topic) => {
      const parsed = parseQuery('topic:"' + topic.replace(/"/g, '') + '"');
      expect(buildFtsQuery(parsed)).not.toContain('topic');
      expect(parsed.phrases).toEqual([]);
    }), { numRuns: 200 });
  });
});
