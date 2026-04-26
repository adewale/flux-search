/**
 * Terminology drift: how a topic's surrounding context shifts over time.
 *
 * Bobbin's docs reference this as a topic-detail-page feature but don't
 * implement it. flux's version is intentionally narrow:
 *
 *   1. Walk every issue that mentions the keyword.
 *   2. Take a window of `windowSize` words on each side of each
 *      occurrence.
 *   3. Bucket by quarter.
 *   4. For each bucket, return the top-k most distinctive context
 *      words versus the topic's overall context distribution.
 *
 * "Distinctive" uses log-odds against the global mean: a word that
 * suddenly dominates one quarter is more interesting than a word that's
 * uniformly common.
 *
 * Pure function — the route assembles {issueText, year, month} tuples
 * from the DB and feeds them in.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'so', 'as', 'at', 'be',
  'by', 'for', 'in', 'is', 'it', 'of', 'on', 'to', 'with', 'this',
  'that', 'these', 'those', 'are', 'was', 'were', 'have', 'has', 'had',
  'will', 'would', 'should', 'could', 'can', 'may', 'might', 'do',
  'does', 'did', 'not', 'no', 'yes', 'about', 'into', 'from', 'up',
  'down', 'out', 'all', 'any', 'some', 'many', 'much', 'more', 'most',
  'than', 'then', 'when', 'where', 'why', 'how', 'what', 'who', 'whom',
  'i', 'you', 'we', 'they', 'he', 'she', 'them', 'us', 'me', 'his',
  'her', 'their', 'our', 'my', 'your', 'its', 'our', 'one', 'two',
  's', 're', 've', 'd', 'm', 'll',
]);

export interface DriftSample {
  text: string;
  year: number;
  month: number;
}

export interface DriftBucket {
  year: number;
  quarter: number;
  occurrences: number;
  topContextWords: Array<{ word: string; share: number; lift: number }>;
}

export interface DriftOptions {
  windowSize?: number;
  topK?: number;
  minContextOccurrences?: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z0-9'-]+/g) ?? [];
}

function quarter(month: number): number {
  return Math.floor((Math.max(1, Math.min(12, month)) - 1) / 3) + 1;
}

/**
 * Scan one document for windowed context around `keyword` (which must
 * already be lowercased + space-normalised).
 */
function contextsFor(text: string, keyword: string, windowSize: number): string[] {
  if (!text || !keyword) return [];
  const tokens = tokenize(text);
  const keywordTokens = keyword.split(' ');
  const contexts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    let match = true;
    for (let j = 0; j < keywordTokens.length; j++) {
      if (tokens[i + j] !== keywordTokens[j]) { match = false; break; }
    }
    if (!match) continue;
    const start = Math.max(0, i - windowSize);
    const end = Math.min(tokens.length, i + keywordTokens.length + windowSize);
    const surrounding: string[] = [];
    for (let k = start; k < end; k++) {
      if (k >= i && k < i + keywordTokens.length) continue;
      const t = tokens[k];
      if (STOPWORDS.has(t)) continue;
      // Two-char words like "ai", "ml", "ui" are domain-relevant; only
      // single-letter tokens are too short to mean anything.
      if (t.length < 2) continue;
      surrounding.push(t);
    }
    contexts.push(surrounding.join(' '));
  }
  return contexts;
}

export function computeTerminologyDrift(
  keyword: string,
  samples: DriftSample[],
  opts: DriftOptions = {},
): DriftBucket[] {
  const windowSize = opts.windowSize ?? 5;
  const topK = opts.topK ?? 5;
  const minOcc = opts.minContextOccurrences ?? 2;

  const k = keyword.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!k || samples.length === 0) return [];

  // Bucket-grain word counts + global counts.
  type Bucket = {
    year: number;
    quarter: number;
    occurrences: number;
    wordCounts: Map<string, number>;
  };
  const buckets = new Map<string, Bucket>();
  const globalCounts = new Map<string, number>();
  let globalTotal = 0;

  for (const s of samples) {
    const ctxList = contextsFor(s.text, k, windowSize);
    if (ctxList.length === 0) continue;
    const q = quarter(s.month);
    const key = s.year + '-' + q;
    const bucket = buckets.get(key) ?? {
      year: s.year, quarter: q, occurrences: 0, wordCounts: new Map<string, number>(),
    };
    bucket.occurrences += ctxList.length;
    for (const ctx of ctxList) {
      for (const w of ctx.split(' ')) {
        if (!w) continue;
        bucket.wordCounts.set(w, (bucket.wordCounts.get(w) ?? 0) + 1);
        globalCounts.set(w, (globalCounts.get(w) ?? 0) + 1);
        globalTotal++;
      }
    }
    buckets.set(key, bucket);
  }

  if (globalTotal === 0) return [];

  const result: DriftBucket[] = [];
  for (const bucket of buckets.values()) {
    let bucketTotal = 0;
    for (const c of bucket.wordCounts.values()) bucketTotal += c;
    if (bucketTotal === 0) continue;

    // Lift = bucket-share / global-share. Higher lift = more
    // distinctive to this quarter than to the overall record.
    const ranked: Array<{ word: string; share: number; lift: number }> = [];
    for (const [w, count] of bucket.wordCounts) {
      if (count < minOcc) continue;
      const bucketShare = count / bucketTotal;
      const globalShare = (globalCounts.get(w) ?? 0) / globalTotal;
      const lift = globalShare > 0 ? bucketShare / globalShare : 0;
      ranked.push({ word: w, share: bucketShare, lift });
    }
    ranked.sort((a, b) => b.lift - a.lift || b.share - a.share);

    result.push({
      year: bucket.year,
      quarter: bucket.quarter,
      occurrences: bucket.occurrences,
      topContextWords: ranked.slice(0, topK),
    });
  }

  result.sort((a, b) => a.year !== b.year ? a.year - b.year : a.quarter - b.quarter);
  return result;
}
