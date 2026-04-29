import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('topic detail links', () => {
  it('uses the SPA URL for topic search, not the JSON /search endpoint', () => {
    const js = readFileSync('frontend/js/topics-page.js', 'utf8');
    expect(js).toContain('href="/?q=');
    expect(js).not.toContain('href="/search?q=');
  });
});
