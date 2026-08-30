import { retryD1Write } from './d1-retry';

export type PipelineJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'deferred';

export const PIPELINE_JOB_LEASE_MS = 15 * 60 * 1000;

export type PipelineJobClaim =
  | { outcome: 'claimed'; token: string }
  | { outcome: 'active'; retryAfterSeconds: number }
  | { outcome: 'terminal' };

export interface PipelineJobRow {
  id: string;
  run_id: string;
  kind: string;
  semantic_key: string;
  status: PipelineJobStatus;
  payload_json: string;
  attempts: number;
  attempt_count?: number;
  schema_version?: number;
  result_json?: string | null;
  last_error?: string | null;
  updated_at?: string | null;
  correlation_id: string;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  claim_token?: string | null;
  lease_expires_at?: string | null;
}

function sha256Hex(input: string): string {
  // FNV-1a fallback for tests/Workers code paths where sync WebCrypto is not
  // available. Idempotency only needs a stable compact key, not secrecy.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function stableKeywordKey(kind: string, keywords: string[]): string {
  const normalized = [...new Set(keywords.map(k => k.trim().toLowerCase()).filter(Boolean))].sort();
  return `${kind}:${sha256Hex(normalized.join('\n'))}`;
}

export function idempotencyKeyForMessage(message: { kind?: string; type?: string; keywords?: string[]; issueId?: string; contentHash?: string | null; runId?: string; run_id?: string; batchIndex?: number }): string {
  const kind = message.kind ?? message.type;
  if (kind === 'embed-corpus-topics' || kind === 'aggregate-topic-slice') {
    return stableKeywordKey(kind, message.keywords ?? []);
  }
  if (kind === 'topic-extract-batch') {
    return `topic-extract-batch:${message.runId ?? message.run_id}:${message.batchIndex ?? 'unknown'}`;
  }
  if (kind === 'topic-finalize-rebuild') {
    return `topic-finalize-rebuild:${message.runId ?? message.run_id}`;
  }
  if (kind === 'rebuild-issue-topics') {
    return `rebuild-issue-topics:${message.issueId}:${message.contentHash ?? 'no-hash'}`;
  }
  return `${kind ?? 'unknown'}:${sha256Hex(JSON.stringify(message))}`;
}

export async function createPipelineJob(
  db: D1Database,
  job: {
    id: string;
    runId: string;
    kind: string;
    semanticKey: string;
    payload: unknown;
    correlationId: string;
    queuedAt: string;
  },
): Promise<boolean> {
  try {
    await retryD1Write(() => db.prepare(`
      INSERT INTO pipeline_jobs
        (id, run_id, kind, semantic_key, status, payload_json, attempts, attempt_count, schema_version, correlation_id, queued_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, 0, 0, 1, ?, ?, ?)
    `).bind(
      job.id,
      job.runId,
      job.kind,
      job.semanticKey,
      JSON.stringify(job.payload),
      job.correlationId,
      job.queuedAt,
      job.queuedAt,
    ).run());
    return true;
  } catch (err) {
    if (String(err).toLowerCase().includes('unique')) return false;
    throw err;
  }
}

export async function claimPipelineJob(
  db: D1Database,
  jobId: string,
  attempts: number,
  now = new Date().toISOString(),
  claimToken = crypto.randomUUID(),
  leaseMs = PIPELINE_JOB_LEASE_MS,
): Promise<PipelineJobClaim> {
  const current = await db.prepare(`
    SELECT status, lease_expires_at, updated_at, started_at, queued_at
    FROM pipeline_jobs WHERE id = ?
  `).bind(jobId).first<{
    status: PipelineJobStatus;
    lease_expires_at: string | null;
    updated_at: string | null;
    started_at: string | null;
    queued_at: string;
  }>();
  if (!current) return { outcome: 'claimed', token: claimToken }; // Legacy/no-row messages remain processable.
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error(`Invalid pipeline claim timestamp: ${now}`);
  const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
  const staleBefore = new Date(nowMs - leaseMs).toISOString();
  const claimed = await retryD1Write(() => db.prepare(`
    UPDATE pipeline_jobs
    SET status = 'processing', attempts = ?, attempt_count = ?, started_at = COALESCE(started_at, ?),
        updated_at = ?, error = NULL, last_error = NULL, claim_token = ?, lease_expires_at = ?
    WHERE id = ? AND (
      status IN ('queued', 'deferred')
      OR (status = 'processing' AND claim_token = ?)
      OR (status = 'processing' AND lease_expires_at <= ?)
      OR (status = 'processing' AND lease_expires_at IS NULL AND COALESCE(updated_at, started_at, queued_at) <= ?)
    )
    RETURNING claim_token
  `).bind(
    attempts,
    attempts,
    now,
    now,
    claimToken,
    leaseExpiresAt,
    jobId,
    claimToken,
    now,
    staleBefore,
  ).first<{ claim_token: string }>());
  if (claimed?.claim_token === claimToken) return { outcome: 'claimed', token: claimToken };

  // Re-read after the conditional update: another claimant or completion may
  // have won between our initial read and write.
  const latest = await db.prepare(`
    SELECT status, lease_expires_at, updated_at, started_at, queued_at
    FROM pipeline_jobs WHERE id = ?
  `).bind(jobId).first<{
    status: PipelineJobStatus;
    lease_expires_at: string | null;
    updated_at: string | null;
    started_at: string | null;
    queued_at: string;
  }>();
  if (!latest || latest.status === 'succeeded' || latest.status === 'failed') {
    return { outcome: 'terminal' };
  }
  const leaseDeadline = Date.parse(
    latest.lease_expires_at
      ?? latest.updated_at
      ?? latest.started_at
      ?? latest.queued_at,
  ) + (latest.lease_expires_at ? 0 : leaseMs);
  const retryAfterSeconds = Number.isFinite(leaseDeadline)
    ? Math.max(1, Math.ceil((leaseDeadline - nowMs) / 1000))
    : Math.ceil(leaseMs / 1000);
  return { outcome: 'active', retryAfterSeconds };
}

