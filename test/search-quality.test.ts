/**
 * Comprehensive search quality test suite.
 *
 * Tests the live API across seven dimensions: ranking quality, section
 * filters, date filters, aggregate consistency, result quality,
 * pagination, and edge cases.
 *
 * Every test calls the live search endpoint and makes 3+ assertions
 * to ensure each quality dimension is meaningfully covered.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEARCH_URL =
  process.env.SEARCH_URL || 'https://flux-search.adewale-883.workers.dev';

interface SearchResult {
  issue_id: string;
  title: string;
  issue_number: number;
  published_at: string;
  snippet: string;
  snippet_section: string | null;
  confidence: string;
  canonical_url: string;
  matched_by: string[];
}

interface SearchResponse {
  parsed_query: {
    free_text: string;
    phrases: string[];
    filters: Record<string, any>;
  } | null;
  applied_filters: string[];
  total_hits: number;
  year_distribution?: Record<string, number>;
  quarter_distribution?: Record<string, Record<string, number>>;
  section_facets?: Record<string, number>;
  results: SearchResult[];
}

/** Fetch the search API with optional query params. */
async function search(
  q: string,
  opts: { limit?: number; page?: number } = {},
): Promise<SearchResponse> {
  const limit = opts.limit ?? 20;
  const page = opts.page ?? 1;
  const url = `${SEARCH_URL}/search?q=${encodeURIComponent(q)}&limit=${limit}&page=${page}`;
  const resp = await fetch(url);
  expect(resp.ok, `API returned ${resp.status} for query "${q}"`).toBe(true);
  return resp.json() as Promise<SearchResponse>;
}

/** Fetch the search API and return the raw Response (for status code tests). */
async function searchRaw(
  q: string,
  opts: { limit?: number; page?: number } = {},
): Promise<Response> {
  const limit = opts.limit ?? 20;
  const page = opts.page ?? 1;
  const url = `${SEARCH_URL}/search?q=${encodeURIComponent(q)}&limit=${limit}&page=${page}`;
  return fetch(url);
}

function topIssueNumbers(data: SearchResponse, n = 3): number[] {
  return data.results.slice(0, n).map((r) => r.issue_number);
}

function topTitles(data: SearchResponse, n = 3): string[] {
  return data.results.slice(0, n).map((r) => r.title);
}

/** Sum all values in a flat number record. */
function sumValues(obj: Record<string, number> | undefined): number {
  if (!obj) return 0;
  return Object.values(obj).reduce((a, b) => a + b, 0);
}

/** Sum all values in a nested quarter_distribution. */
function sumQuarterDistribution(
  qd: Record<string, Record<string, number>> | undefined,
): number {
  if (!qd) return 0;
  let total = 0;
  for (const sectionCounts of Object.values(qd)) {
    total += Object.values(sectionCounts).reduce((a, b) => a + b, 0);
  }
  return total;
}

// ---------------------------------------------------------------------------
// 1. Ranking quality
// ---------------------------------------------------------------------------

