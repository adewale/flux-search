import { describe, expect, it } from 'vitest';
import { rankIssueTopicCandidate, type IssueTopicCandidate } from '../src/lib/issue-topic-ranking';

function candidate(keyword: string, overrides: Partial<IssueTopicCandidate> = {}): IssueTopicCandidate {
  return {
    keyword,
    keyword_display: keyword,
    score: 0.08,
    rank: 1,
    ngram_size: keyword.split(/\s+/).length,
    provenance: ['yake'],
    occurrences: 2,
    sentenceSpread: 2,
    ...overrides,
  };
}

describe('issue topic ranking', () => {
  it('boosts topics mentioned in titles and early issue text', () => {
    const text = 'Systems thinking for institutions\n\nSystems thinking appears immediately. Later we mention good ideas.';
    const early = rankIssueTopicCandidate(candidate('systems thinking'), text);
    const late = rankIssueTopicCandidate(candidate('good ideas'), text);

    expect(early.adjustedScore).toBeLessThan(late.adjustedScore);
    expect(early.features.positionBoost).toBeGreaterThan(late.features.positionBoost);
  });

  it('boosts topics with stronger spread and recurrence in the issue', () => {
    const text = 'Mental models open the issue. Mental models recur. Mental models close the issue.';
    const spread = rankIssueTopicCandidate(candidate('mental models', { occurrences: 6, sentenceSpread: 5 }), text);
    const passing = rankIssueTopicCandidate(candidate('passing phrase', { occurrences: 1, sentenceSpread: 1 }), text);

    expect(spread.adjustedScore).toBeLessThan(passing.adjustedScore);
    expect(spread.features.spreadBoost).toBeGreaterThan(passing.features.spreadBoost);
  });

  it('blends domain distinctiveness into local issue ranking', () => {
    const text = 'Systems thinking and good ideas both appear near the top.';
    const distinctive = rankIssueTopicCandidate(candidate('systems thinking'), text);
    const generic = rankIssueTopicCandidate(candidate('good ideas'), text);

    expect(distinctive.adjustedScore).toBeLessThan(generic.adjustedScore);
    expect(distinctive.features.domainBoost).toBeGreaterThan(generic.features.domainBoost);
  });

  it('gives protected book titles and publications a local floor', () => {
    const text = 'Simple Habits for Complex Times is cited beside Rest of World.';
    const book = rankIssueTopicCandidate(candidate('simple habits for complex times'), text);
    const publication = rankIssueTopicCandidate(candidate('rest of world'), text);

    expect(book.features.protectedTopic).toBe(true);
    expect(publication.features.protectedTopic).toBe(true);
    expect(book.features.domainBoost).toBeGreaterThanOrEqual(1);
    expect(publication.features.domainBoost).toBeGreaterThanOrEqual(1);
  });
});
