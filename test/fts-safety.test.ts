/**
 * FTS5 input safety tests.
 *
 * FTS5 treats certain characters as syntax: ' (phrase), : (column),
 * * (prefix), ( ) (grouping), & < > (operators in some modes).
 * User input containing these must not crash the search.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildFtsQuery } from '../src/routes/search';
import { parseQuery } from '../src/lib/query-parser';
import { searchDb, searchRoute, fakeAi, fakeVectorize } from './helpers-search-route';
import { seedIssue } from './helpers-d1';

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

describe('search route FTS5 safety (real FTS5 via node:sqlite)', () => {
  // The route runs the sanitized query through a real FTS5 MATCH, so a
  // character that slips past buildFtsQuery surfaces as a 500 here instead
  // of only on the deployed Worker.
  async function seeded() {
    const db = searchDb();
    await seedIssue(db, {
      issue_number: 42,
      title: "It's about trust",
      full_text_plain: "It's the test of trust: don't panic, they're fine. a&b a<b a>b (test) test* foo:bar",
      source_url: 'https://example.com/p/42',
    });
    return { DB: db, AI: fakeAi(), VECTORIZE: fakeVectorize([]) };
  }

  const QUERIES = [
    "it's", "don't", "they're",
    'a&b', 'a<b', 'a>b', '(test)', 'test*',
    'foo:bar', 'http://example.com',
    '"unterminated', 'NEAR(a b)', '^test', '{x}', 'col:', '""',
    // FTS5 operators and column-filter syntax that survive the character
    // whitelist: bare AND/OR/NOT and hyphens.
    'a OR', 'AND', 'NOT', 'x NOT', '-', 'trust -', 'a - b', '-trust', 'self-organizing',
  ];

  for (const q of QUERIES) {
    it(`${JSON.stringify(q)} returns 200 with a well-formed body`, async () => {
      const { status, body } = await searchRoute(await seeded(), q);
      expect(status, JSON.stringify(body)).toBe(200);
      expect(Array.isArray(body.results)).toBe(true);
      expect(typeof body.total_hits).toBe('number');
    });
  }

  it('apostrophe query still finds the matching issue', async () => {
    const { status, body } = await searchRoute(await seeded(), "it's trust");
    expect(status).toBe(200);
    expect(body.results.map((r: any) => r.issue_number)).toContain(42);
  });

  it('hyphenated query finds the hyphenated word', async () => {
    const db = searchDb();
    await seedIssue(db, {
      issue_number: 7, title: 'Emergence',
      full_text_plain: 'Self-organizing teams need slack.', source_url: 'https://example.com/p/7',
    });
    const { status, body } = await searchRoute({ DB: db, AI: fakeAi(), VECTORIZE: fakeVectorize([]) }, 'self-organizing');
    expect(status).toBe(200);
    expect(body.results.map((r: any) => r.issue_number)).toEqual([7]);
  });

  it('PBT: every query becomes a MATCH expression FTS5 accepts', () => {
    const db = searchDb();
    const match = db._sqlite.prepare('SELECT rowid FROM issues_fts WHERE issues_fts MATCH ?');
    const token = fc.oneof(
      fc.constantFrom('AND', 'OR', 'NOT', 'NEAR', '-', '+', '*', '^', ':', '"', "'", '(', ')', '{', '}', 'a-b', 'trust'),
      fc.string({ maxLength: 8 }),
    );
    fc.assert(
      fc.property(fc.array(token, { maxLength: 6 }), fc.constantFrom(' ', ''), (tokens, sep) => {
        const fts = buildFtsQuery(parseQuery(tokens.join(sep)));
        if (fts) match.all(fts);
      }),
      // Reuse the 200-run budget of the redundant string-type property,
      // rather than add another recurring randomized campaign.
      { numRuns: 200 },
    );
  });

  it('non-existent issue number returns 0 results', async () => {
    const { status, body } = await searchRoute(await seeded(), 'issue:9999');
    expect(status).toBe(200);
    expect(body.total_hits).toBe(0);
    expect(body.results).toEqual([]);
  });
});