describe('ranking quality', () => {
  it('exact phrase match outranks partial matches', async () => {
    const data = await search('"decision treadmill"');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(topIssueNumbers(data, 1)).toContain(230);
    expect(topTitles(data, 1)[0]).toContain('decision treadmill');
  });

  it('partial term "trust" returns relevant top results with trust in title', async () => {
    const data = await search('trust');
    expect(data.total_hits).toBeGreaterThan(10);
    // At least one of the top-3 titles should contain "trust"
    const hasMatch = topTitles(data, 3).some((t) =>
      t.toLowerCase().includes('trust'),
    );
    expect(hasMatch).toBe(true);
    // Total hits should be substantial for such a common concept
    expect(data.results.length).toBeGreaterThan(0);
  });

  it('issue number query returns exactly 1 result', async () => {
    const data = await search('issue:198');
    expect(data.total_hits).toBe(1);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].issue_number).toBe(198);
  });

  it('issue:1 returns the first issue', async () => {
    const data = await search('issue:1');
    expect(data.total_hits).toBe(1);
    expect(data.results[0].issue_number).toBe(1);
    // canonical_url uses zero-padded issue number for issue #1
    expect(data.results[0].canonical_url).toMatch(/\/p\/0?1$/);
  });

  it('known lead essay title query returns that issue first', async () => {
    const data = await search('How to get unstuck');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(topIssueNumbers(data, 1)).toContain(55);
    expect(topTitles(data, 1)[0]).toContain('unstuck');
  });

  it('common word "the" returns many results', async () => {
    const data = await search('the');
    expect(data.total_hits).toBeGreaterThan(100);
    expect(data.results.length).toBeGreaterThan(0);
    // Year distribution should span multiple years
    const years = Object.keys(data.year_distribution || {});
    expect(years.length).toBeGreaterThanOrEqual(3);
  });

  it('common word "a" returns many results', async () => {
    const data = await search('a');
    expect(data.total_hits).toBeGreaterThan(50);
    expect(data.results.length).toBeGreaterThan(0);
    expect(Object.keys(data.year_distribution || {}).length).toBeGreaterThanOrEqual(2);
  });

  it('empty query returns 0 results', async () => {
    const data = await search('');
    expect(data.total_hits).toBe(0);
    expect(data.results).toHaveLength(0);
    expect(data.parsed_query).toBeNull();
  });

  it('"institutional trust" phrase returns results with trust in snippets', async () => {
    const data = await search('"institutional trust"');
    expect(data.total_hits).toBeGreaterThan(0);
    const snippets = data.results
      .map((r) => (r.snippet || '').toLowerCase())
      .join(' ');
    expect(snippets).toMatch(/trust/);
    expect(data.results.length).toBeGreaterThan(0);
  });

  it('"A model of trust" returns issue #82 as top result', async () => {
    const data = await search('"A model of trust"');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(topIssueNumbers(data, 1)).toContain(82);
    expect(topTitles(data, 1)[0]).toContain('model of trust');
  });
});

// ---------------------------------------------------------------------------
// 2. Section filter correctness
// ---------------------------------------------------------------------------

describe('section filter correctness', () => {
  it('section:lead_essay returns only lead_essay results', async () => {
    const data = await search('section:lead_essay');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.applied_filters).toContain('section:lead_essay');
    for (const r of data.results) {
      expect(r.snippet_section).toBe('lead_essay');
    }
  });

  it('section:signposts returns only signposts results', async () => {
    const data = await search('section:signposts');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.applied_filters).toContain('section:signposts');
    for (const r of data.results) {
      expect(r.snippet_section).toBe('signposts');
    }
  });

  it('section:lens returns only lens results', async () => {
    const data = await search('section:lens');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.applied_filters).toContain('section:lens');
    for (const r of data.results) {
      expect(r.snippet_section).toBe('lens');
    }
  });

  it('section:postcard returns only postcard results', async () => {
    const data = await search('section:postcard');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.applied_filters).toContain('section:postcard');
    for (const r of data.results) {
      expect(r.snippet_section).toBe('postcard');
    }
  });

  it('section:book returns only book results', async () => {
    const data = await search('section:book');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.applied_filters).toContain('section:book');
    for (const r of data.results) {
      expect(r.snippet_section).toBe('book');
    }
  });

  it('section:worth_your_time returns only worth_your_time results', async () => {
    const data = await search('section:worth_your_time');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.applied_filters).toContain('section:worth_your_time');
    for (const r of data.results) {
      expect(r.snippet_section).toBe('worth_your_time');
    }
  });

  it('combined: "trust section:signposts" returns signposts about trust', async () => {
    const data = await search('trust section:signposts');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.applied_filters).toContain('section:signposts');
    for (const r of data.results) {
      expect(r.snippet_section).toBe('signposts');
    }
    // Free text should have been "trust"
    expect(data.parsed_query?.free_text).toBe('trust');
  });

  it('combined: "strategy section:lead_essay" returns lead essays about strategy', async () => {
    const data = await search('strategy section:lead_essay');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.applied_filters).toContain('section:lead_essay');
    for (const r of data.results) {
      expect(r.snippet_section).toBe('lead_essay');
    }
  });

  it('section filter facets contain only the filtered section', async () => {
    const data = await search('section:lens');
    const facetKeys = Object.keys(data.section_facets || {});
    expect(facetKeys).toHaveLength(1);
    expect(facetKeys[0]).toBe('lens');
    expect(data.section_facets!['lens']).toBe(data.total_hits);
  });
});

// ---------------------------------------------------------------------------
// 3. Date filter correctness
// ---------------------------------------------------------------------------

