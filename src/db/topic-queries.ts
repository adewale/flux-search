import type { ExtractedTopic } from '../lib/topic-extractor';
import type { CorpusTopicRow, IssueTopicRow, TopicTimelineRow } from './types';

export async function replaceIssueTopics(
  db: D1Database,
  issueId: string,
  topics: ExtractedTopic[]
): Promise<void> {
  await db.prepare('DELETE FROM issue_topics WHERE issue_id = ?').bind(issueId).run();

  if (topics.length === 0) return;

  const stmts = topics.map(t =>
    db.prepare(`
      INSERT INTO issue_topics (issue_id, keyword, keyword_display, score, rank, ngram_size)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id, keyword) DO UPDATE SET
        keyword_display = excluded.keyword_display,
        score = excluded.score,
        rank = excluded.rank,
        ngram_size = excluded.ngram_size
    `).bind(issueId, t.keyword, t.keyword_display, t.score, t.rank, t.ngram_size)
  );

  await db.batch(stmts);
}

export async function getTopicsByIssueId(
  db: D1Database,
  issueId: string,
  limit = 25
): Promise<IssueTopicRow[]> {
  const result = await db.prepare(
    `SELECT * FROM issue_topics WHERE issue_id = ? ORDER BY rank LIMIT ?`
  ).bind(issueId, limit).all<IssueTopicRow>();
  return result.results;
}

export async function getTopicsForIssueIds(
  db: D1Database,
  issueIds: string[],
  perIssue = 3
): Promise<Map<string, string[]>> {
  if (issueIds.length === 0) return new Map();

  const placeholders = issueIds.map(() => '?').join(',');
  const result = await db.prepare(
    `SELECT issue_id, keyword_display, rank
     FROM issue_topics
     WHERE issue_id IN (${placeholders})
     ORDER BY issue_id, rank`
  ).bind(...issueIds).all<{ issue_id: string; keyword_display: string; rank: number }>();

  const byIssue = new Map<string, string[]>();
  for (const row of result.results) {
    const arr = byIssue.get(row.issue_id) ?? [];
    if (arr.length < perIssue) {
      arr.push(row.keyword_display);
      byIssue.set(row.issue_id, arr);
    }
  }
  return byIssue;
}

export async function getIssueIdsByTopic(
  db: D1Database,
  keyword: string
): Promise<string[]> {
  const result = await db.prepare(
    `SELECT issue_id FROM issue_topics WHERE keyword = ?`
  ).bind(keyword).all<{ issue_id: string }>();
  return result.results.map(r => r.issue_id);
}

export async function getBlocklist(db: D1Database): Promise<Set<string>> {
  const result = await db.prepare(`SELECT keyword FROM topic_blocklist`)
    .all<{ keyword: string }>();
  return new Set(result.results.map(r => r.keyword));
}

export async function addToBlocklist(
  db: D1Database,
  keyword: string,
  reason: string | null = null
): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO topic_blocklist (keyword, reason, added_at) VALUES (?, ?, ?)`
  ).bind(keyword, reason, new Date().toISOString()).run();
}

export async function buildCorpusTopics(db: D1Database): Promise<number> {
  await db.prepare('DELETE FROM corpus_topics').run();

  await db.prepare(`
    INSERT INTO corpus_topics (
      keyword, keyword_display, doc_frequency, avg_score, aggregate_score,
      first_seen, last_seen, ngram_size, updated_at
    )
    SELECT
      t.keyword,
      (SELECT keyword_display FROM issue_topics WHERE keyword = t.keyword ORDER BY score ASC LIMIT 1) AS keyword_display,
      COUNT(DISTINCT t.issue_id) AS doc_frequency,
      AVG(t.score) AS avg_score,
      (COUNT(DISTINCT t.issue_id) * 1.0) / NULLIF(AVG(t.score), 0) AS aggregate_score,
      MIN(i.published_at) AS first_seen,
      MAX(i.published_at) AS last_seen,
      MAX(t.ngram_size) AS ngram_size,
      ? AS updated_at
    FROM issue_topics t
    JOIN issues i ON i.id = t.issue_id
    WHERE t.keyword NOT IN (SELECT keyword FROM topic_blocklist)
    GROUP BY t.keyword
    HAVING COUNT(DISTINCT t.issue_id) >= 2
  `).bind(new Date().toISOString()).run();

  const result = await db.prepare('SELECT COUNT(*) as c FROM corpus_topics')
    .first<{ c: number }>();
  return result?.c ?? 0;
}

export async function buildTopicTimeline(db: D1Database): Promise<number> {
  await db.prepare('DELETE FROM topic_timeline').run();

  await db.prepare(`
    INSERT INTO topic_timeline (keyword, year, month, occurrences)
    SELECT t.keyword, i.year, i.month, COUNT(*) AS occurrences
    FROM issue_topics t
    JOIN issues i ON i.id = t.issue_id
    WHERE i.year IS NOT NULL AND i.month IS NOT NULL
    GROUP BY t.keyword, i.year, i.month
  `).run();

  const result = await db.prepare('SELECT COUNT(*) as c FROM topic_timeline')
    .first<{ c: number }>();
  return result?.c ?? 0;
}

export async function getCorpusTopics(
  db: D1Database,
  opts: { sort?: 'frequency' | 'recency' | 'alpha'; limit?: number; offset?: number } = {}
): Promise<CorpusTopicRow[]> {
  const orderBy =
    opts.sort === 'recency' ? 'last_seen DESC' :
    opts.sort === 'alpha' ? 'keyword ASC' :
    'aggregate_score DESC';
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const result = await db.prepare(
    `SELECT * FROM corpus_topics ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).bind(limit, offset).all<CorpusTopicRow>();
  return result.results;
}

export async function getTopicTimeline(
  db: D1Database,
  keyword: string
): Promise<TopicTimelineRow[]> {
  const result = await db.prepare(
    `SELECT * FROM topic_timeline WHERE keyword = ? ORDER BY year, month`
  ).bind(keyword).all<TopicTimelineRow>();
  return result.results;
}

export async function getRelatedIssuesByTopic(
  db: D1Database,
  issueId: string,
  limit = 3
): Promise<Array<{ issue_id: string; overlap: number }>> {
  const result = await db.prepare(`
    WITH my_topics AS (
      SELECT keyword FROM issue_topics WHERE issue_id = ? ORDER BY rank LIMIT 10
    )
    SELECT it.issue_id, COUNT(*) AS overlap
    FROM issue_topics it
    WHERE it.issue_id != ?
      AND it.keyword IN (SELECT keyword FROM my_topics)
    GROUP BY it.issue_id
    ORDER BY overlap DESC, it.issue_id
    LIMIT ?
  `).bind(issueId, issueId, limit).all<{ issue_id: string; overlap: number }>();
  return result.results;
}
