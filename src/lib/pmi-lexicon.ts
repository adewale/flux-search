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
  /** Maximum contiguous n-gram length to consider. Defaults to 2 for
   *  production precision; tests/experiments can raise this to explore
   *  stopword-bridged title phrases like "seeing like a state". */
  maxN?: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z0-9'-]*/g) ?? [];
}

function phraseKey(tokens: string[]): string {
  return tokens.join(' ');
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
  const maxN = Math.max(2, Math.min(4, opts.maxN ?? 2));

  const wordFreq = new Map<string, number>();
  const phraseFreq = new Map<string, number>();
  let N = 0;

  for (const doc of documents) {
    if (!doc) continue;
    N++;
    const tokens = tokenize(doc);
    const seenWords = new Set<string>();
    const seenPhrases = new Set<string>();
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!SHALLOW_STOP.has(token) && token.length >= 3) seenWords.add(token);
      for (let n = 2; n <= maxN && i + n <= tokens.length; n++) {
        const slice = tokens.slice(i, i + n);
        const first = slice[0];
        const last = slice[slice.length - 1];
        // Stopwords are allowed inside phrases ("seeing like a state"),
        // but not as the phrase boundary.
        if (SHALLOW_STOP.has(first) || SHALLOW_STOP.has(last)) continue;
        if (first.length < 3 || last.length < 3) continue;
        seenPhrases.add(phraseKey(slice));
      }
    }
    for (const w of seenWords) wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
    for (const p of seenPhrases) phraseFreq.set(p, (phraseFreq.get(p) ?? 0) + 1);
  }

  const entries: PhraseLexiconEntry[] = [];
  for (const [phrase, coocc] of phraseFreq) {
    if (coocc < minCooccurrence) continue;
    const words = phrase.split(' ');
    const first = words[0];
    const last = words[words.length - 1];
    const f1 = wordFreq.get(first) ?? 0;
    const f2 = wordFreq.get(last) ?? 0;
    if (f1 === 0 || f2 === 0) continue;
    // Endpoint PMI preserves the old bigram behavior while making
    // longer stopword-bridged phrases measurable without multiplying
    // by every internal stopword/component frequency.
    const pmi = Math.log((coocc * N) / (f1 * f2));
    // For longer exact phrases, endpoint PMI can be low when the endpoint
    // words are common ("seeing" and "state"), even though the full phrase
    // is a meaningful title. Keep recurring 3–4 grams as exact phrase
    // candidates, then let topic-quality/blocklist rules remove artifacts.
    const recurringLongPhrase = words.length >= 3 && coocc >= minCooccurrence;
    if (pmi < minPMI && !recurringLongPhrase) continue;
    const lengthBoost = 1 + Math.log2(words.length);
    const effectiveAssociation = recurringLongPhrase ? Math.max(0.1, pmi) : Math.max(0, pmi);
    const quality = effectiveAssociation * (1 + Math.log2(coocc + 1)) * lengthBoost;
    entries.push({ phrase, pmi, cooccurrence: coocc, quality });
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
