import { extractTopics } from './topic-extractor';
import {
  buildCorpusTopics,
  buildTopicTimeline,
  replaceIssueTopics,
} from '../db/topic-queries';

export interface RebuildStats {
  issues_processed: number;
  corpus_topics: number;
  timeline_rows: number;
}

/**
 * Walk every active issue, extract topics from its plain text, and rebuild
 * the corpus-level aggregates (`corpus_topics`, `topic_timeline`).
 *
 * Per-issue extraction failures are isolated — one bad issue does not
 * abort the whole rebuild.
 */
export async function rebuildAllTopics(db: D1Database): Promise<RebuildStats> {
  const issues = await db.prepare(
    `SELECT id, full_text_plain FROM issues WHERE status = 'active'`
  ).all<{ id: string; full_text_plain: string | null }>();

  let processed = 0;
  for (const issue of issues.results) {
    try {
      const topics = extractTopics(issue.full_text_plain);
      await replaceIssueTopics(db, issue.id, topics);
      processed++;
    } catch (err) {
      console.error(`Rebuild failed for issue ${issue.id}:`, err);
    }
  }

  const corpusCount = await buildCorpusTopics(db);
  const timelineCount = await buildTopicTimeline(db);

  return {
    issues_processed: processed,
    corpus_topics: corpusCount,
    timeline_rows: timelineCount,
  };
}
