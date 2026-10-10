import { describe, expect, it } from 'vitest';
import { makeD1 } from './helpers-d1';
import { enqueueTopicRebuild, enqueueCorpusTopicEmbedding, handleEnrichmentMessage, type EnrichmentMessage } from '../src/jobs/enrichment-queue';

async function seedIssue(db: ReturnType<typeof makeD1>, id: string, n: number, text: string) {
  await db.prepare(`INSERT INTO issues
    (id, issue_number, title, source_url, full_text_plain, status, published_at, ingested_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
    .bind(id, n, `Issue ${n}`, `x://${n}`, text, `2026-01-${String(n).padStart(2, '0')}`, '2026-01-01')
    .run();
}

describe('queue-backed topic rebuild', () => {
  it.each(['extract', 'embedding'] as const)('dispatches its persisted %s job after losing the INSERT response', async (kind) => {
    const db = makeD1();
    await db.prepare(`INSERT INTO corpus_topics
      (keyword, keyword_display, doc_frequency, avg_score, aggregate_score, updated_at)
      VALUES ('a', 'A', 1, 1, 1, 'now')`).run();
    let lost = false;
    const wrapped = { ...db, prepare: (sql: string) => {
      const statement = db.prepare(sql);
      if (!sql.includes('INSERT INTO pipeline_jobs')) return statement;
      return { ...statement, bind: (...values: unknown[]) => {
        const bound = statement.bind(...values);
        return { ...bound, run: async () => {
          const result = await bound.run();
          if (!lost) { lost = true; throw new Error('network connection lost'); }
          return result;
        } };
      } };
    } };
    const sent: EnrichmentMessage[] = [];
    const env = { DB: wrapped, ENRICHMENT_QUEUE: { sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => {
      sent.push(...batch.map(entry => entry.body));
    } } } as any;
    const enqueue = () => kind === 'extract'
      ? enqueueTopicRebuild(env, 'insert-response', ['i1'], 1)
      : enqueueCorpusTopicEmbedding(env, 'insert-response', 1);
    await enqueue();
    const stored = (await db.prepare('SELECT payload_json FROM pipeline_jobs').all<{ payload_json: string }>())
      .results.map(row => JSON.parse(row.payload_json));
    expect(sent).toEqual(stored);
    expect(sent).toHaveLength(1);
    await enqueue();
    expect(sent).toEqual(stored);
  });

  it('fails a superseded finalizer without changing current publication', async () => {
    const db = makeD1();
    await db.prepare("INSERT INTO pipeline_runs (id, mode, started_at) VALUES ('old-finalizer', 'topic_rebuild', 'now')").run();
    const sent: EnrichmentMessage[] = [];
    const env = { DB: db, ENRICHMENT_QUEUE: { sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => {
      sent.push(...batch.map(entry => entry.body));
    } } } as any;
    await enqueueTopicRebuild(env, 'old-finalizer', ['missing'], 1);
    await handleEnrichmentMessage(sent[0], env);
    await db.prepare("INSERT INTO pipeline_runs (id, mode, started_at) VALUES ('current-finalizer', 'topic_rebuild', 'now')").run();
    await db.prepare("INSERT INTO corpus_topics (keyword, keyword_display, doc_frequency, avg_score, aggregate_score, updated_at) VALUES ('current', 'Current', 3, 1, 1, 'now')").run();
    const finalize = sent.find(message => 'kind' in message && message.kind === 'topic-finalize-rebuild')!;
    await expect(handleEnrichmentMessage(finalize, env)).rejects.toThrow();
    expect((await db.prepare('SELECT keyword FROM corpus_topics').all()).results).toEqual([{ keyword: 'current' }]);
    expect(await db.prepare("SELECT status FROM pipeline_runs WHERE id = 'old-finalizer'").first()).toEqual({ status: 'failed' });
    expect(await db.prepare("SELECT status FROM pipeline_runs WHERE id = 'current-finalizer'").first()).toEqual({ status: 'running' });
  });

  it('retries a failed send with the persisted ID and payload, without re-sending ordinary queued jobs', async () => {
    const db = makeD1();
    const sent: EnrichmentMessage[] = [];
    let fail = true;
    const env = { DB: db, ENRICHMENT_QUEUE: { sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => {
      sent.push(...batch.map(entry => entry.body));
      if (fail) { fail = false; throw new Error('network send acknowledgement lost'); }
    } } } as any;
    await expect(enqueueTopicRebuild(env, 'run-send', ['i1'], 1)).rejects.toThrow('acknowledgement lost');
    const original = structuredClone(sent[0]);
    expect(await enqueueTopicRebuild(env, 'run-send', ['i1'], 1)).toEqual({ extractJobs: 1, finalizeJobs: 0 });
    expect(sent).toEqual([original, original]);
    expect(await enqueueTopicRebuild(env, 'run-send', ['i1'], 1)).toEqual({ extractJobs: 0, finalizeJobs: 0 });
    expect(sent).toHaveLength(2);
    expect((await db.prepare('SELECT id FROM pipeline_jobs').all()).results).toEqual([{ id: (original as any).jobId }]);
  });

  it('repairs a failed finalizer send when the already-succeeded extract is redelivered', async () => {
    const db = makeD1();
    const sent: EnrichmentMessage[] = [];
    let failFinalize = true;
    const env = { DB: db, ENRICHMENT_QUEUE: { sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => {
      sent.push(...batch.map(entry => entry.body));
      if (failFinalize && (batch[0].body as any).kind === 'topic-finalize-rebuild') {
        failFinalize = false;
        throw new Error('network finalizer send failed');
      }
    } } } as any;
    await enqueueTopicRebuild(env, 'run-final-send', ['missing'], 1);
    const extract = sent[0];
    await expect(handleEnrichmentMessage(extract, env)).rejects.toThrow('finalizer send failed');
    expect(await db.prepare('SELECT status FROM pipeline_jobs WHERE id = ?').bind((extract as any).jobId).first())
      .toEqual({ status: 'succeeded' });
    const finalizer = structuredClone(sent[1]);
    await handleEnrichmentMessage(extract, env, 2);
    expect(sent).toEqual([extract, finalizer, finalizer]);
    await handleEnrichmentMessage(extract, env, 3);
    expect(sent).toHaveLength(3);
  });

  it.each(['extract', 'embedding'] as const)('retains unsent %s jobs across a later planning failure', async (kind) => {
    const db = makeD1();
    for (const keyword of ['a', 'b']) await db.prepare(`INSERT INTO corpus_topics
      (keyword, keyword_display, doc_frequency, avg_score, aggregate_score, updated_at)
      VALUES (?, ?, 1, 1, 1, 'now')`).bind(keyword, keyword).run();
    const sent: EnrichmentMessage[] = [];
    let failSend = true;
    const env = { DB: db, ENRICHMENT_QUEUE: { sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => {
      if (failSend) { failSend = false; throw new Error('network send failed'); }
      sent.push(...batch.map(entry => entry.body));
    } } } as any;
    const enqueue = (target: typeof env) => kind === 'extract'
      ? enqueueTopicRebuild(target, 'planning', ['i1', 'i2'], 1)
      : enqueueCorpusTopicEmbedding(target, 'planning', 1);
    await expect(enqueue(env)).rejects.toThrow('send failed');
    const originals = (await db.prepare('SELECT payload_json FROM pipeline_jobs ORDER BY rowid').all<{ payload_json: string }>())
      .results.map(row => JSON.parse(row.payload_json));
    let inserts = 0;
    const interrupted = { ...db, prepare: (sql: string) => {
      const statement = db.prepare(sql);
      if (!sql.includes('INSERT INTO pipeline_jobs')) return statement;
      return { ...statement, bind: (...values: unknown[]) => {
        const bound = statement.bind(...values);
        return { ...bound, run: async () => {
          if (++inserts === 2) throw new Error('SQLITE_BUSY');
          return bound.run();
        } };
      } };
    } };
    await expect(enqueue({ ...env, DB: interrupted })).rejects.toThrow('SQLITE_BUSY');
    expect(sent).toEqual([]);
    await enqueue(env);
    expect(sent).toEqual(originals);
    await enqueue(env);
    expect(sent).toEqual(originals);
  });

  it('splits extraction into jobs and finalizes only after batches succeed', async () => {
    const db = makeD1();
    await db.prepare("INSERT INTO pipeline_runs (id, mode, started_at) VALUES ('run-q', 'topic_rebuild', '2026-01-01')").run();
    await seedIssue(db, 'i1', 1, 'Systems thinking and crypto shape governance.');
    await seedIssue(db, 'i2', 2, 'Systems thinking and crypto shape climate change.');
    await seedIssue(db, 'i3', 3, 'Systems thinking and large language models shape governance.');

    const sent: EnrichmentMessage[] = [];
    let aiCalls = 0;
    const env = {
      DB: db as any,
      ENRICHMENT_QUEUE: { sendBatch: async (batch: Array<{ body: EnrichmentMessage }>) => { sent.push(...batch.map(b => b.body)); } },
      AI: { run: async (_model: string, input: { text: string[] }) => {
        aiCalls++;
        return { data: input.text.map((_, i) => [i + 1, 0]) };
      } },
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
    expect(run).toEqual({ status: 'completed' });

    const corpus = await db.prepare('SELECT keyword FROM corpus_topics ORDER BY aggregate_score DESC')
      .all<{ keyword: string }>();
    expect(corpus.results.map(r => r.keyword)).toContain('systems thinking');

    for (const message of sent.filter(m => 'kind' in m && m.kind === 'embed-corpus-topics')) {
      await handleEnrichmentMessage(message, env);
    }
    const embeddings = (await db.prepare('SELECT * FROM topic_embeddings ORDER BY keyword').all()).results;
    expect(embeddings.length).toBeGreaterThan(0);
    const dispatches = structuredClone(sent);
    for (const extract of extracts) await handleEnrichmentMessage(extract, env, 3);
    expect(sent).toEqual(dispatches);
    expect((await db.prepare('SELECT * FROM topic_embeddings ORDER BY keyword').all()).results).toEqual(embeddings);
    expect(aiCalls).toBe(1);
  });
});
