# Domain-Distinctive Topic Ranking

## Goal

Improve public topic quality by surfacing phrases that are **more characteristic of The FLUX Review than of general English**.

This is not the same as the current in-corpus distinctiveness score. The current score asks:

```text
Is this topic too common inside Flux?
```

The new score asks:

```text
Is this topic unusually common in Flux compared with ordinary English/prose?
```

This should demote generic recurring phrases such as `many americans`, `complex times`, `world war`, and `air force` without deleting legitimate domain topics, book titles, publications, or editorially protected phrases such as `crypto`, `Rest of World`, `Not Boring`, `Crooked Timber`, and `Simple Habits for Complex Times`.

## Problem

Recent topic-quality work removed specific artifacts and malformed phrases, but did not solve the main ranking issue:

- blocklists remove known bad strings one at a time;
- the corpus doc-frequency floor already filters one-off topics from `/topics`;
- many weak phrases are recurring enough inside Flux to pass local thresholds;
- the system does not know whether a phrase is common in ordinary English.

Examples:

```text
systems thinking      — common in Flux, uncommon in general English → good
many americans        — recurring in Flux, common in general prose/news → weak
mental models         — characteristic of Flux → good
complex times         — generic unless protected as part of a full book title
```

## Conceptual model

This is a background-adjusted TF-IDF / termhood / weirdness score.

For each candidate topic:

```text
flux_rate = topic_doc_frequency / total_active_flux_issues
background_rate = estimated general-English phrase probability/commonness

domain_distinctiveness = log(flux_rate / background_rate)
```

In practice we may not have exact phrase probabilities, so the first version can estimate background commonness from token frequencies:

```text
background_commonness = aggregate_zipf_frequency(content_tokens)
domain_boost = f(flux_rate, background_commonness, protected_status)
```

The score should initially be a **ranking/demotion feature**, not a hard suppression gate.

## Where this belongs in the pipeline

The highest-leverage insertion point is after corpus aggregation has computed document frequency, but before final public ranking is settled:

```text
per-issue extraction
→ cross-issue candidate floor
→ issue_topics persistence
→ buildCorpusTopics aggregation
→ apply domain-distinctiveness boost/penalty   ← add here
→ nested phrase pruning / clustering
→ timeline
→ confidence/burst annotation
```

Why here:

- we know `doc_frequency` and total active issue count;
- we can compare corpus-level recurrence against a background model;
- we avoid penalizing local issue extraction too early;
- existing public APIs can continue sorting by `aggregate_score`.

Implementation location:

```text
src/lib/domain-distinctiveness.ts       # pure scoring helpers + tests
src/db/topic-queries.ts                 # apply boost after corpus_topics insert
migrations/00XX_domain_distinctiveness.sql  # optional columns/table
```

Optional schema additions:

```sql
ALTER TABLE corpus_topics ADD COLUMN background_commonness REAL;
ALTER TABLE corpus_topics ADD COLUMN domain_distinctiveness REAL;
ALTER TABLE corpus_topics ADD COLUMN domain_adjusted_score REAL;
```

If we want to avoid schema churn initially, update `aggregate_score` in place and expose diagnostics only through `/admin/topic-audit`.

## Scoring v1

### Inputs

For each topic:

```ts
interface DomainDistinctivenessInput {
  keyword: string;
  docFrequency: number;
  totalIssues: number;
  ngramSize: number;
  protectedTopic: boolean;
}
```

Background frequency table:

```ts
interface BackgroundFrequency {
  /** Zipf-like frequency where higher means more common in general English. */
  zipf(term: string): number | null;
}
```

### Token handling

- lowercase;
- split on whitespace/hyphen;
- remove shallow function words for phrase commonness, except when matching protected full phrases;
- keep content words such as `systems`, `thinking`, `language`, `models`, `americans`.

### Background commonness estimate

For v1:

```text
commonness = max(zipf(content_tokens)) or average(top 2 zipf tokens)
```

