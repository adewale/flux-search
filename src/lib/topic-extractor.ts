import { extract } from '@ade_oshineye/yaket/worker';
import { replaceIssueTopics } from '../db/topic-queries';

export interface ExtractedTopic {
  keyword: string;
  keyword_display: string;
  score: number;
  rank: number;
  ngram_size: number;
}

export interface ExtractTopicsOptions {
  top?: number;
  n?: number;
  dedupLim?: number;
}

const DEFAULT_TOP = 25;
const DEFAULT_N = 3;
const DEFAULT_DEDUP_LIM = 0.85;

export function normalizeKeyword(input: string): string {
  return String(input ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function extractTopics(
  text: string | null | undefined,
  opts: ExtractTopicsOptions = {}
): ExtractedTopic[] {
  if (text == null) return [];
  const trimmed = String(text).trim();
  if (trimmed.length === 0) return [];

  const top = opts.top ?? DEFAULT_TOP;
  const n = opts.n ?? DEFAULT_N;
  const dedupLim = opts.dedupLim ?? DEFAULT_DEDUP_LIM;

  let raw: Array<[string, number]>;
  try {
    raw = extract(trimmed, { language: 'en', n, top, dedupLim });
  } catch {
    return [];
  }

  const out: ExtractedTopic[] = [];
  for (let i = 0; i < raw.length; i++) {
    const [display, score] = raw[i];
    const keyword = normalizeKeyword(display);
    if (!keyword) continue;
    out.push({
      keyword,
      keyword_display: display.trim(),
      score,
      rank: out.length + 1,
      ngram_size: keyword.split(' ').length,
    });
  }
  return out;
}

/**
 * Extract and persist topics for an issue. Best-effort: any failure is
 * logged and swallowed so it cannot block ingestion (matches the embedder
 * contract in ingestor.ts).
 *
 * Uses the incremental rebuild path so corpus_topics + topic_timeline +
 * confidence + burst_score for the keys this issue touched all stay in
 * sync — without running the global cluster pass on every ingestion.
 */
export async function persistIssueTopics(
  db: D1Database,
  issueId: string,
  text: string | null | undefined
): Promise<void> {
  try {
    if (text == null) {
      await replaceIssueTopics(db, issueId, []);
      return;
    }
    // Lazy import to avoid a load-time cycle (topic-rebuild → topic-queries
    // → topic-extractor would otherwise pull rebuild on the hot path).
    const { rebuildOneIssueTopics } = await import('./topic-rebuild');
    await rebuildOneIssueTopics(db, issueId);
  } catch (err) {
    console.error(`Topic extraction failed for issue ${issueId}:`, err);
  }
}
