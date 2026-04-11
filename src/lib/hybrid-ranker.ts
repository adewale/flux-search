import type { Env } from '../env';
import type { IssueRow } from '../db/types';
import type { ParsedQuery } from './query-parser';
import type { FtsSearchResult } from '../db/queries';
import type { SemanticCandidate } from './vector-search';

export interface RankedResult {
  issue: IssueRow;
  snippet: string;
  snippetSection: string | null;
  matchedBy: string[];
  confidence: 'high' | 'medium' | 'low';
  debugMeta: DebugMeta;
}

export interface DebugMeta {
  matched_by: string[];
  lexical_rank: number | null;
  semantic_rank: number | null;
  top_chunk_section: string | null;
  applied_boosts: string[];
  applied_penalties: string[];
  final_score: number;
}

// Tuning defaults from spec section 12
const BOOSTS = {
  exactIssue: 10.0,
  phraseTitle: 6.0,
  phraseHeading: 4.0,
  phraseBody: 3.0,
  titleOverlap: 1.5,
  lexicalSemanticAgreement: 1.25,
  multiChunkSupport: 0.75,
  semanticOnlyPenalty: -3.5,
};

// Progressive disclosure: top results get more context (Kahneman anchoring)
const SNIPPET_LEN_TOP = 400;    // top 3 results
const SNIPPET_LEN_DEFAULT = 150; // rest

