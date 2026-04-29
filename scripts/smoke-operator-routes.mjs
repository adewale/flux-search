#!/usr/bin/env node
const base = process.env.FLUX_BASE_URL || 'https://flux-search.adewale-883.workers.dev';
const token = process.env.ADMIN_TOKEN;
if (!token) {
  console.log(JSON.stringify({ skipped: true, reason: 'ADMIN_TOKEN not set', routes: ['/admin/pipeline-runs'] }, null, 2));
  process.exit(0);
}
const headers = { Authorization: `Bearer ${token}` };
const started = Date.now();
const res = await fetch(base + '/admin/pipeline-runs?limit=1', { headers });
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(JSON.stringify({ ok: false, status: res.status, body }, null, 2));
  process.exit(1);
}
const run = body.runs?.[0];
let jobsStatus = null;
if (run?.id) {
  const jobsRes = await fetch(base + `/admin/pipeline-runs/${run.id}/jobs?limit=5`, { headers });
  jobsStatus = jobsRes.status;
  if (!jobsRes.ok) process.exit(1);
}
console.log(JSON.stringify({ ok: true, elapsed_ms: Date.now() - started, latest_run: run?.id ?? null, jobs_status: jobsStatus }, null, 2));
