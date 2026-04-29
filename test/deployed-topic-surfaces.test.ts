import { describe, expect, it } from 'vitest';

const BASE = 'https://flux-search.adewale-883.workers.dev';

describe('deployed topic surfaces', () => {
  it('has populated corpus topics for visible topic UI', async () => {
    const res = await fetch(`${BASE}/topics?limit=5`);
    expect(res.status).toBe(200);
    const body = await res.json() as { topics?: unknown[] };
    expect(body.topics?.length ?? 0).toBeGreaterThan(0);
  });

  it('has issue topics and related issues for a known issue page', async () => {
    const res = await fetch(`${BASE}/issues/issue/214/sections`);
    expect(res.status).toBe(200);
    const body = await res.json() as { topics?: unknown[]; related_issues?: unknown[] };
    expect(body.topics?.length ?? 0).toBeGreaterThan(0);
    expect(body.related_issues?.length ?? 0).toBeGreaterThan(0);
  });
});
