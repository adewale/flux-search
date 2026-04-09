import type { Env } from '../env';
import type { SearchFilters, IssueRow } from '../db/types';

export interface SemanticCandidate {
  issueId: string;
  issue: IssueRow;
  topScore: number;
  topChunkSection: string | null;
  topChunkText: string;
  chunkCount: number;
  rank: number;
}

export async function searchVectorize(
  env: Env,
  queryText: string,
  filters: SearchFilters,
  topK: number = 50
): Promise<SemanticCandidate[]> {
  // Gracefully degrade if AI or Vectorize bindings are unavailable (e.g. local dev)
  try {
    return await doVectorSearch(env, queryText, filters, topK);
  } catch (err) {
    console.error('Semantic search unavailable:', err);
    return [];
  }
}

async function doVectorSearch(
  env: Env,
  queryText: string,
  filters: SearchFilters,
  topK: number
): Promise<SemanticCandidate[]> {
  const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [queryText],
  });

  if (!('data' in embeddingResult) || !embeddingResult.data) return [];
  if (!embeddingResult.data[0]) return [];
  const queryVector = embeddingResult.data[0];

  const matches = await env.VECTORIZE.query(queryVector, {
    topK,
    returnMetadata: 'indexed',
  });

  if (!matches.matches || matches.matches.length === 0) return [];

  // Collect chunk-level hits by issue_id
  const issueChunks = new Map<string, {
    scores: number[];
    topScore: number;
    topSection: string | null;
    topChunkText: string;
    metadata: Record<string, unknown>;
  }>();

  for (const match of matches.matches) {
    const meta = (match.metadata || {}) as Record<string, unknown>;
    const issueId = meta.issue_id as string;
    if (!issueId) continue;

    const existing = issueChunks.get(issueId);
    if (existing) {
      existing.scores.push(match.score);
      if (match.score > existing.topScore) {
        existing.topScore = match.score;
        existing.topSection = (meta.section_label as string) || null;
        existing.topChunkText = (meta.chunk_text as string) || '';
      }
    } else {
      issueChunks.set(issueId, {
        scores: [match.score],
        topScore: match.score,
        topSection: (meta.section_label as string) || null,
        topChunkText: (meta.chunk_text as string) || '',
        metadata: meta,
      });
    }
  }

  // Fetch issue records for all candidate issue IDs
  const issueIds = [...issueChunks.keys()];
  const issues = await fetchIssues(env.DB, issueIds);

  // Apply date filters that Vectorize can't handle
  const filtered = issues.filter(issue => {
    if (filters.before && issue.published_at && issue.published_at >= filters.before) return false;
    if (filters.after && issue.published_at && issue.published_at <= filters.after) return false;
    if (filters.year && issue.year !== filters.year) return false;
    return true;
  });

  // Build candidates sorted by top score
  const candidates: SemanticCandidate[] = filtered
    .map(issue => {
      const chunks = issueChunks.get(issue.id)!;
      return {
        issueId: issue.id,
        issue,
        topScore: chunks.topScore,
        topChunkSection: chunks.topSection,
        topChunkText: chunks.topChunkText,
        chunkCount: chunks.scores.length,
        rank: 0, // will be set after sorting
      };
    })
    .sort((a, b) => b.topScore - a.topScore);

  // Assign ranks
  candidates.forEach((c, i) => { c.rank = i + 1; });

  return candidates;
}

async function fetchIssues(db: D1Database, ids: string[]): Promise<IssueRow[]> {
  if (ids.length === 0) return [];

  // Batch fetch — D1 doesn't support IN with prepared statement array, so batch individual queries
  const stmts = ids.map(id =>
    db.prepare('SELECT * FROM issues WHERE id = ? AND status = ?').bind(id, 'active')
  );

  const results = await db.batch(stmts);
  return results
    .map(r => r.results[0] as IssueRow | undefined)
    .filter((r): r is IssueRow => r !== undefined);
}
