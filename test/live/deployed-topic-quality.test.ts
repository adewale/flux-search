import { describe, expect, it } from 'vitest';
import { SEARCH_URL } from './live-url';

const FORBIDDEN = ['signposts clues', 'editor note', 'people', 'world', 'time', 'move', 'point', 'direction'];

describe('deployed topic quality', () => {
  it('does not surface editorial boilerplate or generic singleton noise in top topics', async () => {
    const res = await fetch(`${SEARCH_URL}/topics?limit=50`);
    expect(res.status).toBe(200);
    const body = await res.json() as { topics: Array<{ keyword: string }> };
    const keywords = body.topics.map(t => t.keyword);
    for (const forbidden of FORBIDDEN) {
      expect(keywords).not.toContain(forbidden);
    }
  });

  it('does not expose boilerplate topic detail pages', async () => {
    for (const topic of ['signposts clues', 'editor note']) {
      const res = await fetch(`${SEARCH_URL}/topics/${encodeURIComponent(topic)}`);
      expect(res.status).toBe(404);
    }
  });
});
