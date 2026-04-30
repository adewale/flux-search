import type { ExtractedTopic } from '../lib/topic-extractor';
import type { CorpusTopicRow, IssueRow, IssueTopicRow, TopicTimelineRow } from './types';
import { buildTopicSimilarities, type TopicEmbedding } from '../lib/topic-similarity';

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

  const result = await db.prepare(
    `WITH requested(issue_id) AS (
       SELECT value FROM json_each(?)
     )
     SELECT it.issue_id, it.keyword_display, it.rank
     FROM requested r
     JOIN issue_topics it ON it.issue_id = r.issue_id
     ORDER BY it.issue_id, it.rank`
  ).bind(JSON.stringify(issueIds)).all<{ issue_id: string; keyword_display: string; rank: number }>();

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

export async function getIssuesByTopic(
  db: D1Database,
  keyword: string,
): Promise<IssueRow[]> {
  const result = await db.prepare(
    `SELECT i.*
     FROM issue_topics it
     CROSS JOIN issues i ON i.id = it.issue_id
     WHERE it.keyword = ? AND i.status = 'active'
     ORDER BY i.published_at DESC`,
  ).bind(keyword).all<IssueRow>();
  return result.results;
}

/**
 * For each query string, find the issues whose extracted topics match it
 * exactly (case-insensitively). Used by the ranker to apply a topic boost
 * when free-text queries name a topic without using the topic: operator.
 *
 * Flux topic boost: +0.15 per matching topic slug.
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

  const result = await db.prepare(
    `WITH requested(keyword) AS (
       SELECT value FROM json_each(?)
     )
     SELECT it.keyword, it.issue_id
     FROM requested r
     JOIN issue_topics it ON it.keyword = r.keyword`
  ).bind(JSON.stringify(normalized)).all<{ keyword: string; issue_id: string }>();
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
 * Used by the topic detail page "adjacent topics" panel.
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
  // df threshold: flux's corpus is smaller (~240 issues), so the default
  // sits above the previous 2 while staying low enough to keep emerging
  // topics visible — high enough to drop hapaxes and one-off curiosities,
  // low enough to keep emerging topics visible.
  const minDf = opts.minDocFrequency ?? 3;

  await db.prepare('DELETE FROM corpus_topics').run();

  const total = await db.prepare("SELECT COUNT(*) AS c FROM issues WHERE status = 'active'")
    .first<{ c: number }>();
  const totalIssues = Math.max(1, total?.c ?? 1);

  // Aggregate by stem when one is recorded so morphological variants
  // ("models" / "model" / "modeling") collapse to a single corpus row.
  // Falls back to the literal keyword when stem is null.
  await db.prepare(`
    INSERT INTO corpus_topics (
      keyword, keyword_display, doc_frequency, avg_score, aggregate_score,
      distinctiveness, first_seen, last_seen, ngram_size, updated_at
    )
    SELECT
      cluster.canonical AS keyword,
      cluster.display AS keyword_display,
      cluster.df AS doc_frequency,
      cluster.avg_score AS avg_score,
      ((cluster.df * 1.0) / NULLIF(cluster.avg_score, 0)) *
        MAX(0.01, 1.0 - (cluster.df * 1.0 / ?)) *
        CASE WHEN cluster.ngram_size >= 2 THEN 1.5 ELSE 1.0 END AS aggregate_score,
      MAX(0.01, 1.0 - (cluster.df * 1.0 / ?)) AS distinctiveness,
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
  `).bind(totalIssues, totalIssues, new Date().toISOString(), minDf).run();

  await pruneNestedCorpusTopicFragments(db);

  const result = await db.prepare('SELECT COUNT(*) as c FROM corpus_topics')
    .first<{ c: number }>();
  return result?.c ?? 0;
}

function tokenContains(longer: string, shorter: string): boolean {
  const a = longer.split(/\s+/).filter(Boolean);
  const b = shorter.split(/\s+/).filter(Boolean);
  if (b.length >= a.length || b.length === 0) return false;
  for (let i = 0; i <= a.length - b.length; i++) {
    if (b.every((tok, j) => a[i + j] === tok)) return true;
  }
  return false;
}

async function issueSetForKeyword(db: D1Database, keyword: string): Promise<Set<string>> {
  const rows = await db.prepare(
    'SELECT DISTINCT issue_id FROM issue_topics WHERE keyword = ? AND suppression_reason IS NULL',
  ).bind(keyword).all<{ issue_id: string }>();
  return new Set(rows.results.map(r => r.issue_id));
}

async function pruneNestedCorpusTopicFragments(db: D1Database): Promise<number> {
  const { buildAliasMap } = await import('../lib/known-entities');
  const aliasMap = buildAliasMap();
  const rows = await db.prepare(
    'SELECT keyword, doc_frequency FROM corpus_topics WHERE ngram_size >= 2',
  ).all<{ keyword: string; doc_frequency: number }>();
  const topics = rows.results;
  const toDelete = new Set<string>();

  for (const shorter of topics) {
    // Curated canonical labels are allowed to be nested in longer prose
    // fragments; never delete them as fragments.
    if (aliasMap.get(shorter.keyword) === shorter.keyword) continue;
    for (const longer of topics) {
      if (shorter.keyword === longer.keyword) continue;
      if (!tokenContains(longer.keyword, shorter.keyword)) continue;
      const shorterIssues = await issueSetForKeyword(db, shorter.keyword);
      if (shorterIssues.size === 0) continue;
      const longerIssues = await issueSetForKeyword(db, longer.keyword);
      let overlap = 0;
      for (const id of shorterIssues) if (longerIssues.has(id)) overlap++;
      const containment = overlap / shorterIssues.size;
      // C-value-like nested phrase handling: if the shorter phrase mostly
      // appears only as part of the longer phrase, keep the more specific
      // label and drop the fragment. Independent usage survives.
      if (containment >= 0.8) {
        toDelete.add(shorter.keyword);
        break;
      }
    }
  }

  for (const keyword of toDelete) {
    await db.prepare('DELETE FROM corpus_topics WHERE keyword = ?').bind(keyword).run();
  }
  return toDelete.size;
}

/**
 * Two-pass clustering over corpus_topics.
 *
 *   Pass A — alias-driven: KNOWN_ENTITIES carries explicit aliases
 *            (e.g. "llm" / "llms" → "large language models"). These are
 *            hard merges because Dice on character bigrams misses them
 *            for short acronyms.
 *   Pass B — Dice character-bigram similarity ≥ `threshold`. Catches
 *            morphological near-duplicates that survive stem-grouping
 *            ("loose coupling" / "loosely coupled").
 *
 * Keeps the row with the lowest avg_score (most distinctive YAKE
 * keyphrase) as canonical. Returns the number of pairs merged.
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

  const [{ diceSimilarity }, { buildAliasMap }] = await Promise.all([
    import('../lib/porter-stem'),
    import('../lib/known-entities'),
  ]);
  const aliasMap = buildAliasMap();

  const sorted = [...list].sort((a, b) => a.avg_score - b.avg_score);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (!p || p === x) { parent.set(x, x); return x; }
    const r = find(p); parent.set(x, r); return r;
  };
  for (const row of sorted) parent.set(row.keyword, row.keyword);

  let merges = 0;

  // Pass A: alias-driven hard merges.
  for (const row of sorted) {
    const canonical = aliasMap.get(row.keyword);
    if (!canonical || canonical === row.keyword) continue;
    // Only merge if the alias's canonical is itself a corpus row.
    if (!parent.has(canonical)) continue;
    const ra = find(canonical);
    const rb = find(row.keyword);
    if (ra !== rb) { parent.set(rb, ra); merges++; }
  }

  // Pass B: Dice similarity within the surviving rows.
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (diceSimilarity(sorted[i].keyword, sorted[j].keyword) >= threshold) {
        const ra = find(sorted[i].keyword);
        const rb = find(sorted[j].keyword);
        if (ra !== rb) { parent.set(rb, ra); merges++; }
      }
    }
  }

  // Apply merges: fold each non-canonical row's frequency into its root
  // and delete the original. Order doesn't matter — the final state is
  // a single row per equivalence class.
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

/**
 * Stamp confidence + burst_score onto each corpus_topic row.
 * Pure SQL would force us to hand-compute log/lift in SQLite; doing it
 * in JS with the helpers in topic-quality / topic-burst keeps the
 * logic auditable.
 */