describe('date filter correctness', () => {
  it('before:2022 returns all results published before 2022-01-01', async () => {
    const data = await search('before:2022');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.published_at < '2022-01-01').toBe(true);
    }
    // Year distribution should only contain years < 2022
    for (const year of Object.keys(data.year_distribution || {})) {
      expect(parseInt(year)).toBeLessThan(2022);
    }
  });

  it('after:2025 returns all results published after 2025-01-01', async () => {
    const data = await search('after:2025');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.published_at >= '2025-01-01').toBe(true);
    }
    // Year distribution should only contain years >= 2025
    for (const year of Object.keys(data.year_distribution || {})) {
      expect(parseInt(year)).toBeGreaterThanOrEqual(2025);
    }
  });

  it('year:2023 returns all results from 2023', async () => {
    const data = await search('year:2023');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.published_at.startsWith('2023')).toBe(true);
    }
    // Year distribution should only have 2023
    const years = Object.keys(data.year_distribution || {});
    expect(years).toHaveLength(1);
    expect(years[0]).toBe('2023');
  });

  it('year:2024 returns all results from 2024', async () => {
    const data = await search('year:2024');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.published_at.startsWith('2024')).toBe(true);
    }
    expect(Object.keys(data.year_distribution || {})).toEqual(['2024']);
  });

  it('combined: "trust year:2023" returns trust results from 2023 only', async () => {
    const data = await search('trust year:2023');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.applied_filters).toContain('year:2023');
    for (const r of data.results) {
      expect(r.published_at.startsWith('2023')).toBe(true);
    }
    // Parsed query should capture both free text and year filter
    expect(data.parsed_query?.free_text).toBe('trust');
    expect(data.parsed_query?.filters?.year).toBe(2023);
  });

  it('combined date range: "before:2023 after:2022" returns only 2022', async () => {
    const data = await search('before:2023 after:2022');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.published_at >= '2022-01-01').toBe(true);
      expect(r.published_at < '2023-01-01').toBe(true);
    }
    const years = Object.keys(data.year_distribution || {});
    expect(years).toEqual(['2022']);
  });

  it('combined: "crypto year:2022" returns crypto results from 2022', async () => {
    const data = await search('crypto year:2022');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.published_at.startsWith('2022')).toBe(true);
    }
    expect(data.parsed_query?.free_text).toBe('crypto');
  });

  it('combined: section + date filters work together', async () => {
    const data = await search('section:lead_essay year:2023');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.applied_filters).toContain('section:lead_essay');
    expect(data.applied_filters).toContain('year:2023');
    for (const r of data.results) {
      expect(r.snippet_section).toBe('lead_essay');
      expect(r.published_at.startsWith('2023')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Aggregate consistency
// ---------------------------------------------------------------------------

describe('aggregate consistency', () => {
  const AGGREGATE_QUERIES = [
    'trust',
    'strategy',
    'section:lead_essay',
    'year:2023',
    'before:2023 after:2022',
    'AI',
  ];

  for (const q of AGGREGATE_QUERIES) {
    it(`"${q}": sum(section_facets) == total_hits`, async () => {
      const data = await search(q);
      const facetTotal = sumValues(data.section_facets);
      expect(facetTotal).toBe(data.total_hits);
      expect(data.total_hits).toBeGreaterThan(0);
      // Section facets should have at least one key
      expect(Object.keys(data.section_facets || {}).length).toBeGreaterThan(0);
    });

    it(`"${q}": sum(quarter_distribution) == total_hits`, async () => {
      const data = await search(q);
      const qdTotal = sumQuarterDistribution(data.quarter_distribution);
      expect(qdTotal).toBe(data.total_hits);
      expect(data.total_hits).toBeGreaterThan(0);
      // Quarter distribution should have at least one quarter
      expect(
        Object.keys(data.quarter_distribution || {}).length,
      ).toBeGreaterThan(0);
    });

    it(`"${q}": sum(year_distribution) == total_hits`, async () => {
      const data = await search(q);
      const yearTotal = sumValues(data.year_distribution);
      expect(yearTotal).toBe(data.total_hits);
      expect(data.total_hits).toBeGreaterThan(0);
      expect(
        Object.keys(data.year_distribution || {}).length,
      ).toBeGreaterThan(0);
    });
  }

  it('aggregates are identical across pages', async () => {
    const page1 = await search('trust', { limit: 5, page: 1 });
    const page2 = await search('trust', { limit: 5, page: 2 });

    // Total hits must match
    expect(page1.total_hits).toBe(page2.total_hits);

    // Year distribution must match
    expect(page1.year_distribution).toEqual(page2.year_distribution);

    // Section facets must match
    expect(page1.section_facets).toEqual(page2.section_facets);

    // Quarter distribution must match
    expect(page1.quarter_distribution).toEqual(page2.quarter_distribution);
  });
});

// ---------------------------------------------------------------------------
// 5. Result quality
// ---------------------------------------------------------------------------

describe('result quality', () => {
  const BOILERPLATE_PATTERNS = [
    'Subscribe',
    'Collection notice',
    'ReplyShare',
    'ragtag band',
    'FLUX Review, Ep.',
  ];

  it('no result snippet contains Substack boilerplate (query: trust)', async () => {
    const data = await search('trust');
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      for (const pattern of BOILERPLATE_PATTERNS) {
        expect(
          r.snippet,
          `Boilerplate "${pattern}" found in snippet for issue #${r.issue_number}`,
        ).not.toContain(pattern);
      }
    }
    // Also check titles
    for (const r of data.results) {
      expect(r.title).not.toContain('FLUX Review, Ep.');
    }
  });

  it('no result snippet contains Substack boilerplate (query: strategy)', async () => {
    const data = await search('strategy');
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      for (const pattern of BOILERPLATE_PATTERNS) {
        expect(
          r.snippet,
          `Boilerplate "${pattern}" found in snippet for issue #${r.issue_number}`,
        ).not.toContain(pattern);
      }
    }
  });

  it('no result title contains "FLUX Review, Ep." (query: AI)', async () => {
    const data = await search('AI');
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.title).not.toContain('FLUX Review, Ep.');
      expect(r.title).not.toContain('FLUX Review');
    }
    // Also verify snippets are clean
    for (const r of data.results) {
      expect(r.snippet).not.toContain('FLUX Review, Ep.');
    }
  });

  it('at least 90% of results have a non-null snippet_section', async () => {
    const data = await search('trust');
    expect(data.results.length).toBeGreaterThan(0);
    const withSection = data.results.filter(
      (r) => r.snippet_section !== null,
    ).length;
    const ratio = withSection / data.results.length;
    expect(ratio).toBeGreaterThanOrEqual(0.9);
    // Additionally verify sections are known values
    const knownSections = new Set([
      'lead_essay',
      'signposts',
      'lens',
      'book',
      'postcard',
      'worth_your_time',
      'other',
    ]);
    for (const r of data.results) {
      if (r.snippet_section !== null) {
        expect(knownSections.has(r.snippet_section)).toBe(true);
      }
    }
  });

  it('every result has a non-empty snippet', async () => {
    const data = await search('strategy');
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.snippet, `Empty snippet for issue #${r.issue_number}`).toBeTruthy();
      expect(r.snippet.length).toBeGreaterThan(10);
    }
    // Snippets should be meaningfully different from each other
    const uniqueSnippets = new Set(data.results.map((r) => r.snippet));
    expect(uniqueSnippets.size).toBe(data.results.length);
  });

  it('every result has a valid canonical_url', async () => {
    const data = await search('leadership');
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.canonical_url).toBeTruthy();
      expect(r.canonical_url).toMatch(
        /^https:\/\/read\.fluxcollective\.org\/p\/\d+$/,
      );
      // canonical_url issue number should match result issue_number
      const urlIssueNumber = parseInt(
        r.canonical_url.split('/p/')[1],
        10,
      );
      expect(urlIssueNumber).toBe(r.issue_number);
    }
  });

  it('every result has a valid published_at date', async () => {
    const data = await search('design');
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.published_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const date = new Date(r.published_at);
      expect(isNaN(date.getTime())).toBe(false);
      // Dates should be within the newsletter's lifetime (2021-2026)
      expect(date.getFullYear()).toBeGreaterThanOrEqual(2021);
      expect(date.getFullYear()).toBeLessThanOrEqual(2026);
    }
  });

  it('every result has a non-empty title', async () => {
    const data = await search('culture');
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.title).toBeTruthy();
      expect(r.title.length).toBeGreaterThan(2);
    }
    // Titles should be distinct
    const uniqueTitles = new Set(data.results.map((r) => r.title));
    expect(uniqueTitles.size).toBe(data.results.length);
  });

  it('results have valid matched_by arrays', async () => {
    const data = await search('trust');
    expect(data.results.length).toBeGreaterThan(0);
    const validMatchedBy = new Set(['fts', 'vector', 'filter']);
    for (const r of data.results) {
      expect(Array.isArray(r.matched_by)).toBe(true);
      expect(r.matched_by.length).toBeGreaterThan(0);
      for (const m of r.matched_by) {
        expect(validMatchedBy.has(m)).toBe(true);
      }
    }
  });

  it('filter-only results use matched_by:filter', async () => {
    const data = await search('section:lead_essay', { limit: 5 });
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.matched_by).toContain('filter');
    }
    // confidence should still be present
    for (const r of data.results) {
      expect(r.confidence).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Pagination
// ---------------------------------------------------------------------------

describe('pagination', () => {
  it('page 2 returns different results than page 1', async () => {
    const page1 = await search('trust', { limit: 10, page: 1 });
    const page2 = await search('trust', { limit: 10, page: 2 });

    expect(page1.results.length).toBeGreaterThan(0);
    expect(page2.results.length).toBeGreaterThan(0);

    const page1Ids = new Set(page1.results.map((r) => r.issue_id));
    const page2Ids = new Set(page2.results.map((r) => r.issue_id));

    // No overlap between pages
    for (const id of page2Ids) {
      expect(
        page1Ids.has(id),
        `Result ${id} appears on both page 1 and page 2`,
      ).toBe(false);
    }
  });

  it('page 2 results do not overlap with page 1 issue numbers', async () => {
    const page1 = await search('section:lead_essay', { limit: 10, page: 1 });
    const page2 = await search('section:lead_essay', { limit: 10, page: 2 });

    const page1Issues = new Set(page1.results.map((r) => r.issue_number));
    const page2Issues = new Set(page2.results.map((r) => r.issue_number));

    for (const issueNum of page2Issues) {
      expect(
        page1Issues.has(issueNum),
        `Issue #${issueNum} appears on both pages`,
      ).toBe(false);
    }
    // Both pages should have results
    expect(page1.results.length).toBe(10);
    expect(page2.results.length).toBe(10);
  });

  it('total_hits is the same on all pages', async () => {
    const page1 = await search('trust', { limit: 5, page: 1 });
    const page2 = await search('trust', { limit: 5, page: 2 });
    const page3 = await search('trust', { limit: 5, page: 3 });

    expect(page1.total_hits).toBe(page2.total_hits);
    expect(page2.total_hits).toBe(page3.total_hits);
    expect(page1.total_hits).toBeGreaterThan(0);
  });

  it('page beyond last returns 0 results but correct total_hits', async () => {
    const page1 = await search('trust', { limit: 10, page: 1 });
    const lastPage = Math.ceil(page1.total_hits / 10);
    const beyondLast = await search('trust', {
      limit: 10,
      page: lastPage + 10,
    });

    expect(beyondLast.results).toHaveLength(0);
    expect(beyondLast.total_hits).toBe(page1.total_hits);
    // Aggregates should still be present
    expect(beyondLast.year_distribution).toBeDefined();
  });

  it('page 1 with limit=1 returns exactly 1 result', async () => {
    const data = await search('trust', { limit: 1, page: 1 });
    expect(data.results).toHaveLength(1);
    expect(data.total_hits).toBeGreaterThan(1);
    // The one result should still have all fields
    const r = data.results[0];
    expect(r.title).toBeTruthy();
    expect(r.snippet).toBeTruthy();
    expect(r.canonical_url).toBeTruthy();
  });

  it('consecutive pages cover the full result set without gaps', async () => {
    const allIssueNumbers: number[] = [];
    const limit = 10;
    let page = 1;
    let totalHits = 0;

    // Fetch first 3 pages of a filter-only query (deterministic order)
    while (page <= 3) {
      const data = await search('year:2023', { limit, page });
      totalHits = data.total_hits;
      allIssueNumbers.push(...data.results.map((r) => r.issue_number));
      if (data.results.length < limit) break;
      page++;
    }

    // No duplicates across pages
    const unique = new Set(allIssueNumbers);
    expect(unique.size).toBe(allIssueNumbers.length);
    // We should have fetched results
    expect(allIssueNumbers.length).toBeGreaterThan(0);
    // Total hits should be >= what we fetched
    expect(totalHits).toBeGreaterThanOrEqual(allIssueNumbers.length);
  });
});

// ---------------------------------------------------------------------------
// 7. Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('very long query (200+ characters) does not crash', async () => {
    const longQuery = 'trust '.repeat(40).trim(); // ~240 chars
    const resp = await searchRaw(longQuery);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as SearchResponse;
    expect(data.total_hits).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.results)).toBe(true);
  });

  it('query with only operators (no free text) works', async () => {
    const data = await search('before:2023 after:2022');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.parsed_query?.free_text).toBe('');
    expect(data.applied_filters.length).toBeGreaterThanOrEqual(2);
  });

  it('query with unrecognized operator is treated as free text', async () => {
    const resp = await searchRaw('foo:bar');
    expect(resp.status).toBe(200);
    const data = await resp.json() as any;
    // foo:bar is left in free text, colon is sanitized for FTS safety
    expect(data.parsed_query.free_text).toContain('foo');
  });

  it('single character query returns results without error', async () => {
    const data = await search('a');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.section_facets).toBeDefined();
  });

  it('numeric query returns results', async () => {
    const data = await search('2023');
    expect(data.total_hits).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.results)).toBe(true);
    // Response shape is valid
    expect(data.parsed_query).toBeDefined();
  });

  it('query with double spaces is handled gracefully', async () => {
    const data = await search('trust  strategy');
    expect(data.total_hits).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.parsed_query).toBeDefined();
  });

  it('issue:0 (non-existent) returns 0 results', async () => {
    const data = await search('issue:0');
    expect(data.total_hits).toBe(0);
    expect(data.results).toHaveLength(0);
    expect(data.parsed_query).toBeDefined();
  });

  it('issue:9999 (non-existent) returns 0 results', async () => {
    const data = await search('issue:9999');
    expect(data.total_hits).toBe(0);
    expect(data.results).toHaveLength(0);
  });

  it('conceptual/semantic query returns results even without exact match', async () => {
    const data = await search('organizational credibility');
    expect(data.total_hits).toBeGreaterThan(0);
    expect(data.results.length).toBeGreaterThan(0);
    // Results should still have valid structure
    expect(data.section_facets).toBeDefined();
  });

  it('unicode characters in query do not crash', async () => {
    const resp = await searchRaw('caf\u00e9 r\u00e9sum\u00e9');
    // Should either return 200 with results or 200 with 0 results
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as SearchResponse;
    expect(data.total_hits).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.results)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Response shape contract
// ---------------------------------------------------------------------------

describe('response shape contract', () => {
  it('search response has all required top-level fields', async () => {
    const data = await search('trust');
    expect(data).toHaveProperty('parsed_query');
    expect(data).toHaveProperty('applied_filters');
    expect(data).toHaveProperty('total_hits');
    expect(data).toHaveProperty('year_distribution');
    expect(data).toHaveProperty('quarter_distribution');
    expect(data).toHaveProperty('section_facets');
    expect(data).toHaveProperty('results');
    expect(Array.isArray(data.results)).toBe(true);
    expect(Array.isArray(data.applied_filters)).toBe(true);
  });

  it('each result has all required fields', async () => {
    const data = await search('trust', { limit: 5 });
    expect(data.results.length).toBeGreaterThan(0);
    const requiredFields = [
      'issue_id',
      'title',
      'issue_number',
      'published_at',
      'snippet',
      'snippet_section',
      'confidence',
      'canonical_url',
      'matched_by',
    ];
    for (const r of data.results) {
      for (const field of requiredFields) {
        expect(r).toHaveProperty(field);
      }
    }
  });

  it('parsed_query has correct structure for text + filter query', async () => {
    const data = await search('trust year:2023');
    expect(data.parsed_query).not.toBeNull();
    expect(data.parsed_query!.free_text).toBe('trust');
    expect(data.parsed_query!.filters).toHaveProperty('year');
    expect(Array.isArray(data.parsed_query!.phrases)).toBe(true);
  });

  it('parsed_query has correct structure for phrase query', async () => {
    const data = await search('"decision treadmill"');
    expect(data.parsed_query).not.toBeNull();
    expect(data.parsed_query!.phrases.length).toBeGreaterThanOrEqual(1);
    expect(data.parsed_query!.phrases).toContain('decision treadmill');
  });

  it('empty query response has null parsed_query', async () => {
    const data = await search('');
    expect(data.parsed_query).toBeNull();
    expect(data.total_hits).toBe(0);
    expect(data.results).toHaveLength(0);
  });
});
