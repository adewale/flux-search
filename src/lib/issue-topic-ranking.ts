import { computeDomainDistinctivenessBoost, isProtectedDomainTopic } from './domain-distinctiveness';
import type { MultiExtractedTopic } from './topic-multi-extract';

export type IssueTopicCandidate = MultiExtractedTopic;

export interface IssueTopicRankFeatures {
  baseScore: number;
  adjustedScore: number;
  domainBoost: number;
  positionBoost: number;
  spreadBoost: number;
  provenanceBoost: number;
  protectedBoost: number;
  firstOccurrenceRatio: number;
  protectedTopic: boolean;
}

export interface RankedIssueTopic {
  adjustedScore: number;
  features: IssueTopicRankFeatures;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstOccurrenceRatio(keyword: string, text: string): number {
  const lower = text.toLowerCase();
  if (!lower) return 1;
  const pattern = new RegExp(`\\b${escapeRegExp(keyword.toLowerCase()).replace(/\\\s+/g, '\\s+')}\\b`);
  const match = pattern.exec(lower);
  if (!match) return 1;
  return Math.max(0, Math.min(1, match.index / Math.max(1, lower.length)));
}

function appearsInHeadingOrOpening(keyword: string, text: string): boolean {
  const lowerKeyword = keyword.toLowerCase();
  const lines = text.split(/\n+/).slice(0, 12);
  return lines.some(line => {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed.includes(lowerKeyword)) return false;
    // Processed Substack text typically leaves titles/headings as short lines.
    return trimmed.length <= 120 || /^[#>*\-\s]+/.test(line);
  });
}

export function rankIssueTopicCandidate(
  topic: IssueTopicCandidate,
  issueText: string,
  totalIssues = 236,
): RankedIssueTopic {
  const protectedTopic = isProtectedDomainTopic(topic.keyword);
  const domain = computeDomainDistinctivenessBoost({
    keyword: topic.keyword,
    docFrequency: Math.max(1, topic.occurrences ?? 1),
    totalIssues,
    ngramSize: topic.ngram_size,
    protectedTopic,
  });

  const occurrenceRatio = firstOccurrenceRatio(topic.keyword, issueText);
  const earlyBoost = 1 + (0.35 * (1 - occurrenceRatio));
  const headingBoost = appearsInHeadingOrOpening(topic.keyword, issueText) ? 1.2 : 1;
  const positionBoost = Math.min(1.6, earlyBoost * headingBoost);

  const occurrences = Math.max(1, topic.occurrences ?? 1);
  const spread = Math.max(1, topic.sentenceSpread ?? 1);
  const spreadBoost = Math.min(1.6, 1 + (0.08 * Math.log2(occurrences + 1)) + (0.08 * Math.log2(spread + 1)));

  const provenanceBoost = Math.min(1.35, 1 + (0.08 * Math.max(0, topic.provenance.length - 1)));
  const protectedBoost = protectedTopic ? 1.12 : 1;

  const totalBoost = domain.boost * positionBoost * spreadBoost * provenanceBoost * protectedBoost;
  const adjustedScore = topic.score / Math.max(0.1, totalBoost);

  return {
    adjustedScore,
    features: {
      baseScore: topic.score,
      adjustedScore,
      domainBoost: domain.boost,
      positionBoost,
      spreadBoost,
      provenanceBoost,
      protectedBoost,
      firstOccurrenceRatio: occurrenceRatio,
      protectedTopic,
    },
  };
}

export function rerankIssueTopics<T extends IssueTopicCandidate>(topics: T[], issueText: string): T[] {
  return topics
    .map(topic => ({ topic, ranked: rankIssueTopicCandidate(topic, issueText) }))
    .sort((a, b) => {
      if (a.ranked.adjustedScore !== b.ranked.adjustedScore) return a.ranked.adjustedScore - b.ranked.adjustedScore;
      return a.topic.keyword.localeCompare(b.topic.keyword);
    })
    .map(({ topic, ranked }, index) => ({
      ...topic,
      score: ranked.adjustedScore,
      rank: index + 1,
    }));
}
