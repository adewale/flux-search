import type { Env } from '../env';
import type { SearchFilters, IssueRow } from '../db/types';
import { getIssueIdsByTopic } from '../db/topic-queries';

const EMBEDDING_CACHE_TTL_MS = 10 * 60 * 1000;
const EMBEDDING_CACHE_MAX = 128;
const embeddingCache = new Map<string, { vector: number[]; expiresAt: number }>();

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
  topK: number = 15
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
  const vectorizeFilter = await buildVectorizeFilter(env, filters);
  if (vectorizeFilter === null) return [];

  const queryVector = await embedQuery(env, queryText);
  if (queryVector.length === 0) return [];

  const matches = await env.VECTORIZE.query(queryVector, {
    topK,
    returnMetadata: 'all',
    ...(vectorizeFilter ? { filter: vectorizeFilter } : {}),
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
    // Drop weak vector hits before issue grouping. The ranker still applies
    // its stricter semantic-only threshold later.
    if (match.score < 0.72) continue;
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
  let filtered = issues.filter(issue => {
    if (filters.before && issue.published_at && issue.published_at >= filters.before) return false;
    if (filters.after && issue.published_at && issue.published_at <= filters.after) return false;
    if (filters.year && issue.year !== filters.year) return false;
    return true;
  });

  // Topic filter: intersect with issues carrying the keyword
  if (filters.topic) {
    const topicIssueIds = new Set(await getIssueIdsByTopic(env.DB, filters.topic));
    filtered = filtered.filter(i => topicIssueIds.has(i.id));
  }

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

async function embedQuery(env: Env, queryText: string): Promise<number[]> {
  const key = queryText.trim().toLowerCase().replace(/\s+/g, ' ');
  const now = Date.now();
  const cached = embeddingCache.get(key);
  if (cached && cached.expiresAt > now) return cached.vector;
  if (cached) embeddingCache.delete(key);

  const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [queryText],
  });
  if (!('data' in embeddingResult) || !embeddingResult.data?.[0]) return [];
  const vector = embeddingResult.data[0];
  if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
    const oldest = embeddingCache.keys().next().value;
    if (oldest) embeddingCache.delete(oldest);
  }
  embeddingCache.set(key, { vector, expiresAt: now + EMBEDDING_CACHE_TTL_MS });
  return vector;
}

async function buildVectorizeFilter(env: Env, filters: SearchFilters): Promise<VectorizeVectorMetadataFilter | null | undefined> {
  const filter: VectorizeVectorMetadataFilter = {};
  const publishedAt: Record<string, string> = {};

  if (filters.year) {
    publishedAt.$gte = `${filters.year}-01-01`;
    publishedAt.$lt = `${filters.year + 1}-01-01`;
  }
  if (filters.after) {
    if (!publishedAt.$gte || filters.after >= publishedAt.$gte) {
      delete publishedAt.$gte;
      publishedAt.$gt = filters.after;
    }
  }
  if (filters.before) {
    if (!publishedAt.$lt || filters.before <= publishedAt.$lt) publishedAt.$lt = filters.before;
  }
  if (Object.keys(publishedAt).length > 0) filter.published_at = publishedAt;

  if (filters.section) filter.section_label_public = filters.section;

  if (filters.topic) {
    const topicIssueIds = await getIssueIdsByTopic(env.DB, filters.topic);
    if (topicIssueIds.length === 0) return null;
    filter.issue_id = { $in: topicIssueIds };
  }

  return Object.keys(filter).length > 0 ? filter : undefined;
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
