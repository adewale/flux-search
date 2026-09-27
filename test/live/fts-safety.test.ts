/**
 * FTS5 input safety against a deployed Worker (real D1 + FTS5 + Vectorize).
 * The same queries run offline against node:sqlite FTS5 in
 * test/fts-safety.test.ts; this copy checks the deployment.
 */
import { describe, it, expect } from 'vitest';
import { SEARCH_URL } from './live-url';

describe('live API safety', () => {
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