export async function succeedPipelineJob(
  db: D1Database,
  jobId: string,
  claimToken: string,
  result: unknown = null,
  now = new Date().toISOString(),
): Promise<boolean> {
  const updated = await retryD1Write(() => db.prepare(`
    UPDATE pipeline_jobs
    SET status = 'succeeded', completed_at = ?, finished_at = ?, updated_at = ?, result_json = ?,
        error = NULL, last_error = NULL, lease_expires_at = NULL
    WHERE id = ? AND claim_token = ? AND status = 'processing'
    RETURNING status
  `).bind(now, now, now, result == null ? null : JSON.stringify(result), jobId, claimToken)
    .first<{ status: 'succeeded' }>());
  if (updated != null) return true;
  // A D1 write may commit and then surface a retryable transport error. The
  // retry no longer matches `processing`, so confirm the same owner already
  // reached the requested terminal state before reporting failure.
  const current = await db.prepare(`
    SELECT status, claim_token FROM pipeline_jobs WHERE id = ?
  `).bind(jobId).first<{ status: PipelineJobStatus; claim_token: string | null }>();
  return current?.status === 'succeeded' && current.claim_token === claimToken;
}

export async function renewPipelineJobLease(
  db: D1Database,
  jobId: string,
  claimToken: string,
  now = new Date(),
  leaseMs = PIPELINE_JOB_LEASE_MS,
): Promise<boolean> {
  const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
  const updated = await retryD1Write(() => db.prepare(`
    UPDATE pipeline_jobs
    SET updated_at = ?, lease_expires_at = ?
    WHERE id = ? AND claim_token = ? AND status = 'processing'
    RETURNING status
  `).bind(now.toISOString(), leaseExpiresAt, jobId, claimToken)
    .first<{ status: 'processing' }>());
  return updated != null;
}

/**
 * Commit finalizer job success and its run-level completion in one D1 batch.
 * Both writes are fenced by the same claim token, so an expired owner cannot
 * complete a run after another delivery has reclaimed the job.
 */
export async function succeedPipelineJobAndCompleteRun(
  db: D1Database,
  input: {
    jobId: string;
    runId: string;
    claimToken: string;
    result: unknown;
    notes: unknown;
    now?: string;
  },
): Promise<boolean> {
  const now = input.now ?? new Date().toISOString();
  const resultJson = input.result == null ? null : JSON.stringify(input.result);
  const notes = input.notes == null ? null : JSON.stringify(input.notes);
  await retryD1Write(() => db.batch([
    db.prepare(`
      UPDATE pipeline_runs
      SET completed_at = ?, status = 'completed', notes = ?
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM pipeline_jobs
        WHERE id = ? AND run_id = ? AND claim_token = ? AND status = 'processing'
      )
    `).bind(now, notes, input.runId, input.jobId, input.runId, input.claimToken),
    db.prepare(`
      UPDATE pipeline_jobs
      SET status = 'succeeded', completed_at = ?, finished_at = ?, updated_at = ?, result_json = ?,
          error = NULL, last_error = NULL, lease_expires_at = NULL
      WHERE id = ? AND run_id = ? AND claim_token = ? AND status = 'processing'
    `).bind(now, now, now, resultJson, input.jobId, input.runId, input.claimToken),
  ]));

  const row = await db.prepare(`
    SELECT status, claim_token FROM pipeline_jobs WHERE id = ?
  `).bind(input.jobId).first<{ status: PipelineJobStatus; claim_token: string | null }>();
  return row?.status === 'succeeded' && row.claim_token === input.claimToken;
}

export async function failPipelineJob(
  db: D1Database,
  jobId: string,
  claimToken: string,
  error: unknown,
  now = new Date().toISOString(),
): Promise<boolean> {
  const updated = await retryD1Write(() => db.prepare(`
    UPDATE pipeline_jobs
    SET status = 'failed', completed_at = ?, finished_at = ?, updated_at = ?, error = ?, last_error = ?,
        last_error_kind = 'permanent', lease_expires_at = NULL
    WHERE id = ? AND claim_token = ? AND status = 'processing'
    RETURNING status
  `).bind(now, now, now, String(error), String(error), jobId, claimToken)
    .first<{ status: 'failed' }>());
  if (updated != null) return true;
  const current = await db.prepare(`
    SELECT status, claim_token FROM pipeline_jobs WHERE id = ?
  `).bind(jobId).first<{ status: PipelineJobStatus; claim_token: string | null }>();
  return current?.status === 'failed' && current.claim_token === claimToken;
}

