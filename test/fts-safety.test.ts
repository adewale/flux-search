/**
 * FTS5 input safety tests.
 *
 * FTS5 treats certain characters as syntax: ' (phrase), : (column),
 * * (prefix), ( ) (grouping), & < > (operators in some modes).
 * User input containing these must not crash the search.
 */
import { describe, it, expect } from 'vitest';
import { buildFtsQuery } from '../src/routes/search';
import { parseQuery } from '../src/lib/query-parser';

describe('buildFtsQuery sanitization', () => {
  it('apostrophes are safe', () => {
    const parsed = parseQuery("it's");
    const fts = buildFtsQuery(parsed);
    expect(fts).not.toContain("'");
  });

  it('colons from unknown operators are safe', () => {
    const parsed = parseQuery('foo:bar');
    const fts = buildFtsQuery(parsed);
    expect(fts).not.toContain(':');
  });

  it('angle brackets are safe', () => {
    const parsed = parseQuery('a<b>c');
    const fts = buildFtsQuery(parsed);
    expect(fts).not.toContain('<');
    expect(fts).not.toContain('>');
  });

  it('ampersands are safe', () => {
    const parsed = parseQuery('a&b');
    const fts = buildFtsQuery(parsed);
    expect(fts).not.toContain('&');
  });

  it('parentheses are safe', () => {
    const parsed = parseQuery('(test)');
    const fts = buildFtsQuery(parsed);
    expect(fts).not.toContain('(');
    expect(fts).not.toContain(')');
  });

  it('asterisks are safe', () => {
    const parsed = parseQuery('test*');
    const fts = buildFtsQuery(parsed);
    expect(fts).not.toContain('*');
  });

  it('preserves alphanumeric content', () => {
    const parsed = parseQuery("it's don't foo:bar a&b");
    const fts = buildFtsQuery(parsed);
    expect(fts).toContain('it');
    expect(fts).toContain('don');
    expect(fts).toContain('foo');
    expect(fts).toContain('bar');
  });

  it('valid operators are NOT in the free text', () => {
    const parsed = parseQuery('trust before:2023');
    const fts = buildFtsQuery(parsed);
    expect(fts).toContain('trust');
    expect(fts).not.toContain('before');
    expect(fts).not.toContain('2023');
  });

  it('quoted phrases preserve their content', () => {
    const parsed = parseQuery('"institutional trust"');
    const fts = buildFtsQuery(parsed);
    expect(fts).toContain('"institutional trust"');
  });
});

describe('live API safety', () => {
  const SEARCH_URL = 'https://flux-search.adewale-883.workers.dev';

  async function searchStatus(q: string): Promise<number> {
    const resp = await fetch(`${SEARCH_URL}/search?q=${encodeURIComponent(q)}`);
    return resp.status;
  }

  it("apostrophe queries don't crash", async () => {
    expect(await searchStatus("it's")).toBe(200);
    expect(await searchStatus("don't")).toBe(200);
    expect(await searchStatus("they're")).toBe(200);
  });

  it("special characters don't crash", async () => {
    expect(await searchStatus('a&b')).toBe(200);
    expect(await searchStatus('a<b')).toBe(200);
    expect(await searchStatus('a>b')).toBe(200);
    expect(await searchStatus('(test)')).toBe(200);
    expect(await searchStatus('test*')).toBe(200);
  });

  it("unknown operators don't crash", async () => {
    expect(await searchStatus('foo:bar')).toBe(200);
    expect(await searchStatus('http://example.com')).toBe(200);
  });

  it('non-existent issue number returns 0 results', async () => {
    const resp = await fetch(`${SEARCH_URL}/search?q=${encodeURIComponent('issue:9999')}`);
    const data = await resp.json() as any;
    expect(resp.status).toBe(200);
    expect(data.total_hits).toBe(0);
  });
});
