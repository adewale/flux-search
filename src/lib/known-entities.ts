/**
 * Curated list of canonical entities the multi-strategy extractor should
 * never miss. Each row is `{ canonical, aliases[] }` — alias matches still
 * resolve to the canonical form so corpus aggregation collapses variants.
 *
 * Flux's archive is conceptual rather than tool-dense, so the seed list
 * is small on purpose. New entries belong here when YAKE keeps missing them.
 */
export interface KnownEntity {
  canonical: string;
  display: string;
  aliases: string[];
}

export const KNOWN_ENTITIES: KnownEntity[] = [
  { canonical: 'institutional trust', display: 'Institutional Trust', aliases: ['institutional trust'] },
  { canonical: 'large language models', display: 'Large Language Models', aliases: ['large language model', 'large language models', 'llms', 'llm'] },
  { canonical: 'systems thinking', display: 'Systems Thinking', aliases: ['systems thinking'] },
  { canonical: 'loose coupling', display: 'Loose Coupling', aliases: ['loose coupling', 'loose-coupling'] },
  { canonical: 'mental models', display: 'Mental Models', aliases: ['mental models', 'mental model'] },
  { canonical: 'open source', display: 'Open Source', aliases: ['open source', 'open-source', 'oss'] },
  { canonical: 'web3', display: 'Web3', aliases: ['web3', 'web 3'] },
  { canonical: 'machine learning', display: 'Machine Learning', aliases: ['machine learning', 'ml'] },
  { canonical: 'crypto', display: 'Crypto', aliases: ['crypto'] },
  { canonical: 'cryptocurrency', display: 'Cryptocurrency', aliases: ['cryptocurrency', 'cryptocurrencies', 'crypto currency'] },
  { canonical: 'climate change', display: 'Climate Change', aliases: ['climate change', 'global warming'] },
  { canonical: 'seeing like a state', display: 'Seeing Like a State', aliases: ['seeing like a state'] },
  { canonical: 'ursula k. le guin', display: 'Ursula K. Le Guin', aliases: ['ursula k. le guin', 'ursula le guin', 'le guin'] },
  { canonical: 'rest of world', display: 'Rest of World', aliases: ['rest of world', 'restofworld'] },
  { canonical: 'not boring', display: 'Not Boring', aliases: ['not boring'] },
  { canonical: 'crooked timber', display: 'Crooked Timber', aliases: ['crooked timber'] },
  { canonical: 'simple habits for complex times', display: 'Simple Habits for Complex Times', aliases: ['simple habits for complex times'] },
  { canonical: 'zugzwang', display: 'Zugzwang', aliases: ['zugzwang'] },
  { canonical: 'saddle point', display: 'Saddle Point', aliases: ['saddle point', 'saddle points'] },
  { canonical: 'legibility', display: 'Legibility', aliases: ['legibility'] },
  { canonical: 'governance', display: 'Governance', aliases: ['governance'] },
  { canonical: 'prompting', display: 'Prompting', aliases: ['prompting'] },
  { canonical: 'iteration', display: 'Iteration', aliases: ['iteration'] },
  { canonical: 'exploration', display: 'Exploration', aliases: ['exploration'] },
  { canonical: 'judgment', display: 'Judgment', aliases: ['judgment', 'judgement'] },
  { canonical: 'chesterton fence', display: "Chesterton's Fence", aliases: ["chesterton's fence", 'chesterton fence'] },
  { canonical: 'attention', display: 'Attention', aliases: ['attention'] },
  { canonical: 'awareness', display: 'Awareness', aliases: ['awareness'] },
  { canonical: 'export controls', display: 'Export Controls', aliases: ['export controls', 'export rules'] },
];

/**
 * Match known-entity aliases against the input text, case-insensitively.
 * Returns one ExtractedTopic-shaped row per distinct canonical form,
 * carrying its occurrence count.
 */
export interface KnownEntityHit {
  keyword: string;
  keyword_display: string;
  occurrences: number;
}

/**
 * Build a quick alias→canonical lookup for the cluster step. Each alias
 * (canonical included) maps to its canonical keyword. Used by
 * clusterCorpusTopics to do hard merges before character-bigram Dice
 * similarity — which is too coarse for acronyms like "LLM" / "large
 * language models".
 */
export function buildAliasMap(entities: KnownEntity[] = KNOWN_ENTITIES): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of entities) {
    out.set(e.canonical.toLowerCase(), e.canonical.toLowerCase());
    for (const a of e.aliases) {
      out.set(a.toLowerCase(), e.canonical.toLowerCase());
    }
  }
  return out;
}

export function findKnownEntities(text: string, entities: KnownEntity[] = KNOWN_ENTITIES): KnownEntityHit[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const hits: KnownEntityHit[] = [];
  const seen = new Set<string>();

  for (const e of entities) {
    let count = 0;
    for (const alias of e.aliases) {
      const a = alias.toLowerCase();
      if (a.length === 0) continue;
      let idx = lower.indexOf(a);
      while (idx !== -1) {
        // Word-boundary check: surrounding chars must not be word chars.
        const before = idx === 0 ? '' : lower[idx - 1];
        const after = lower[idx + a.length] ?? '';
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) count++;
        idx = lower.indexOf(a, idx + 1);
      }
    }
    if (count > 0 && !seen.has(e.canonical)) {
      hits.push({ keyword: e.canonical, keyword_display: e.display, occurrences: count });
      seen.add(e.canonical);
    }
  }
  return hits;
}
