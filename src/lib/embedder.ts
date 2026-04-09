import type { Env } from '../env';
import type { IssueChunkRow } from '../db/types';

const BATCH_SIZE = 100; // Workers AI embedding batch limit

export interface EmbeddedChunk {
  chunk: IssueChunkRow;
  vector: number[];
}

export async function embedChunks(
  env: Env,
  chunks: IssueChunkRow[]
): Promise<EmbeddedChunk[]> {
  const results: EmbeddedChunk[] = [];

  // Process in batches
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.chunk_text);

    const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: texts,
    });

    if (!('data' in embeddingResult) || !embeddingResult.data) continue;
    const vectors = embeddingResult.data;
    for (let j = 0; j < batch.length; j++) {
      if (vectors[j]) {
        results.push({
          chunk: batch[j],
          vector: vectors[j],
        });
      } else {
        console.error(`Embedding failed for chunk ${batch[j].id}`);
      }
    }
  }

  return results;
}

export async function upsertVectors(
  env: Env,
  embedded: EmbeddedChunk[],
  issueMeta: { issue_id: string; issue_number: number | null; published_at: string | null; title: string }
): Promise<void> {
  if (embedded.length === 0) return;

  const VECTORIZE_BATCH = 999; // Vectorize max per upsert

  for (let i = 0; i < embedded.length; i += VECTORIZE_BATCH) {
    const batch = embedded.slice(i, i + VECTORIZE_BATCH);

    const vectors = batch.map(e => ({
      id: e.chunk.id,
      values: e.vector,
      metadata: {
        issue_id: issueMeta.issue_id,
        issue_number: issueMeta.issue_number ?? 0,
        published_at: issueMeta.published_at || '',
        title: issueMeta.title,
        section_label: e.chunk.section_label || '',
        chunk_text: truncateForMetadata(e.chunk.chunk_text),
      },
    }));

    await env.VECTORIZE.upsert(vectors);
  }
}

// Vectorize metadata has size limits — truncate chunk text for snippet use
function truncateForMetadata(text: string, maxLen: number = 500): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}
