/**
 * PMI bigram phrase lexicon.
 *
 * For every pair of adjacent tokens (after stopword/punctuation
 * filtering) we estimate
 *
 *     PMI = log( cooccurrence × N / ( freq(w1) × freq(w2) ) )
 *
 * where N is the number of documents. Pairs above `minPMI` and
 * `minCooccurrence` are kept and ranked by `pmi × log2(coocc + 1)`.
 *
 * The lexicon is precomputed once at corpus-rebuild time and stored in
 * `phrase_lexicon`. The multi-strategy extractor consults it before
 * falling back to YAKE.
 */

const SHALLOW_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'so', 'as', 'at', 'be',
  'by', 'for', 'in', 'is', 'it', 'of', 'on', 'to', 'with', 'this',
  'that', 'these', 'those', 'are', 'was', 'were', 'have', 'has', 'had',
  'will', 'would', 'should', 'could', 'can', 'may', 'might', 'do',
  'does', 'did', 'not', 'no', 'yes', 'about', 'into', 'from', 'up',
  'down', 'out', 'all', 'any', 'some', 'many', 'much', 'more', 'most',
  'than', 'then', 'when', 'where', 'why', 'how', 'what', 'who', 'whom',
  'i', 'you', 'we', 'they', 'he', 'she', 'them', 'us', 'me', 'his',
  'her', 'their', 'our', 'my', 'your', 'its',
]);

export interface PhraseLexiconEntry {
  phrase: string;
  pmi: number;
  cooccurrence: number;
  quality: number;
}

export interface BuildOptions {
  minPMI?: number;
  minCooccurrence?: number;
  limit?: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z0-9'-]+/g) ?? [];
}

/**
 * Build the lexicon from an array of document texts. Computes word
 * frequencies + bigram co-occurrences in a single pass, then produces
 * sorted entries above the thresholds.
 */
export function buildPhraseLexicon(
  documents: string[],
  opts: BuildOptions = {},
): PhraseLexiconEntry[] {
  const minPMI = opts.minPMI ?? 3.0;
  const minCooccurrence = opts.minCooccurrence ?? 5;
  const limit = opts.limit ?? 500;

  const wordFreq = new Map<string, number>();
  const bigramFreq = new Map<string, number>();
  let N = 0;

  for (const doc of documents) {
    if (!doc) continue;
    N++;
    const tokens = tokenize(doc).filter(t => !SHALLOW_STOP.has(t) && t.length >= 3);
    const seenWords = new Set<string>();
    const seenBigrams = new Set<string>();
    for (let i = 0; i < tokens.length; i++) {
      seenWords.add(tokens[i]);
      if (i > 0) {
        seenBigrams.add(tokens[i - 1] + ' ' + tokens[i]);
      }
    }
    for (const w of seenWords) wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
    for (const b of seenBigrams) bigramFreq.set(b, (bigramFreq.get(b) ?? 0) + 1);
  }

  const entries: PhraseLexiconEntry[] = [];
  for (const [bigram, coocc] of bigramFreq) {
    if (coocc < minCooccurrence) continue;
    const [w1, w2] = bigram.split(' ');
    const f1 = wordFreq.get(w1) ?? 0;
    const f2 = wordFreq.get(w2) ?? 0;
    if (f1 === 0 || f2 === 0) continue;
    const pmi = Math.log((coocc * N) / (f1 * f2));
    if (pmi < minPMI) continue;
    const quality = Math.max(0, pmi) * (1 + Math.log2(coocc + 1));
    entries.push({ phrase: bigram, pmi, cooccurrence: coocc, quality });
  }

  entries.sort((a, b) => b.quality - a.quality);
  return entries.slice(0, limit);
}

/**
 * Match phrase-lexicon entries against a single document. Returns hits
 * with occurrence counts so quality filtering can use spread-style logic.
 */
export interface PhraseHit {
  keyword: string;
  keyword_display: string;
  occurrences: number;
}

export function findLexiconPhrases(
  text: string,
  lexicon: PhraseLexiconEntry[],
): PhraseHit[] {
  if (!text || lexicon.length === 0) return [];
  const lower = text.toLowerCase();
  const hits: PhraseHit[] = [];

  for (const entry of lexicon) {
    let count = 0;
    let idx = lower.indexOf(entry.phrase);
    while (idx !== -1) {
      const before = idx === 0 ? '' : lower[idx - 1];
      const after = lower[idx + entry.phrase.length] ?? '';
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) count++;
      idx = lower.indexOf(entry.phrase, idx + 1);
    }
    if (count > 0) {
      hits.push({
        keyword: entry.phrase,
        keyword_display: entry.phrase,
        occurrences: count,
      });
    }
  }

  return hits;
}
