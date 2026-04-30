#!/usr/bin/env node
/**
 * Reusable topic-quality rollout runner.
 *
 * It packages the recurring operator workflow:
 *   1. verify Wrangler/D1 auth and optionally apply remote migrations;
 *   2. deploy the Worker;
 *   3. optionally trigger authenticated topic rebuild;
 *   4. benchmark public topic/issue quality;
 *   5. write timestamped reports.
 *
 * Usage:
 *   npm run rollout:topic-quality -- --skip-rebuild
 *   ADMIN_TOKEN=... npm run rollout:topic-quality
 *   npm run rollout:topic-quality -- --skip-migrations --skip-deploy --skip-rebuild
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const skipMigrations = args.has('--skip-migrations');
const skipDeploy = args.has('--skip-deploy');
const skipRebuild = args.has('--skip-rebuild');
const skipBenchmark = args.has('--skip-benchmark');
const dryRun = args.has('--dry-run');
const base = process.env.FLUX_BASE_URL || 'https://flux-search.adewale-883.workers.dev';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportDir = join('reports', 'topic-quality-rollout', timestamp);
mkdirSync(reportDir, { recursive: true });

function log(event, data = {}) {
  console.log(JSON.stringify({ event, ...data }, null, 2));
}

function run(command, commandArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    log('command_start', { command, args: commandArgs });
    if (dryRun) return resolve({ stdout: '', stderr: '', code: 0 });
    const child = spawn(command, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(opts.env || {}) },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; process.stdout.write(d); });
    child.stderr.on('data', d => { stderr += d; process.stderr.write(d); });
    child.on('close', code => {
      const payload = { command, args: commandArgs, code, stdout, stderr };
      writeFileSync(join(reportDir, `${opts.name || command.replace(/\W+/g, '-')}.log`), stdout + stderr);
      if (code === 0) {
        log('command_ok', { command, code });
        resolve(payload);
      } else {
        log('command_failed', { command, code });
        reject(Object.assign(new Error(`${command} ${commandArgs.join(' ')} failed with ${code}`), payload));
      }
    });
  });
}

async function fetchJson(path) {
  const res = await fetch(base + path);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, contentType: res.headers.get('content-type'), body };
}

async function smokePublicRoutes() {
  const routes = [
    '/topics?limit=5',
    '/topics/crypto',
    '/topics/seeing%20like%20a%20state',
    '/topics/rest%20of%20world',
    '/topics/not%20boring',
    '/topics/crooked%20timber',
    '/topics/simple%20habits%20for%20complex%20times',
    '/issues/issue/214',
    '/issues/issue/229',
    '/issues/issue/190',
  ];
  const results = [];
  for (const route of routes) {
    const res = await fetch(base + route, { headers: { accept: route.includes('?') ? 'application/json' : 'text/html' } });
    results.push({ route, status: res.status, contentType: res.headers.get('content-type') });
  }
  writeFileSync(join(reportDir, 'public-route-smoke.json'), JSON.stringify(results, null, 2));
  return results;
}

async function main() {
  log('topic_quality_rollout_start', { base, reportDir, skipMigrations, skipDeploy, skipRebuild, skipBenchmark, dryRun });

  await run('npx', ['wrangler', 'whoami'], { name: 'wrangler-whoami' });
  await run('npx', ['wrangler', 'd1', 'list'], { name: 'wrangler-d1-list' });

  if (!skipMigrations) {
    await run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'flux-search-db', '--remote'], { name: 'd1-migrations-remote' });
  }

  if (!skipDeploy) {
    await run('npm', ['run', 'deploy'], { name: 'deploy' });
  }

  if (!skipRebuild) {
    if (!process.env.ADMIN_TOKEN) {
      throw new Error('ADMIN_TOKEN is required unless --skip-rebuild is set');
    }
    await run('npm', ['run', 'smoke:admin-topic-rebuild'], {
      name: 'admin-topic-rebuild-smoke',
      env: {
        FLUX_BASE_URL: base,
        REBUILD_WAIT_SECONDS: process.env.REBUILD_WAIT_SECONDS || '30',
        QUEUE_POLL_SECONDS: process.env.QUEUE_POLL_SECONDS || '300',
      },
    });
  }

  const routeSmoke = await smokePublicRoutes();
  const topics = await fetchJson('/topics?limit=200');
  writeFileSync(join(reportDir, 'topics-public.json'), JSON.stringify(topics, null, 2));

  if (!skipBenchmark) {
    const bench = await run('node', ['scripts/benchmark-topic-quality.mjs'], { name: 'benchmark-topic-quality' });
    writeFileSync(join(reportDir, 'benchmark-topic-quality.json'), bench.stdout);
    if (existsSync('reports/correct-by-construction/new-system-local-benchmark.json')) {
      copyFileSync(
        'reports/correct-by-construction/new-system-local-benchmark.json',
        join(reportDir, 'new-system-local-benchmark.json'),
      );
    }
  }

  const failures = routeSmoke.filter(r => r.status >= 400);
  const summary = {
    ok: failures.length === 0,
    base,
    reportDir,
    routeFailures: failures,
    topicCount: topics.body?.topics?.length ?? null,
  };
  writeFileSync(join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
  log('topic_quality_rollout_result', summary);
  if (!summary.ok) process.exit(1);
}

main().catch(err => {
  log('topic_quality_rollout_failed', { message: err.message, stack: err.stack });
  process.exit(1);
});
