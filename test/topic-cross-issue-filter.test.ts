import { describe, expect, it } from 'vitest';
import { filterTopicsByIssueFrequency } from '../src/lib/topic-cross-issue-filter';
import type { MultiExtractedTopic } from '../src/lib/topic-multi-extract';

function topic(keyword: string, rank = 1): MultiExtractedTopic {
  return {
    keyword,
    keyword_display: keyword,
    score: 0.05,
    rank,
    ngram_size: keyword.split(/\s+/).length,
    provenance: ['yake'],
    occurrences: 2,
    sentenceSpread: 2,
  };
}

describe('filterTopicsByIssueFrequency', () => {
  it('keeps only topics that appear in more than one issue', () => {
    const extracted = new Map<string, MultiExtractedTopic[]>([
      ['issue-a', [topic('systems thinking', 1), topic('one off curiosity', 2)]],
      ['issue-b', [topic('systems thinking', 1), topic('another singleton', 2)]],
    ]);

    const result = filterTopicsByIssueFrequency(extracted, 2);

    expect(result.documentFrequency.get('systems thinking')).toBe(2);
    expect(result.documentFrequency.get('one off curiosity')).toBe(1);
    expect(result.byIssue.get('issue-a')?.map(t => t.keyword)).toEqual(['systems thinking']);
    expect(result.byIssue.get('issue-b')?.map(t => t.keyword)).toEqual(['systems thinking']);
    expect(result.suppressedCount).toBe(2);
  });

  it('counts at most one hit per issue even if a topic is repeated in rows', () => {
    const extracted = new Map<string, MultiExtractedTopic[]>([
      ['issue-a', [topic('local refrain', 1), topic('local refrain', 2)]],
      ['issue-b', [topic('shared topic', 1)]],
      ['issue-c', [topic('shared topic', 1)]],
    ]);

    const result = filterTopicsByIssueFrequency(extracted, 2);

    expect(result.documentFrequency.get('local refrain')).toBe(1);
    expect(result.byIssue.get('issue-a')).toEqual([]);
    expect(result.byIssue.get('issue-b')?.[0].rank).toBe(1);
  });
});
