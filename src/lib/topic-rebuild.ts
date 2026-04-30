import { extractTopicsMulti } from './topic-multi-extract';
import { stemPhrase } from './porter-stem';
import { buildPhraseLexicon } from './pmi-lexicon';
import { filterTopicsByIssueFrequency } from './topic-cross-issue-filter';
import {
  annotateCorpusTopics,
  buildCorpusTopics,
  buildTopicTimeline,
  clusterCorpusTopics,
  getBlocklist,
  getPhraseLexicon,
  replaceIssueTopics,
  replacePhraseLexicon,
  replaceTopicSimilarities,
} from '../db/topic-queries';
import { buildTopicSimilarities } from './topic-similarity';
import type { EmbedFn } from './topic-embed';

export interface PipelineStepResult<T> {
  name: string;
  elapsed_ms: number;
  result: T;
}

export async function runStep<T>(name: string, fn: () => Promise<T>): Promise<PipelineStepResult<T>> {
  const start = Date.now();
  try {
    const result = await fn();
    const elapsed_ms = Date.now() - start;
    console.log(JSON.stringify({ event: 'pipeline_step', name, status: 'ok', elapsed_ms }));
    return { name, elapsed_ms, result };
  } catch (err) {
    const elapsed_ms = Date.now() - start;
    console.error(JSON.stringify({ event: 'pipeline_step', name, status: 'failed', elapsed_ms, error: String(err) }));
    throw err;
  }
}

export function shouldRetryError(err: unknown): boolean {
  const message = String(err instanceof Error ? err.message : err).toLowerCase();
  return message.includes('sqlite_busy')
    || message.includes('database is locked')
    || /\b429\b/.test(message)
    || /\b503\b/.test(message)
    || message.includes('rate limit')
    || message.includes('temporarily unavailable')
    || message.includes('network');
}

export interface RebuildStats {
  run_id: string;
  issues_processed: number;
  corpus_topics: number;
  timeline_rows: number;
  lexicon_phrases: number;
  cluster_merges: number;
  topics_suppressed: number;
  similarity_pairs: number;
}

/**
 * Walk every active issue, extract topics with the multi-strategy
 * pipeline (known entities → phrase lexicon → heuristic entities →
 * YAKE), persist them with provenance, then rebuild the corpus
 * aggregates with stem-based grouping + Dice clustering.
 *
 * Per-issue extraction failures are isolated; one bad issue does not
 * abort the whole rebuild.
 */
export interface RebuildOptions {
  minDocFrequency?: number;
  clusterThreshold?: number;
  /** Optional embedder for the cross-validation similarity pass. When
   *  omitted, the pass is skipped (corpus rebuild stays cheap and the
   *  existing Jaccard adjacency keeps working). */
  embed?: EmbedFn;
  /** α blend between cosine and Jaccard (0..1). Default 0.6. */
  similarityAlpha?: number;
  /** Candidate topics must appear in this many distinct issues before
   *  being persisted during a full rebuild. Default 2. */
  minCandidateIssueFrequency?: number;
}

