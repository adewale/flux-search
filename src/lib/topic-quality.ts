/**
 * Topic-quality heuristics adapted to Flux's per-issue extractor.
 *
 * Each suppression rule writes a reason so the pipeline stays auditable:
 *
 *   noise_word        — generic filler we never want as a topic
 *   short_low_freq    — single word <4 chars without enough usage
 *   pronoun_lead      — phrase starts with someone/everything/etc.
 *   weak_suffix       — singleton with -ly/-ize/-ify/-ment/-oes/-ays/etc.
 *   weak_singleton    — singleton with low occurrences AND low sentence spread
 *   phrase_component  — single word dominated by an established multi-word phrase
 *   blocklist         — explicit blocklist hit
 *   boilerplate_phrase — recurring editorial/navigation phrase
 *   markup_artifact   — HTML/text extraction artifact, e.g. img/src/href
 *   weak_phrase       — incomplete phrase with weak boundary token
 *   malformed_phrase  — audited phrase fragment/truncation
 *
 * Inputs assume topics from extractTopics(...), augmented with
 * occurrence/sentence-spread counts the multi-strategy extractor records.
 */

export interface QualityTopic {
  keyword: string;
  keyword_display: string;
  score: number;
  rank: number;
  ngram_size: number;
  occurrences?: number;
  sentenceSpread?: number;
}

export interface ClassifyOptions {
  blocklist?: Set<string>;
  /** keyword → ratio of standalone-occurrences accounted for by a phrase */
  phraseComponentRatios?: Map<string, number>;
}

export interface QualityVerdict {
  suppress: boolean;
  reason: SuppressionReason | null;
}

export type SuppressionReason =
  | 'noise_word'
  | 'short_low_freq'
  | 'pronoun_lead'
  | 'weak_suffix'
  | 'weak_singleton'
  | 'phrase_component'
  | 'blocklist'
  | 'boilerplate_phrase'
  | 'markup_artifact'
  | 'weak_phrase'
  | 'malformed_phrase';

/** Topics we never auto-suppress, even if they trip generic rules. */
export const PROTECTED_TOPICS: ReadonlySet<string> = new Set([
  'ai', 'llm', 'gpt',
  'crypto', 'defi', 'nft', 'dao',
  'react', 'rust', 'github', 'twitter', 'wikipedia',
]);

/** Generic cross-domain fillers we strip outright. */
export const NOISE_WORDS: ReadonlySet<string> = new Set([
  // generic verbs
  'leverage', 'enable', 'utilise', 'utilize', 'enabling', 'enabled',
  'making', 'doing', 'getting', 'using', 'taking', 'putting',
  'looking', 'thinking', 'wanting', 'needing', 'going',
  // generic adjectives / comparatives
  'better', 'worse', 'harder', 'easier', 'faster', 'slower',
  'simpler', 'complex', 'simple', 'complicated', 'big', 'small',
  'large', 'huge', 'tiny', 'long', 'short', 'old', 'new', 'good', 'bad',
  // generic nouns
  'system', 'systems', 'data', 'thing', 'things', 'stuff',
  'piece', 'parts', 'part', 'kind', 'sort', 'type', 'way', 'ways',
  'time', 'times', 'place', 'places', 'case', 'cases',
  'move', 'moves', 'point', 'points', 'direction', 'directions',
  'life', 'work', 'idea', 'ideas', 'story', 'stories', 'problem', 'problems',
  'someone', 'everyone', 'anyone', 'something', 'everything', 'anything',
  // filler adverbs
  'really', 'actually', 'basically', 'literally', 'obviously',
  'clearly', 'simply', 'mostly', 'usually', 'always', 'never',
  // overused tech-writer fillers
  'software', 'platform', 'product', 'team', 'people', 'world',
  'space', 'area', 'industry',
]);

/** Phrase fillers that start a multi-word topic but bleed all signal. */
const PRONOUN_LEAD: ReadonlySet<string> = new Set([
  'someone', 'everyone', 'anyone', 'something', 'everything', 'anything',
  'this', 'that', 'these', 'those', 'their', 'them',
]);

const MARKUP_ARTIFACT_TOKENS: ReadonlySet<string> = new Set([
  'img', 'src', 'href', 'alt', 'nbsp', 'http', 'https', 'jpg', 'jpeg', 'png',
  'gif', 'webp', 'iframe', 'script', 'style', 'class', 'xers', 'fluxers',
]);

const MARKUP_ARTIFACT_PHRASES: ReadonlySet<string> = new Set([
  'img src',
  'src href',
  'href img',
  'alt text',
  'xers highlighting',
  'fluxers highlighting',
  'highlighting independent publications',
]);

const MALFORMED_PHRASES: ReadonlySet<string> = new Set([
  'secretary of defense rock',
  'exchange commission',
  'many americans',
  'top-right quadrant',
  'labor day',
  'golden state',
  'complex times',
  'world war',
  'le guin',
  'packy mc',
  'native american',
  'technology review',
  'census bureau',
  'air force',
]);

const BOILERPLATE_PHRASES: ReadonlySet<string> = new Set([
  'signposts clues',
  'signpost clues',
  'editor note',
  'editors note',
  'editor s note',
  'clues trails',
  'worth your time',
  'lens of the week',
  'book for your shelf',
  'postcard from the future',
  'more from fluxers',
]);

