import type { Env } from '../env';
import { runStep, shouldRetryError } from '../lib/topic-rebuild';

export type EnrichmentMessage = {
  type: 'embed-corpus-topics';
  run_id: string;
  keywords: string[];
};

export interface TopicKeywordRow {
  keyword: string;
}

export function makeTopicEmbeddingMessages(
  rows: TopicKeywordRow[],
  runId: string,
  batchSize = 25
): EnrichmentMessage[] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('batchSize must be a positive integer');
  }

  const messages: EnrichmentMessage[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const keywords = rows.slice(i, i + batchSize).map(row => row.keyword).filter(Boolean);
    if (keywords.length > 0) messages.push({ type: 'embed-corpus-topics', run_id: runId, keywords });
  }
  return messages;
}

export async function enqueueCorpusTopicEmbedding(env: Env, runId: string, batchSize = 25): Promise<number> {
  if (!env.ENRICHMENT_QUEUE) return 0;

  const rows = await env.DB.prepare(`
    SELECT keyword
    FROM corpus_topics
    ORDER BY aggregate_score DESC
  `).all<TopicKeywordRow>();

  const messages = makeTopicEmbeddingMessages(rows.results, runId, batchSize);
  for (let i = 0; i < messages.length; i += 100) {
    await env.ENRICHMENT_QUEUE.sendBatch(
      messages.slice(i, i + 100).map(body => ({ body }))
    );
  }
  return messages.length;
}

export async function handleEnrichmentMessage(message: EnrichmentMessage): Promise<{ embedded: number }> {
  switch (message.type) {
    case 'embed-corpus-topics': {
      // Flux does not yet persist topic embeddings; this queue variant is the
      // fan-out seam. Keeping it as an acked, measured unit lets us move the
      // expensive embedding implementation here later without changing
      // producers or retry policy.
      await runStep('embed_corpus_topics', async () => {
        console.log(JSON.stringify({
          event: 'embed_batch',
          run_id: message.run_id,
          batch_size: message.keywords.length,
          ack: true,
        }));
      });
      return { embedded: message.keywords.length };
    }
  }
}

export async function processEnrichmentQueue(batch: MessageBatch<EnrichmentMessage>): Promise<void> {
  for (const message of batch.messages) {
    try {
      await handleEnrichmentMessage(message.body);
      message.ack();
    } catch (err) {
      if (shouldRetryError(err)) {
        message.retry({ delaySeconds: 5 });
      } else {
        console.error(JSON.stringify({
          event: 'enrichment_message_failed',
          type: message.body?.type,
          error: String(err),
          ack: true,
        }));
        message.ack();
      }
    }
  }
}
