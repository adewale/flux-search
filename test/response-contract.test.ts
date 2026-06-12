/**
 * Response contract tests for GET /search.
 *
 * docs/architecture.md promises that all three query paths (text search,
 * filter-only, issue lookup) return the same response shape:
 * - 7 top-level fields
 * - 10 fields per result
 * - parsed_query is { free_text, phrases, filters } on every path
 *
 * It also promises that operators listed in applied_filters were actually
 * applied — so `issue:N section:X` must honor the section filter instead of
 * short-circuiting on the issue number alone.
 *
 * These run against the real route handler with real SQL (node:sqlite via
 * helpers-d1, FTS5 enabled) — no mocked DB layer.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { searchRoutes } from '../src/routes/search';
import { makeD1, enableFts, seedIssue, type D1Like } from './helpers-d1';
import { defaultEnv } from './helpers';

const RESPONSE_KEYS = [
  'parsed_query', 'applied_filters', 'total_hits',
  'year_distribution', 'quarter_distribution', 'section_facets', 'results',
].sort();

const RESULT_KEYS = [
  'issue_id', 'title', 'issue_number', 'published_at', 'snippet',
  'snippet_section', 'confidence', 'canonical_url', 'matched_by', 'topics',
].sort();

const PARSED_QUERY_KEYS = ['free_text', 'phrases', 'filters'].sort();

const SIGNPOSTS_MD = '## 🪧 Signposts\n\nClues to how the future might unfold, like quiet shifts in institutional trust.';

function seededDb(): D1Like {
  const db = makeD1();
  enableFts(db);
  // Issue 198: only section is signposts; matches FTS query "trust".
  void seedIssue(db, {
    issue_number: 198,
    title: 'Institutional trust',
    summary: 'How trust erodes and rebuilds.',
    full_text_plain: 'Clues to how the future might unfold, like quiet shifts in institutional trust.',
    full_text_markdown: SIGNPOSTS_MD,
    published_at: '2023-05-12',
    year: 2023,
    month: 5,
    source_url: 'https://example.com/p/198',
  });
  // A second issue in another year so filters have something to exclude.
  void seedIssue(db, {
    issue_number: 73,
    title: 'Feedback loops',
    summary: 'Loops everywhere.',
    full_text_plain: 'Feedback loops compound in unexpected ways.',
    full_text_markdown: '## 🔍 Lens of the week\n\nFeedback loops compound in unexpected ways.',
    published_at: '2022-02-04',
    year: 2022,
    month: 2,
    source_url: 'https://example.com/p/73',
  });
  return db;
}

async function search(db: D1Like, q: string): Promise<{ status: number; body: any }> {
  const app = new Hono();
  app.route('/', searchRoutes as any);
  const res = await app.request(
    '/search?q=' + encodeURIComponent(q),
    {},
    { ...defaultEnv, DB: db } as any,
  );
  return { status: res.status, body: await res.json() };
}

// One representative query per handler path, plus combinations.
const PATH_QUERIES = [
  'trust',                  // text search (FTS)
  '"institutional trust"',  // text search with phrase
  'year:2023',              // filter-only
  'issue:198',              // issue lookup, found
  'issue:9999',             // issue lookup, not found
];

describe('search response contract across query paths', () => {
  it('every path returns the same 7 top-level fields', async () => {
    const db = seededDb();
    for (const q of PATH_QUERIES) {
      const { status, body } = await search(db, q);
      expect(status, q).toBe(200);
      expect(Object.keys(body).sort(), q).toEqual(RESPONSE_KEYS);
    }
  });

  it('every path returns parsed_query as { free_text, phrases, filters }', async () => {
    const db = seededDb();
    for (const q of PATH_QUERIES) {
      const { body } = await search(db, q);
      expect(Object.keys(body.parsed_query).sort(), q).toEqual(PARSED_QUERY_KEYS);
    }
  });

  it('every result carries exactly the 10 documented fields', async () => {
    const db = seededDb();
    for (const q of ['trust', 'year:2023', 'issue:198']) {
      const { body } = await search(db, q);
      expect(body.results.length, q).toBeGreaterThan(0);
      for (const r of body.results) {
        expect(Object.keys(r).sort(), q).toEqual(RESULT_KEYS);
      }
    }
  });

  it('aggregates stay consistent with total_hits on every path', async () => {
    const db = seededDb();
    for (const q of PATH_QUERIES) {
      const { body } = await search(db, q);
      const yearTotal = Object.values(body.year_distribution as Record<string, number>)
        .reduce((a, b) => a + b, 0);
      expect(yearTotal, q).toBe(body.total_hits);
      expect(body.results.length, q).toBeLessThanOrEqual(body.total_hits);
    }
  });
});

describe('issue: lookups combined with other operators', () => {
  it('issue:N alone short-circuits with high confidence', async () => {
    const { body } = await search(seededDb(), 'issue:198');
    expect(body.total_hits).toBe(1);
    expect(body.results[0].issue_number).toBe(198);
    expect(body.results[0].confidence).toBe('high');
    expect(body.results[0].matched_by).toEqual(['issue_number']);
  });

  it('issue:N section:X applies the section filter instead of ignoring it', async () => {
    const db = seededDb();
    // Issue 198's only section is signposts — a lens filter must exclude it.
    const miss = await search(db, 'issue:198 section:lens');
    expect(miss.body.total_hits).toBe(0);
    expect(miss.body.results).toEqual([]);

    const hit = await search(db, 'issue:198 section:signposts');
    expect(hit.body.total_hits).toBe(1);
    expect(hit.body.results[0].issue_number).toBe(198);
    expect(hit.body.results[0].snippet_section).toBe('signposts');
  });

  it('issue:N year:Y applies the year filter instead of ignoring it', async () => {
    const db = seededDb();
    const miss = await search(db, 'issue:198 year:2022');
    expect(miss.body.total_hits).toBe(0);

    const hit = await search(db, 'issue:198 year:2023');
    expect(hit.body.total_hits).toBe(1);
    expect(hit.body.results[0].issue_number).toBe(198);
  });

  it('applied_filters only lists operators on paths that honor them', async () => {
    const db = seededDb();
    const { body } = await search(db, 'issue:198 section:lens');
    // Both operators are listed — and both were applied (hence 0 hits).
    expect(body.applied_filters).toEqual(['issue:198', 'section:lens']);
    expect(body.total_hits).toBe(0);
  });
});
