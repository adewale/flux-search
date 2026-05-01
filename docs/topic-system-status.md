# Topic system status

_Last updated: 2026-04-30_

## Current production state

- Public corpus topics: **134**
- Latest queue-backed rebuild report: `reports/correct-by-construction/new-system-typed-corpus-deduped-ranking.json`
- Rebuild mechanism: **queue-backed by default** via `POST /admin/rebuild-topics`
- Monolithic Worker rebuild: **retired for production use** because it exceeded Cloudflare CPU limits during `extract_issue_topics`.

## Quality scorecard

| Metric | Old baseline | Current system | Change |
| --- | ---: | ---: | ---: |
| Public topic count | 127 | 134 | +7 |
| Issue gold average hits@5 | 2.64 | 3.40 | +0.76 |
| Minimum hits@5 | 0 | 2 | +2 |
| Issues with >=3 hits@5 | 15 / 25 | 21 / 25 | +6 issues |
| Issues with >=4 hits@5 | 5 / 25 | 12 / 25 | +7 issues |
| Known bad/artifact topics present | 0 | 0 | no regression |

Conclusion: the correct-by-construction topic path is yielding better public-topic and issue-topic results than the old system.

## Current top 10 topics

| Rank | Topic | Type | Doc frequency | Confidence |
| ---: | --- | --- | ---: | --- |
| 1 | crypto | technology | 95 | high |
| 2 | systems thinking | theme | 106 | high |
| 3 | large language models | technology | 80 | high |
| 4 | attention | theme | 62 | high |
| 5 | climate change | theme | 47 | high |
| 6 | mental models | theme | 34 | high |
| 7 | legibility | theme | 15 | high |
| 8 | machine learning | technology | 30 | high |
| 9 | exploration | theme | 33 | high |
| 10 | open source | technology | 30 | high |

## Current bottom 10 topics

Lowest aggregate-score topics are mostly legitimate low-frequency entities/concepts, not artifacts.

| Topic | Type | Doc frequency | Confidence | Notes |
| --- | --- | ---: | --- | --- |
| epic games | unknown | 3 | medium | likely organization |
| new zealand | unknown | 5 | medium | likely place |
| solar panels | unknown | 3 | medium | likely technology/theme |
| game of life | unknown | 4 | medium | ambiguous concept/title |
| wall street | unknown | 3 | medium | likely place/institutional metonym |
| financial times | unknown | 4 | medium | likely publication |
| department of defense | unknown | 3 | medium | likely organization |
| vaughn tan | unknown | 3 | medium | likely person |
| paul musgrave | unknown | 3 | medium | likely person |
| ned resnikoff | unknown | 3 | medium | likely person |

## Type coverage

Current `corpus_topics.topic_type` distribution:

| Type | Count |
| --- | ---: |
| unknown | 111 |
| theme | 11 |
| technology | 6 |
| publication | 3 |
| book | 2 |
| person | 1 |

Interpretation:

- High-impact topics are now typed.
- The long tail remains mostly `unknown`, which is acceptable when evidence is ambiguous.
- Obvious tail entities can be promoted into the registry as needed, but typing every tail topic has diminishing returns.

## Crypto / cryptocurrency policy

`crypto` and `cryptocurrency` remain separate canonical topics. This is intentional:

- `crypto` captures the broader web3/crypto ecosystem.
- `cryptocurrency` captures the narrower asset/currency concept.

To avoid visual redundancy, corpus aggregation demotes `cryptocurrency` in public ranking when both are present. It remains discoverable, but no longer appears beside `crypto` at the top of `/topics`.

## Rebuild architecture

The current production rebuild path is:

```text
/admin/rebuild-topics
  -> create pipeline_run
  -> build phrase lexicon
  -> enqueue topic-extract-batch jobs
  -> enqueue topic-finalize-rebuild job

topic-extract-batch
  -> extract bounded issue batch
  -> store constructed candidates in pipeline_jobs.result_json

topic-finalize-rebuild
  -> wait for extract batches
  -> apply cross-issue candidate floor
  -> persist issue_topics
  -> rebuild corpus_topics, timeline, annotations
  -> enqueue topic embedding jobs
  -> mark pipeline_run completed
```

This keeps each Worker invocation under CPU limits and makes full rebuilds resumable and inspectable.

## Remaining work

1. Increase `topic_type` coverage for obvious tail entities when it improves UI/audit quality.
2. Add a typed public topic view once public routes are ready to depend on `public_topics` in all environments.
3. Continue monitoring queue-backed rebuild runs; the old rollout gates remain useful as operational confidence criteria.
4. Rotate `ADMIN_TOKEN` whenever it is pasted into chat or logs.