Rationale: a phrase with very common words should be treated cautiously unless it is protected or has strong Flux recurrence.

Examples:

```text
many americans → high background commonness → penalty
systems thinking → moderate/low background commonness → boost or no penalty
large language models → protected/domain phrase → boost/floor
```

### Boost function

Use a bounded multiplier so one signal cannot dominate ranking:

```text
raw = log1p(flux_rate * 100) - λ * max(0, background_commonness - baseline)
boost = clamp(exp(raw / scale), 0.35, 2.5)
```

Protected topics get a floor:

```text
if protectedTopic:
  boost = max(boost, 1.0)
```

This preserves editorially meaningful terms even if they contain common words:

```text
crypto
rest of world
not boring
crooked timber
simple habits for complex times
seeing like a state
```

## TDD plan

### Unit tests

Create `test/domain-distinctiveness.test.ts`.

Red tests:

```ts
expect(score('systems thinking')).toBeGreaterThan(score('many americans'));
expect(score('mental models')).toBeGreaterThan(score('complex times'));
expect(score('open source')).toBeGreaterThan(score('air force'));
expect(score('large language models')).toBeGreaterThan(score('world war'));
```

Protected topic tests:

```ts
expect(score('crypto')).toBeGreaterThanOrEqual(1.0);
expect(score('rest of world')).toBeGreaterThanOrEqual(1.0);
expect(score('not boring')).toBeGreaterThanOrEqual(1.0);
expect(score('crooked timber')).toBeGreaterThanOrEqual(1.0);
expect(score('simple habits for complex times')).toBeGreaterThanOrEqual(1.0);
```

Property tests:

- boost is always bounded;
- unknown words do not produce `NaN`;
- increasing `docFrequency` never lowers the score, all else equal;
- protected topics never receive a below-1 multiplier.

### Integration tests

Add/extend `test/topic-queries.test.ts`:

```text
Given equal document frequency:
- `systems thinking` ranks above `many americans`
- `mental models` ranks above `complex times`
```

Add admin/audit diagnostics test if `/admin/topic-audit` exposes:

```text
background_commonness
domain_distinctiveness
domain_boost
```

## Measurement plan

Before and after every rebuild, report:

1. total surfaced topics;
2. top 20 topics;
3. bottom 30 topics;
4. current manual worst-20 list presence;
5. Precision@100 / Review@100 / Reject@100 from manual audit;
6. count of generic phrase leakage;
7. median domain boost for kept vs reviewed/rejected topics.

Expected first-pass improvement:

- generic recurring phrases sink out of top 100;
- protected domain/book/publication phrases remain available;
- no increase in boilerplate/artifact leakage;
- public topic pages for protected topics remain 200.

## Background/reference corpus candidates

We need a permissively licensed source of general-English frequencies. The key licensing requirement is that generated frequency tables can be checked into this repository and used in a deployed commercial/noncommercial Cloudflare Worker without copyleft obligations or unclear redistribution restrictions.

### Candidate A — Build our own from public-domain Project Gutenberg texts

Source:

```text
Project Gutenberg public-domain ebooks
https://www.gutenberg.org/
```

License posture:

- many texts are public domain in the United States;
- Project Gutenberg metadata and trademark terms require care;
- safest route is to use only works explicitly marked public domain in the US and store generated frequencies with provenance;
- do not redistribute Gutenberg headers/footers or book text, only derived aggregate counts.

Pros:

- permissive/public-domain source if curated carefully;
- no dependency on opaque package data;
- easy to document and reproduce;
- aggregate frequencies are small and deployable.

Cons:

- literary/public-domain English skews old;
- less representative of modern web/news language;
- requires a small reproducible build script and source manifest.

Recommendation:

- good first permissive baseline;
- combine with a modern permissive corpus later if needed.

### Candidate B — Standard Ebooks public-domain corpus

Source:

```text
Standard Ebooks
https://standardebooks.org/
https://github.com/standardebooks
```

