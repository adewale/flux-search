# Surfacing High-Quality Topics Without LLMs

This note summarizes non-LLM approaches from information retrieval, keyphrase extraction, topic modeling, terminology extraction, and corpus navigation that are relevant to Flux Search.

## Problem framing

Flux Search has a small, curated, long-running newsletter corpus: roughly weekly issues, long-form prose, recurring editorial sections, and strong authorial vocabulary. The product goal is not just keyword extraction; it is **topic surfacing for navigation**. A good surfaced topic should be:

- **salient** — important in the local issue or corpus;
- **specific** — not a generic word such as `people`, `world`, or `time`;
- **stable** — recurring enough to be useful, unless intentionally shown as a burst;
- **interpretable** — readable as a phrase or recognizable entity;
- **non-boilerplate** — not section furniture such as `editor note`;
- **non-redundant** — does not crowd the page with variants of the same idea;
- **typed** — theme, technology, person, place, organization, publication, etc.;
- **useful for navigation** — clicking it should lead to coherent neighboring issues.

The current system suppresses known boilerplate and generic singleton noise, but still mixes themes, technologies, places, and people in one `/topics` surface. Literature suggests that this is a taxonomy/ranking problem, not just a better stopword list problem.

## Relevant non-LLM literature and methods

### 1. Statistical keyphrase extraction

Classic unsupervised keyphrase extraction ranks candidate words/phrases by features such as frequency, position, casing, spread, and co-occurrence.

Representative methods:

- **TF-IDF** — strong baseline for corpus distinctiveness, but weak for multi-word phrase quality and tends to overvalue rare artifacts.
- **RAKE** — Rose et al. (2010). Extracts candidate phrases by stopword boundaries and ranks by word co-occurrence statistics. Good for speed and no training data, but sensitive to stopword/candidate boundaries.
- **YAKE** — Campos et al. (2020). Uses local document features: casing, position, frequency, sentence dispersion, and term relatedness. Good fit for per-issue extraction because it does not require a large external corpus.
- **KP-Miner** — El-Beltagy and Rafea (2009). Uses frequency, first occurrence, and boosting for multi-word terms; useful conceptually because it explicitly balances frequency and early occurrence.

Implication for Flux: keep YAKE as a candidate generator, but do not treat YAKE score as final product quality. Use corpus-level scoring and type-aware filters afterward.

### 2. Graph-based keyphrase extraction

Graph methods build a word/phrase co-occurrence graph and rank candidates by centrality.

Representative methods:

- **TextRank** — Mihalcea and Tarau (2004). PageRank over a word co-occurrence graph.
- **SingleRank / ExpandRank** — Wan and Xiao (2008). Improve TextRank with phrase candidates and neighboring documents.
- **TopicRank** — Bougouin et al. (2013). Clusters similar candidate phrases into topics, then ranks topic clusters rather than individual strings.
- **MultipartiteRank** — Boudin (2018). Improves topical diversity by using a multipartite graph over topic clusters.
- **PositionRank** — Florescu and Caragea (2017). Adds position bias; useful because early mentions in essays often indicate salience.

Implication for Flux: graph methods are useful for **diversity and redundancy control**. TopicRank/MultipartiteRank are especially relevant because our current surface can show near-duplicates such as `new york` and `new york city`.

### 3. Terminology extraction: termhood and unithood

Terminology extraction separates “good terms” from arbitrary n-grams using two dimensions:

- **Unithood** — how strongly words form a phrase together.
- **Termhood** — how characteristic the phrase is of the domain/corpus.

Representative work:

- Kageura and Umino (1996) on term recognition and termhood/unithood.
- Frantzi, Ananiadou, and Mima (2000), **C-value/NC-value**, for multi-word term extraction.
- Dunning (1993), log-likelihood ratio for collocation significance.
- Church and Hanks (1990), mutual information for word association.

Implication for Flux: high-quality topics should score well on both:

- unithood: `large language models` is a real phrase, not accidental adjacency;
- termhood: it is more characteristic of Flux than a generic phrase.

This argues for adding phrase-quality features beyond frequency: PMI/log-likelihood, C-value-like nested phrase handling, and phrase pattern validation.

### 4. Topic modeling and topic coherence

Probabilistic topic models discover latent themes, but their raw topics are often poor user-facing labels.

Representative methods:

- **pLSA** — Hofmann (1999).
- **LDA** — Blei, Ng, Jordan (2003).
- **Hierarchical LDA** — Blei et al. (2004).
- **Dynamic Topic Models** — Blei and Lafferty (2006), useful for temporal corpora.
- **NMF** — Lee and Seung (1999), often competitive for interpretable document-topic decompositions.

