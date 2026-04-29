import type { Env } from '../env';
import { runStep, shouldRetryError } from '../lib/topic-rebuild';
import {
  claimPipelineJob,
  createPipelineJob,
  deferPipelineJob,
  failPipelineJob,
  idempotencyKeyForMessage,
  recordPipelinePhase,
  succeedPipelineJob,
} from '../lib/pipeline-jobs';
import { rebuildSimilaritiesFromStoredEmbeddings, replaceTopicEmbeddings } from '../db/topic-queries';

export type EmbedCorpusTopicsMessage = {
  schemaVersion: 1;
  kind: 'embed-corpus-topics';
  /** Legacy producer compatibility. Prefer kind. */
  type?: 'embed-corpus-topics';
  runId: string;
  /** Legacy producer compatibility. Prefer runId. */
  run_id?: string;
  jobId: string;
  correlationId: string;
  queuedAt: string;
  keywords: string[];
};

export type LegacyEnrichmentMessage = {
  type: 'embed-corpus-topics';
  run_id: string;
  keywords: string[];
};

export type EnrichmentMessage = EmbedCorpusTopicsMessage | LegacyEnrichmentMessage;

export interface TopicKeywordRow {
  keyword: string;
}

function randomId(): string {
  return crypto.randomUUID();
}

function messageKind(message: EnrichmentMessage): 'embed-corpus-topics' {
  return ('kind' in message ? message.kind : message.type) as 'embed-corpus-topics';
}

function messageRunId(message: EnrichmentMessage): string {
  return 'runId' in message ? message.runId : message.run_id;
}

function messageJobId(message: EnrichmentMessage): string | null {
  return 'jobId' in message ? message.jobId : null;
}

function messageCorrelationId(message: EnrichmentMessage): string | null {
  return 'correlationId' in message ? message.correlationId : null;
}

export function makeTopicEmbeddingMessages(
  rows: TopicKeywordRow[],
  runId: string,
  batchSize = 25,
  opts: { correlationId?: string; now?: string } = {},
): EmbedCorpusTopicsMessage[] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('batchSize must be a positive integer');
  }

  const messages: EmbedCorpusTopicsMessage[] = [];
  const correlationId = opts.correlationId ?? randomId();
  const queuedAt = opts.now ?? new Date().toISOString();
  for (let i = 0; i < rows.length; i += batchSize) {
    const keywords = rows.slice(i, i + batchSize).map(row => row.keyword).filter(Boolean);
    if (keywords.length > 0) {
      messages.push({
        schemaVersion: 1,
        kind: 'embed-corpus-topics',
        type: 'embed-corpus-topics',
        runId,
        run_id: runId,
        jobId: randomId(),
        correlationId,
        queuedAt,
        keywords,
      });
    }
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
  const sendable: EmbedCorpusTopicsMessage[] = [];
  for (const message of messages) {
    const created = await createPipelineJob(env.DB, {
      id: message.jobId,
      runId,
      kind: message.kind,
      semanticKey: idempotencyKeyForMessage(message),
      payload: message,
      correlationId: message.correlationId,
      queuedAt: message.queuedAt,
    });
    if (created) sendable.push(message);
  }

  for (let i = 0; i < sendable.length; i += 100) {
    await env.ENRICHMENT_QUEUE.sendBatch(
      sendable.slice(i, i + 100).map(body => ({ body }))
    );
  }
  return sendable.length;
}

async function embedTopicKeywords(env: Env, keywords: string[]): Promise<number> {
  if (keywords.length === 0) return 0;
  const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: keywords });
  if (!('data' in result) || !Array.isArray(result.data)) return 0;
  const embeddings = keywords.map((keyword, i) => ({ keyword, vector: (result.data as number[][])[i] ?? [] }))
    .filter(e => e.vector.length > 0);
  await replaceTopicEmbeddings(env.DB, embeddings);
  await rebuildSimilaritiesFromStoredEmbeddings(env.DB, embeddings.map(e => e.keyword));
  return embeddings.length;
}

export async function handleEnrichmentMessage(message: EnrichmentMessage, env?: Env, attempts = 1): Promise<{ embedded: number }> {
  const kind = messageKind(message);
  const runId = messageRunId(message);
  const jobId = messageJobId(message);
  const correlationId = messageCorrelationId(message);

  if (env && jobId) {
    const claimed = await claimPipelineJob(env.DB, jobId, attempts);
    if (!claimed) return { embedded: 0 };
  }

  try {
    switch (kind) {
      case 'embed-corpus-topics': {
        const embedded = await runStep('embed_corpus_topics', async () => {
          const count = env ? await embedTopicKeywords(env, message.keywords) : message.keywords.length;
          console.log(JSON.stringify({
            event: 'topic_enrichment_job',
            run_id: runId,
            job_id: jobId,
            correlation_id: correlationId,
            kind,
            status: 'succeeded',
            attempts,
            batch_size: message.keywords.length,
            embedded: count,
            ack: true,
          }));
          return count;
        });
        if (env) await recordPipelinePhase(env.DB, {
          runId,
          jobId,
          phase: 'topic_embedding',
          status: 'succeeded',
          summary: { keywords: message.keywords.length, embedded: embedded.result },
        });
        if (env && jobId) await succeedPipelineJob(env.DB, jobId, { embedded: embedded.result });
        return { embedded: embedded.result };
      }
    }
  } catch (err) {
    if (env && jobId) {
      if (shouldRetryError(err)) await deferPipelineJob(env.DB, jobId, err);
      else await failPipelineJob(env.DB, jobId, err);
    }
    throw err;
  }
}

export async function processEnrichmentQueue(batch: MessageBatch<EnrichmentMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const attempts = typeof message.attempts === 'number' ? message.attempts : 1;
    try {
      await handleEnrichmentMessage(message.body, env, attempts);
      message.ack();
    } catch (err) {
      const jobId = messageJobId(message.body);
      if (shouldRetryError(err)) {
        if (jobId) await deferPipelineJob(env.DB, jobId, err);
        message.retry({ delaySeconds: 5 });
      } else {
        if (jobId) await failPipelineJob(env.DB, jobId, err);
        console.error(JSON.stringify({
          event: 'enrichment_message_failed',
          type: message.body && ('kind' in message.body ? message.body.kind : message.body.type),
          job_id: jobId,
          attempts,
          error: String(err),
          ack: true,
        }));
        message.ack();
      }
    }
  }
}