export function rankResults(
  parsed: ParsedQuery,
  lexicalResults: FtsSearchResult[],
  semanticResults: SemanticCandidate[],
  env: Env
): RankedResult[] {
  const lexicalWeight = parseFloat(env.LEXICAL_WEIGHT) || 1.0;
  const semanticWeight = parseFloat(env.SEMANTIC_WEIGHT) || 0.55;
  const k = parseFloat(env.RRF_K) || 40;

  const lexicalMap = new Map<string, FtsSearchResult>();
  for (const r of lexicalResults) {
    lexicalMap.set(r.issue.id, r);
  }

  const semanticMap = new Map<string, SemanticCandidate>();
  for (const r of semanticResults) {
    semanticMap.set(r.issueId, r);
  }

  const allIds = new Set([...lexicalMap.keys(), ...semanticMap.keys()]);
  const hasStrongLexical = lexicalResults.length >= 3;

  const candidates: Array<Omit<RankedResult, 'snippet' | 'confidence' | 'snippetSection'> & { score: number; semantic?: SemanticCandidate; highlightSnippet?: string | null }> = [];

  for (const issueId of allIds) {
    const lexical = lexicalMap.get(issueId);
    const semantic = semanticMap.get(issueId);
    const issue = lexical?.issue || semantic?.issue;
    if (!issue) continue;

    let score = 0;
    const matchedBy: string[] = [];
    const appliedBoosts: string[] = [];
    const appliedPenalties: string[] = [];

    if (lexical) {
      score += lexicalWeight * (1 / (k + lexical.rank));
      matchedBy.push('fts');
    }
    if (semantic) {
      score += semanticWeight * (1 / (k + semantic.rank));
      matchedBy.push('vector');
    }

    if (parsed.filters.issueNumber && issue.issue_number === parsed.filters.issueNumber) {
      score += BOOSTS.exactIssue;
      matchedBy.push('issue_number');
      appliedBoosts.push('exact_issue');
    }

    for (const phrase of parsed.phrases) {
      const lowerPhrase = phrase.toLowerCase();
      if (issue.title?.toLowerCase().includes(lowerPhrase)) {
        score += BOOSTS.phraseTitle;
        matchedBy.push('phrase');
        appliedBoosts.push('phrase_title');
      }
      if (issue.subtitle?.toLowerCase().includes(lowerPhrase) ||
          issue.headings?.toLowerCase().includes(lowerPhrase)) {
        score += BOOSTS.phraseHeading;
        appliedBoosts.push('phrase_heading');
      }
      if (issue.full_text_plain?.toLowerCase().includes(lowerPhrase)) {
        score += BOOSTS.phraseBody;
        appliedBoosts.push('phrase_body');
      }
    }

    if (parsed.freeText) {
      const queryTerms = parsed.freeText.toLowerCase().split(/\s+/);
      const titleTerms = new Set((issue.title || '').toLowerCase().split(/\s+/));
      const overlap = queryTerms.filter(t => titleTerms.has(t)).length;
      if (overlap >= 2 || (queryTerms.length === 1 && overlap === 1)) {
        score += BOOSTS.titleOverlap;
        appliedBoosts.push('title_overlap');
      }
    }

    if (lexical && semantic) {
      score += BOOSTS.lexicalSemanticAgreement;
      appliedBoosts.push('lexical_semantic_agreement');
    }

    if (semantic && semantic.chunkCount > 1) {
      score += BOOSTS.multiChunkSupport;
      appliedBoosts.push('multi_chunk_support');
    }

    if (!lexical && semantic && hasStrongLexical) {
      score += BOOSTS.semanticOnlyPenalty;
      appliedPenalties.push('semantic_only_penalty');
    }

    candidates.push({
      issue,
      matchedBy,
      debugMeta: {
        matched_by: matchedBy,
        lexical_rank: lexical?.rank ?? null,
        semantic_rank: semantic?.rank ?? null,
        top_chunk_section: semantic?.topChunkSection ?? null,
        applied_boosts: appliedBoosts,
        applied_penalties: appliedPenalties,
        final_score: score,
      },
      score,
      semantic,
      highlightSnippet: lexical?.highlightSnippet,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  // Generate snippets: prefer FTS highlight (shows WHY it matched), then progressive disclosure
  return candidates.map((c, rank): RankedResult => {
    const snippetLen = rank < 3 ? SNIPPET_LEN_TOP : SNIPPET_LEN_DEFAULT;
    const snippet = c.highlightSnippet || generateSnippet(c.issue, c.semantic, snippetLen);
    const confidence = classifyConfidence(c.debugMeta);

    return {
      issue: c.issue,
      snippet,
      snippetSection: c.debugMeta.top_chunk_section,
      matchedBy: c.matchedBy,
      confidence,
      debugMeta: c.debugMeta,
    };
  });
}

// --- Facets: section distribution ---

export function computeSectionFacets(results: Array<{ snippetSection: string | null }>): Record<string, number> {
  const facets: Record<string, number> = {};
  for (const r of results) {
    if (r.snippetSection) {
      facets[r.snippetSection] = (facets[r.snippetSection] || 0) + 1;
    }
  }
  return facets;
}

// --- Snippet section detection ---

/**
 * Determine which section a FTS snippet came from by matching
 * snippet text against parsed section bodies.
 */
export function detectSnippetSection(
  snippet: string,
  sections: Array<{ type: string; title?: string; body: string }>
): string | null {
  if (!snippet) return null;

  // Strip <mark> tags and take a clean text window
  const cleanSnippet = snippet.replace(/<\/?mark>/g, '').replace(/\.\.\./g, '').trim();
  if (cleanSnippet.length < 10) return null;

  // Take a word sequence from the snippet as a search probe
  const words = cleanSnippet.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 3) return null;
  const probe = words.slice(0, 6).join(' ').toLowerCase();

  for (const section of sections) {
    if (section.body.toLowerCase().includes(probe)) {
      return section.type;
    }
  }

  // If the snippet matches the first section's title, it's from the lead essay
  if (sections.length > 0 && sections[0].title?.toLowerCase().includes(probe)) {
    return sections[0].type;
  }

  return null;
}

// --- Density strip: year distribution ---

export function computeYearDistribution(results: RankedResult[]): Record<number, number> {
  const dist: Record<number, number> = {};
  for (const r of results) {
    const year = r.issue.year;
    if (year != null) {
      dist[year] = (dist[year] || 0) + 1;
    }
  }
  return dist;
}

// --- Confidence tiers (Robin Williams: contrast as hierarchy) ---

export function classifyConfidence(meta: DebugMeta): 'high' | 'medium' | 'low' {
  const boosts = meta.applied_boosts;
  const penalties = meta.applied_penalties;

  // High: exact issue match, phrase match in title, or phrase match in body
  if (boosts.includes('exact_issue') || boosts.includes('phrase_title') || boosts.includes('phrase_body')) {
    return 'high';
  }

  // Low: penalized semantic-only results
  if (penalties.includes('semantic_only_penalty')) {
    return 'low';
  }

  // Everything else is medium
  return 'medium';
}

// --- Snippet generation ---

function generateSnippet(
  issue: IssueRow,
  semantic: SemanticCandidate | undefined,
  maxLen: number
): string {
  if (semantic?.topChunkText) {
    return truncateSnippet(semantic.topChunkText, maxLen);
  }
  if (issue.summary) {
    return truncateSnippet(issue.summary, maxLen);
  }
  if (issue.full_text_plain) {
    return truncateSnippet(issue.full_text_plain, maxLen);
  }
  return '';
}

function truncateSnippet(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.7 ? truncated.slice(0, lastSpace) : truncated) + '...';
}
