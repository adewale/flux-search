# Non-LLM Topic Quality Experiments

This is a measurable backlog of non-LLM techniques for improving surfaced topic quality in Flux Search. Each experiment should be evaluated against:

- top-100 topic audit labels: `keep | review | reject`;
- typed labels: `theme | technology | person | place | organization | publication | event | boilerplate | generic`;
- issue-level gold set: expected top 5 topics for representative issues;
- negative set: phrases that must not surface (`signposts clues`, `editor note`, generic singletons);
- public-route invariant: every top-N topic detail page returns 200;
- D1 query-plan invariant for new hot paths.

## Metrics

Use these before/after metrics for every experiment:

1. **Precision@N** — fraction of top N corpus topics labeled `keep`.
2. **Reject@N** — fraction of top N labeled `reject`; target 0 for N=100.
3. **Review@N** — fraction of top N requiring editorial review; should trend down.
4. **Type mix@N** — distribution of topic types in `/topics`.
5. **Theme/technology precision@N** — precision after applying the intended `/topics` policy.
6. **Issue topic precision@5** — fraction of issue-level top 5 topics labeled good.
7. **Duplicate rate@N** — near-duplicate topic pairs in top N.
8. **Boilerplate leakage** — count of known boilerplate phrases surfaced anywhere public.
9. **Generic singleton leakage** — count of generic singleton terms in top N.
10. **Click coherence** — average pairwise overlap/coherence among issues behind a topic.
11. **Latency/rows-read** — route performance and D1 plan impact.

## Techniques to try

### 1. Typed topic classifier

Assign each candidate one deterministic type:

```text
theme | technology | person | place | organization | publication | event | boilerplate | generic
```

Signals:

- curated lists for known people, places, technologies, organizations;
- capitalization/proper-noun patterns from original text;
- phrase suffixes: `city`, `university`, `institute`, `models`, `learning`, `protocol`, etc.;
- gazetteer for countries/cities;
- section provenance;
- recurring-position behavior.

Measurable test:

- current review terms classify correctly:
  - `new york` → place
  - `new york city` → place
  - `united states` → place/geopolitical entity
  - `silicon valley` → place/technology-culture entity
  - `venkatesh rao` → person
  - `christopher alexander` → person
  - `cryptocurrency` → technology/theme

Expected impact:

- `/topics` can default to theme + technology without discarding useful entities.

### 2. Surface-specific ranking policy

Use different policies for different surfaces instead of one global topic ranking.

Examples:

- `/topics`: theme + technology first;
- issue rail: themes/technologies first, entities in separate block;
- related issues: use all types, but weight theme overlap higher;
- admin audit: show all types and suspicious terms.

Measurable test:

- Precision@50 for `/topics` improves after excluding/demoting people/places.
- Entity recall remains available via entity-specific surface or filter.

### 3. Corpus distinctiveness / IDF strengthening

Boost terms that are characteristic of Flux and demote terms common across general English or too broadly distributed.

Signals:

- document frequency floor and ceiling;
- IDF-like score inside the Flux corpus;
- optional external background frequency list, without LLMs;
- domain lexicon boost.

Measurable test:

- generic singleton leakage decreases;
- known domain topics outrank generic alternatives.

### 4. Phrase unithood with PMI or log-likelihood

Score whether words form a real phrase rather than accidental adjacency.

Candidate measures:

- pointwise mutual information;
- normalized PMI;
- Dunning log-likelihood ratio;
- Dice coefficient;
- t-score for frequent collocations.

Measurable test:

- meaningful phrases like `large language models`, `mental models`, `open source` outrank weak or accidental n-grams.
- low-unithood n-grams are demoted from top 100.

### 5. C-value / nested phrase handling

Handle nested terms such as:

- `new york` vs `new york city`;
- `language models` vs `large language models`;
- `machine learning` vs broader AI phrases.

C-value-style scoring rewards longer multi-word terms while penalizing phrases that mostly occur nested inside longer phrases.

Measurable test:

- near-duplicate rate@100 decreases;
- parent/child pairs only both surface when each has independent usage.

### 6. TopicRank-style candidate clustering

Cluster candidate phrases that refer to the same concept, then rank clusters rather than strings.

Signals:

- lexical similarity: Dice/Jaccard over tokens/stems;
- shared issue sets;
- phrase containment;
- co-occurrence patterns.

Measurable test:

- duplicate rate@100 decreases;
- cluster representative labels remain readable;
- top-N precision does not drop.

### 7. MultipartiteRank-style diversity penalty

