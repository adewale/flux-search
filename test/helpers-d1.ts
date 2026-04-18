import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * D1-compatible adapter around Node's built-in `node:sqlite`.
 * Gives tests real SQL execution instead of stubbing the DB interface.
 * Only covers the surface we use: prepare → bind → run/first/all/batch.
 *
 * Schema is set up directly rather than by running migrations verbatim —
 * the FTS virtual table + triggers in migration 0004 are tightly coupled
 * and aren't what these tests exercise.
 */
export interface D1Like {
  prepare: (sql: string) => D1Stmt;
  batch: (stmts: D1Stmt[]) => Promise<unknown[]>;
  _sqlite: DatabaseSync;
}

interface D1Stmt {
  bind: (...params: unknown[]) => D1Bound;
  _sql: string;
}

interface D1Bound {
  run: () => Promise<{ success: boolean }>;
  first: <T = unknown>() => Promise<T | null>;
  all: <T = unknown>() => Promise<{ results: T[] }>;
}

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

const CORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  issue_number INTEGER,
  title TEXT NOT NULL,
  subtitle TEXT,
  published_at TEXT,
  source_url TEXT NOT NULL UNIQUE,
  canonical_url TEXT,
  authors TEXT,
  contributors TEXT,
  summary TEXT,
  headings TEXT,
  lead_essay_title TEXT,
  opening_quote TEXT,
  full_text_markdown TEXT,
  full_text_plain TEXT,
  crawl_run_id TEXT,
  content_hash TEXT,
  ingested_at TEXT NOT NULL,
  word_count INTEGER,
  status TEXT DEFAULT 'active',
  year INTEGER,
  month INTEGER,
  has_semantic_chunks INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS issue_chunks (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  section_label TEXT,
  chunk_text TEXT NOT NULL,
  token_estimate INTEGER,
  content_hash TEXT
);
`;

export function makeD1(): D1Like {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(CORE_SCHEMA);
  sqlite.exec(readFileSync(join(MIGRATIONS_DIR, '0006_topics.sql'), 'utf-8'));
  return wrap(sqlite);
}

function wrap(sqlite: DatabaseSync): D1Like {
  const bound = (sql: string, params: unknown[]) => {
    const sanitized = params.map(p => p === undefined ? null : p) as any[];
    return {
      run: async () => {
        sqlite.prepare(sql).run(...sanitized);
        return { success: true };
      },
      first: async <T>() => {
        const row = sqlite.prepare(sql).get(...sanitized);
        return (row ?? null) as T | null;
      },
      all: async <T>() => {
        const rows = sqlite.prepare(sql).all(...sanitized);
        return { results: rows as T[] };
      },
    };
  };

  const prepare = (sql: string) => {
    const noParams = bound(sql, []);
    return {
      _sql: sql,
      bind: (...params: unknown[]) => bound(sql, params),
      run: noParams.run,
      first: noParams.first,
      all: noParams.all,
    };
  };

  return {
    _sqlite: sqlite,
    prepare,
    batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => {
      sqlite.exec('BEGIN');
      try {
        const out: unknown[] = [];
        for (const s of stmts) {
          out.push(await s.run());
        }
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

export async function seedIssue(db: D1Like, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = overrides.id as string ?? crypto.randomUUID();
  const row = {
    id,
    issue_number: 1,
    title: 'Test',
    subtitle: null,
    published_at: '2024-01-15',
    source_url: `https://example.com/p/${id}`,
    canonical_url: null,
    authors: null,
    contributors: null,
    summary: null,
    headings: null,
    lead_essay_title: null,
    opening_quote: null,
    full_text_markdown: null,
    full_text_plain: 'body',
    crawl_run_id: null,
    content_hash: null,
    ingested_at: '2024-01-15',
    word_count: 100,
    status: 'active',
    year: 2024,
    month: 1,
    has_semantic_chunks: 0,
    ...overrides,
  };

  db._sqlite.prepare(`
    INSERT INTO issues (id, issue_number, title, subtitle, published_at, source_url, canonical_url,
      authors, contributors, summary, headings, lead_essay_title, opening_quote,
      full_text_markdown, full_text_plain, crawl_run_id, content_hash, ingested_at,
      word_count, status, year, month, has_semantic_chunks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.issue_number, row.title, row.subtitle, row.published_at,
    row.source_url, row.canonical_url, row.authors, row.contributors,
    row.summary, row.headings, row.lead_essay_title, row.opening_quote,
    row.full_text_markdown, row.full_text_plain, row.crawl_run_id,
    row.content_hash, row.ingested_at, row.word_count, row.status,
    row.year, row.month, row.has_semantic_chunks
  );
  return id;
}
