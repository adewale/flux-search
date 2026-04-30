import type { MultiExtractedTopic } from './topic-multi-extract';

export interface CrossIssueTopicFilterResult {
  byIssue: Map<string, MultiExtractedTopic[]>;
  documentFrequency: Map<string, number>;
  suppressedCount: number;
}

/**
 * Keep only candidate topics that appear in at least `minIssueFrequency`
 * distinct issues. Counts are per issue, not per occurrence, so a phrase
 * repeated many times in one newsletter cannot become a topic by itself.
 *
 * This is intentionally placed between per-issue extraction and persistence:
 * bad one-off YAKE/heuristic candidates never enter `issue_topics`, which
 * keeps issue chips, related issues, corpus aggregation, and timelines clean.
 */
export function filterTopicsByIssueFrequency(
  extractedByIssue: Map<string, MultiExtractedTopic[]>,
  minIssueFrequency = 2,
): CrossIssueTopicFilterResult {
  const documentFrequency = new Map<string, number>();

  for (const topics of extractedByIssue.values()) {
    const seenInIssue = new Set<string>();
    for (const topic of topics) {
      seenInIssue.add(topic.keyword);
    }
    for (const keyword of seenInIssue) {
      documentFrequency.set(keyword, (documentFrequency.get(keyword) ?? 0) + 1);
    }
  }

  const byIssue = new Map<string, MultiExtractedTopic[]>();
  let suppressedCount = 0;
  for (const [issueId, topics] of extractedByIssue) {
    const kept = topics.filter(topic => (documentFrequency.get(topic.keyword) ?? 0) >= minIssueFrequency);
    suppressedCount += topics.length - kept.length;
    byIssue.set(issueId, kept.map((topic, index) => ({ ...topic, rank: index + 1 })));
  }

  return { byIssue, documentFrequency, suppressedCount };
}
