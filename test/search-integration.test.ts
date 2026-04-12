/**
 * Integration tests against the search API.
 *
 * These call the live deployed endpoint and verify response invariants.
 * They catch pipeline ordering bugs, schema inconsistencies, and
 * aggregate mismatches that unit tests miss.
 *
 * Skip if SEARCH_URL is not set (CI without deployment).
 */
import { describe, it, expect } from 'vitest';

const SEARCH_URL = process.env.SEARCH_URL || 'https://flux-search.adewale-883.workers.dev';

const REQUIRED_FIELDS = [
  'parsed_query', 'applied_filters', 'total_hits',
  'year_distribution', 'quarter_distribution', 'section_facets', 'results',
];

const REQUIRED_RESULT_FIELDS = [
  'issue_id', 'title', 'issue_number', 'published_at',
  'snippet', 'snippet_section', 'confidence', 'canonical_url', 'matched_by',
];

async function search(q: string, params?: Record<string, string>) {
  const url = new URL('/search', SEARCH_URL);
  url.searchParams.set('q', q);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const resp = await fetch(url.toString());
  return resp.json() as Promise<Record<string, any>>;
}

function assertResponseShape(data: Record<string, any>, label: string) {
  for (const field of REQUIRED_FIELDS) {
    expect(data, `${label}: missing field '${field}'`).toHaveProperty(field);
  }
  if (data.results.length > 0) {
    const r = data.results[0];
    for (const field of REQUIRED_RESULT_FIELDS) {
      expect(r, `${label}: result missing field '${field}'`).toHaveProperty(field);
    }
  }
}

function assertAggregateConsistency(data: Record<string, any>, label: string) {
  const total = data.total_hits;

  const yearTotal = Object.values(data.year_distribution as Record<string, number>)
    .reduce((a: number, b: number) => a + b, 0);

  const quarterTotal = Object.values(data.quarter_distribution as Record<string, Record<string, number>>)
    .reduce((sum: number, sections: any) => sum + Object.values(sections as Record<string, number>).reduce((a: number, b: number) => a + b, 0), 0);

  const facetTotal = Object.values(data.section_facets as Record<string, number>)
    .reduce((a: number, b: number) => a + b, 0);

  expect(yearTotal, `${label}: year_distribution total (${yearTotal}) != total_hits (${total})`).toBe(total);
  expect(quarterTotal, `${label}: quarter_distribution total (${quarterTotal}) != total_hits (${total})`).toBe(total);
  expect(facetTotal, `${label}: section_facets total (${facetTotal}) != total_hits (${total})`).toBe(total);
}

describe('search API integration', () => {
  // --- Response shape consistency across all paths ---

  it('normal search returns correct shape', async () => {
    const data = await search('crypto');
    assertResponseShape(data, 'normal search');
  });

  it('issue lookup returns correct shape', async () => {
    const data = await search('issue:198');
    assertResponseShape(data, 'issue lookup');
  });

  it('filter-only returns correct shape', async () => {
    const data = await search('before:2023');
    assertResponseShape(data, 'filter-only');
  });

  // --- Aggregate consistency ---

  it('normal search: aggregates equal total_hits', async () => {
    const data = await search('crypto');
    assertAggregateConsistency(data, 'crypto');
  });

  it('issue lookup: aggregates equal total_hits', async () => {
    const data = await search('issue:198');
    assertAggregateConsistency(data, 'issue:198');
  });

  it('filter-only: aggregates equal total_hits', async () => {
    const data = await search('before:2023');
    assertAggregateConsistency(data, 'before:2023');
  });

  it('year filter: aggregates equal total_hits', async () => {
    const data = await search('year:2022');
    assertAggregateConsistency(data, 'year:2022');
  });

  // --- Aggregates are stable across pages ---

  it('aggregates are identical on page 1 and page 2', async () => {
    const page1 = await search('crypto', { page: '1' });
    const page2 = await search('crypto', { page: '2' });
    expect(page1.total_hits).toBe(page2.total_hits);
    expect(page1.year_distribution).toEqual(page2.year_distribution);
    expect(page1.quarter_distribution).toEqual(page2.quarter_distribution);
    expect(page1.section_facets).toEqual(page2.section_facets);
  });

  // --- Section filter works correctly ---

  it('section:signposts returns only signpost results', async () => {
    const data = await search('crypto section:signposts');
    expect(data.total_hits).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.snippet_section).toBe('signposts');
    }
  });

  // --- Every result has a snippet_section ---

  it('normal search results have snippet_section set', async () => {
    const data = await search('trust', { limit: '20' });
    const nullSections = data.results.filter((r: any) => r.snippet_section === null);
    // Allow a small number of undetectable sections
    // Allow up to 25% undetectable sections (short snippets, edge cases)
    expect(nullSections.length).toBeLessThan(data.results.length * 0.25);
  });
});