const WEAK_PHRASE_END: ReadonlySet<string> = new Set([
  'like', 'from', 'with', 'without', 'into', 'onto', 'about', 'toward', 'towards',
]);

const WEAK_SUFFIX_RX = /(ly|ize|ise|ify|ment|oes|ays|akes|ives)$/;

export function classifyTopicQuality(
  topic: QualityTopic,
  opts: ClassifyOptions = {},
): QualityVerdict {
  const keyword = topic.keyword.toLowerCase();
  const tokens = keyword.split(/\s+/).filter(Boolean);
  const isSingleton = topic.ngram_size === 1 || tokens.length === 1;
  const occurrences = topic.occurrences ?? 0;
  const spread = topic.sentenceSpread ?? 0;

  if (PROTECTED_TOPICS.has(keyword)) {
    return { suppress: false, reason: null };
  }

  if (opts.blocklist && opts.blocklist.has(keyword)) {
    return { suppress: true, reason: 'blocklist' };
  }

  if (BOILERPLATE_PHRASES.has(keyword)) {
    return { suppress: true, reason: 'boilerplate_phrase' };
  }

  if (MALFORMED_PHRASES.has(keyword)) {
    return { suppress: true, reason: 'malformed_phrase' };
  }

  if (MARKUP_ARTIFACT_PHRASES.has(keyword) || tokens.some(t => MARKUP_ARTIFACT_TOKENS.has(t))) {
    return { suppress: true, reason: 'markup_artifact' };
  }

  if (isSingleton && NOISE_WORDS.has(keyword)) {
    return { suppress: true, reason: 'noise_word' };
  }

  if (!isSingleton && PRONOUN_LEAD.has(tokens[0])) {
    return { suppress: true, reason: 'pronoun_lead' };
  }

  if (!isSingleton && WEAK_PHRASE_END.has(tokens[tokens.length - 1])) {
    return { suppress: true, reason: 'weak_phrase' };
  }

  // Phrase-component dominance: a singleton that is mostly explained
  // by a longer phrase already in the result set.
  if (isSingleton && opts.phraseComponentRatios) {
    const ratio = opts.phraseComponentRatios.get(keyword) ?? 0;
    if (ratio >= 0.25) return { suppress: true, reason: 'phrase_component' };
  }

  // Length-based suppression for very short singles.
  if (isSingleton && keyword.length < 4 && occurrences < 20) {
    return { suppress: true, reason: 'short_low_freq' };
  }

  // Suffix-based weak singletons.
  if (isSingleton && WEAK_SUFFIX_RX.test(keyword) && (occurrences < 20 && spread < 4)) {
    return { suppress: true, reason: 'weak_suffix' };
  }

  // Generic weak-singleton scoring: low occurrences AND low sentence spread.
  if (isSingleton && occurrences < 4 && spread < 2) {
    return { suppress: true, reason: 'weak_singleton' };
  }

  return { suppress: false, reason: null };
}

/**
 * Topic-level confidence — analogous to result confidence in the
 * hybrid ranker. Driven by:
 *   - provenance breadth (how many strategies produced the topic)
 *   - doc_frequency (how often the corpus uses it)
 *   - whether quality gates ever rejected the keyword
 *
 * Used to weight chips in the UI without baking thresholds into CSS.
 */
export type TopicConfidence = 'high' | 'medium' | 'low';

export interface ConfidenceInputs {
  provenanceCount: number;
  docFrequency: number;
  /** Number of issues that suppressed this keyword for any reason. */
  suppressionHits?: number;
}

export function classifyTopicConfidence(input: ConfidenceInputs): TopicConfidence {
  const provenance = Math.max(0, input.provenanceCount);
  const df = Math.max(0, input.docFrequency);
  const suppressed = Math.max(0, input.suppressionHits ?? 0);

  // Suppression is a louder signal than provenance: a topic the quality
  // gate rejected even once should drop a tier.
  const tierAdjust = suppressed > 0 ? -1 : 0;

  let tier: 0 | 1 | 2 = 0; // 0=low, 1=medium, 2=high
  if (provenance >= 2 && df >= 5) tier = 2;
  else if (provenance >= 2 || df >= 3) tier = 1;

  const final = Math.max(0, Math.min(2, tier + tierAdjust));
  return (['low', 'medium', 'high'] as const)[final];
}

export interface FilterResult<T extends QualityTopic> {
  kept: T[];
  suppressed: Array<T & { suppression_reason: SuppressionReason }>;
}

/**
 * Apply quality classification across an array of topics, returning two
 * lists. Kept topics get their `rank` re-numbered to a contiguous sequence
 * so downstream code (snippets, chips) doesn't need to deal with gaps.
 */
export function filterTopics<T extends QualityTopic>(
  topics: T[],
  opts: ClassifyOptions = {},
): FilterResult<T> {
  const kept: T[] = [];
  const suppressed: Array<T & { suppression_reason: SuppressionReason }> = [];
  for (const t of topics) {
    const verdict = classifyTopicQuality(t, opts);
    if (verdict.suppress) {
      suppressed.push({ ...(t as any), suppression_reason: verdict.reason! });
    } else {
      kept.push(t);
    }
  }
  kept.forEach((t, i) => { t.rank = i + 1; });
  return { kept, suppressed };
}
