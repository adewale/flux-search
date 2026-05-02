# Topic Operations Playbook

_Last updated: 2026-05-01_

This playbook covers routine topic-pipeline operations and incident response.

## Prerequisites

- Wrangler must be authenticated to the account that owns `flux-search-db`.
- `ADMIN_TOKEN` must be set locally for authenticated admin routes.
- If the token has ever been pasted into chat/logs, rotate it before use.

Check Wrangler identity:

```bash
npx wrangler whoami
npx wrangler d1 list
```

## Routine full rollout

Use after topic extraction, topic quality, schema, or queue changes:

```bash
ADMIN_TOKEN="$ADMIN_TOKEN" npm run rollout:topic-quality
```

This runs:

1. Wrangler identity check;
2. D1 list/auth check;
3. remote D1 migrations;
4. Worker deploy;
5. authenticated queue-backed topic rebuild smoke;
6. public route smoke;
7. topic-quality benchmark;
8. timestamped report output.

Reports are written to:

```text
reports/topic-quality-rollout/<timestamp>/
```

## Benchmark only

```bash
npm run benchmark:topic-quality
```

This checks:

- public corpus topic count;
- top 20 topics;
- protected topic presence;
- known-bad topic leakage;
- issue gold hits@5;
- protected route status/content type;
- bad route status/content type.

## Rebuild only

```bash
ADMIN_TOKEN="$ADMIN_TOKEN" npm run smoke:admin-topic-rebuild
```

Expected success shape:

```text
ok: true
latest_run.status: completed
jobs_by_status.succeeded: all jobs
failures: []
```

## Inspect pipeline runs

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://flux-search.adewale-883.workers.dev/admin/pipeline-runs?limit=5"
```

Inspect a run:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://flux-search.adewale-883.workers.dev/admin/pipeline-runs/$RUN_ID"
```

Inspect jobs:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://flux-search.adewale-883.workers.dev/admin/pipeline-runs/$RUN_ID/jobs?limit=500"
```

## Interpret job states

| State | Meaning | Operator action |
| --- | --- | --- |
| `queued` | Job is waiting for queue delivery | Usually wait |
| `processing` | Job has been claimed | Wait briefly; inspect if stale |
| `succeeded` | Job completed and recorded result | None |
| `deferred` | Retryable failure; next attempt scheduled | Inspect if old/repeated |
| `failed` | Permanent failure | Inspect error and replay/fix |

## Replay a job

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://flux-search.adewale-883.workers.dev/admin/pipeline-jobs/$JOB_ID/replay"
```

DLQ replay route:

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://flux-search.adewale-883.workers.dev/admin/queue/dlq/$JOB_ID/replay"
```

## If a rebuild stalls

1. Inspect latest runs.
2. Inspect jobs for the latest run.
3. Count job statuses.
4. If extract jobs are still queued/processing, wait for queue delivery.
5. If finalize is deferred with “waiting for topic extract batches,” verify extract jobs are still active; this is usually normal retry behavior.
6. If jobs are failed, inspect `last_error` / `error`.
7. Replay failed jobs if the error was transient.
8. Re-run benchmark after recovery.

## If public topics look wrong

Run:

```bash
npm run benchmark:topic-quality
```

Then inspect:

```bash
curl -s "https://flux-search.adewale-883.workers.dev/topics?limit=20" | jq
```

Check common invariants:

- topic count is near the current documented count in `docs/topic-system-status.md`;
- known-bad topics are absent;
- protected topics are present;
- `crypto` and `cryptocurrency` are not adjacent at the top;
- high-impact topics have `topic_type` values.

## If D1 auth fails

Typical error:

```text
code 7403: The given account is not valid or is not authorized
```

Fix:

```bash
unset CLOUDFLARE_API_TOKEN # if stale/wrong
npx wrangler logout
npx wrangler login
npx wrangler whoami
npx wrangler d1 list
```

Then retry migrations or rollout.

## If CI fails because `data/processed` is missing

CI now runs:

```bash
npm run corpus:process
```

before tests. If this regresses, restore that workflow step. The gold topic tests depend on generated processed corpus files, while `data/raw/` is the checked-in source.

## If a Worker CPU limit appears again

Do not move more work back into `waitUntil()` or a monolithic route. Split the work into queue jobs or precompute offline. `waitUntil()` is not durable execution; it still has Worker CPU limits.

## Security

Rotate `ADMIN_TOKEN` after exposure:

```bash
openssl rand -base64 32
npx wrangler secret put ADMIN_TOKEN
export ADMIN_TOKEN='new-token'
```
