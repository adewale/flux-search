import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { makeD1 } from './helpers-d1';
import {
  claimPipelineJob,
  createPipelineJob,
  failPipelineJob,
  idempotencyKeyForMessage,
  listPipelineJobs,
  succeedPipelineJob,
} from '../src/lib/pipeline-jobs';

describe('pipeline job state', () => {
  it('deduplicates active semantic jobs', async () => {
    const db = makeD1();
    const payload = { kind: 'embed-corpus-topics', keywords: ['b', 'a'] };
    const semanticKey = idempotencyKeyForMessage(payload);
    const base = {
      runId: 'run-1', kind: 'embed-corpus-topics', semanticKey, payload,
      correlationId: 'corr-1', queuedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(await createPipelineJob(db as any, { ...base, id: 'job-1' })).toBe(true);
    expect(await createPipelineJob(db as any, { ...base, id: 'job-2' })).toBe(false);
  });

  it('claims, succeeds, fails, and lists jobs', async () => {
    const db = makeD1();
    await createPipelineJob(db as any, {
      id: 'job-1', runId: 'run-1', kind: 'embed-corpus-topics', semanticKey: 'k1',
      payload: { ok: true }, correlationId: 'corr-1', queuedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await claimPipelineJob(db as any, 'job-1', 3, '2026-01-01T00:01:00.000Z')).toBe(true);
    await succeedPipelineJob(db as any, 'job-1', '2026-01-01T00:02:00.000Z');
    expect(await claimPipelineJob(db as any, 'job-1', 4)).toBe(false);

    await createPipelineJob(db as any, {
      id: 'job-2', runId: 'run-1', kind: 'embed-corpus-topics', semanticKey: 'k2',
      payload: { ok: false }, correlationId: 'corr-1', queuedAt: '2026-01-01T00:03:00.000Z',
    });
    await failPipelineJob(db as any, 'job-2', new Error('boom'), '2026-01-01T00:04:00.000Z');

    const jobs = await listPipelineJobs(db as any, 'run-1');
    expect(jobs.map(j => j.id)).toEqual(['job-2', 'job-1']);
    expect(jobs.map(j => j.status)).toEqual(['failed', 'succeeded']);
  });

  it('PBT: keyword idempotency is order-insensitive', () => {
    fc.assert(fc.property(
      fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 20 }),
      (keywords) => {
        const a = idempotencyKeyForMessage({ kind: 'embed-corpus-topics', keywords });
        const b = idempotencyKeyForMessage({ kind: 'embed-corpus-topics', keywords: [...keywords].reverse() });
        expect(a).toBe(b);
      },
    ));
  });
});
