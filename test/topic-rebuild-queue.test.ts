import { describe, expect, it } from 'vitest';
import { makeD1 } from './helpers-d1';
import { enqueueTopicRebuild, handleEnrichmentMessage, type EnrichmentMessage } from '../src/jobs/enrichment-queue';
import { claimPipelineJob, createPipelineJob, failPipelineJob, idempotencyKeyForMessage } from '../src/lib/pipeline-jobs';

async function seedIssue(db: ReturnType<typeof makeD1>, id: string, n: number, text: string) {
  await db.prepare(`INSERT INTO issues
    (id, issue_number, title, source_url, full_text_plain, status, published_at, ingested_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
    .bind(id, n, `Issue ${n}`, `x://${n}`, text, `2026-01-${String(n).padStart(2, '0')}`, '2026-01-01')
    .run();
}

describe('queue-backed topic rebuild', () => {
  it('splits extraction into jobs and finalizes only after batches succeed', async () => {
    const db = makeD1();
    await seedIssue(db, 'i1', 1, 'Systems thinking and crypto shape governance.');
    await seedIssue(db, 'i2', 2, 'Systems thinking and crypto shape climate change.');
    await seedIssue(db, 'i3', 3, 'Systems thinking and large language models shape governance.');

    const sent: EnrichmentMessage[] = [];
    const env = {
      DB: db as any,
      ENRICHMENT_QUEUE: { sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => { sent.push(...batch.map(b => b.body)); } },
      AI: { run: async (_model: string, input: { text: string[] }) => ({ data: input.text.map((_, i) => [i + 1, 0]) }) },
    } as any;

    const queued = await enqueueTopicRebuild(env, 'run-q', ['i1', 'i2', 'i3'], 2);
    expect(queued).toEqual({ extractJobs: 2, finalizeJobs: 0 });
    expect(sent.some(m => 'kind' in m && m.kind === 'topic-finalize-rebuild')).toBe(false);

    const extracts = sent.filter(m => 'kind' in m && m.kind === 'topic-extract-batch');
    await handleEnrichmentMessage(extracts[0], env);
    expect(sent.some(m => 'kind' in m && m.kind === 'topic-finalize-rebuild')).toBe(false);
    await handleEnrichmentMessage(extracts[1], env);

    const finalize = sent.find(m => 'kind' in m && m.kind === 'topic-finalize-rebuild')!;
    expect(finalize).toBeDefined();
    await handleEnrichmentMessage(finalize, env, 2);

    const run = await db.prepare('SELECT status FROM pipeline_runs WHERE id = ?').bind('run-q').first<{ status: string }>();
    // In production the admin route creates the run before enqueueing. The
    // finalizer is still allowed to run in tests without a pre-created row.
    expect(run).toBeNull();

    const corpus = await db.prepare('SELECT keyword FROM corpus_topics ORDER BY aggregate_score DESC')
      .all<{ keyword: string }>();
    expect(corpus.results.map(r => r.keyword)).toContain('systems thinking');
  });

  it('materializes a finalizer delivery whose legacy job row is missing', async () => {
    const db = makeD1();
    await seedIssue(db, 'legacy-1', 1, 'Systems thinking and crypto shape governance.');
    await seedIssue(db, 'legacy-2', 2, 'Systems thinking and crypto shape climate change.');
    await seedIssue(db, 'legacy-3', 3, 'Systems thinking and crypto shape institutions.');

    const sent: EnrichmentMessage[] = [];
    const env = {
      DB: db as any,
      ENRICHMENT_QUEUE: {
        sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => {
          sent.push(...batch.map(item => item.body));
        },
      },
      AI: { run: async (_model: string, input: { text: string[] }) => ({ data: input.text.map(() => [1, 0]) }) },
    } as any;

    await enqueueTopicRebuild(env, 'run-legacy-finalizer', ['legacy-1', 'legacy-2', 'legacy-3'], 1);
    const extracts = sent.filter(message => 'kind' in message && message.kind === 'topic-extract-batch');
    await handleEnrichmentMessage(extracts[0], env);
    await handleEnrichmentMessage(extracts[1], env);
    await handleEnrichmentMessage(extracts[2], env);
    const finalizer = sent.find(message => 'kind' in message && message.kind === 'topic-finalize-rebuild');
    expect(finalizer).toBeDefined();
    if (!finalizer || !('jobId' in finalizer)) throw new Error('expected a persisted finalizer message');

    await db.prepare('DELETE FROM pipeline_jobs WHERE id = ?').bind(finalizer.jobId).run();
    await expect(handleEnrichmentMessage(finalizer, env)).resolves.toEqual({ embedded: 0, finalized: true });

    const corpus = await db.prepare('SELECT keyword FROM corpus_topics ORDER BY keyword')
      .all<{ keyword: string }>();
    expect(corpus.results.map(row => row.keyword)).toContain('systems thinking');
    expect(await db.prepare('SELECT status FROM pipeline_jobs WHERE id = ?')
      .bind(finalizer.jobId).first()).toEqual({ status: 'succeeded' });
  });

  it('restores a missing extract row so its result still reaches the barrier', async () => {
    const db = makeD1();
    await seedIssue(db, 'legacy-extract', 1, 'Systems thinking shapes governance.');
    const sent: EnrichmentMessage[] = [];
    const env = {
      DB: db as any,
      ENRICHMENT_QUEUE: {
        sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => {
          sent.push(...batch.map(item => item.body));
        },
      },
    } as any;

    await enqueueTopicRebuild(env, 'run-legacy-extract', ['legacy-extract'], 1);
    const extract = sent.find(message => 'kind' in message && message.kind === 'topic-extract-batch');
    expect(extract).toBeDefined();
    if (!extract || !('jobId' in extract)) throw new Error('expected a persisted extract message');

    await db.prepare('DELETE FROM pipeline_jobs WHERE id = ?').bind(extract.jobId).run();
    await expect(handleEnrichmentMessage(extract, env)).resolves.toEqual({ embedded: 0, extracted: 1 });

    const restored = await db.prepare(`
      SELECT status, result_json FROM pipeline_jobs WHERE id = ?
    `).bind(extract.jobId).first<{ status: string; result_json: string | null }>();
    expect(restored?.status).toBe('succeeded');
    expect(JSON.parse(restored?.result_json ?? '{}').issues?.[0]?.issueId).toBe('legacy-extract');
    expect(sent.some(message => 'kind' in message && message.kind === 'topic-finalize-rebuild')).toBe(true);
  });

  it('replays a persisted finalizer outbox without creating a late duplicate', async () => {
    const db = makeD1();
    await db.prepare(`
      INSERT INTO pipeline_runs (id, mode, started_at, status)
      VALUES ('run-outbox', 'topic-rebuild', '2026-01-01T00:00:00.000Z', 'running')
    `).run();
    await seedIssue(db, 'o1', 1, 'Systems thinking and crypto shape governance.');
    await seedIssue(db, 'o2', 2, 'Systems thinking and crypto shape climate change.');

    const sent: EnrichmentMessage[] = [];
    let throwAfterFirstFinalizerPublish = true;
    const env = {
      DB: db as any,
      ENRICHMENT_QUEUE: {
        sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => {
          const bodies = batch.map(item => item.body);
          sent.push(...bodies);
          if (throwAfterFirstFinalizerPublish && bodies.some(body => 'kind' in body && body.kind === 'topic-finalize-rebuild')) {
            throwAfterFirstFinalizerPublish = false;
            throw new Error('network connection lost after finalizer publish');
          }
        },
      },
      AI: { run: async (_model: string, input: { text: string[] }) => ({ data: input.text.map((_, i) => [i + 1, 0]) }) },
    } as any;

    await enqueueTopicRebuild(env, 'run-outbox', ['o1', 'o2'], 1);
    const extracts = sent.filter(message => 'kind' in message && message.kind === 'topic-extract-batch');
    await handleEnrichmentMessage(extracts[0], env);
    await expect(handleEnrichmentMessage(extracts[1], env)).rejects.toThrow(/connection lost/);

    const persisted = await db.prepare(`
      SELECT COUNT(*) AS c FROM pipeline_jobs
      WHERE run_id = ? AND kind = 'topic-finalize-rebuild'
    `).bind('run-outbox').first<{ c: number }>();
    expect(persisted?.c).toBe(1);

    // Redelivery sees a terminal extract, republishes the existing queued
    // finalizer row, and does not invent a new job id.
    await handleEnrichmentMessage(extracts[1], env);
    const finalizerPublishes = sent.filter(message => 'kind' in message && message.kind === 'topic-finalize-rebuild');
    expect(finalizerPublishes).toHaveLength(2);
    expect(new Set(finalizerPublishes.map(message => 'jobId' in message ? message.jobId : null)).size).toBe(1);

    await handleEnrichmentMessage(finalizerPublishes[0], env);
    expect((await db.prepare('SELECT status FROM pipeline_runs WHERE id = ?')
      .bind('run-outbox').first<{ status: string }>())?.status).toBe('completed');

    const publishesBeforeLateRedelivery = sent.filter(message => 'kind' in message && message.kind === 'topic-finalize-rebuild').length;
    await handleEnrichmentMessage(extracts[1], env);
    expect(sent.filter(message => 'kind' in message && message.kind === 'topic-finalize-rebuild')).toHaveLength(publishesBeforeLateRedelivery);
    expect((await db.prepare(`
      SELECT COUNT(*) AS c FROM pipeline_jobs
      WHERE run_id = ? AND kind = 'topic-finalize-rebuild'
    `).bind('run-outbox').first<{ c: number }>())?.c).toBe(1);
  });

  it('repairs a terminal finalizer whose job failure committed before run failure', async () => {
    const db = makeD1();
    await db.prepare(`
      INSERT INTO pipeline_runs (id, mode, started_at, status)
      VALUES ('run-failed-finalizer', 'topic-rebuild', '2026-01-01T00:00:00.000Z', 'running')
    `).run();
    const message: EnrichmentMessage = {
      schemaVersion: 1,
      kind: 'topic-finalize-rebuild',
      runId: 'run-failed-finalizer',
      jobId: 'job-failed-finalizer',
      correlationId: 'corr-failed-finalizer',
      queuedAt: '2026-01-01T00:00:00.000Z',
      expectedExtractJobs: 1,
    };
    await createPipelineJob(db as any, {
      id: message.jobId,
      runId: message.runId,
      kind: message.kind,
      semanticKey: idempotencyKeyForMessage(message),
      payload: message,
      correlationId: message.correlationId,
      queuedAt: message.queuedAt,
    });
    const claim = await claimPipelineJob(db as any, message.jobId, 1);
    expect(claim.outcome).toBe('claimed');
    if (claim.outcome !== 'claimed') throw new Error('expected finalizer claim');
    expect(await failPipelineJob(
      db as any,
      message.jobId,
      claim.token,
      new Error('finalizer permanently failed'),
    )).toBe(true);
    expect((await db.prepare('SELECT status FROM pipeline_runs WHERE id = ?')
      .bind(message.runId).first<{ status: string }>())?.status).toBe('running');

    await handleEnrichmentMessage(message, {
      DB: db as any,
      ENRICHMENT_QUEUE: { sendBatch: async () => undefined },
    } as any);
    expect((await db.prepare('SELECT status FROM pipeline_runs WHERE id = ?')
      .bind(message.runId).first<{ status: string }>())?.status).toBe('failed');
  });
});
