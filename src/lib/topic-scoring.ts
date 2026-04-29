export function weightedTopicScore(docFrequency: number, distinctiveness: number, avgScore: number): number {
  if (docFrequency <= 0 || avgScore <= 0 || !Number.isFinite(avgScore)) return 0;
  return (docFrequency * Math.max(0.01, distinctiveness)) / avgScore;
}

export function corpusDistinctiveness(docFrequency: number, totalIssues: number): number {
  if (docFrequency <= 0 || totalIssues <= 0) return 0;
  const ratio = docFrequency / totalIssues;
  return Math.max(0.01, Math.min(1, 1 - ratio));
}
