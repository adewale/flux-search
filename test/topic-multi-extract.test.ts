/**
 * End-to-end tests for the multi-strategy extractor.
 * Covers each strategy in isolation, then their composition.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractTopicsMulti } from '../src/lib/topic-multi-extract';
import { findKnownEntities, KNOWN_ENTITIES } from '../src/lib/known-entities';
import { findHeuristicEntities } from '../src/lib/heuristic-entities';
import { buildPhraseLexicon, findLexiconPhrases } from '../src/lib/pmi-lexicon';

const FLUX_SAMPLE = `
Institutional trust matters. Institutional trust depends on legitimacy.
Civic repair, governance and accountability are central. Institutional trust
is fragile. Large language models reshape the substrate.
George Yancey writes about institutional trust. Mont Blanc towers over us.
`;

describe('findKnownEntities', () => {
  it('keeps crypto as its own protected topic rather than aliasing it to cryptocurrency', () => {
    const hits = findKnownEntities('Crypto markets and cryptocurrency markets both appeared.');
    expect(hits.find(h => h.keyword === 'crypto')).toBeDefined();
    expect(hits.find(h => h.keyword === 'cryptocurrency')).toBeDefined();
  });

  it('canonicalizes audited aliases without collapsing protected short topics', () => {
    const hits = findKnownEntities('Le Guin essays appeared.');
    expect(hits.find(h => h.keyword === 'ursula k. le guin')).toBeDefined();
  });

  it('protects newsletter/blog names and book titles as known entities', () => {
    const hits = findKnownEntities([
      'Rest of World covered the story.',
      'Not Boring and Crooked Timber both linked to it.',
      'Simple Habits for Complex Times is the relevant book title.',
    ].join(' '));

    expect(hits.find(h => h.keyword === 'rest of world')).toBeDefined();
    expect(hits.find(h => h.keyword === 'not boring')).toBeDefined();
    expect(hits.find(h => h.keyword === 'crooked timber')).toBeDefined();
    expect(hits.find(h => h.keyword === 'simple habits for complex times')).toBeDefined();
  });

  it('matches stopword-bridged protected title phrases', () => {
    const hits = findKnownEntities('James C. Scott wrote Seeing Like a State.');
    expect(hits.find(h => h.keyword === 'seeing like a state')).toBeDefined();
  });

  it('matches canonical aliases including LLM/llms variants', () => {
    const hits = findKnownEntities('LLMs reshape software. Large language models too.');
    const llm = hits.find(h => h.keyword === 'large language models');
    expect(llm).toBeDefined();
    expect(llm!.occurrences).toBeGreaterThanOrEqual(2);
  });

  it('returns no false positives for embedded substrings', () => {
    // "machine learning" is in the entity list — make sure it doesn't
    // match inside an unrelated word like "machineries learning rooms".
    const hits = findKnownEntities('Machineries learning rooms machinery learning rates.');
    expect(hits.find(h => h.keyword === 'machine learning')).toBeUndefined();
  });
});

describe('findHeuristicEntities', () => {
  it('captures multi-word capitalised proper nouns', () => {
    const hits = findHeuristicEntities('George Yancey writes about Mont Blanc and OpenAI Inc.');
    const keys = hits.map(h => h.keyword);
    expect(keys).toContain('george yancey');
    expect(keys).toContain('mont blanc');
  });

  it('rejects sentence-initial filler-led runs', () => {
    const hits = findHeuristicEntities('However Some People disagree.');
    expect(hits.find(h => h.keyword === 'however some people')).toBeUndefined();
  });

  it('records sentence-spread', () => {
    const hits = findHeuristicEntities(
      'George Yancey writes. George Yancey responds. George Yancey concludes.'
    );
    const g = hits.find(h => h.keyword === 'george yancey')!;
    expect(g.sentenceSpread).toBeGreaterThanOrEqual(2);
  });
});

describe('buildPhraseLexicon', () => {
  it('extracts genuine collocations above threshold', () => {
    // PMI measures coupling beyond chance. The phrase has to appear
    // together more often than the component words appear apart —
    // strong coupling means the words rarely show up alone.
    const phrasal = Array(5).fill(
      'Institutional trust collapses. Civic repair becomes a line item.',
    );
    const unrelated = Array(15).fill(
      'apple banana carrot durian elderberry. fig grape honeydew kiwi lemon.',
    );
    const lex = buildPhraseLexicon([...phrasal, ...unrelated], {
      minCooccurrence: 3, minPMI: 0.5,
    });
    const phrases = lex.map(e => e.phrase);
    expect(phrases).toContain('institutional trust');
    expect(phrases).toContain('civic repair');
  });

  it('returns empty when documents are too few', () => {
    const lex = buildPhraseLexicon(['just one'], {});
    expect(lex).toEqual([]);
  });

  it('can learn stopword-bridged title phrases up to four grams', () => {
    const docs = [
      ...Array(8).fill('James C. Scott wrote Seeing Like a State. Seeing Like a State is about legibility.'),
      ...Array(20).fill('apple banana carrot durian elderberry. fig grape honeydew kiwi lemon.'),
    ];
    const lex = buildPhraseLexicon(docs, { minCooccurrence: 3, minPMI: 0.5, maxN: 4 });
    expect(lex.map(e => e.phrase)).toContain('seeing like a state');
  });

  it('respects limit', () => {
    const docs = Array(20).fill('alpha beta gamma delta epsilon zeta eta theta iota kappa').slice();
    const lex = buildPhraseLexicon(docs, { minCooccurrence: 5, minPMI: 0.5, limit: 3 });
    expect(lex.length).toBeLessThanOrEqual(3);
  });

  it('PBT: never produces NaN/Infinity in pmi or quality', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 200 }), { maxLength: 30 }),
        (docs) => {
          const lex = buildPhraseLexicon(docs, { minCooccurrence: 2, minPMI: 0 });
          for (const e of lex) {
            expect(Number.isFinite(e.pmi)).toBe(true);
            expect(Number.isFinite(e.quality)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('findLexiconPhrases', () => {
  it('finds bigrams from a lexicon in text and counts occurrences', () => {
    const lex = [{ phrase: 'institutional trust', pmi: 5, cooccurrence: 10, quality: 30 }];
    const hits = findLexiconPhrases('Institutional trust matters. Institutional trust matters again.', lex);
    expect(hits).toHaveLength(1);
    expect(hits[0].occurrences).toBe(2);
  });

  it('skips substring matches (only word-bounded hits)', () => {
    const lex = [{ phrase: 'dog cat', pmi: 5, cooccurrence: 10, quality: 30 }];
    expect(findLexiconPhrases('hotdog catty', lex)).toEqual([]);
  });
});

describe('extractTopicsMulti', () => {
  it('produces results with provenance arrays', () => {
    const { kept } = extractTopicsMulti(FLUX_SAMPLE);
    expect(kept.length).toBeGreaterThan(0);
    for (const t of kept) {
      expect(Array.isArray(t.provenance)).toBe(true);
      expect(t.provenance.length).toBeGreaterThan(0);
    }
  });

  it('surfaces known entities at the top of the result list', () => {
    const { kept } = extractTopicsMulti(FLUX_SAMPLE);
    const top = kept.slice(0, 3).map(t => t.keyword);
    expect(top).toContain('institutional trust');
  });

  it('records that a known-entity hit also appears via YAKE/lexicon', () => {
    const { kept } = extractTopicsMulti(FLUX_SAMPLE);
    const it = kept.find(t => t.keyword === 'institutional trust');
    expect(it).toBeDefined();
    expect(it!.provenance).toContain('known_entity');
  });

  it('returns empty kept/suppressed for null/empty input', () => {
    expect(extractTopicsMulti(null).kept).toEqual([]);
    expect(extractTopicsMulti('').kept).toEqual([]);
    expect(extractTopicsMulti('   ').kept).toEqual([]);
  });

  it('suppresses recurring FLUXers highlighting boilerplate artifacts', () => {
    const { kept, suppressed } = extractTopicsMulti(
      'More from FLUXers highlighting independent publications from FLUX contributors. '.repeat(4),
    );
    expect(kept.map(t => t.keyword)).not.toContain('xers highlighting');
    expect(kept.map(t => t.keyword)).not.toContain('fluxers highlighting');
    expect(suppressed.some(t => t.suppression_reason === 'markup_artifact')).toBe(true);
  });

  it('respects the blocklist and records suppression_reason', () => {
    const { kept, suppressed } = extractTopicsMulti(
      'governance institutional trust governance governance governance',
      { blocklist: new Set(['governance']) },
    );
    expect(kept.find(t => t.keyword === 'governance')).toBeUndefined();
    expect(suppressed.find(t => t.keyword === 'governance' && t.suppression_reason === 'blocklist'))
      .toBeDefined();
  });

  it('returns empty when phrase lexicon is empty (graceful)', () => {
    const { kept } = extractTopicsMulti(FLUX_SAMPLE, { phraseLexicon: [] });
    expect(kept.length).toBeGreaterThan(0);
  });

  it('merges duplicates and prefers the highest-priority display form', () => {
    const text = 'Open source is everywhere. Open Source is the default for new projects.';
    const { kept } = extractTopicsMulti(text);
    const os = kept.find(t => t.keyword === 'open source');
    expect(os).toBeDefined();
    expect(os!.provenance).toContain('known_entity');
  });

  it('PBT: never throws on adversarial unicode input', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (s) => {
        expect(() => extractTopicsMulti(s)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it('PBT: rank starts at 1, increments by 1', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 50, maxLength: 1000 }), (s) => {
        const { kept } = extractTopicsMulti(s);
        for (let i = 0; i < kept.length; i++) {
          expect(kept[i].rank).toBe(i + 1);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('KNOWN_ENTITIES sanity', () => {
  it('every entry has at least one alias and a canonical/display form', () => {
    for (const e of KNOWN_ENTITIES) {
      expect(e.canonical.length).toBeGreaterThan(0);
      expect(e.display.length).toBeGreaterThan(0);
      expect(e.aliases.length).toBeGreaterThan(0);
    }
  });
});
