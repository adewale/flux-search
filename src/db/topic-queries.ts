import type { ExtractedTopic } from '../lib/topic-extractor';
import type { CorpusTopicRow, IssueTopicRow, TopicTimelineRow } from './types';

export async function replaceIssueTopics(
  db: D1Database,
  issueId: string,
  topics: Array<ExtractedTopic & {
    provenance?: string[];
    suppression_reason?: string | null;
    stem?: string | null;
  }>,
): Promise<void> {
  await db.prepare('DELETE FROM issue_topics WHERE issue_id = ?').bind(issueId).run();

  if (topics.length === 0) return;

  const stmts = topics.map(t =>
    db.prepare(`
      INSERT INTO issue_topics (
        issue_id, keyword, keyword_display, score, rank, ngram_size,
        provenance, suppression_reason, stem
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id, keyword) DO UPDATE SET
        keyword_display = excluded.keyword_display,
        score = excluded.score,
        rank = excluded.rank,
        ngram_size = excluded.ngram_size,
        provenance = excluded.provenance,
        suppression_reason = excluded.suppression_reason,
        stem = excluded.stem
    `).bind(
      issueId, t.keyword, t.keyword_display, t.score, t.rank, t.ngram_size,
      t.provenance ? JSON.stringify(t.provenance) : null,
      t.suppression_reason ?? null,
      t.stem ?? null,
    )
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

/**
 * For each query string, find the issues whose extracted topics match it
 * exactly (case-insensitively). Used by the ranker to apply a topic boost
 * when free-text queries name a topic without using the topic: operator.
 *
 * Bobbin-equivalent: search-topics.applyTopicBoost (+0.15 per matching slug).
 */
export async function getIssuesMatchingQueryTopics(
  db: D1Database,
  queryStrings: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const normalized = queryStrings
    .map(s => s.toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 0);
  if (normalized.length === 0) return out;

  const placeholders = normalized.map(() => '?').join(',');
  const result = await db.prepare(
    `SELECT keyword, issue_id FROM issue_topics WHERE keyword IN (${placeholders})`
  ).bind(...normalized).all<{ keyword: string; issue_id: string }>();
  for (const row of result.results) {
    const set = out.get(row.keyword) ?? new Set<string>();
    set.add(row.issue_id);
    out.set(row.keyword, set);
  }
  return out;
}

/**
 * Adjacent topics: keywords that frequently co-occur with the given keyword
 * across issues. Pure Jaccard-style overlap, ranked by raw co-occurrence
 * count then keyword for stable order.
 *
 * Bobbin-equivalent: topic detail page "adjacent topics" panel.
 */
export async function getAdjacentTopics(
  db: D1Database,
  keyword: string,
  limit = 10,
): Promise<Array<{ keyword: string; keyword_display: string; cooccurrence: number }>> {
  const result = await db.prepare(`
    WITH my_issues AS (
      SELECT DISTINCT issue_id FROM issue_topics WHERE keyword = ?
    )
    SELECT it.keyword, MAX(it.keyword_display) AS keyword_display,
      COUNT(DISTINCT it.issue_id) AS cooccurrence
    FROM issue_topics it
    WHERE it.issue_id IN (SELECT issue_id FROM my_issues)
      AND it.keyword != ?
    GROUP BY it.keyword
    ORDER BY cooccurrence DESC, it.keyword
    LIMIT ?
  `).bind(keyword, keyword, limit).all<{ keyword: string; keyword_display: string; cooccurrence: number }>();
  return result.results;
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

export async function buildCorpusTopics(
  db: D1Database,
  opts: { minDocFrequency?: number } = {},
): Promise<number> {
  // df threshold: Bobbin uses 5 (Yang & Pedersen 1997). flux's corpus is
  // smaller (~240 issues), so the default sits between Bobbin's 5 and
  // our previous 2 — high enough to drop hapaxes and one-off curiosities,
  // low enough to keep emerging topics visible.
  const minDf = opts.minDocFrequency ?? 3;

  await db.prepare('DELETE FROM corpus_topics').run();

  // Aggregate by stem when one is recorded so morphological variants
  // ("models" / "model" / "modeling") collapse to a single corpus row.
  // Falls back to the literal keyword when stem is null.
  await db.prepare(`
    INSERT INTO corpus_topics (
      keyword, keyword_display, doc_frequency, avg_score, aggregate_score,
      first_seen, last_seen, ngram_size, updated_at
    )
    SELECT
      cluster.canonical AS keyword,
      cluster.display AS keyword_display,
      cluster.df AS doc_frequency,
      cluster.avg_score AS avg_score,
      (cluster.df * 1.0) / NULLIF(cluster.avg_score, 0) AS aggregate_score,
      cluster.first_seen,
      cluster.last_seen,
      cluster.ngram_size,
      ? AS updated_at
    FROM (
      SELECT
        COALESCE(NULLIF(t.stem, ''), t.keyword) AS cluster_key,
        (SELECT keyword FROM issue_topics it2
          WHERE COALESCE(NULLIF(it2.stem,''), it2.keyword) = COALESCE(NULLIF(t.stem,''), t.keyword)
          ORDER BY score ASC LIMIT 1) AS canonical,
        (SELECT keyword_display FROM issue_topics it3
          WHERE COALESCE(NULLIF(it3.stem,''), it3.keyword) = COALESCE(NULLIF(t.stem,''), t.keyword)
          ORDER BY score ASC LIMIT 1) AS display,
        COUNT(DISTINCT t.issue_id) AS df,
        AVG(t.score) AS avg_score,
        MIN(i.published_at) AS first_seen,
        MAX(i.published_at) AS last_seen,
        MAX(t.ngram_size) AS ngram_size
      FROM issue_topics t
      JOIN issues i ON i.id = t.issue_id
      WHERE t.suppression_reason IS NULL
        AND t.keyword NOT IN (SELECT keyword FROM topic_blocklist)
      GROUP BY cluster_key
      HAVING COUNT(DISTINCT t.issue_id) >= ?
    ) AS cluster
  `).bind(new Date().toISOString(), minDf).run();

  const result = await db.prepare('SELECT COUNT(*) as c FROM corpus_topics')
    .first<{ c: number }>();
  return result?.c ?? 0;
}

/**
 * Dice-similarity clustering pass over the keys already in corpus_topics.
 * Merges near-duplicates (e.g. "loose coupling" / "loosely coupled") that
 * survived stem-based grouping. Keeps the row with the lowest avg_score
 * (most distinctive YAKE keyphrase) as canonical and folds the others'
 * doc_frequency into it. Returns the number of pairs merged.
 */
export async function clusterCorpusTopics(
  db: D1Database,
  threshold = 0.85,
): Promise<number> {
  const rows = await db.prepare(
    'SELECT keyword, keyword_display, doc_frequency, avg_score FROM corpus_topics',
  ).all<{ keyword: string; keyword_display: string; doc_frequency: number; avg_score: number }>();
  const list = rows.results;
  if (list.length < 2) return 0;

  const { diceSimilarity } = await import('../lib/porter-stem');
  // Single-pass union-find over rows sorted by avg_score asc (best first).
  const sorted = [...list].sort((a, b) => a.avg_score - b.avg_score);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (!p || p === x) { parent.set(x, x); return x; }
    const r = find(p); parent.set(x, r); return r;
  };
  for (const row of sorted) parent.set(row.keyword, row.keyword);

  let merges = 0;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (diceSimilarity(sorted[i].keyword, sorted[j].keyword) >= threshold) {
        const ra = find(sorted[i].keyword);
        const rb = find(sorted[j].keyword);
        if (ra !== rb) { parent.set(rb, ra); merges++; }
      }
    }
  }

  // Apply merges: for each non-canonical row, fold its frequency into
  // the canonical and delete it.
  for (const row of list) {
    const canonical = find(row.keyword);
    if (canonical === row.keyword) continue;
    await db.prepare(
      `UPDATE corpus_topics SET doc_frequency = doc_frequency + ?
       WHERE keyword = ?`,
    ).bind(row.doc_frequency, canonical).run();
    await db.prepare('DELETE FROM corpus_topics WHERE keyword = ?').bind(row.keyword).run();
  }

  return merges;
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

export async function replacePhraseLexicon(
  db: D1Database,
  entries: Array<{ phrase: string; pmi: number; cooccurrence: number; quality: number }>,
): Promise<void> {
  await db.prepare('DELETE FROM phrase_lexicon').run();
  if (entries.length === 0) return;
  const updatedAt = new Date().toISOString();
  const stmts = entries.map(e =>
    db.prepare(
      `INSERT OR REPLACE INTO phrase_lexicon (phrase, pmi, cooccurrence, quality, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(e.phrase, e.pmi, e.cooccurrence, e.quality, updatedAt),
  );
  await db.batch(stmts);
}

export async function getPhraseLexicon(
  db: D1Database,
  limit = 500,
): Promise<Array<{ phrase: string; pmi: number; cooccurrence: number; quality: number }>> {
  const result = await db.prepare(
    'SELECT phrase, pmi, cooccurrence, quality FROM phrase_lexicon ORDER BY quality DESC LIMIT ?',
  ).bind(limit).all<{ phrase: string; pmi: number; cooccurrence: number; quality: number }>();
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
