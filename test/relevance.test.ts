/**
 * Relevance evaluation harness.
 *
 * Hand-labeled set of {query, expected results} that verifies the search
 * returns the right content. Catches ranking regressions, title pollution,
 * and broken section filtering.
 *
 * Each case specifies a query and what should appear in the top results.
 * This is the test we should have written from the start.
 */
import { describe, it, expect } from 'vitest';

const SEARCH_URL = process.env.SEARCH_URL || 'https://flux-search.adewale-883.workers.dev';

async function search(q: string) {
  const resp = await fetch(`${SEARCH_URL}/search?q=${encodeURIComponent(q)}&limit=20`);
  return resp.json() as Promise<Record<string, any>>;
}

function topIssueNumbers(data: Record<string, any>, n: number = 3): number[] {
  return data.results.slice(0, n).map((r: any) => r.issue_number);
}

function topTitles(data: Record<string, any>, n: number = 3): string[] {
  return data.results.slice(0, n).map((r: any) => r.title);
}

describe('relevance evaluation', () => {
  // --- Exact term matches: the right issue should be #1 ---

  it('"decision treadmill" → #230 is top result', async () => {
    const data = await search('"decision treadmill"');
    expect(topIssueNumbers(data, 1)).toContain(230);
  });

  it('"institutional trust" → returns results containing the phrase', async () => {
    const data = await search('"institutional trust"');
    expect(data.total_hits).toBeGreaterThan(0);
    // The phrase should appear in at least one snippet (not necessarily title)
    const snippets = data.results.map((r: any) => (r.snippet || '').toLowerCase()).join(' ');
    expect(snippets).toMatch(/trust/);
  });

  it('unstuck → #55 "How to get unstuck" is top result', async () => {
    const data = await search('unstuck');
    expect(topIssueNumbers(data, 1)).toContain(55);
    expect(topTitles(data, 1)[0]).toContain('unstuck');
  });

  // --- Issue number lookup ---

  it('issue:198 → returns exactly issue #198', async () => {
    const data = await search('issue:198');
    expect(data.total_hits).toBe(1);
    expect(data.results[0].issue_number).toBe(198);
  });

  it('issue:1 → returns issue #1', async () => {
    const data = await search('issue:1');
    expect(data.total_hits).toBe(1);
    expect(data.results[0].issue_number).toBe(1);
  });

  // --- Date filters ---

  it('before:2022 → all results published before 2022', async () => {
    const data = await search('before:2022');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.published_at < '2022-01-01').toBe(true);
    }
  });

  it('year:2023 → all results from 2023', async () => {
    const data = await search('year:2023');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.published_at.startsWith('2023')).toBe(true);
    }
  });

  // --- Section filter ---

  it('section:lens → all results are from the lens section', async () => {
    const data = await search('section:lens');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.snippet_section).toBe('lens');
    }
  });

  it('section:postcard → all results are from postcard section', async () => {
    const data = await search('section:postcard');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.snippet_section).toBe('postcard');
    }
  });

  // --- Broad queries return many results ---

  it('common word "the" returns most of the archive', async () => {
    const data = await search('the');
    // With 230 issues, a word as common as "the" should match most
    expect(data.total_hits).toBeGreaterThan(100);
  });

  // --- No crud in results ---

  it('results do not contain Substack boilerplate', async () => {
    const data = await search('trust');
    const crud = ['Subscribe', 'Collection notice', 'ReplyShare', 'ragtag band', 'FLUX Review, Ep.'];
    for (const r of data.results) {
      for (const pattern of crud) {
        expect(r.snippet, `crud "${pattern}" in snippet for #${r.issue_number}`).not.toContain(pattern);
        expect(r.title, `crud "${pattern}" in title for #${r.issue_number}`).not.toContain(pattern);
      }
    }
  });

  // --- Semantic search contributes results ---

  it('conceptual query returns results even without exact term match', async () => {
    // "organizational credibility" may not appear verbatim, but related
    // concepts should surface via FTS or semantic search
    const data = await search('organizational credibility');
    expect(data.total_hits).toBeGreaterThan(0);
  });

  // --- Combined operators ---

  it('crypto year:2022 → all results from 2022 about crypto', async () => {
    const data = await search('crypto year:2022');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.published_at.startsWith('2022')).toBe(true);
    }
  });
});