export async function rebuildAllTopics(
  db: D1Database,
  opts: RebuildOptions = {},
): Promise<RebuildStats> {
  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO pipeline_runs (id, mode, started_at, status, notes)
    VALUES (?, ?, ?, 'running', NULL)
  `).bind(runId, 'topic_rebuild', new Date().toISOString()).run();

  try {
    const issues = (await runStep('load_active_issues', () => db.prepare(
      `SELECT id, full_text_plain FROM issues WHERE status = 'active'`,
    ).all<{ id: string; full_text_plain: string | null }>())).result;

    // Phase 1: build a fresh PMI lexicon from the live corpus.
    const lexicon = (await runStep('build_phrase_lexicon', async () => {
      const documents = issues.results.map(i => i.full_text_plain ?? '').filter(Boolean);
      const phrases = buildPhraseLexicon(documents);
      await replacePhraseLexicon(db, phrases);
      return phrases;
    })).result;

    const blocklist = (await runStep('load_topic_blocklist', () => getBlocklist(db))).result;

    // Phase 2: extract per-issue topics with provenance + suppression,
    // then apply the corpus-level candidate floor before persistence. This
    // keeps one-issue curiosities out of issue_topics entirely, rather than
    // relying on the later corpus aggregate threshold to hide them.
    let processed = 0;
    let totalSuppressed = 0;
    await runStep('extract_issue_topics', async () => {
      const extractedByIssue = new Map<string, ReturnType<typeof extractTopicsMulti>['kept']>();
      for (const issue of issues.results) {
        try {
          const { kept, suppressed } = extractTopicsMulti(
            issue.full_text_plain,
            { blocklist, phraseLexicon: lexicon },
          );
          extractedByIssue.set(issue.id, kept);
          totalSuppressed += suppressed.length;
          processed++;
        } catch (err) {
          console.error(`Rebuild failed for issue ${issue.id}:`, err);
          extractedByIssue.set(issue.id, []);
        }
      }

      const crossIssue = filterTopicsByIssueFrequency(
        extractedByIssue,
        opts.minCandidateIssueFrequency ?? 2,
      );
      totalSuppressed += crossIssue.suppressedCount;

      for (const issue of issues.results) {
        const kept = crossIssue.byIssue.get(issue.id) ?? [];
        const rows = kept.map(t => ({
          ...t,
          provenance: t.provenance,
          stem: stemPhrase(t.keyword),
        }));
        await replaceIssueTopics(db, issue.id, rows);
      }
    });

    // Phase 3: aggregate, cluster, build the timeline, then annotate with
    // confidence + burst score so the API can sort/filter without
    // recomputing on every request.
    const corpusCount = (await runStep('aggregate_corpus_topics', () =>
      buildCorpusTopics(db, { minDocFrequency: opts.minDocFrequency })
    )).result;
    const merges = (await runStep('cluster_corpus_topics', () => clusterCorpusTopics(db, opts.clusterThreshold))).result;
    const timelineCount = (await runStep('build_topic_timeline', () => buildTopicTimeline(db))).result;
    await runStep('annotate_corpus_topics', () => annotateCorpusTopics(db));

    // Phase 4 (optional): cross-validation. When an embedder is provided
    // we embed each surviving keyword, blend cosine with Jaccard, and
    // store the result for the topic detail page.
    let similarityPairs = 0;
    if (opts.embed) {
      similarityPairs = (await runStep('build_topic_similarities', async () => {
        const survivors = await db.prepare(
          'SELECT keyword, keyword_display FROM corpus_topics',
        ).all<{ keyword: string; keyword_display: string }>();
        const keywords = survivors.results.map(r => r.keyword);

        if (keywords.length < 2) return 0;

        const vectors = await opts.embed!(survivors.results.map(r => r.keyword_display));
        const embeddings = keywords.map((kw, i) => ({ keyword: kw, vector: vectors[i] ?? [] }))
          .filter(e => e.vector.length > 0);

        // Build issue-set per keyword for Jaccard. Survivors come from
        // corpus_topics, so keep this set-oriented instead of sending a
        // dynamic keyword IN-list back to D1.
        const issueSets = new Map<string, Set<string>>();
        const sets = embeddings.length === 0 ? null : await db.prepare(
          `SELECT it.keyword, it.issue_id
           FROM issue_topics it
           JOIN corpus_topics ct ON ct.keyword = it.keyword`,
        ).all<{ keyword: string; issue_id: string }>();
        for (const row of sets?.results ?? []) {
          const set = issueSets.get(row.keyword) ?? new Set<string>();
          set.add(row.issue_id);
          issueSets.set(row.keyword, set);
        }

        const pairs = buildTopicSimilarities(embeddings, issueSets, {
          alpha: opts.similarityAlpha ?? 0.6,
        });
        await replaceTopicSimilarities(db, pairs);
        return pairs.length;
      })).result;
    }

    const elapsed = Date.now() - startedAt;
    const stats: RebuildStats = {
      run_id: runId,
      issues_processed: processed,
      corpus_topics: corpusCount,
      timeline_rows: timelineCount,
      lexicon_phrases: lexicon.length,
      cluster_merges: merges,
      topics_suppressed: totalSuppressed,
      similarity_pairs: similarityPairs,
    };
    await db.prepare(`
      UPDATE pipeline_runs SET completed_at = ?, status = 'completed', notes = ? WHERE id = ?
    `).bind(new Date().toISOString(), JSON.stringify(stats), runId).run();
    // Wide event log line — single canonical form. Easy to grep,
    // easy to chart.
    console.log(JSON.stringify({
      event: 'topic_rebuild',
      elapsed_ms: elapsed,
      ...stats,
    }));
    return stats;
  } catch (err) {
    await db.prepare(`
      UPDATE pipeline_runs SET completed_at = ?, status = 'failed', notes = ? WHERE id = ?
    `).bind(new Date().toISOString(), String(err), runId).run();
    throw err;
  }
}

/**
 * Incremental update for one issue. The full rebuild is fine for our
 * 240-issue corpus today, but it scales linearly with corpus size and
 * dominates the cron path once we cross a few thousand issues.
 *
 * The cheaper path:
 *   1. Re-extract topics for just this issue (using the cached
 *      phrase_lexicon — no need to rebuild it).
 *   2. Replace its rows in issue_topics. Keep track of the union of
 *      old + new keywords.
 *   3. Re-aggregate corpus_topics rows for those keys only.
 *   4. Re-build topic_timeline rows for those keys.
 *   5. Re-annotate the affected corpus_topics rows.
 *
 * We don't run the cluster step here — Dice clustering is global by
 * nature and only makes sense after a full rebuild. Most incremental
 * updates won't change the clustering anyway.
 */
export async function rebuildOneIssueTopics(
  db: D1Database,
  issueId: string,
): Promise<{ kept: number; affected_keywords: number }> {
  const issue = await db.prepare(
    'SELECT id, full_text_plain FROM issues WHERE id = ? AND status = ?',
  ).bind(issueId, 'active').first<{ id: string; full_text_plain: string | null }>();
  if (!issue) return { kept: 0, affected_keywords: 0 };

  const oldRows = await db.prepare(
    'SELECT keyword FROM issue_topics WHERE issue_id = ?',
  ).bind(issueId).all<{ keyword: string }>();
  const oldKeywords = new Set(oldRows.results.map(r => r.keyword));

  const lexicon = await getPhraseLexicon(db);
  const blocklist = await getBlocklist(db);

  const { kept } = extractTopicsMulti(
    issue.full_text_plain,
    { blocklist, phraseLexicon: lexicon },
  );
  const rows = kept.map(t => ({
    ...t,
    provenance: t.provenance,
    stem: stemPhrase(t.keyword),
  }));
  await replaceIssueTopics(db, issueId, rows);

  const newKeywords = new Set(kept.map(k => k.keyword));
  const affected = new Set([...oldKeywords, ...newKeywords]);

  // Re-aggregate corpus_topics + topic_timeline for affected keywords
  // only. We delete the affected rows then re-insert with a per-keyword
  // SELECT.
  for (const kw of affected) {
    await reaggregateOneKeyword(db, kw);
  }

  return { kept: rows.length, affected_keywords: affected.size };
}

async function reaggregateOneKeyword(db: D1Database, keyword: string): Promise<void> {
  // Delete existing aggregates for this keyword so that disappearance
  // (occurrences dropped to 0) is honoured.
  await db.prepare('DELETE FROM corpus_topics WHERE keyword = ?').bind(keyword).run();
  await db.prepare('DELETE FROM topic_timeline WHERE keyword = ?').bind(keyword).run();

  const counts = await db.prepare(`
    SELECT
      t.keyword,
      MAX(t.keyword_display) AS keyword_display,
      COUNT(DISTINCT t.issue_id) AS df,
      AVG(t.score) AS avg_score,
      MIN(i.published_at) AS first_seen,
      MAX(i.published_at) AS last_seen,
      MAX(t.ngram_size) AS ngram_size
    FROM issue_topics t
    JOIN issues i ON i.id = t.issue_id
    WHERE t.keyword = ?
      AND t.suppression_reason IS NULL
      AND t.keyword NOT IN (SELECT keyword FROM topic_blocklist)
    GROUP BY t.keyword
  `).bind(keyword).first<{
    keyword: string; keyword_display: string; df: number; avg_score: number;
    first_seen: string | null; last_seen: string | null; ngram_size: number | null;
  }>();

  if (!counts || counts.df < 2) return; // disappear gracefully

  const total = await db.prepare("SELECT COUNT(*) AS c FROM issues WHERE status = 'active'")
    .first<{ c: number }>();
  const distinctiveness = Math.max(0.01, 1 - (counts.df / Math.max(1, total?.c ?? 1)));

  await db.prepare(`
    INSERT INTO corpus_topics (
      keyword, keyword_display, doc_frequency, avg_score, aggregate_score,
      distinctiveness, first_seen, last_seen, ngram_size, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    counts.keyword, counts.keyword_display, counts.df, counts.avg_score,
    ((counts.df * 1.0) / Math.max(counts.avg_score || 1e-9, 1e-9)) * distinctiveness,
    distinctiveness,
    counts.first_seen, counts.last_seen, counts.ngram_size,
    new Date().toISOString(),
  ).run();

  // Re-insert timeline rows for this keyword.
  const timelineRows = await db.prepare(`
    SELECT i.year, i.month, COUNT(*) AS occurrences
    FROM issue_topics t
    JOIN issues i ON i.id = t.issue_id
    WHERE t.keyword = ? AND i.year IS NOT NULL AND i.month IS NOT NULL
    GROUP BY i.year, i.month
  `).bind(keyword).all<{ year: number; month: number; occurrences: number }>();
  for (const r of timelineRows.results) {
    await db.prepare(
      'INSERT INTO topic_timeline (keyword, year, month, occurrences) VALUES (?, ?, ?, ?)',
    ).bind(keyword, r.year, r.month, r.occurrences).run();
  }

  // Re-annotate just this row (cheap: one timeline + one suppression query).
  const { computeBurstScore } = await import('./topic-burst');
  const { classifyTopicConfidence } = await import('./topic-quality');

  const burst = computeBurstScore(timelineRows.results);
  const provRow = await db.prepare(
    `SELECT MAX(json_array_length(provenance)) AS pmax
     FROM issue_topics WHERE keyword = ? AND provenance IS NOT NULL`,
  ).bind(keyword).first<{ pmax: number | null }>();
  const suppRow = await db.prepare(
    'SELECT COUNT(*) AS c FROM issue_topics WHERE keyword = ? AND suppression_reason IS NOT NULL',
  ).bind(keyword).first<{ c: number }>();
  const confidence = classifyTopicConfidence({
    provenanceCount: provRow?.pmax ?? 1,
    docFrequency: counts.df,
    suppressionHits: suppRow?.c ?? 0,
  });
  await db.prepare(
    `UPDATE corpus_topics
       SET confidence = ?, burst_score = ?, burst_quarter = ?
     WHERE keyword = ?`,
  ).bind(confidence, burst.burstScore, burst.burstQuarter, keyword).run();
}
