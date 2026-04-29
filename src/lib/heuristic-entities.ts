/**
 * Heuristic capitalised-sequence extractor.
 *
 * Catches multi-word proper nouns YAKE often misses: "George Yancey",
 * "Mont Blanc", "OpenAI". A simple regex finds runs of two or more
 * capitalised words. Single-word capitalised hits are dropped because
 * sentence-initial words like "But" or "However" would otherwise pollute.
 */
export interface HeuristicHit {
  keyword: string;
  keyword_display: string;
  occurrences: number;
  sentenceSpread: number;
}

const SENTENCE_BOUNDARY = /[.!?]+\s+/;
const CAPITALISED_RUN = /(?:[A-Z][a-z0-9]+(?:'s)?(?:\s+(?:of|the|de|von|van|&)\s+|\s+|-)){1,4}[A-Z][a-z0-9]+/g;

export function findHeuristicEntities(text: string): HeuristicHit[] {
  if (!text) return [];

  // Sentence boundaries used to compute spread.
  const sentences = text.split(SENTENCE_BOUNDARY);

  const counts = new Map<string, { display: string; occurrences: number; sentences: Set<number> }>();

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    let m: RegExpExecArray | null;
    const re = new RegExp(CAPITALISED_RUN.source, 'g');
    while ((m = re.exec(s)) !== null) {
      const display = m[0].trim();
      // Reject hits that are only a single token (regex requires ≥2 but
      // a stray initial split could produce one).
      const tokens = display.split(/\s+|-/);
      if (tokens.length < 2) continue;
      // Reject sentence-initial all-caps words like "However Some".
      if (/^(But|And|However|Yet|Or|So|For|Nor|Although|Because|If|While|When|Then|Now|This|That|These|Those|The|A|An|It|We|They|He|She|His|Her|Our|Their|My|Your)\s/.test(display)) continue;

      const keyword = display.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!keyword) continue;
      const slot = counts.get(keyword) ?? { display, occurrences: 0, sentences: new Set<number>() };
      slot.occurrences++;
      slot.sentences.add(i);
      counts.set(keyword, slot);
    }
  }

  const hits: HeuristicHit[] = [];
  for (const [keyword, slot] of counts) {
    hits.push({
      keyword,
      keyword_display: slot.display,
      occurrences: slot.occurrences,
      sentenceSpread: slot.sentences.size,
    });
  }
  return hits;
}
