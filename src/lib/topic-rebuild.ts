import { extractTopicsMulti } from './topic-multi-extract';
import { stemPhrase } from './porter-stem';
import { buildPhraseLexicon } from './pmi-lexicon';
import {
  buildCorpusTopics,
  buildTopicTimeline,
  clusterCorpusTopics,
  getBlocklist,
  replaceIssueTopics,
  replacePhraseLexicon,
} from '../db/topic-queries';

export interface RebuildStats {
  issues_processed: number;
  corpus_topics: number;
  timeline_rows: number;
  lexicon_phrases: number;
  cluster_merges: number;
  topics_suppressed: number;
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
}

export async function rebuildAllTopics(
  db: D1Database,
  opts: RebuildOptions = {},
): Promise<RebuildStats> {
  const startedAt = Date.now();
  const issues = await db.prepare(
    `SELECT id, full_text_plain FROM issues WHERE status = 'active'`,
  ).all<{ id: string; full_text_plain: string | null }>();

  // Phase 1: build a fresh PMI lexicon from the live corpus.
  const documents = issues.results.map(i => i.full_text_plain ?? '').filter(Boolean);
  const lexicon = buildPhraseLexicon(documents);
  await replacePhraseLexicon(db, lexicon);

  const blocklist = await getBlocklist(db);

  // Phase 2: extract per-issue topics with provenance + suppression.
  let processed = 0;
  let totalSuppressed = 0;
  for (const issue of issues.results) {
    try {
      const { kept, suppressed } = extractTopicsMulti(
        issue.full_text_plain,
        { blocklist, phraseLexicon: lexicon },
      );
      const rows = kept.map(t => ({
        ...t,
        provenance: t.provenance,
        stem: stemPhrase(t.keyword),
      }));
      await replaceIssueTopics(db, issue.id, rows);
      totalSuppressed += suppressed.length;
      processed++;
    } catch (err) {
      console.error(`Rebuild failed for issue ${issue.id}:`, err);
    }
  }

  // Phase 3: aggregate, cluster, and build the timeline.
  const corpusCount = await buildCorpusTopics(db, { minDocFrequency: opts.minDocFrequency });
  const merges = await clusterCorpusTopics(db, opts.clusterThreshold);
  const timelineCount = await buildTopicTimeline(db);

  const elapsed = Date.now() - startedAt;
  const stats: RebuildStats = {
    issues_processed: processed,
    corpus_topics: corpusCount,
    timeline_rows: timelineCount,
    lexicon_phrases: lexicon.length,
    cluster_merges: merges,
    topics_suppressed: totalSuppressed,
  };
  // Wide event log line — single canonical form mirroring Bobbin's
  // `refresh` / `queue_batch` events. Easy to grep, easy to chart.
  console.log(JSON.stringify({
    event: 'topic_rebuild',
    elapsed_ms: elapsed,
    ...stats,
  }));
  return stats;
}
