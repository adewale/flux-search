import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { makeD1 } from './helpers-d1';
import {
  claimPipelineJob,
  createPipelineJob,
  deferPipelineJob,
  failPipelineJob,
  failPipelineJobAndRun,
  getPipelineJob,
  idempotencyKeyForMessage,
  listPipelineJobs,
  PIPELINE_JOB_LEASE_MS,
  PipelineJobOwnershipLostError,
  renewPipelineJobLease,
  runWithPipelineJobLease,
  succeedPipelineJob,
  succeedPipelineJobAndCompleteRun,
  type PipelineJobStatus,
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
    const firstClaim = await claimPipelineJob(
      db as any,
      'job-1',
      3,
      '2026-01-01T00:01:00.000Z',
      'owner-1',
    );
    expect(firstClaim).toEqual({ outcome: 'claimed', token: 'owner-1' });
    if (firstClaim.outcome !== 'claimed') throw new Error('expected owner-1 to claim job-1');
    expect(await succeedPipelineJob(
      db as any,
      'job-1',
      firstClaim.token,
      { ok: true },
      '2026-01-01T00:02:00.000Z',
    )).toBe(true);
    expect(await claimPipelineJob(db as any, 'job-1', 4)).toEqual({ outcome: 'terminal' });

    await createPipelineJob(db as any, {
      id: 'job-2', runId: 'run-1', kind: 'embed-corpus-topics', semanticKey: 'k2',
      payload: { ok: false }, correlationId: 'corr-1', queuedAt: '2026-01-01T00:03:00.000Z',
    });
    const secondClaim = await claimPipelineJob(
      db as any,
      'job-2',
      1,
      '2026-01-01T00:04:00.000Z',
      'owner-2',
    );
    expect(secondClaim).toEqual({ outcome: 'claimed', token: 'owner-2' });
    if (secondClaim.outcome !== 'claimed') throw new Error('expected owner-2 to claim job-2');
    expect(await failPipelineJob(
      db as any,
      'job-2',
      secondClaim.token,
      new Error('boom'),
      '2026-01-01T00:05:00.000Z',
    )).toBe(true);

    const jobs = await listPipelineJobs(db as any, 'run-1');
    expect(jobs.map(j => j.id)).toEqual(['job-2', 'job-1']);
    expect(jobs.map(j => j.status)).toEqual(['failed', 'succeeded']);
  });

  it('allows exactly one concurrent claimant for a queued job', async () => {
    const db = makeD1();
    await createTestJob(db, 'job-race');

    const claims = await Promise.all([
      claimPipelineJob(db as any, 'job-race', 1, '2026-01-01T00:01:00.000Z', 'racer-a'),
      claimPipelineJob(db as any, 'job-race', 2, '2026-01-01T00:01:00.000Z', 'racer-b'),
    ]);

    expect(claims.map(claim => claim.outcome).sort()).toEqual(['active', 'claimed']);
    expect((await getPipelineJob(db as any, 'job-race'))?.status).toBe('processing');
  });

  it('reclaims an expired worker lease and fences the stale owner', async () => {
    const db = makeD1();
    await createTestJob(db, 'job-stale');
    const claimedAt = Date.parse('2026-01-01T00:01:00.000Z');
    const staleClaim = await claimPipelineJob(
      db as any,
      'job-stale',
      1,
      new Date(claimedAt).toISOString(),
      'stale-owner',
    );

    expect(staleClaim).toEqual({ outcome: 'claimed', token: 'stale-owner' });
    if (staleClaim.outcome !== 'claimed') throw new Error('expected stale owner to acquire initial lease');
    expect(await claimPipelineJob(
      db as any,
      'job-stale',
      2,
      new Date(claimedAt + PIPELINE_JOB_LEASE_MS - 1).toISOString(),
      'early-owner',
    )).toEqual({ outcome: 'active', retryAfterSeconds: 1 });

    const replacementClaim = await claimPipelineJob(
      db as any,
      'job-stale',
      3,
      new Date(claimedAt + PIPELINE_JOB_LEASE_MS).toISOString(),
      'replacement-owner',
    );
    expect(replacementClaim).toEqual({ outcome: 'claimed', token: 'replacement-owner' });
    if (replacementClaim.outcome !== 'claimed') throw new Error('expected replacement owner to acquire expired lease');
    expect(await succeedPipelineJob(db as any, 'job-stale', staleClaim.token, { stale: true })).toBe(false);
    expect(await succeedPipelineJob(db as any, 'job-stale', replacementClaim.token, { ok: true })).toBe(true);
    expect((await getPipelineJob(db as any, 'job-stale'))?.status).toBe('succeeded');
  });

  it('fences run completion and lease renewal from a replaced finalizer owner', async () => {
    const db = makeD1();
    await db.prepare(`
      INSERT INTO pipeline_runs (id, mode, started_at, status)
      VALUES ('run-finalizer', 'topic-rebuild', '2026-01-01T00:00:00.000Z', 'running')
    `).run();
    await createPipelineJob(db as any, {
      id: 'job-finalizer',
      runId: 'run-finalizer',
      kind: 'topic-finalize-rebuild',
      semanticKey: 'topic-finalize-rebuild:run-finalizer',
      payload: { kind: 'topic-finalize-rebuild', runId: 'run-finalizer' },
      correlationId: 'corr-finalizer',
      queuedAt: '2026-01-01T00:00:00.000Z',
    });
    const claimedAt = Date.parse('2026-01-01T00:01:00.000Z');
    expect(await claimPipelineJob(
      db as any,
      'job-finalizer',
      1,
      new Date(claimedAt).toISOString(),
      'stale-finalizer',
    )).toEqual({ outcome: 'claimed', token: 'stale-finalizer' });
    expect(await claimPipelineJob(
      db as any,
      'job-finalizer',
      2,
      new Date(claimedAt + PIPELINE_JOB_LEASE_MS).toISOString(),
      'replacement-finalizer',
    )).toEqual({ outcome: 'claimed', token: 'replacement-finalizer' });

    expect(await renewPipelineJobLease(
      db as any,
      'job-finalizer',
      'stale-finalizer',
      new Date(claimedAt + PIPELINE_JOB_LEASE_MS),
    )).toBe(false);
    expect(await succeedPipelineJobAndCompleteRun(db as any, {
      jobId: 'job-finalizer',
      runId: 'run-finalizer',
      claimToken: 'stale-finalizer',
      result: { stale: true },
      notes: { stale: true },
      now: new Date(claimedAt + PIPELINE_JOB_LEASE_MS + 1).toISOString(),
    })).toBe(false);
    expect((await db.prepare('SELECT status FROM pipeline_runs WHERE id = ?')
      .bind('run-finalizer').first<{ status: string }>())?.status).toBe('running');

    expect(await succeedPipelineJobAndCompleteRun(db as any, {
      jobId: 'job-finalizer',
      runId: 'run-finalizer',
      claimToken: 'replacement-finalizer',
      result: { ok: true },
      notes: { ok: true },
      now: new Date(claimedAt + PIPELINE_JOB_LEASE_MS + 2).toISOString(),
    })).toBe(true);
    expect((await db.prepare('SELECT status FROM pipeline_runs WHERE id = ?')
      .bind('run-finalizer').first<{ status: string }>())?.status).toBe('completed');
  });

  it('heartbeats a long-running owner so its lease cannot be reclaimed mid-work', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(startedAt);
    const db = makeD1();
    await createTestJob(db, 'job-heartbeat');
    expect(await claimPipelineJob(
      db as any,
      'job-heartbeat',
      1,
      startedAt.toISOString(),
      'live-owner',
      100,
    )).toEqual({ outcome: 'claimed', token: 'live-owner' });

    let releaseWork!: () => void;
    let signalStarted!: () => void;
    const workStarted = new Promise<void>(resolve => { signalStarted = resolve; });
    const workBlocked = new Promise<void>(resolve => { releaseWork = resolve; });
    const running = runWithPipelineJobLease(
      db as any,
      'job-heartbeat',
      'live-owner',
      async (checkpoint) => {
        signalStarted();
        await workBlocked;
        await checkpoint();
        return 'finished';
      },
      { leaseMs: 100, heartbeatMs: 20 },
    );

    try {
      await workStarted;
      await vi.advanceTimersByTimeAsync(300);
      const replacement = await claimPipelineJob(
        db as any,
        'job-heartbeat',
        2,
        new Date().toISOString(),
        'replacement-owner',
        100,
      );
      expect(replacement.outcome).toBe('active');
      releaseWork();
      await expect(running).resolves.toBe('finished');
    } finally {
      releaseWork();
      await running.catch(() => undefined);
      vi.useRealTimers();
    }
  });

  it('coalesces per-mutation checkpoints inside the current heartbeat window', async () => {
    const startedAt = Date.parse('2026-01-01T00:00:00.000Z');
    let nowMs = startedAt;
    const db = makeD1();
    await createTestJob(db, 'job-coalesced-checkpoints');
    expect(await claimPipelineJob(
      db as any,
      'job-coalesced-checkpoints',
      1,
      new Date(startedAt).toISOString(),
      'coalesced-owner',
      5_000,
    )).toEqual({ outcome: 'claimed', token: 'coalesced-owner' });

    const prepareSpy = vi.spyOn(db, 'prepare');
    try {
      await runWithPipelineJobLease(
        db as any,
        'job-coalesced-checkpoints',
        'coalesced-owner',
        async (checkpoint) => {
          for (let i = 0; i < 500; i++) await checkpoint();
          nowMs += 1_000;
          await checkpoint();
        },
        {
          leaseMs: 5_000,
          heartbeatMs: 1_000,
          now: () => new Date(nowMs),
        },
      );

      const renewals = prepareSpy.mock.calls.filter(([sql]) =>
        sql.includes('SET updated_at = ?, lease_expires_at = ?'));
      expect(renewals).toHaveLength(2);
    } finally {
      prepareSpy.mockRestore();
    }
  });

  it('stops stale work at its next checkpoint after a replacement takes ownership', async () => {
    vi.useFakeTimers();
    const startedAt = Date.parse('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(startedAt);
    const db = makeD1();
    await createTestJob(db, 'job-overlap');
    expect(await claimPipelineJob(
      db as any,
      'job-overlap',
      1,
      new Date(startedAt).toISOString(),
      'stale-owner',
      100,
    )).toEqual({ outcome: 'claimed', token: 'stale-owner' });

    let staleMutationRan = false;
    try {
      await expect(runWithPipelineJobLease(
        db as any,
        'job-overlap',
        'stale-owner',
        async (checkpoint) => {
          vi.setSystemTime(startedAt + 100);
          expect(await claimPipelineJob(
            db as any,
            'job-overlap',
            2,
            new Date().toISOString(),
            'replacement-owner',
            100,
          )).toEqual({ outcome: 'claimed', token: 'replacement-owner' });
          await checkpoint();
          staleMutationRan = true;
        },
        { leaseMs: 100, heartbeatMs: 90 },
      )).rejects.toBeInstanceOf(PipelineJobOwnershipLostError);
      expect(staleMutationRan).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails a finalizer job and its run in one owner-fenced batch', async () => {
    const db = makeD1();
    await db.prepare(`
      INSERT INTO pipeline_runs (id, mode, started_at, status)
      VALUES ('run-finalizer-failure', 'topic-rebuild', '2026-01-01T00:00:00.000Z', 'running')
    `).run();
    await createPipelineJob(db as any, {
      id: 'job-finalizer-failure',
      runId: 'run-finalizer-failure',
      kind: 'topic-finalize-rebuild',
      semanticKey: 'topic-finalize-rebuild:run-finalizer-failure',
      payload: { kind: 'topic-finalize-rebuild', runId: 'run-finalizer-failure' },
      correlationId: 'corr-finalizer-failure',
      queuedAt: '2026-01-01T00:00:00.000Z',
    });
    const claim = await claimPipelineJob(
      db as any,
      'job-finalizer-failure',
      1,
      '2026-01-01T00:01:00.000Z',
      'finalizer-failure-owner',
    );
    expect(claim).toEqual({ outcome: 'claimed', token: 'finalizer-failure-owner' });
    expect(await failPipelineJobAndRun(db as any, {
      jobId: 'job-finalizer-failure',
      runId: 'run-finalizer-failure',
      claimToken: 'finalizer-failure-owner',
      error: new Error('permanent finalizer failure'),
      now: '2026-01-01T00:02:00.000Z',
    })).toBe(true);
    expect((await getPipelineJob(db as any, 'job-finalizer-failure'))?.status).toBe('failed');
    expect((await db.prepare('SELECT status FROM pipeline_runs WHERE id = ?')
      .bind('run-finalizer-failure').first<{ status: string }>())?.status).toBe('failed');
  });

  it('recovers when a claim commits before a retryable connection error', async () => {
    const db = makeD1();
    await createTestJob(db, 'job-ambiguous');
    const flaky = commitThenThrowOnce(db);

    expect(await claimPipelineJob(
      flaky as any,
      'job-ambiguous',
      1,
      '2026-01-01T00:01:00.000Z',
      'ambiguous-owner',
    )).toEqual({ outcome: 'claimed', token: 'ambiguous-owner' });
    expect((await getPipelineJob(db as any, 'job-ambiguous'))?.claim_token).toBe('ambiguous-owner');
  });

  it('recognizes same-owner success after a committed update reports a connection error', async () => {
    const db = makeD1();
    await createTestJob(db, 'job-success-ambiguous');
    expect((await claimPipelineJob(
      db as any,
      'job-success-ambiguous',
      1,
      '2026-01-01T00:01:00.000Z',
      'success-owner',
    )).outcome).toBe('claimed');

    const flaky = commitThenThrowOnce(db, "SET status = 'succeeded'");
    expect(await succeedPipelineJob(
      flaky as any,
      'job-success-ambiguous',
      'success-owner',
      { ok: true },
    )).toBe(true);
    expect((await getPipelineJob(db as any, 'job-success-ambiguous'))?.status).toBe('succeeded');
  });

  it('recognizes same-owner failure after a committed update reports a connection error', async () => {
    const db = makeD1();
    await createTestJob(db, 'job-fail-ambiguous');
    expect((await claimPipelineJob(
      db as any,
      'job-fail-ambiguous',
      1,
      '2026-01-01T00:01:00.000Z',
      'fail-owner',
    )).outcome).toBe('claimed');

    const flaky = commitThenThrowOnce(db, "SET status = 'failed'");
    expect(await failPipelineJob(
      flaky as any,
      'job-fail-ambiguous',
      'fail-owner',
      new Error('permanent'),
    )).toBe(true);
    expect((await getPipelineJob(db as any, 'job-fail-ambiguous'))?.status).toBe('failed');
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

  it('PBT: generated job lifecycles agree with the durable state', async () => {
    const commands = fc.commands([
      fc.integer({ min: 1, max: 5 }).map(attempts => new ClaimCommand(attempts)),
      fc.constantFrom<'succeed' | 'fail' | 'defer'>('succeed', 'fail', 'defer')
        .map(transition => new CompleteCommand(transition)),
      fc.constant(new CrashCommand()),
      fc.integer({ min: 1, max: 20 }).map(minutes => new AdvanceTimeCommand(minutes)),
    ], { maxCommands: 25 });

    await fc.assert(fc.asyncProperty(commands, async (sequence) => {
      const db = makeD1();
      await createTestJob(db, 'job-model');

      await fc.asyncModelRun(
        () => ({
          model: { status: 'queued', ownerToken: null, leaseExpiresAt: null },
          real: {
            db,
            jobId: 'job-model',
            nowMs: Date.parse('2026-01-01T00:01:00.000Z'),
            claimSequence: 0,
          },
        }),
        sequence,
      );
    }));
  });
});

type JobModel = {
  status: PipelineJobStatus;
  ownerToken: string | null;
  leaseExpiresAt: number | null;
};
type JobReal = {
  db: ReturnType<typeof makeD1>;
  jobId: string;
  nowMs: number;
  claimSequence: number;
};

class ClaimCommand implements fc.AsyncCommand<JobModel, JobReal> {
  constructor(private readonly attempts: number) {}

  check(): boolean {
    return true;
  }

  async run(model: JobModel, real: JobReal): Promise<void> {
    const expected = model.status === 'queued'
      || model.status === 'deferred'
      || (model.status === 'processing'
        && model.leaseExpiresAt !== null
        && real.nowMs >= model.leaseExpiresAt);
    const token = `model-owner-${++real.claimSequence}`;
    const claim = await claimPipelineJob(
      real.db as any,
      real.jobId,
      this.attempts,
      new Date(real.nowMs).toISOString(),
      token,
    );
    if (expected) {
      expect(claim).toEqual({ outcome: 'claimed', token });
    } else if (model.status === 'processing') {
      expect(claim.outcome).toBe('active');
    } else {
      expect(claim).toEqual({ outcome: 'terminal' });
    }
    if (expected) {
      model.status = 'processing';
      model.ownerToken = token;
      model.leaseExpiresAt = real.nowMs + PIPELINE_JOB_LEASE_MS;
    }
    await expectJobStatus(real, model.status);
  }

  toString(): string {
    return `claim(${this.attempts})`;
  }
}

class CompleteCommand implements fc.AsyncCommand<JobModel, JobReal> {
  constructor(private readonly transition: 'succeed' | 'fail' | 'defer') {}

  check(model: Readonly<JobModel>): boolean {
    return model.status === 'processing' && model.ownerToken !== null;
  }

  async run(model: JobModel, real: JobReal): Promise<void> {
    switch (this.transition) {
      case 'succeed':
        await succeedPipelineJob(real.db as any, real.jobId, model.ownerToken!, { ok: true });
        model.status = 'succeeded';
        break;
      case 'fail':
        await failPipelineJob(real.db as any, real.jobId, model.ownerToken!, new Error('permanent'));
        model.status = 'failed';
        break;
      case 'defer':
        await deferPipelineJob(real.db as any, real.jobId, model.ownerToken!, new Error('transient'));
        model.status = 'deferred';
        break;
    }
    model.ownerToken = null;
    model.leaseExpiresAt = null;
    await expectJobStatus(real, model.status);
  }

  toString(): string {
    return this.transition;
  }
}

class CrashCommand implements fc.AsyncCommand<JobModel, JobReal> {
  check(model: Readonly<JobModel>): boolean {
    return model.status === 'processing' && model.ownerToken !== null;
  }

  async run(model: JobModel, real: JobReal): Promise<void> {
    model.ownerToken = null;
    await expectJobStatus(real, 'processing');
  }

  toString(): string {
    return 'crash';
  }
}

class AdvanceTimeCommand implements fc.AsyncCommand<JobModel, JobReal> {
  constructor(private readonly minutes: number) {}

  check(): boolean {
    return true;
  }

  async run(model: JobModel, real: JobReal): Promise<void> {
    real.nowMs += this.minutes * 60_000;
    await expectJobStatus(real, model.status);
  }

  toString(): string {
    return `advance(${this.minutes}m)`;
  }
}

async function createTestJob(db: ReturnType<typeof makeD1>, id: string): Promise<void> {
  await createPipelineJob(db as any, {
    id,
    runId: 'run-model',
    kind: 'embed-corpus-topics',
    semanticKey: id,
    payload: { keywords: ['model'] },
    correlationId: 'corr-model',
    queuedAt: '2026-01-01T00:00:00.000Z',
  });
}

async function expectJobStatus(real: JobReal, expected: PipelineJobStatus): Promise<void> {
  expect((await getPipelineJob(real.db as any, real.jobId))?.status).toBe(expected);
}

function commitThenThrowOnce(
  db: ReturnType<typeof makeD1>,
  sqlMarker = 'RETURNING claim_token',
): ReturnType<typeof makeD1> {
  let shouldThrow = true;
  return {
    ...db,
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        ...statement,
        bind(...params: unknown[]) {
          const bound = statement.bind(...params);
          return {
            ...bound,
            async first<T>() {
              const result = await bound.first<T>();
              if (shouldThrow && sql.includes('UPDATE pipeline_jobs') && sql.includes(sqlMarker)) {
                shouldThrow = false;
                throw new Error('network connection lost after commit');
              }
              return result;
            },
          };
        },
      };
    },
  };
}
