/**
 * Multi-strategy topic extractor with provenance.
 *
 * Pipeline order:
 *   1. known_entity   (priority 4) — exact alias lookup
 *   2. phrase_lexicon (priority 3) — PMI bigram lookup
 *   3. heuristic_entity (priority 2) — capitalised multi-word runs
 *   4. yake          (priority 1) — fallback YAKE call
 *
 * For each candidate keyword we accumulate all sources that produced it
 * (provenance: ['phrase_lexicon', 'yake']) and pick the highest-priority
 * source's metadata as the canonical record. Sentence-spread + occurrence
 * counts come from the heuristic + lexicon passes; YAKE-only candidates
 * inherit a default of 1/1 so the topic-quality module can still grade
 * them.
 *
 * The result is then run through `filterTopics` for noise/weak-singleton
 * suppression. Suppressed rows are still surfaced separately so the
 * caller (or future audit endpoint) can record reasons.
 */

import { extractTopics, normalizeKeyword, type ExtractedTopic } from './topic-extractor';
import { findKnownEntities } from './known-entities';
import { findHeuristicEntities } from './heuristic-entities';
import { findLexiconPhrases, type PhraseLexiconEntry } from './pmi-lexicon';
import { rerankIssueTopics } from './issue-topic-ranking';
import { cleanTextFromPlain } from './clean-text';
import { constructCandidate } from './topic-candidate';
import { getTopicRegistry } from './topic-registry';
import {
  classifyTopicQuality,
  type SuppressionReason,
} from './topic-quality';

export type ProvenanceSource = 'known_entity' | 'phrase_lexicon' | 'heuristic_entity' | 'yake';

export interface MultiExtractedTopic extends ExtractedTopic {
  provenance: ProvenanceSource[];
  occurrences: number;
  sentenceSpread: number;
  suppression_reason?: SuppressionReason | null;
  topic_type?: string | null;
  quality_status?: string | null;
  eligibility_status?: string | null;
  evidence_json?: string | null;
}

export interface MultiExtractContext {
  blocklist?: Set<string>;
  phraseLexicon?: PhraseLexiconEntry[];
}

const PRIORITY: Record<ProvenanceSource, number> = {
  known_entity: 4,
  phrase_lexicon: 3,
  heuristic_entity: 2,
  yake: 1,
};

interface CandidateSlot {
  keyword: string;
  keyword_display: string;
  score: number;
  rank: number;
  ngram_size: number;
  provenance: Set<ProvenanceSource>;
  occurrences: number;
  sentenceSpread: number;
  topPriority: number;
}

function add(
  slots: Map<string, CandidateSlot>,
  source: ProvenanceSource,
  keyword: string,
  keyword_display: string,
  occurrences: number,
  sentenceSpread: number,
  baseScore: number,
): void {
  const existing = slots.get(keyword);
  const priority = PRIORITY[source];
  if (existing) {
    existing.provenance.add(source);
    existing.occurrences = Math.max(existing.occurrences, occurrences);
    existing.sentenceSpread = Math.max(existing.sentenceSpread, sentenceSpread);
    if (priority > existing.topPriority) {
      existing.topPriority = priority;
      existing.keyword_display = keyword_display;
    }
    if (baseScore < existing.score) existing.score = baseScore;
  } else {
    slots.set(keyword, {
      keyword,
      keyword_display,
      score: baseScore,
      rank: 0,
      ngram_size: keyword.split(' ').length,
      provenance: new Set([source]),
      occurrences,
      sentenceSpread,
      topPriority: priority,
    });
  }
}

/**
 * Compute, for each singleton keyword, the share of its standalone
 * occurrences that's already explained by a multi-word phrase already
 * in the candidate set. Returns a map keyword → ratio in [0,1].
 *
 * E.g. if "trust" appears 5 times and "institutional trust" 4 of those,
 * the ratio is 0.8 — phrase-component suppression triggers at >= 0.25.
 */
function computePhraseComponentRatios(text: string, slots: Map<string, CandidateSlot>): Map<string, number> {
  if (!text) return new Map();
  const lower = text.toLowerCase();
  const ratios = new Map<string, number>();

  const phrases: Array<{ phrase: string; tokens: string[]; count: number }> = [];
  for (const slot of slots.values()) {
    if (slot.ngram_size < 2) continue;
    phrases.push({ phrase: slot.keyword, tokens: slot.keyword.split(' '), count: slot.occurrences });
  }
  if (phrases.length === 0) return ratios;

  for (const slot of slots.values()) {
    if (slot.ngram_size !== 1) continue;
    const w = slot.keyword;
    let phraseHits = 0;
    for (const p of phrases) {
      if (p.tokens.includes(w)) phraseHits += p.count;
    }
    const standalone = slot.occurrences;
    if (standalone === 0) continue;
    ratios.set(w, Math.min(1, phraseHits / standalone));
  }
  return ratios;
}