Topic quality/coherence evaluation:

- **UMass coherence** — Mimno et al. (2011), based on document co-occurrence.
- **UCI / NPMI coherence** — Newman et al. (2010), often better aligned with human judgment.
- **Röder, Both, Hinneburg (2015)** — systematic framework for coherence measures.
- **Chang et al. (2009)** — showed that model likelihood does not necessarily correspond to human interpretability.

Implication for Flux: LDA/NMF can help as diagnostics or clustering tools, but should not directly produce public labels. Coherence metrics are more useful as audit signals: a surfaced topic should lead to a coherent set of issues and related terms.

### 5. Topic labeling and readable labels

A latent topic is not the same as a readable label. Non-LLM labeling literature ranks candidate labels by association with a topic distribution.

Representative work:

- Mei, Shen, Zhai (2007), automatic labeling of multinomial topic models.
- Lau, Grieser, Newman, Baldwin (2011), best topic word selection and labeling.

Implication for Flux: public topic labels should come from high-quality extracted phrases/entities, not from opaque clusters. If we later cluster related phrases, choose the label by a phrase quality function, not just frequency.

### 6. Temporal and burst detection

For a newsletter archive, time matters. Some topics are evergreen; others are valuable because they spike.

Representative work:

- **Kleinberg (2002), bursty and hierarchical structure in streams**.
- Dynamic topic models, Blei and Lafferty (2006).

Implication for Flux: ranking should distinguish evergreen corpus topics from burst topics. A low-document-frequency topic may be valuable if it has a sharp, interpretable burst; otherwise low-frequency topics should be demoted.

### 7. Faceted navigation and entity typing

For browsing, “topic” is often overloaded. Information architecture and faceted-search practice recommend separate facets for concept, person, place, organization, time, and content type.

Representative systems/ideas:

- Hearst (2006), **Design Recommendations for Hierarchical Faceted Search Interfaces**.
- Faceted metadata systems such as Flamenco.
- Traditional NER/gazetteer approaches for entity typing without LLMs.

Implication for Flux: `systems thinking`, `large language models`, `new york`, and `venkatesh rao` should not all compete in the same ranking without type awareness. They may all be useful, but they belong to different facets.

## What this means for Flux Search

### Current state

The current topic system has improved materially:

- boilerplate phrases such as `signposts clues` and `editor note` are blocked;
- generic singleton noise such as `people`, `world`, `time`, `move`, `point`, and `direction` is blocked;
- multi-word phrase scoring has been boosted;
- the top 100 audit had 0 hard rejects and 9 review items.

But the top surface still mixes:

- themes: `systems thinking`, `mental models`;
- technologies: `large language models`, `machine learning`, `open source`;
- places: `new york`, `new york city`, `united states`, `silicon valley`;
- people: `venkatesh rao`, `christopher alexander`.

That is not “bad extraction”; it is an unmodeled taxonomy.

### Recommended non-LLM architecture

#### 1. Candidate generation

Use multiple deterministic generators:

- YAKE per issue;
- collocation mining across the corpus using PMI/log-likelihood;
- C-value-like multi-word term extraction;
- curated known entities and domain phrases;
- optional TextRank/TopicRank for candidate diversity.

#### 2. Candidate normalization

Normalize variants before ranking:

- lowercase/collapse whitespace;
- stem or lemmatize for clustering, but keep display form;
- merge close variants by Dice/Jaccard similarity;
- handle nested phrases, e.g. `new york` inside `new york city`, using C-value-style nested-term penalties unless both are independently meaningful.

#### 3. Type classification

Assign each candidate a type:

```text
theme | technology | person | place | organization | publication | event | boilerplate | generic
```

Use deterministic signals:

- curated lexicons for known people, places, technologies, organizations;
- capitalization/proper-noun patterns from source text;
- gazetteers for places;
- suffix/prefix patterns: `city`, `university`, `institute`, `models`, `learning`, etc.;
- section provenance: headings and editorial furniture are suspicious;
- corpus behavior: appears in the same position/section every issue → likely boilerplate.

#### 4. Quality scoring

Score each candidate with interpretable features:

```text
quality =
  local_salience
  × corpus_distinctiveness
  × phrase_quality
  × type_prior
  × coherence
  × diversity_penalty
  × boilerplate_penalty
```

Useful features:

