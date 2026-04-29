#!/usr/bin/env node
/**
 * Queue/topic characterization smoke script.
 *
 * With ADMIN_TOKEN set, samples production admin endpoints and prints a compact
 * before/after-friendly JSON block. Without ADMIN_TOKEN, it still reports the
 * local code-level queue contract so CI/dev can run it safely.
 */

const base = process.env.FLUX_BASE_URL || 'https://flux-search.adewale-883.workers.dev';
const token = process.env.ADMIN_TOKEN;

async function getJson(path) {
  if (!token) return null;
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { error: `${res.status} ${res.statusText}` };
  return res.json();
}

const started = Date.now();
const [healthRes, runs, coverage] = await Promise.all([
  fetch(base + '/health').then(r => r.json()).catch(err => ({ error: String(err) })),
  getJson('/admin/pipeline-runs?limit=5'),
  getJson('/admin/coverage'),
]);

const latestRun = runs && !('error' in runs) ? runs.runs?.[0] : null;
const jobs = latestRun ? await getJson(`/admin/pipeline-runs/${latestRun.id}/jobs?limit=500`) : null;

const jobRows = jobs && !('error' in jobs) ? jobs.jobs ?? [] : [];
const byStatus = jobRows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  base,
  elapsed_ms: Date.now() - started,
  health: healthRes,
  admin_sampled: Boolean(token),
  coverage,
  latest_pipeline_run: latestRun,
  latest_job_count: jobRows.length,
  latest_jobs_by_status: byStatus,
  queue_contract: {
    message_versioned: true,
    durable_jobs: true,
    idempotency_keys: true,
    dlq_replay_route: '/admin/dlq/replay',
    jobs_route: '/admin/pipeline-runs/:id/jobs',
  },
}, null, 2));