/**
 * Run the full multi-strategy pipeline. The returned array is bounded by
 * `top` (default 25) and re-ranked 1..N.
 */
export function extractTopicsMulti(
  text: string | null | undefined,
  ctx: MultiExtractContext = {},
  opts: { top?: number } = {},
): { kept: MultiExtractedTopic[]; suppressed: MultiExtractedTopic[] } {
  if (text == null) return { kept: [], suppressed: [] };
  const trimmed = String(text).trim();
  if (trimmed.length === 0) return { kept: [], suppressed: [] };
  const top = opts.top ?? 25;
  const candidateTop = Math.max(top * 4, 25);

  const slots = new Map<string, CandidateSlot>();

  // Strategy 1: known entities.
  for (const e of findKnownEntities(trimmed)) {
    const key = normalizeKeyword(e.keyword);
    if (!key) continue;
    add(slots, 'known_entity', key, e.keyword_display, e.occurrences, 1, 0.05);
  }

  // Strategy 2: phrase lexicon (PMI).
  if (ctx.phraseLexicon && ctx.phraseLexicon.length > 0) {
    for (const p of findLexiconPhrases(trimmed, ctx.phraseLexicon)) {
      const key = normalizeKeyword(p.keyword);
      if (!key) continue;
      add(slots, 'phrase_lexicon', key, p.keyword_display, p.occurrences, 1, 0.06);
    }
  }

  // Strategy 3: heuristic capitalised entities.
  for (const h of findHeuristicEntities(trimmed)) {
    const key = normalizeKeyword(h.keyword);
    if (!key) continue;
    add(slots, 'heuristic_entity', key, h.keyword_display, h.occurrences, h.sentenceSpread, 0.08);
  }

  // Strategy 4: YAKE fallback (always runs — provides a strong baseline).
  for (const y of extractTopics(trimmed, { top: candidateTop })) {
    add(slots, 'yake', y.keyword, y.keyword_display, 1, 1, y.score);
  }

  // Phrase-component dominance ratios feed into the quality filter.
  const phraseComponentRatios = computePhraseComponentRatios(trimmed, slots);

  // Sort by (top-priority desc, score asc, alphabetic) and apply quality
  // filtering. Lower yake-style score is better, so we sort ascending
  // within a priority tier.
  const ordered = [...slots.values()].sort((a, b) => {
    if (b.topPriority !== a.topPriority) return b.topPriority - a.topPriority;
    if (a.score !== b.score) return a.score - b.score;
    return a.keyword.localeCompare(b.keyword);
  });

  const kept: MultiExtractedTopic[] = [];
  const suppressed: MultiExtractedTopic[] = [];
  const cleanText = cleanTextFromPlain(trimmed);
  const registry = getTopicRegistry();

  for (const slot of ordered) {
    const verdict = classifyTopicQuality(slot, {
      blocklist: ctx.blocklist,
      phraseComponentRatios,
    });
    const row: MultiExtractedTopic = {
      keyword: slot.keyword,
      keyword_display: slot.keyword_display,
      score: slot.score,
      rank: 0,
      ngram_size: slot.ngram_size,
      provenance: [...slot.provenance],
      occurrences: slot.occurrences,
      sentenceSpread: slot.sentenceSpread,
    };
    if (verdict.suppress) {
      row.suppression_reason = verdict.reason;
      suppressed.push(row);
    } else {
      const constructed = constructCandidate(
        { surface: slot.keyword, display: slot.keyword_display, source: [...slot.provenance][0] },
        cleanText,
        registry,
      );
      if (!constructed.ok) {
        row.suppression_reason = constructed.reason === 'registry_deny' ? 'blocklist' : 'malformed_phrase';
        suppressed.push(row);
      } else {
        row.keyword = constructed.value.canonical;
        row.keyword_display = constructed.value.display;
        row.topic_type = constructed.value.topicType;
        row.quality_status = constructed.value.qualityStatus;
        row.eligibility_status = constructed.value.eligibilityStatus;
        row.evidence_json = JSON.stringify(constructed.value.evidence);
        kept.push(row);
      }
    }
    if (kept.length >= top) break;
  }

  const reranked = rerankIssueTopics(kept, trimmed).slice(0, top);
  return { kept: reranked, suppressed };
}
