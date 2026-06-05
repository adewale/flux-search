import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { searchRoutes } from '../src/routes/search';
import { makeD1 } from './helpers-d1';

function requestSearch(env: Record<string, unknown>, path = '/search?q=trust') {
  const app = new Hono();
  app.route('/', searchRoutes as any);
  return app.request(path, { headers: { 'cf-connecting-ip': '203.0.113.10' } }, env as any);
}

describe('public semantic search rate limiting', () => {
  it('rejects metered text searches when the rate limiter denies the key', async () => {
    let key = '';
    const res = await requestSearch({
      DB: makeD1() as any,
      SEARCH_RATE_LIMITER: { limit: async (input: { key: string }) => { key = input.key; return { success: false }; } },
    });

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(key).toBe('203.0.113.10');
  });

  it('keeps local/test behavior unchanged when no limiter binding exists', async () => {
    const res = await requestSearch({ DB: makeD1() as any }, '/search?q=year:2024');
    expect(res.status).toBe(200);
  });
});
