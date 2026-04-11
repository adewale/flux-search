import type { IssueRow, IssueChunkRow, CrawlRunRow, SearchFilters } from './types';

// --- Issues ---

export async function upsertIssue(db: D1Database, issue: IssueRow): Promise<void> {
  await db.prepare(`
    INSERT INTO issues (
      id, issue_number, title, subtitle, published_at, source_url, canonical_url,
      authors, contributors, summary, headings, lead_essay_title, opening_quote,
      full_text_markdown, full_text_plain,
      crawl_run_id, content_hash, ingested_at, word_count, status,
      year, month, has_semantic_chunks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      issue_number = excluded.issue_number,
      title = excluded.title,
      subtitle = excluded.subtitle,
      published_at = excluded.published_at,
      canonical_url = excluded.canonical_url,
      authors = excluded.authors,
      contributors = excluded.contributors,
      summary = excluded.summary,
      headings = excluded.headings,
      lead_essay_title = excluded.lead_essay_title,
      opening_quote = excluded.opening_quote,
      full_text_markdown = excluded.full_text_markdown,
      full_text_plain = excluded.full_text_plain,
      content_hash = excluded.content_hash,
      word_count = excluded.word_count,
      has_semantic_chunks = excluded.has_semantic_chunks
  `).bind(
    issue.id, issue.issue_number, issue.title, issue.subtitle,
    issue.published_at, issue.source_url, issue.canonical_url,
    issue.authors, issue.contributors,
    issue.summary, issue.headings, issue.lead_essay_title, issue.opening_quote,
    issue.full_text_markdown, issue.full_text_plain,
    issue.crawl_run_id, issue.content_hash,
    issue.ingested_at, issue.word_count, issue.status,
    issue.year, issue.month, issue.has_semantic_chunks
  ).run();
}

export async function getIssueById(db: D1Database, id: string): Promise<IssueRow | null> {
  return db.prepare('SELECT * FROM issues WHERE id = ? AND status = ?')
    .bind(id, 'active')
    .first<IssueRow>();
}

export async function getIssueByNumber(db: D1Database, issueNumber: number): Promise<IssueRow | null> {
  return db.prepare('SELECT * FROM issues WHERE issue_number = ? AND status = ?')
    .bind(issueNumber, 'active')
    .first<IssueRow>();
}

export async function getIssueBySourceUrl(db: D1Database, url: string): Promise<IssueRow | null> {
  return db.prepare('SELECT * FROM issues WHERE source_url = ? AND status = ?')
    .bind(url, 'active')
    .first<IssueRow>();
}

export async function getIssueByContentHash(db: D1Database, hash: string): Promise<IssueRow | null> {
  return db.prepare('SELECT * FROM issues WHERE content_hash = ? AND status = ?')
    .bind(hash, 'active')
    .first<IssueRow>();
}

export async function getAllSourceUrls(db: D1Database): Promise<string[]> {
  const results = await db.prepare('SELECT source_url FROM issues WHERE status = ?').bind('active').all<{ source_url: string }>();
  return results.results.map(r => r.source_url);
}