After ranking, penalize candidates too similar to already selected higher-ranked candidates.

Use maximal marginal relevance-style selection:

```text
score = quality - λ * similarity_to_selected
```

Similarity can combine:

- token overlap;
- stem overlap;
- issue-set Jaccard;
- precomputed topic similarity.

Measurable test:

- top 50 contains fewer redundant variants;
- no loss in issue-topic precision@5.

### 8. Position-aware salience

Earlier mentions in essays/headings are usually more salient than later passing references.

Signals:

- first occurrence percentile;
- appears in lead essay title/headings;
- appears in opening summary/title;
- appears repeatedly across sections.

Measurable test:

- issue-level topic precision@5 improves;
- topics extracted from recurring footer/editorial furniture are not boosted.

### 9. Section-aware boilerplate detection

Detect terms that repeatedly appear in the same editorial structure rather than the issue content.

Signals:

- section entropy: terms appearing almost only in one recurring section/position are suspicious;
- issue-position entropy: same relative position in many issues;
- heading-only terms;
- terms surrounded by known boilerplate patterns.

Measurable test:

- boilerplate leakage remains 0;
- newly discovered boilerplate candidates appear in `/admin/topic-audit`.

### 10. Temporal burst scoring

Separate evergreen topics from burst topics.

Approaches:

- Kleinberg burst detection;
- z-score over quarterly counts;
- burst/evergreen labels;
- recency-weighted ranking for a separate “rising topics” surface.

Measurable test:

- low-document-frequency topics only surface when burst score is high or quality is strong;
- evergreen top topics remain stable across rebuilds.

### 11. Topic coherence scoring

A good topic should retrieve a coherent set of issues.

Coherence measures:

- UMass-style document co-occurrence among top associated terms;
- NPMI among related terms/issues;
- average pairwise topic overlap among issues containing the topic;
- average related-topic similarity.

Measurable test:

- low-coherence topics are demoted or flagged;
- related issue quality improves in manual review.

### 12. Entity-aware related issue weighting

Related issues currently use topic overlap. If entities and themes are mixed, place/person overlap may dominate incorrectly.

Policy:

```text
theme overlap weight > technology overlap weight > organization/person weight > place weight
```

Measurable test:

- hand-labeled related issue set improves;
- broad places like `united states` do not dominate relatedness.

### 13. Protected domain lexicon

Curate terms that should be allowed/boosted even if singleton or low-frequency.

Examples:

- `cryptocurrency`;
- `metacrisis`;
- `protocols` if editorially meaningful;
- named frameworks/authors relevant to Flux.

Measurable test:

- protected terms survive generic singleton filters;
- protected terms still need enough evidence to enter top surfaces.

### 14. Negative lexicon with reasons

Maintain a typed blocklist, not just a flat list.

Reasons:

```text
boilerplate_phrase | generic_singleton | section_heading | source_artifact | malformed | too_broad
```

Measurable test:

- admin audit can explain suppression;
- blocklist changes are regression-tested.

### 15. Human-in-the-loop audit set, non-LLM

Build a small labeled dataset and use it as the quality gate.

Artifacts:

- top 100 corpus topics labeled by status and type;
- 20 issues with expected top 5 topics;
- 20 query/topic pages with expected related issues;
- known bad phrase list;
- known good phrase list.

Measurable test:

- CI reports precision/recall-style metrics after every scoring change;
- scoring changes require before/after audit diffs.

## Recommended implementation order

1. **Typed topic classifier** — unlocks better surfacing without deleting useful entities.
2. **Surface-specific ranking policy** — `/topics` becomes theme/technology-first.
3. **Manual audit dataset** — makes quality measurable.
4. **Phrase unithood scoring** — improves multi-word phrase quality.
5. **Nested phrase handling** — reduces duplicates like parent/child place phrases.
6. **Coherence scoring** — demotes topics whose issue sets are incoherent.
7. **Diversity penalty** — improves top-N browsing quality.
8. **Section-aware boilerplate detection** — catches future `editor note`-style artifacts.
9. **Related issue type weighting** — improves recommendation quality.
10. **Temporal burst surface** — separates evergreen topics from emerging topics.

## Minimal next TDD slice

1. Add tests for deterministic type classification of current review items.
2. Add `topic_type` and `quality_score` fields or a `topic_metadata` table.
3. Update corpus rebuild to classify topics.
4. Change `/topics` default to `theme + technology`, with `?type=all` or `?type=place` available.
5. Add a top-100 audit command that reports Precision@N, Review@N, Reject@N, and Type mix@N.