export async function annotateCorpusTopics(db: D1Database): Promise<void> {
  const [
    { computeBurstScore },
    { classifyTopicConfidence },
  ] = await Promise.all([
    import('../lib/topic-burst'),
    import('../lib/topic-quality'),
  ]);

  const rows = await db.prepare(
    'SELECT keyword, doc_frequency FROM corpus_topics',
  ).all<{ keyword: string; doc_frequency: number }>();

  const [timelineRows, qualityRows] = await Promise.all([
    db.prepare(
      `SELECT keyword, year, month, occurrences
       FROM topic_timeline
       WHERE keyword IN (SELECT keyword FROM corpus_topics)
       ORDER BY keyword, year, month`,
    ).all<{ keyword: string; year: number; month: number; occurrences: number }>(),
    db.prepare(
      `SELECT
         keyword,
         COALESCE(MAX(CASE WHEN provenance IS NOT NULL THEN json_array_length(provenance) END), 1) AS provenance_count,
         SUM(CASE WHEN suppression_reason IS NOT NULL THEN 1 ELSE 0 END) AS suppression_hits
       FROM issue_topics
       WHERE keyword IN (SELECT keyword FROM corpus_topics)
       GROUP BY keyword`,
    ).all<{ keyword: string; provenance_count: number | null; suppression_hits: number | null }>(),
  ]);

  const timelineByKeyword = new Map<string, Array<{ year: number; month: number; occurrences: number }>>();
  for (const row of timelineRows.results) {
    const list = timelineByKeyword.get(row.keyword) ?? [];
    list.push({ year: row.year, month: row.month, occurrences: row.occurrences });
    timelineByKeyword.set(row.keyword, list);
  }

  const qualityByKeyword = new Map(qualityRows.results.map(row => [row.keyword, row]));

  const stmts = rows.results.map(r => {
    const burst = computeBurstScore(timelineByKeyword.get(r.keyword) ?? []);
    const quality = qualityByKeyword.get(r.keyword);
    const provenanceCount = quality?.provenance_count ?? 1;
    const suppressionHits = quality?.suppression_hits ?? 0;

    const confidence = classifyTopicConfidence({
      provenanceCount,
      docFrequency: r.doc_frequency,
      suppressionHits,
    });

    return db.prepare(
      `UPDATE corpus_topics
         SET confidence = ?, burst_score = ?, burst_quarter = ?
       WHERE keyword = ?`,
    ).bind(confidence, burst.burstScore, burst.burstQuarter, r.keyword);
  });

  if (stmts.length > 0) await db.batch(stmts);
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
  opts: { sort?: 'frequency' | 'recency' | 'alpha' | 'burst'; limit?: number; offset?: number } = {}
): Promise<CorpusTopicRow[]> {
  const orderBy =
    opts.sort === 'recency' ? 'last_seen DESC' :
    opts.sort === 'alpha' ? 'keyword ASC' :
    opts.sort === 'burst' ? 'burst_score DESC NULLS LAST, aggregate_score DESC' :
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

/**
 * Replace the topic_similarity table with a precomputed pair list.
 * Pairs are bidirectional — each input pair is stored once for (a,b)
 * and once for (b,a) — so route lookups are single-key.
 */
export async function replaceTopicEmbeddings(
  db: D1Database,
  embeddings: TopicEmbedding[],
  model = '@cf/baai/bge-base-en-v1.5',
): Promise<void> {
  if (embeddings.length === 0) return;
  const now = new Date().toISOString();
  await db.batch(embeddings.map(e => db.prepare(
    `INSERT OR REPLACE INTO topic_embeddings (keyword, model, vector_json, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(e.keyword, model, JSON.stringify(e.vector), now)));
}

export async function rebuildSimilaritiesFromStoredEmbeddings(
  db: D1Database,
  changedKeywords: string[] = [],
  alpha = 0.6,
): Promise<number> {
  const rows = await db.prepare('SELECT keyword, vector_json FROM topic_embeddings')
    .all<{ keyword: string; vector_json: string }>();
  const embeddings = rows.results.map(r => ({
    keyword: r.keyword,
    vector: JSON.parse(r.vector_json) as number[],
  })).filter(e => Array.isArray(e.vector) && e.vector.length > 0);

  if (embeddings.length < 2) return 0;

  const issueRows = await db.prepare('SELECT keyword, issue_id FROM issue_topics')
    .all<{ keyword: string; issue_id: string }>();
  const issueSets = new Map<string, Set<string>>();
  for (const row of issueRows.results) {
    const set = issueSets.get(row.keyword) ?? new Set<string>();
    set.add(row.issue_id);
    issueSets.set(row.keyword, set);
  }

  const pairs = buildTopicSimilarities(embeddings, issueSets, { alpha });
  if (changedKeywords.length > 0) {
    for (const keyword of changedKeywords) {
      await db.prepare('DELETE FROM topic_similarity WHERE keyword_a = ? OR keyword_b = ?')
        .bind(keyword, keyword).run();
    }
    const changed = new Set(changedKeywords);
    await replaceTopicSimilarities(db, pairs.filter(p => changed.has(p.keyword_a) || changed.has(p.keyword_b)));
  } else {
    await replaceTopicSimilarities(db, pairs);
  }
  return pairs.length;
}

export async function replaceTopicSimilarities(
  db: D1Database,
  pairs: Array<{ keyword_a: string; keyword_b: string; cosine: number; jaccard: number; blended: number }>,
): Promise<void> {
  await db.prepare('DELETE FROM topic_similarity').run();
  if (pairs.length === 0) return;
  const updatedAt = new Date().toISOString();
  const stmts = pairs.map(p =>
    db.prepare(
      `INSERT OR REPLACE INTO topic_similarity (keyword_a, keyword_b, cosine, jaccard, blended, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(p.keyword_a, p.keyword_b, p.cosine, p.jaccard, p.blended, updatedAt),
  );
  await db.batch(stmts);
}

/**
 * Read precomputed similarity rows for a keyword. Empty when the
 * embedding pass never ran or no pair cleared the threshold.
 */
export async function getTopicSimilarities(
  db: D1Database,
  keyword: string,
  limit = 10,
): Promise<Array<{ keyword: string; cosine: number; jaccard: number; blended: number }>> {
  const result = await db.prepare(
    `SELECT keyword_b AS keyword, cosine, jaccard, blended
     FROM topic_similarity
     WHERE keyword_a = ?
     ORDER BY blended DESC
     LIMIT ?`,
  ).bind(keyword, limit).all<{ keyword: string; cosine: number; jaccard: number; blended: number }>();
  return result.results;
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
): Promise<Array<{
  issue_id: string;
  issue_number: number | null;
  title: string;
  published_at: string | null;
  canonical_url: string | null;
  source_url: string;
  overlap: number;
}>> {
  const result = await db.prepare(`
    WITH my_topics AS (
      SELECT keyword FROM issue_topics WHERE issue_id = ? ORDER BY rank LIMIT 10
    ), related AS (
      SELECT it.issue_id, COUNT(*) AS overlap
      FROM issue_topics it
      WHERE it.issue_id != ?
        AND it.keyword IN (SELECT keyword FROM my_topics)
      GROUP BY it.issue_id
    )
    SELECT r.issue_id, i.issue_number, i.title, i.published_at,
           i.canonical_url, i.source_url, r.overlap
    FROM related r
    JOIN issues i ON i.id = r.issue_id
    WHERE i.status = 'active'
    ORDER BY r.overlap DESC, i.issue_number DESC, r.issue_id
    LIMIT ?
  `).bind(issueId, issueId, limit).all<{
    issue_id: string;
    issue_number: number | null;
    title: string;
    published_at: string | null;
    canonical_url: string | null;
    source_url: string;
    overlap: number;
  }>();
  return result.results;
}
