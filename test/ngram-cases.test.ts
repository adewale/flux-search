/**
 * Test cases where bigrams/trigrams/n-grams might help.
 * Each test checks whether our current search (FTS5 + Vectorize)
 * handles the case well enough, or whether n-gram indexing would improve it.
 *
 * Categories:
 * 1. Typo tolerance — misspelled queries
 * 2. Substring matching — partial words
 * 3. Compound concepts — multi-word phrases treated as units
 * 4. Spelling variants — US vs UK English
 * 5. Word order sensitivity — different orderings of the same concept
 *
 * These tests run against the live production API.
 */

import { describe, it, expect } from 'vitest';

const API = 'https://flux-search.adewale-883.workers.dev';

async function search(q: string): Promise<{ total_hits: number; results: any[]; matched_by_sources: Record<string, number> }> {
  const resp = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
  const data = await resp.json() as any;
  const sources: Record<string, number> = {};
  for (const r of data.results || []) {
    for (const m of r.matched_by || []) {
      sources[m] = (sources[m] || 0) + 1;
    }
  }
  return { total_hits: data.total_hits || 0, results: data.results || [], matched_by_sources: sources };
}

// ========================
// 1. Typo tolerance
// ========================
describe('typo tolerance (n-grams would help)', () => {
  it('finds "coordination" when user types "coordnation" (missing i)', async () => {
    const correct = await search('coordination');
    const typo = await search('coordnation');

    console.log(`  coordination: ${correct.total_hits} hits`);
    console.log(`  coordnation (typo): ${typo.total_hits} hits`);
    console.log(`  typo sources: ${JSON.stringify(typo.matched_by_sources)}`);

    // Does Vectorize rescue this?
    if (typo.total_hits > 0) {
      console.log('  ✓ Handled by current system');
    } else {
      console.log('  ✗ N-gram indexing would help here');
    }
    // We just log, not assert — this is diagnostic
    expect(correct.total_hits).toBeGreaterThan(0);
  });

  it('finds "resilience" when user types "resillience" (double l)', async () => {
    const correct = await search('resilience');
    const typo = await search('resillience');

    console.log(`  resilience: ${correct.total_hits} hits`);
    console.log(`  resillience (typo): ${typo.total_hits} hits`);
    console.log(`  typo sources: ${JSON.stringify(typo.matched_by_sources)}`);

    expect(correct.total_hits).toBeGreaterThan(0);
  });

  it('finds "hierarchy" when user types "heirarchy" (common misspelling)', async () => {
    const correct = await search('hierarchy');
    const typo = await search('heirarchy');

    console.log(`  hierarchy: ${correct.total_hits} hits`);
    console.log(`  heirarchy (typo): ${typo.total_hits} hits`);
    console.log(`  typo sources: ${JSON.stringify(typo.matched_by_sources)}`);

    expect(correct.total_hits).toBeGreaterThan(0);
  });
});

// ========================
// 2. Substring matching
// ========================
describe('substring matching (trigrams would help)', () => {
  it('finds issues about "organize" when user types "organ"', async () => {
    const full = await search('organize');
    const partial = await search('organ');

    console.log(`  organize: ${full.total_hits} hits`);
    console.log(`  organ (substring): ${partial.total_hits} hits`);
    // FTS5 with porter stemming should handle this via prefix matching

    expect(full.total_hits).toBeGreaterThan(0);
  });

  it('finds "accountability" when user types "accountab"', async () => {
    const full = await search('accountability');
    const partial = await search('accountab');

    console.log(`  accountability: ${full.total_hits} hits`);
    console.log(`  accountab (prefix): ${partial.total_hits} hits`);

    expect(full.total_hits).toBeGreaterThan(0);
  });
});

// ========================
// 3. Compound concepts (bigrams)
// ========================
describe('compound concepts (bigram indexing would help)', () => {
  it('"systems thinking" as a concept vs individual words', async () => {
    const phrase = await search('"systems thinking"');
    const words = await search('systems thinking');

    console.log(`  "systems thinking" (phrase): ${phrase.total_hits} hits`);
    console.log(`  systems thinking (words): ${words.total_hits} hits`);
    console.log(`  phrase sources: ${JSON.stringify(phrase.matched_by_sources)}`);
    // Phrase search should be more precise than word search
    expect(phrase.total_hits).toBeLessThanOrEqual(words.total_hits);
  });

  it('"loose coupling" as a concept vs individual words', async () => {
    const phrase = await search('"loose coupling"');
    const words = await search('loose coupling');

    console.log(`  "loose coupling" (phrase): ${phrase.total_hits} hits`);
    console.log(`  loose coupling (words): ${words.total_hits} hits`);

    expect(phrase.total_hits).toBeLessThanOrEqual(words.total_hits);
  });

  it('"mental models" as a concept', async () => {
    const phrase = await search('"mental models"');
    const words = await search('mental models');

    console.log(`  "mental models" (phrase): ${phrase.total_hits} hits`);
    console.log(`  mental models (words): ${words.total_hits} hits`);

    expect(phrase.total_hits).toBeLessThanOrEqual(words.total_hits);
  });
});

// ========================
// 4. Spelling variants
// ========================
describe('spelling variants (character n-grams would help)', () => {
  it('US "organization" vs UK "organisation"', async () => {
    const us = await search('organization');
    const uk = await search('organisation');

    console.log(`  organization (US): ${us.total_hits} hits, sources: ${JSON.stringify(us.matched_by_sources)}`);
    console.log(`  organisation (UK): ${uk.total_hits} hits, sources: ${JSON.stringify(uk.matched_by_sources)}`);
    // Porter stemmer maps both to "organ" so FTS should handle this

    expect(us.total_hits).toBeGreaterThan(0);
  });

  it('US "behavior" vs UK "behaviour"', async () => {
    const us = await search('behavior');
    const uk = await search('behaviour');

    console.log(`  behavior (US): ${us.total_hits} hits`);
    console.log(`  behaviour (UK): ${uk.total_hits} hits`);

    expect(us.total_hits).toBeGreaterThan(0);
  });
});

// ========================
// 5. Word order sensitivity
// ========================
describe('word order sensitivity (bigrams encode order)', () => {
  it('"trust building" vs "building trust" — same concept?', async () => {
    const tb = await search('"trust building"');
    const bt = await search('"building trust"');
    const both = await search('trust building');

    console.log(`  "trust building" (phrase): ${tb.total_hits} hits`);
    console.log(`  "building trust" (phrase): ${bt.total_hits} hits`);
    console.log(`  trust building (words): ${both.total_hits} hits, sources: ${JSON.stringify(both.matched_by_sources)}`);
    // Vectorize should match the concept regardless of word order
  });
});
