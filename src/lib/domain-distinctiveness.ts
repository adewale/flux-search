import { BACKGROUND_ZIPF_EN } from './background-frequency.generated';
import { buildAliasMap } from './known-entities';
import { PROTECTED_TOPICS } from './topic-quality';

const SHALLOW_STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'for', 'to', 'in', 'on', 'with',
  'by', 'from', 'as', 'at', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
]);

export interface DomainDistinctivenessInput {
  keyword: string;
  docFrequency: number;
  totalIssues: number;
  ngramSize: number;
  protectedTopic?: boolean;
}

export interface DomainDistinctivenessResult {
  backgroundCommonness: number;
  domainDistinctiveness: number;
  boost: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function tokenize(keyword: string): string[] {
  return keyword.toLowerCase().match(/[a-z][a-z0-9'-]*/g) ?? [];
}

function lookupZipf(term: string): number | null {
  const v = BACKGROUND_ZIPF_EN[term.toLowerCase()];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export function isProtectedDomainTopic(keyword: string): boolean {
  const normalized = tokenize(keyword).join(' ');
  if (!normalized) return false;
  if (PROTECTED_TOPICS.has(normalized)) return true;
  return buildAliasMap().get(normalized) === normalized;
}

export function estimateBackgroundCommonness(keyword: string): number {
  const normalized = tokenize(keyword).join(' ');
  if (!normalized) return 4.75;

  const phraseZipf = lookupZipf(normalized);
  const content = tokenize(normalized).filter(t => !SHALLOW_STOP.has(t));
  const tokenZipfs = content.map(lookupZipf).filter((v): v is number => v !== null);

  if (phraseZipf === null && tokenZipfs.length === 0) return 4.75;
  if (tokenZipfs.length === 0) return phraseZipf ?? 4.75;

  // Penalize phrases built out of very common words even when the exact
  // phrase table is sparse. This is the signal that distinguishes generic
  // prose like "good ideas" from Flux-ish terms like "mental models".
  const avgTokenZipf = tokenZipfs.reduce((a, b) => a + b, 0) / tokenZipfs.length;
  return Math.max(phraseZipf ?? 0, avgTokenZipf);
}

export function computeDomainDistinctivenessBoost(
  input: DomainDistinctivenessInput,
): DomainDistinctivenessResult {
  const df = Math.max(0, input.docFrequency);
  const total = Math.max(1, input.totalIssues);
  const fluxRate = df / total;
  const backgroundCommonness = estimateBackgroundCommonness(input.keyword);

  // Positive when the phrase is common in Flux and not too common in general
  // English. Bounded so this acts as a demotion/boost, not a replacement for
  // existing salience and document-frequency scoring.
  const fluxComponent = Math.log1p(fluxRate * 100);
  const rarityComponent = 5.25 - backgroundCommonness;
  const domainDistinctiveness = rarityComponent + (0.12 * fluxComponent);
  let boost = clamp(1 + (0.28 * domainDistinctiveness), 0.35, 2.5);

  if (input.protectedTopic || isProtectedDomainTopic(input.keyword)) {
    boost = Math.max(1.0, boost);
  }

  return { backgroundCommonness, domainDistinctiveness, boost };
}