License posture:

- Standard Ebooks produces carefully cleaned editions of public-domain works;
- repo/code/artifacts may have project-specific licensing, but the underlying texts are public domain in the US;
- verify current repository license and reuse terms before vendoring anything;
- safest route is again to store only derived aggregate frequencies plus a source manifest.

Pros:

- cleaner text than raw Gutenberg;
- reproducible via GitHub repositories;
- public-domain literary baseline.

Cons:

- also older/literary;
- repository structure and licensing must be verified per source.

Recommendation:

- strongest candidate for a clean v1 background if license verification passes.

### Candidate C — wordfreq Python package frequency data

Source:

```text
wordfreq
https://github.com/rspeer/wordfreq
```

License posture:

- package code is Apache-2.0;
- the distributed frequency data is mixed-source;
- the package notice says the data includes files redistributable under Creative Commons Attribution-ShareAlike 4.0;
- listed sources include Google Books Ngrams, Leeds Internet Corpus, Wikipedia, ParaCrawl, OpenSubtitles, SUBTLEX lists, and Twitter-derived aggregate statistics;
- this is usable with attribution/share-alike obligations, but is not the cleanest fit for a strictly permissive vendored production table.

Pros:

- excellent modern general-language coverage;
- Zipf frequencies are exactly the feature we want;
- supports many forms/phrases better than a simple word list;
- good calibration source for experiments.

Cons:

- mixed-source data creates attribution/share-alike obligations;
- Python dependency/build step, not native to the Worker runtime;
- vendoring a derived subset would still need license/attribution handling.

Recommendation:

- use locally for calibration and to validate scoring formulas;
- avoid vendoring production data unless we are comfortable with CC BY-SA-style obligations and include notices.

### Candidate D — Wikipedia dumps

Source:

```text
Wikimedia dumps
https://dumps.wikimedia.org/
https://dumps.wikimedia.org/enwiki/latest/
```

Relevant dump files:

```text
enwiki-latest-pages-articles-multistream.xml.bz2
enwiki-latest-pages-articles-multistream-index.txt.bz2
```

The multistream dump is the practical choice because it can be processed in chunks using the index. A frequency builder would need to strip MediaWiki markup/templates/tables/references before tokenization.

License posture:

- Wikimedia's dump license page says original textual content is generally under GFDL and Creative Commons Attribution-ShareAlike 4.0;
- Wikimedia content may be freely used, including commercially, but attribution and share-alike obligations apply;
- dumps may contain exceptions, fair-use material, and possible unresolved infringements;
- Wikidata structured data is CC0, but Wikipedia article text is not;
- derived frequency tables from article text may still raise attribution/share-alike questions.

Pros:

- modern broad-knowledge language;
- very large and current;
- article text is closer to explainer/newsletter prose than old public-domain fiction;
- useful for detecting general named entities and broad phrases.

Cons:

- CC BY-SA/GFDL is not “permissive” in the MIT/Apache/BSD sense;
- attribution/share-alike obligations are awkward for a checked-in derived table;
- heavy preprocessing required to remove markup and encyclopedic boilerplate;
- encyclopedic bias may over-penalize legitimate Flux topics that are also Wikipedia-common, e.g. `climate change`, `machine learning`, `open source`.

Recommendation:

- acceptable as an experimental/calibration corpus if we keep attribution and do not vendor derived data into production;
- avoid as the first production background table if the requirement is permissively licensed data.

### Candidate E — Common Crawl / web-scale corpora

Source:

```text
Common Crawl
https://commoncrawl.org/
```

License posture:

- crawl data availability does not grant copyright permission for page contents;
- unsuitable as a clean permissive source for vendored frequency tables without legal review.

Recommendation:

- avoid for this use.

### Candidate F — COCA/BNC/Brown/SUBTLEX and academic corpora

License posture:

- typically commercial, academic-only, registration-bound, or otherwise redistribution-restricted.