/** Atomically fail a finalizer job and its parent run under one owner token. */
export async function failPipelineJobAndRun(
  db: D1Database,
  input: {
    jobId: string;
    runId: string;
    claimToken: string;
    error: unknown;
    now?: string;
  },
): Promise<boolean> {
  const now = input.now ?? new Date().toISOString();
  const error = String(input.error);
  await retryD1Write(() => db.batch([
    db.prepare(`
      UPDATE pipeline_runs
      SET completed_at = COALESCE(completed_at, ?), status = 'failed', notes = ?
      WHERE id = ? AND status != 'completed' AND EXISTS (
        SELECT 1 FROM pipeline_jobs
        WHERE id = ? AND run_id = ? AND claim_token = ? AND status = 'processing'
      )
    `).bind(now, error, input.runId, input.jobId, input.runId, input.claimToken),
    db.prepare(`
      UPDATE pipeline_jobs
      SET status = 'failed', completed_at = ?, finished_at = ?, updated_at = ?, error = ?, last_error = ?,
          last_error_kind = 'permanent', lease_expires_at = NULL
      WHERE id = ? AND run_id = ? AND claim_token = ? AND status = 'processing'
    `).bind(now, now, now, error, error, input.jobId, input.runId, input.claimToken),
  ]));

  const row = await db.prepare(`
    SELECT status, claim_token FROM pipeline_jobs WHERE id = ?
  `).bind(input.jobId).first<{ status: PipelineJobStatus; claim_token: string | null }>();
  return row?.status === 'failed' && row.claim_token === input.claimToken;
}

export async function failPipelineRunIfPresent(db: D1Database, runId: string, error: unknown, now = new Date().toISOString()): Promise<void> {
  await retryD1Write(() => db.prepare(`
    UPDATE pipeline_runs
    SET completed_at = COALESCE(completed_at, ?), status = 'failed', notes = ?
    WHERE id = ? AND status != 'completed'
  `).bind(now, String(error), runId).run());
}

export async function deferPipelineJob(
  db: D1Database,
  jobId: string,
  claimToken: string,
  error: unknown,
  now = new Date(),
): Promise<boolean> {
  const nextAttemptAt = new Date(now.getTime() + 60_000).toISOString();
  const updated = await retryD1Write(() => db.prepare(`
    UPDATE pipeline_jobs
    SET status = 'deferred', error = ?, last_error = ?, last_error_kind = 'transient', updated_at = ?,
        next_attempt_at = ?, lease_expires_at = NULL
    WHERE id = ? AND claim_token = ? AND status = 'processing'
    RETURNING status
  `).bind(String(error), String(error), now.toISOString(), nextAttemptAt, jobId, claimToken)
    .first<{ status: 'deferred' }>());
  if (updated != null) return true;
  const current = await db.prepare(`
    SELECT status, claim_token FROM pipeline_jobs WHERE id = ?
  `).bind(jobId).first<{ status: PipelineJobStatus; claim_token: string | null }>();
  return current?.status === 'deferred' && current.claim_token === claimToken;
}

export async function getPipelineJob(db: D1Database, jobId: string): Promise<PipelineJobRow | null> {
  return db.prepare('SELECT * FROM pipeline_jobs WHERE id = ?').bind(jobId).first<PipelineJobRow>();
}

export async function listPipelineJobs(db: D1Database, runId: string, limit = 100): Promise<PipelineJobRow[]> {
  const rows = await db.prepare(`
    SELECT * FROM pipeline_jobs WHERE run_id = ? ORDER BY queued_at DESC LIMIT ?
  `).bind(runId, limit).all<PipelineJobRow>();
  return rows.results;
}

export async function recordPipelinePhase(
  db: D1Database,
  input: { runId: string; jobId?: string | null; phase: string; status: 'running' | 'succeeded' | 'failed'; summary?: unknown; error?: unknown },
): Promise<void> {
  const now = new Date().toISOString();
  await retryD1Write(() => db.prepare(`
    INSERT INTO pipeline_phases
      (id, job_id, run_id, name, phase, started_at, completed_at, finished_at, status, elapsed_ms, error, error_count, summary_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.jobId ?? input.runId,
    input.runId,
    input.phase,
    input.phase,
    now,
    input.status === 'running' ? null : now,
    input.status === 'running' ? null : now,
    input.status,
    input.error == null ? null : String(input.error),
    input.error == null ? 0 : 1,
    input.summary == null ? null : JSON.stringify(input.summary),
  ).run());
}

export async function activeDuplicateCount(db: D1Database): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS c FROM (
      SELECT semantic_key FROM pipeline_jobs
      WHERE status IN ('queued', 'processing', 'deferred')
      GROUP BY semantic_key HAVING COUNT(*) > 1
    )
  `).first<{ c: number }>();
  return row?.c ?? 0;
}
