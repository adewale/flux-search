#!/usr/bin/env node
// Public read contract smoke: queue migration must not break these surfaces.
const base = process.env.FLUX_BASE_URL || 'https://flux-search.adewale-883.workers.dev';
const urls = [
  '/search?q=topic%3A%22trust%22&limit=3',
  '/topics?limit=3',
  '/issues/issue/214/sections',
  '/latest-issue',
];
const out = [];
for (const path of urls) {
  const res = await fetch(base + path);
  const body = await res.json().catch(() => null);
  out.push({ path, status: res.status, ok: res.ok, keys: body && typeof body === 'object' ? Object.keys(body).sort() : [] });
  if (!res.ok) process.exitCode = 1;
}
console.log(JSON.stringify({ ok: !process.exitCode, surfaces: out }, null, 2));