Recommendation:

- avoid for production unless a specific dataset is verified as permissive.

### Candidate G — npm equivalents of Python `wordfreq`

The closest npm package found is:

```text
nodewordfreq
https://www.npmjs.com/package/nodewordfreq
https://github.com/realchendahuang/nodewordfreq
```

Package facts from npm:

```text
version: 0.2.1
license field: Apache-2.0
unpacked size: ~60 MB
description: TypeScript/Node.js port of wordfreq with built-in frequency data and Zipf APIs
```

API advertised by the package:

```ts
import { wordFrequency, zipfFrequency, tokenize } from 'nodewordfreq';

zipfFrequency('frequency', 'en');
wordFrequency('café', 'fr');
```

Important licensing detail:

- `nodewordfreq` reuses the original Python `wordfreq` data files directly;
- its `NOTICE.md` says data includes Creative Commons Attribution-ShareAlike 4.0 material and other attributed sources;
- therefore the npm package is convenient, but it does **not** solve the permissive-data problem.

Operational fit:

- not suitable for Worker runtime dependency as-is: package is large (~60 MB unpacked) and includes native-ish/tokenization dependencies such as `nodejieba`;
- could be used in an offline script to sample Zipf frequencies and generate a tiny table for experiments;
- production vendoring still inherits the data-license question.

Other npm search results for `word frequency`, `zipf`, and `wordfreq` were mostly unrelated packages. No mature, small, permissively licensed npm equivalent to Python `wordfreq` was identified.

Recommendation after product decision:

- use `nodewordfreq` as an offline build/calibration dependency;
- do not add it as a Worker runtime dependency;
- preserve attribution/share-alike notices for the generated table;
- keep the runtime API isolated so we can swap in a public-domain/CC0 table later if needed.

## Chosen source path

We will use `nodewordfreq` as an **offline calibration/build tool** and provide attribution/share-alike notices. This is an intentional product decision: the quality benefit of modern `wordfreq` data is worth the attribution obligations, and the package will not be bundled into the Worker runtime.

Generated/runtime artifacts:

```text
scripts/build-background-frequency.mjs      # offline builder; imports nodewordfreq
src/lib/background-frequency.generated.ts   # tiny generated table imported by Worker
data/background/manifest.json               # structured generation/source provenance
docs/background-frequency-attribution.md    # attribution/license notes
```

NPM command:

```bash
npm run build:background-frequency
```

Generation rules:

- collect current/protected candidate topic phrases and their content tokens;
- call `zipfFrequency(term, 'en')` from `nodewordfreq`;
- write a compact TypeScript object of English Zipf frequencies;
- write a structured manifest with generator, source package/version, output hash, and attribution pointer;
- do not import `nodewordfreq` from Worker code.

Generated table example:

```ts
export const BACKGROUND_ZIPF_EN: Readonly<Record<string, number>> = {
  "many americans": 4.8,
  "systems thinking": 4.85,
  "many": 5.91,
  "americans": 4.83,
  "systems": 5.07,
  "thinking": 5.24
};
```

The runtime commonness estimate uses both exact phrase frequency and token frequency. This matters because exact phrase estimates alone can underrate generic constructions; e.g. `many americans` is also generic because its component words are common.

Potential future path:

- if attribution/share-alike obligations become a problem, replace the generated table with a public-domain/CC0 table from Standard Ebooks/Gutenberg and keep the same runtime API.

## Acceptance criteria

- Tests prove domain-distinctive phrases outrank generic phrases at equal/local-comparable Flux frequency.
- Protected topics are not penalized below neutral.
- `/topics` top 100 has lower manual Review@100/Reject@100 than the current baseline.
- No public protected topic route regresses:

```text
/topics/crypto
/topics/rest%20of%20world
/topics/not%20boring
/topics/crooked%20timber
/topics/simple%20habits%20for%20complex%20times
```

- Background data has a documented source manifest and license note.
