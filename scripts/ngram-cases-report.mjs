#!/usr/bin/env node
/**
 * N-gram diagnostic report (formerly test/ngram-cases.test.ts).
 *
 * Compares hit counts for query pairs where bigram/trigram/character n-gram
 * indexing might help: typos, substrings, compound phrases, US/UK spellings
 * and word order. It is a diagnostic for deciding whether n-gram indexing is
 * worth building, so it reports numbers instead of asserting; the invariants
 * it used to check live in test/live/ngram-invariants.test.ts.
 *
 * Usage: FLUX_BASE_URL=https://flux-search.adewale-883.workers.dev npm run report:ngram-cases
 */
const base = process.env.FLUX_BASE_URL || 'https://flux-search.adewale-883.workers.dev';

const CASES = [
  { category: 'typo tolerance', label: 'missing i', reference: 'coordination', probe: 'coordnation' },
  { category: 'typo tolerance', label: 'double l', reference: 'resilience', probe: 'resillience' },
  { category: 'typo tolerance', label: 'common misspelling', reference: 'hierarchy', probe: 'heirarchy' },
  { category: 'substring', label: 'short prefix', reference: 'organize', probe: 'organ' },
  { category: 'substring', label: 'long prefix', reference: 'accountability', probe: 'accountab' },
  { category: 'compound concept', label: 'phrase vs words', reference: 'systems thinking', probe: '"systems thinking"' },
  { category: 'compound concept', label: 'phrase vs words', reference: 'loose coupling', probe: '"loose coupling"' },
  { category: 'compound concept', label: 'phrase vs words', reference: 'mental models', probe: '"mental models"' },
  { category: 'spelling variant', label: 'US vs UK', reference: 'organization', probe: 'organisation' },
  { category: 'spelling variant', label: 'US vs UK', reference: 'behavior', probe: 'behaviour' },
  { category: 'word order', label: 'phrase order', reference: '"trust building"', probe: '"building trust"' },
];

async function search(q) {
  const res = await fetch(`${base}/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`GET /search?q=${q} -> ${res.status}`);
  const data = await res.json();
  const sources = {};
  for (const r of data.results || []) {
    for (const m of r.matched_by || []) sources[m] = (sources[m] || 0) + 1;
  }
  return { hits: data.total_hits || 0, sources };
}

const rows = [];
for (const c of CASES) {
  const [reference, probe] = [await search(c.reference), await search(c.probe)];
  rows.push({
    category: c.category,
    case: c.label,
    reference: `${c.reference} (${reference.hits})`,
    probe: `${c.probe} (${probe.hits})`,
    probe_sources: JSON.stringify(probe.sources),
    handled: probe.hits > 0 ? 'yes' : 'n-grams would help',
  });
}
console.log(`n-gram diagnostic report for ${base}`);
console.table(rows);
