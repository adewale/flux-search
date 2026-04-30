# Topic quality rollout scripts

Use this reusable operator workflow after topic-quality, topic-pipeline, or correct-by-construction changes.

## Full rollout

```bash
ADMIN_TOKEN="$ADMIN_TOKEN" npm run rollout:topic-quality
```

This runs:

1. `wrangler whoami`
2. `wrangler d1 list`
3. remote D1 migrations
4. Worker deploy
5. authenticated topic rebuild smoke
6. public route smoke
7. topic-quality benchmark
8. timestamped report output

Reports are written to:

```text
reports/topic-quality-rollout/<timestamp>/
```

## Common variants

Deploy and benchmark without rebuild:

```bash
npm run rollout:topic-quality -- --skip-rebuild
```

Benchmark current production only:

```bash
npm run rollout:topic-quality -- --skip-migrations --skip-deploy --skip-rebuild
```

Dry-run command plan:

```bash
npm run rollout:topic-quality -- --dry-run --skip-rebuild
```

## Standalone benchmark

```bash
npm run benchmark:topic-quality
```

This reports:

- corpus topic count;
- top 20 topics;
- protected topic presence;
- known bad topic leakage;
- 25-issue gold-set hits@5 from public issue pages;
- protected and blocked route statuses.

## D1 auth prerequisite

If D1 migration fails with Cloudflare `7403`, fix Wrangler identity first:

```bash
unset CLOUDFLARE_API_TOKEN # if stale/wrong
npx wrangler logout
npx wrangler login
npx wrangler whoami
npx wrangler d1 list
```
