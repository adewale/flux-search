import type { CleanText } from './clean-text';
import { lookupTopicRegistry, type TopicRegistry, type TopicType } from './topic-registry';
import { normalizeKeyword } from './topic-extractor';

export type CandidateSource = 'known_entity' | 'phrase_lexicon' | 'heuristic_entity' | 'yake';
export type CandidateRejection = 'empty' | 'registry_deny' | 'invalid_phrase_grammar';

export interface CandidateProposal {
  surface: string;
  display?: string;
  source: CandidateSource;
}

export interface CandidateEvidence {
  occurrences: number;
  firstOccurrencePercentile: number;
  inOpening: boolean;
  sentenceSpread: number;
}

export interface ConstructedTopicCandidate {
  canonical: string;
  display: string;
  topicType: TopicType;
  qualityStatus: 'valid';
  eligibilityStatus: 'local_valid';
  source: CandidateSource;
  evidence: CandidateEvidence;
}

export type ConstructCandidateResult =
  | { ok: true; value: ConstructedTopicCandidate }
  | { ok: false; reason: CandidateRejection };

const MARKUP = new Set(['img', 'src', 'href', 'alt', 'nbsp', 'http', 'https']);
const BAD_START = new Set(['as', 'because', 'while', 'when', 'where', 'why', 'how']);
const BAD_TOKENS = new Set(['you', 'your', 'can', 'could', 'should', 'would', 'will']);
const WEAK_END = new Set(['like', 'from', 'with', 'without', 'into', 'onto', 'about']);

function tokens(s: string): string[] {
  return normalizeKeyword(s).match(/[a-z][a-z0-9'-]*/g) ?? [];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(keyword: string, text: string): number {
  const pattern = new RegExp(`\\b${escapeRegExp(keyword).replace(/\\\s+/g, '\\s+')}\\b`, 'gi');
  return [...text.matchAll(pattern)].length;
}

function phraseGrammarValid(keyword: string): boolean {
  const ts = tokens(keyword);
  if (ts.length === 0) return false;
  if (ts.some(t => MARKUP.has(t))) return false;
  if (ts.length > 1 && BAD_START.has(ts[0])) return false;
  if (ts.length > 1 && BAD_TOKENS.has(ts[ts.length - 1])) return false;
  if (ts.length > 1 && ts.some(t => BAD_TOKENS.has(t))) return false;
  if (ts.length > 1 && WEAK_END.has(ts[ts.length - 1])) return false;
  return true;
}

export function constructCandidate(
  proposal: CandidateProposal,
  text: CleanText,
  registry: TopicRegistry,
): ConstructCandidateResult {
  const normalized = normalizeKeyword(proposal.surface);
  if (!normalized) return { ok: false, reason: 'empty' };

  const entry = lookupTopicRegistry(normalized, registry);
  if (entry?.status === 'deny') return { ok: false, reason: 'registry_deny' };
  if (!entry && !phraseGrammarValid(normalized)) return { ok: false, reason: 'invalid_phrase_grammar' };

  const canonical = entry?.canonical ?? normalized;
  const plain = String(text);
  const first = plain.toLowerCase().indexOf(canonical);
  const occurrences = Math.max(1, countOccurrences(canonical, plain));

  return {
    ok: true,
    value: {
      canonical,
      display: entry?.display ?? proposal.display ?? proposal.surface,
      topicType: entry?.topicType ?? 'unknown',
      qualityStatus: 'valid',
      eligibilityStatus: 'local_valid',
      source: proposal.source,
      evidence: {
        occurrences,
        firstOccurrencePercentile: first < 0 ? 1 : first / Math.max(1, plain.length),
        inOpening: first >= 0 && first < Math.min(500, plain.length),
        sentenceSpread: 1,
      },
    },
  };
}
