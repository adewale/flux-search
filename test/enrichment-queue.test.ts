import { describe, expect, it, vi } from 'vitest';
import { makeD1 } from './helpers-d1';
import {
  enqueueCorpusTopicEmbedding,
  makeTopicEmbeddingMessages,
  handleEnrichmentMessage,
  processEnrichmentQueue,
  type EnrichmentMessage,
} from '../src/jobs/enrichment-queue';
import {
  claimPipelineJob,
  createPipelineJob,
  idempotencyKeyForMessage,
  PipelineJobOwnershipLostError,
  succeedPipelineJob,
} from '../src/lib/pipeline-jobs';

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

  it('replays an embedding outbox row orphaned before queue publication', async () => {
    const db = makeD1();
    await db.prepare(`INSERT INTO corpus_topics
      (keyword, keyword_display, doc_frequency, avg_score, aggregate_score, first_seen, last_seen, ngram_size, updated_at)
      VALUES ('topic-1', 'topic-1', 2, 0.1, 20, '2026-01-01', '2026-01-01', 1, '2026-01-01'),
             ('topic-2', 'topic-2', 2, 0.2, 10, '2026-01-01', '2026-01-01', 1, '2026-01-01')`).run();
    const sent: EnrichmentMessage[] = [];
    const env = {
      DB: db as any,
      ENRICHMENT_QUEUE: {
        sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => {
          sent.push(...batch.map(item => item.body));
        },
      },
    } as any;

    let checkpoints = 0;
    await expect(enqueueCorpusTopicEmbedding(env, 'run-outbox', 25, async () => {
      checkpoints++;
      if (checkpoints === 4) throw new PipelineJobOwnershipLostError('stale-finalizer');
    })).rejects.toBeInstanceOf(PipelineJobOwnershipLostError);
    expect(sent).toEqual([]);

    const persisted = await db.prepare(`
      SELECT id, status FROM pipeline_jobs WHERE kind = 'embed-corpus-topics'
    `).first<{ id: string; status: string }>();
    expect(persisted?.status).toBe('queued');

    await expect(enqueueCorpusTopicEmbedding(env, 'run-outbox', 25)).resolves.toBe(1);
    expect(sent).toHaveLength(1);
    expect('jobId' in sent[0] ? sent[0].jobId : null).toBe(persisted?.id);
    expect((await db.prepare(`
      SELECT COUNT(*) AS c FROM pipeline_jobs WHERE kind = 'embed-corpus-topics'
    `).first<{ c: number }>())?.c).toBe(1);

    const claim = await claimPipelineJob(db as any, persisted!.id, 1);
    expect(claim.outcome).toBe('claimed');
    if (claim.outcome !== 'claimed') throw new Error('expected persisted embedding job to be claimable');
    expect(await succeedPipelineJob(db as any, persisted!.id, claim.token, { embedded: 2 })).toBe(true);
    sent.length = 0;

    // A replacement finalizer arriving after that outbox job completed must
    // not create and publish a second same-run embedding job.
    await expect(enqueueCorpusTopicEmbedding(env, 'run-outbox', 25)).resolves.toBe(0);
    expect(sent).toEqual([]);
    expect((await db.prepare(`
      SELECT COUNT(*) AS c FROM pipeline_jobs WHERE kind = 'embed-corpus-topics'
    `).first<{ c: number }>())?.c).toBe(1);
  });

  it('does not republish an active semantic-key job owned by another run', async () => {
    const db = makeD1();
    await db.prepare(`INSERT INTO corpus_topics
      (keyword, keyword_display, doc_frequency, avg_score, aggregate_score, first_seen, last_seen, ngram_size, updated_at)
      VALUES ('shared-topic', 'Shared Topic', 2, 0.1, 20, '2026-01-01', '2026-01-01', 1, '2026-01-01')`).run();
    const sent: EnrichmentMessage[] = [];
    const env = {
      DB: db as any,
      ENRICHMENT_QUEUE: {
        sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => {
          sent.push(...batch.map(item => item.body));
        },
      },
    } as any;

    await expect(enqueueCorpusTopicEmbedding(env, 'run-a', 25)).resolves.toBe(1);
    expect(sent).toHaveLength(1);
    sent.length = 0;

    await expect(enqueueCorpusTopicEmbedding(env, 'run-b', 25)).resolves.toBe(0);
    expect(sent).toEqual([]);
    const jobs = await db.prepare(`
      SELECT run_id, status FROM pipeline_jobs WHERE kind = 'embed-corpus-topics'
    `).all<{ run_id: string; status: string }>();
    expect(jobs.results).toEqual([{ run_id: 'run-a', status: 'queued' }]);
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

  it('processes an embed delivery whose legacy job row is missing', async () => {
    const db = makeD1();
    await db.prepare(`INSERT INTO corpus_topics
      (keyword, keyword_display, doc_frequency, avg_score, aggregate_score, first_seen, last_seen, ngram_size, updated_at)
      VALUES ('topic-1', 'topic-1', 1, 1, 1, '2026-01-01', '2026-01-01', 1, '2026-01-01')`).run();
    const message = makeTopicEmbeddingMessages(keywordRows(1), 'run-untracked', 25, {
      correlationId: 'corr-untracked',
      now: '2026-01-01T00:00:00.000Z',
    })[0];

    await expect(handleEnrichmentMessage(message, {
      DB: db as any,
      AI: { run: async () => ({ data: [[1, 0]] }) },
    } as any)).resolves.toEqual({ embedded: 1 });

    expect((await db.prepare(`
      SELECT keyword FROM topic_embeddings
    `).all<{ keyword: string }>()).results).toEqual([{ keyword: 'topic-1' }]);
    expect(await db.prepare('SELECT status FROM pipeline_jobs WHERE id = ?')
      .bind(message.jobId).first()).toEqual({ status: 'succeeded' });
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

  it('retries an active lease and processes the delivery after expiry', async () => {
    const db = makeD1();
    const message = makeTopicEmbeddingMessages(keywordRows(1), 'run-lease', 25, {
      correlationId: 'corr-lease',
      now: '2026-01-01T00:00:00.000Z',
    })[0];
    await db.prepare(`INSERT INTO corpus_topics
      (keyword, keyword_display, doc_frequency, avg_score, aggregate_score, first_seen, last_seen, ngram_size, updated_at)
      VALUES ('topic-1', 'topic-1', 1, 1, 1, '2026-01-01', '2026-01-01', 1, '2026-01-01')`).run();
    await createPipelineJob(db as any, {
      id: message.jobId,
      runId: message.runId,
      kind: message.kind,
      semanticKey: idempotencyKeyForMessage(message),
      payload: message,
      correlationId: message.correlationId,
      queuedAt: message.queuedAt,
    });
    expect((await claimPipelineJob(
      db as any,
      message.jobId,
      1,
      new Date().toISOString(),
      'crashed-owner',
    )).outcome).toBe('claimed');

    const ack = vi.fn();
    const retry = vi.fn();
    const delivery = { id: 'redelivery', attempts: 2, body: message, ack, retry };
    const env = {
      DB: db as any,
      AI: { run: async () => ({ data: [[1, 0]] }) },
    } as any;

    await processEnrichmentQueue({ messages: [delivery] } as any, env);
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0][0].delaySeconds).toBeGreaterThan(0);

    await db.prepare(`
      UPDATE pipeline_jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z'
      WHERE id = ?
    `).bind(message.jobId).run();
    retry.mockClear();

    await processEnrichmentQueue({ messages: [delivery] } as any, env);
    expect(retry).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect((await db.prepare('SELECT status FROM pipeline_jobs WHERE id = ?')
      .bind(message.jobId).first<{ status: string }>())?.status).toBe('succeeded');
  });
});
