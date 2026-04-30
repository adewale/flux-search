import { describe, expect, it } from 'vitest';
import { makeD1 } from './helpers-d1';
import { enqueueTopicRebuild, handleEnrichmentMessage, type EnrichmentMessage } from '../src/jobs/enrichment-queue';

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
    expect(queued).toEqual({ extractJobs: 2, finalizeJobs: 1 });

    const finalize = sent.find(m => 'kind' in m && m.kind === 'topic-finalize-rebuild')!;
    await expect(handleEnrichmentMessage(finalize, env)).rejects.toThrow(/waiting/);

    for (const message of sent.filter(m => 'kind' in m && m.kind === 'topic-extract-batch')) {
      await handleEnrichmentMessage(message, env);
    }
    await handleEnrichmentMessage(finalize, env, 2);

    const run = await db.prepare('SELECT status FROM pipeline_runs WHERE id = ?').bind('run-q').first<{ status: string }>();
    // In production the admin route creates the run before enqueueing. The
    // finalizer is still allowed to run in tests without a pre-created row.
    expect(run).toBeNull();

    const corpus = await db.prepare('SELECT keyword FROM corpus_topics ORDER BY aggregate_score DESC')
      .all<{ keyword: string }>();
    expect(corpus.results.map(r => r.keyword)).toContain('systems thinking');
  });
});