export async function getIssueCount(db: D1Database): Promise<number> {
  const result = await db.prepare('SELECT COUNT(*) as count FROM issues WHERE status = ?')
    .bind('active')
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function getIssueDateRange(db: D1Database): Promise<{ first: string | null; last: string | null }> {
  const result = await db.prepare(`
    SELECT MIN(published_at) as first, MAX(published_at) as last
    FROM issues WHERE status = ?
  `).bind('active').first<{ first: string | null; last: string | null }>();
  return result ?? { first: null, last: null };
}

export async function getMissingIssueNumbers(db: D1Database): Promise<number[]> {
  const rows = await db.prepare(`
    SELECT issue_number FROM issues
    WHERE status = ? AND issue_number IS NOT NULL
    ORDER BY issue_number
  `).bind('active').all<{ issue_number: number }>();

  const numbers = rows.results.map(r => r.issue_number);
  if (numbers.length === 0) return [];

  const missing: number[] = [];
  const min = numbers[0];
  const max = numbers[numbers.length - 1];
  const set = new Set(numbers);
  for (let i = min; i <= max; i++) {
    if (!set.has(i)) missing.push(i);
  }
  return missing;
}

// --- Issue Chunks ---

export async function insertChunks(db: D1Database, chunks: IssueChunkRow[]): Promise<void> {
  if (chunks.length === 0) return;

  const stmts = chunks.map(chunk =>
    db.prepare(`
      INSERT INTO issue_chunks (id, issue_id, chunk_index, section_label, chunk_text, token_estimate, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET chunk_text = excluded.chunk_text, content_hash = excluded.content_hash
    `).bind(chunk.id, chunk.issue_id, chunk.chunk_index, chunk.section_label, chunk.chunk_text, chunk.token_estimate, chunk.content_hash)
  );

  await db.batch(stmts);
}

export async function deleteChunksByIssueId(db: D1Database, issueId: string): Promise<void> {
  await db.prepare('DELETE FROM issue_chunks WHERE issue_id = ?').bind(issueId).run();
}

// --- Crawl Runs ---

export async function createCrawlRun(db: D1Database, run: CrawlRunRow): Promise<void> {
  await db.prepare(`
    INSERT INTO crawl_runs (id, seed_url, mode, started_at, completed_at, status, records_found, issues_created, issues_updated, issues_skipped, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    run.id, run.seed_url, run.mode, run.started_at, run.completed_at,
    run.status, run.records_found, run.issues_created, run.issues_updated,
    run.issues_skipped, run.notes
  ).run();
}

export async function startCrawlRun(db: D1Database, id: string, mode: string, seedUrl: string | null = null): Promise<void> {
  await createCrawlRun(db, {
    id, seed_url: seedUrl, mode,
    started_at: new Date().toISOString(), completed_at: null,
    status: 'running', records_found: 0, issues_created: 0,
    issues_updated: 0, issues_skipped: 0, notes: null,
  });
}

export async function updateCrawlRun(db: D1Database, id: string, updates: Partial<CrawlRunRow>): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key !== 'id' && value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;
  values.push(id);

  await db.prepare(`UPDATE crawl_runs SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function getCrawlRun(db: D1Database, id: string): Promise<CrawlRunRow | null> {
  return db.prepare('SELECT * FROM crawl_runs WHERE id = ?')
    .bind(id)
    .first<CrawlRunRow>();
}

// --- FTS Search ---

export interface FtsSearchResult {
  issue: IssueRow;
  bm25Score: number;
  rank: number;
  highlightSnippet: string | null;
}

export async function searchFts(
  db: D1Database,
  ftsQuery: string,
  filters: SearchFilters,
  limit: number = 50
): Promise<FtsSearchResult[]> {
  if (!ftsQuery.trim()) return [];

  // snippet() col 4 = full_text_plain; marks matches with <mark>...</mark>
  let sql = `
    SELECT issues.*,
      bm25(issues_fts, 16.0, 8.0, 8.0, 4.0, 1.0, 2.0) as bm25_score,
      snippet(issues_fts, 4, '<mark>', '</mark>', '...', 24) as highlight_snippet
    FROM issues_fts
    JOIN issues ON issues.rowid = issues_fts.rowid
    WHERE issues_fts MATCH ?
      AND issues.status = 'active'
  `;
  const params: unknown[] = [ftsQuery];

  if (filters.before) {
    sql += ' AND issues.published_at < ?';
    params.push(filters.before);
  }
  if (filters.after) {
    sql += ' AND issues.published_at > ?';
    params.push(filters.after);
  }
  if (filters.year) {
    sql += ' AND issues.year = ?';
    params.push(filters.year);
  }

  sql += ' ORDER BY bm25_score LIMIT ?';
  params.push(limit);

  const results = await db.prepare(sql).bind(...params).all<IssueRow & { bm25_score: number; highlight_snippet: string | null }>();

  return results.results.map((row, index) => ({
    issue: row,
    bm25Score: row.bm25_score,
    rank: index + 1,
    highlightSnippet: row.highlight_snippet || null,
  }));
}

// --- Autocomplete ---

export async function autocompleteTerms(db: D1Database, prefix: string, limit: number = 10): Promise<string[]> {
  if (!prefix || prefix.length < 2) return [];

  const result = await db.prepare(`
    SELECT DISTINCT term FROM issues_fts_vocab
    WHERE term LIKE ? AND col != '*'
    ORDER BY doc DESC
    LIMIT ?
  `).bind(prefix + '%', limit).all<{ term: string }>();

  return result.results.map(r => r.term);
}

export async function autocompleteTitles(db: D1Database, prefix: string, limit: number = 5): Promise<Array<{ title: string; issue_number: number | null }>> {
  if (!prefix || prefix.length < 2) return [];

  const result = await db.prepare(`
    SELECT title, lead_essay_title, issue_number FROM issues
    WHERE status = 'active'
      AND (title LIKE ? OR lead_essay_title LIKE ?)
    ORDER BY published_at DESC
    LIMIT ?
  `).bind('%' + prefix + '%', '%' + prefix + '%', limit)
    .all<{ title: string; lead_essay_title: string | null; issue_number: number | null }>();

  return result.results.map(r => ({
    title: r.lead_essay_title || r.title,
    issue_number: r.issue_number,
  }));
}

export async function autocompleteIssueNumbers(db: D1Database, prefix: string, limit: number = 5): Promise<number[]> {
  const result = await db.prepare(`
    SELECT DISTINCT issue_number FROM issues
    WHERE issue_number IS NOT NULL
      AND CAST(issue_number AS TEXT) LIKE ?
      AND status = 'active'
    ORDER BY issue_number DESC
    LIMIT ?
  `).bind(prefix + '%', limit).all<{ issue_number: number }>();

  return result.results.map(r => r.issue_number);
}
