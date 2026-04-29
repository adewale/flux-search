export interface TopicScoreOptions {
  ngramSize?: number | null;
  provenanceCount?: number | null;
}

export function weightedTopicScore(
  docFrequency: number,
  distinctiveness: number,
  avgScore: number,
  opts: TopicScoreOptions = {},
): number {
  if (docFrequency <= 0 || avgScore <= 0 || !Number.isFinite(avgScore)) return 0;
  const ngram = Math.max(1, opts.ngramSize ?? 1);
  const provenance = Math.max(1, opts.provenanceCount ?? 1);
  // Corpus navigation works better when meaningful phrases outrank generic
  // singleton words. Keep the base frequency/distinctiveness/YAKE signal,
  // then apply small, bounded boosts for phrase-ness and extractor agreement.
  const phraseBoost = ngram >= 2 ? 1.5 : 1;
  const provenanceBoost = provenance >= 2 ? 1.2 : 1;
  return ((docFrequency * Math.max(0.01, distinctiveness)) / avgScore) * phraseBoost * provenanceBoost;
}

export function corpusDistinctiveness(docFrequency: number, totalIssues: number): number {
  if (docFrequency <= 0 || totalIssues <= 0) return 0;
  const ratio = docFrequency / totalIssues;
  return Math.max(0.01, Math.min(1, 1 - ratio));
}