- document frequency with floor/ceiling;
- average YAKE score;
- IDF / distinctiveness;
- n-gram length prior;
- first-position / heading-position signals;
- PMI or log-likelihood for multi-word phrases;
- C-value nested phrase score;
- section entropy: topics appearing only in recurring furniture are suspicious;
- issue-set coherence: issues sharing the topic should also share related terms;
- temporal burst score;
- redundancy penalty against already selected topics.

#### 5. Surface-specific policies

Do not use one global topic ranking everywhere.

- `/topics` default: show `theme` + `technology`, maybe publications; hide or separate people/places.
- Issue page topic rail: show themes/technologies first, entities in a separate block.
- Related issues: use all typed signals, but weight themes more than places/people.
- Topic detail: support entity pages, but label them as entity/person/place rather than “topic” if typed that way.
- Admin audit: show low-confidence and mixed-type terms for review.

#### 6. Evaluation

Use a small hand-labeled set and automatic invariants.

Manual labels:

- top 100 corpus topics labeled as `keep`, `review`, `reject`, and type;
- 20 representative issues with expected top 5 topics;
- known bad phrases that must never surface;
- known good phrases that must outrank nearby generic alternatives.

Automatic checks:

- no boilerplate in top N;
- no generic singleton in top N;
- top N has type diversity within expected policy;
- near-duplicates are not adjacent unless intentionally kept;
- high-ranked topics have minimum issue-set coherence;
- topic detail pages load for all top N topics;
- query-plan tests remain indexed.

## Recommended next implementation slice

See also [`topic-quality-experiments.md`](./topic-quality-experiments.md) for a measurable experiment backlog.

1. Add `topic_type` and `quality_score` to `corpus_topics` and/or a new topic metadata table.
2. Add deterministic type classifier tests for current review items:
   - `new york` → place
   - `new york city` → place
   - `united states` → place/geopolitical entity
   - `silicon valley` → place/technology-culture entity
   - `venkatesh rao` → person
   - `christopher alexander` → person
   - `cryptocurrency` → technology/theme
3. Change `/topics` default policy to show themes/technologies first, with entities available separately.
4. Add phrase-quality features: PMI/log-likelihood and nested phrase penalty.
5. Add coherence and redundancy audit metrics.
6. Re-run production rebuild and update the top-100 audit.

## Key references

- Blei, Ng, Jordan. 2003. Latent Dirichlet Allocation.
- Blei, Lafferty. 2006. Dynamic Topic Models.
- Bougouin, Boudin, Daille. 2013. TopicRank: Graph-Based Topic Ranking for Keyphrase Extraction.
- Boudin. 2018. Unsupervised Keyphrase Extraction with Multipartite Graphs.
- Campos et al. 2020. YAKE! Keyword Extraction from Single Documents using Multiple Local Features.
- Chang et al. 2009. Reading Tea Leaves: How Humans Interpret Topic Models.
- Church, Hanks. 1990. Word Association Norms, Mutual Information, and Lexicography.
- Dunning. 1993. Accurate Methods for the Statistics of Surprise and Coincidence.
- El-Beltagy, Rafea. 2009. KP-Miner: Participation in SemEval-2.
- Florescu, Caragea. 2017. PositionRank: An Unsupervised Approach to Keyphrase Extraction.
- Frantzi, Ananiadou, Mima. 2000. Automatic Recognition of Multi-word Terms: the C-value/NC-value Method.
- Hearst. 2006. Design Recommendations for Hierarchical Faceted Search Interfaces.
- Hofmann. 1999. Probabilistic Latent Semantic Analysis.
- Kageura, Umino. 1996. Methods of Automatic Term Recognition.
- Kleinberg. 2002. Bursty and Hierarchical Structure in Streams.
- Lau, Grieser, Newman, Baldwin. 2011. Automatic Labelling of Topic Models.
- Lee, Seung. 1999. Learning the Parts of Objects by Non-negative Matrix Factorization.
- Mei, Shen, Zhai. 2007. Automatic Labeling of Multinomial Topic Models.
- Mihalcea, Tarau. 2004. TextRank: Bringing Order into Texts.
- Mimno et al. 2011. Optimizing Semantic Coherence in Topic Models.
- Newman et al. 2010. Automatic Evaluation of Topic Coherence.
- Röder, Both, Hinneburg. 2015. Exploring the Space of Topic Coherence Measures.
- Rose et al. 2010. Automatic Keyword Extraction from Individual Documents.
- Wan, Xiao. 2008. CollabRank / ExpandRank-style graph-based keyphrase extraction using neighboring documents.
