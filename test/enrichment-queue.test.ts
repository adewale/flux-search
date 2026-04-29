import { describe, expect, it } from 'vitest';
import { makeD1 } from './helpers-d1';
import { makeTopicEmbeddingMessages, handleEnrichmentMessage, type EnrichmentMessage } from '../src/jobs/enrichment-queue';
import { createPipelineJob, idempotencyKeyForMessage } from '../src/lib/pipeline-jobs';

function keywordRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({ keyword: `topic-${i + 1}` }));
}

describe('enrichment queue helpers', () => {
  it('fans out corpus topics into versioned bounded embed messages', () => {
    const messages = makeTopicEmbeddingMessages(keywordRows(53), 'run-1', 25, {
      correlationId: 'corr-1',
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(messages).toHaveLength(3);
    expect(messages.map(m => m.keywords.length)).toEqual([25, 25, 3]);
    expect(messages.every(m =>
      m.schemaVersion === 1 &&
      m.kind === 'embed-corpus-topics' &&
      m.type === 'embed-corpus-topics' &&
      m.runId === 'run-1' &&
      m.run_id === 'run-1' &&
      m.correlationId === 'corr-1' &&
      m.queuedAt === '2026-01-01T00:00:00.000Z' &&
      Boolean(m.jobId)
    )).toBe(true);
  });

  it('handles empty topic lists without producing poison messages', () => {
    expect(makeTopicEmbeddingMessages([], 'run-1', 25)).toEqual([]);
  });

  it('rejects invalid batch sizes', () => {
    expect(() => makeTopicEmbeddingMessages(keywordRows(1), 'run-1', 0)).toThrow(/batch/i);
  });

  it('processes the initial embed-corpus-topics message variant', async () => {
    const message: EnrichmentMessage = {
      schemaVersion: 1,
      kind: 'embed-corpus-topics',
      runId: 'run-1',
      jobId: 'job-1',
      correlationId: 'corr-1',
      queuedAt: '2026-01-01T00:00:00.000Z',
      keywords: ['trust', 'governance'],
    };
    await expect(handleEnrichmentMessage(message)).resolves.toEqual({ embedded: 2 });
  });

  it('supports legacy type/run_id messages during migration', async () => {
    const message: EnrichmentMessage = { type: 'embed-corpus-topics', run_id: 'run-1', keywords: ['trust'] };
    await expect(handleEnrichmentMessage(message)).resolves.toEqual({ embedded: 1 });
  });

  it('marks durable jobs succeeded after processing', async () => {
    const db = makeD1();
    const message = makeTopicEmbeddingMessages(keywordRows(2), 'run-1', 25, {
      correlationId: 'corr-1',
      now: '2026-01-01T00:00:00.000Z',
    })[0];
    await db.prepare(`INSERT INTO corpus_topics
      (keyword, keyword_display, doc_frequency, avg_score, aggregate_score, first_seen, last_seen, ngram_size, updated_at)
      VALUES ('topic-1', 'topic-1', 1, 1, 1, '2026-01-01', '2026-01-01', 1, '2026-01-01'),
             ('topic-2', 'topic-2', 1, 1, 1, '2026-01-01', '2026-01-01', 1, '2026-01-01')`).run();
    await createPipelineJob(db as any, {
      id: message.jobId,
      runId: message.runId,
      kind: message.kind,
      semanticKey: idempotencyKeyForMessage(message),
      payload: message,
      correlationId: message.correlationId,
      queuedAt: message.queuedAt,
    });

    await handleEnrichmentMessage(message, {
      DB: db as any,
      AI: { run: async () => ({ data: [[1, 0], [0, 1]] }) },
    } as any, 2);

    const row = await db.prepare('SELECT status, attempts FROM pipeline_jobs WHERE id = ?')
      .bind(message.jobId).first<{ status: string; attempts: number }>();
    expect(row).toEqual({ status: 'succeeded', attempts: 2 });
  });
});
