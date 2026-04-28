/**
 * A small Porter-style stemmer. Not the full Porter algorithm — flux only
 * needs to collapse trivial morphological variants (plurals, -ing, -ed,
 * -s, -ies) so corpus aggregation merges "models" / "model" / "modeled"
 * into one row.
 *
 * For the rare cases where this is too aggressive, callers can fall back
 * to the literal keyword. Bobbin uses the full Porter stemmer; flux's
 * shorter list of suffixes covers the same ground for our corpus size.
 */

// First-pass: noun-shape suffixes (plurals, possessives).
const SUFFIX_RULES_1: Array<[RegExp, string]> = [
  [/sses$/, 'ss'],
  [/ies$/, 'y'],
  [/ied$/, 'y'],
  // Generic plural: strip a trailing single 's' (after the rules above
  // have already handled "ss", "ies", "ied" so we don't over-strip).
  [/([a-rt-z])s$/, '$1'],
];

// Second-pass: verbal/derivational suffixes. Run after the noun pass so
// that "couplings" → "coupling" → "coupl" composes correctly.
const SUFFIX_RULES_2: Array<[RegExp, string]> = [
  [/(iz|is)ation$/, '$1e'],
  [/ation$/, 'ate'],
  [/([aeiou][a-z]+)ing$/, '$1'],
  [/([aeiou][a-z]+)ed$/, '$1'],
];

// Cleanup: collapse double consonants left by the rules above
// (running → runn → run, shipped → shipp → ship).
const CLEANUP_RULES: Array<[RegExp, string]> = [
  [/([bdgmnprt])\1$/, '$1'],
];

function applyOnePass(w: string, rules: Array<[RegExp, string]>): string {
  for (const [pattern, replacement] of rules) {
    const next = w.replace(pattern, replacement);
    if (next !== w) return next;
  }
  return w;
}

export function stem(word: string): string {
  if (!word) return '';
  let w = word.toLowerCase();
  if (w.length < 4) return w;
  w = applyOnePass(w, SUFFIX_RULES_1);
  w = applyOnePass(w, SUFFIX_RULES_2);
  w = applyOnePass(w, CLEANUP_RULES);
  return w;
}

/**
 * Stem each token in a multi-word keyword and rejoin. Used to cluster
 * "mental models" with "mental model" without flattening unrelated
 * compounds.
 */
export function stemPhrase(phrase: string): string {
  if (!phrase) return '';
  return phrase
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(stem)
    .join(' ');
}

/**
 * Dice similarity over bigram character sets. Used by the clustering pass
 * to merge near-duplicate keywords like "loose coupling" / "loosely
 * coupled" that share most of their character bigrams.
 */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let intersection = 0;
  for (const g of A) if (B.has(g)) intersection++;
  return (2 * intersection) / (A.size + B.size || 1);
}
