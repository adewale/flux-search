# Correct-by-Construction Topic Pipeline Design

## Premise

This spec describes how the topic pipeline would be designed if we started from the principle:

```text
defense-in-depth is an antipattern; prefer correct-by-construction
```

In the current implementation, topic quality improved by layering defenses:

- crawler strips HTML;
- normalizer strips more artifacts;
- extractor emits candidates;
- quality filter suppresses bad candidates;
- blocklist catches known leaks;
- corpus aggregation filters by document frequency;
- topic audit finds remaining leaks.

That worked incrementally, but it means invalid data can travel far through the system before being rejected. A correct-by-construction design makes invalid states unrepresentable, or rejects them at the narrowest type boundary where they are first knowable.

## Current pipeline shape

Simplified current flow:

```text
raw Substack HTML
→ htmlToSimpleMarkdown / normalize
→ full_text_plain string
→ per-issue candidate generators
   - known entities
   - phrase lexicon
   - heuristic entities
   - YAKE
→ topic-quality filters
→ issue_topics rows
→ cross-issue candidate floor
→ corpus_topics aggregation
→ domain distinctiveness scoring
→ topic timeline / related issues / public UI
```

Current problems are mostly caused by plain strings crossing too many boundaries:

- decoded pseudo-tags such as `&lt;img src&gt;` became plain text;
- recurring editorial furniture became extractable text;
- malformed n-grams such as `exchange commission` reached corpus surfaces;
- generic phrases such as `many americans` were only removed after audit;
- people, places, publications, concepts, and book titles share one undifferentiated `topic` shape;
- issue-level topic ranking has to infer section/position from flat text.

## Correct-by-construction target

The redesigned pipeline should enforce this invariant:

```text
Only valid, typed, source-positioned topic candidates can be ranked or persisted.
```

A candidate topic should not be represented as only:

```ts
{ keyword: string, score: number }
```

It should require enough structure to prove why it is valid:

```ts
type CandidateTopic = {
  canonical: CanonicalTopicKey;
  display: DisplayLabel;
  type: TopicType;
  source: CandidateSource;
  provenance: NonEmptyArray<CandidateEvidence>;
  localEvidence: LocalEvidence;
  corpusEvidence?: CorpusEvidence;
  quality: CandidateQuality;
};
```

If the candidate cannot produce this evidence, it should never be constructed.

## Core design changes

### 1. Replace `full_text_plain` as the extraction substrate

Current extraction runs over a flat string. Correct-by-construction extraction should run over a typed document model:

```ts
type NormalizedIssue = {
  id: IssueId;
  title: CleanText;
  subtitle?: CleanText;
  leadEssayTitle?: CleanText;
  sections: IssueSection[];
};

type IssueSection = {
  kind: 'lead_essay' | 'links' | 'quote' | 'editor_note' | 'footer' | 'unknown';
  heading?: CleanText;
  paragraphs: CleanParagraph[];
  position: number;
  recurringFurniture: boolean;
};
```

Correctness properties:

- HTML cannot exist inside `CleanText`;
- decoded tag-shaped text cannot exist inside `CleanText`;
- boilerplate sections are represented as `section.kind`, not inferred later;
- topic extraction can exclude or downweight section kinds by construction.

### 2. Make `CleanText` a constructed type

Do not pass raw strings into extractors.

```ts
type CleanText = string & { readonly __brand: 'CleanText' };
```

Only one constructor can create it:

```ts
function cleanTextFromHtml(input: RawHtml): Result<CleanText, NormalizationError>
```

Constructor invariants:

- no `<tag>` or `&lt;tag&gt;` artifacts;
- no Substack image/link residue;
- no navigation/footer boilerplate;
- whitespace normalized;
- original source offsets retained if possible.

Tests become property tests over the constructor, not later filters.

### 3. Separate candidate generation from candidate construction

Generators may propose strings, but only a validator can construct `CandidateTopic`.

```ts
type CandidateProposal = {
  surface: string;
  source: 'known_entity' | 'phrase_lexicon' | 'heuristic_entity' | 'yake';
  spans: TextSpan[];
};

function constructCandidate(
  proposal: CandidateProposal,
  issue: NormalizedIssue,
  registry: TopicRegistry,
): Result<CandidateTopic, CandidateRejection>
```

Construction requirements:

- canonical key is known or passes phrase-quality checks;
- phrase boundaries are valid;
- no weak start/end tokens;
- no markup/text artifact tokens;
- no blocked section-only provenance;
- evidence includes issue position and section spread;
- type is assigned or explicitly `unknown` with lower rankability.

This removes the need for broad post-hoc suppression lists in normal operation.

### 4. Use a topic registry, not scattered protection/blocklist sets

Today protected topics, known entities, aliases, blocklists, and malformed fragments live in multiple places. Correct-by-construction uses one registry:

```ts
type TopicRegistryEntry = {
  canonical: CanonicalTopicKey;
  display: DisplayLabel;
  type: 'theme' | 'technology' | 'person' | 'place' | 'publication' | 'book' | 'organization' | 'event';
  aliases: Alias[];
  status: 'allow' | 'deny' | 'review';
  license?: string;
  notes?: string;
};
```

Examples:

```text
crypto → allow, technology/theme, canonical crypto
cryptocurrency → allow, technology/theme
Rest of World → allow, publication
Not Boring → allow, publication
Crooked Timber → allow, publication
Simple Habits for Complex Times → allow, book
exchange commission → deny, malformed fragment
```

The registry is the single source of truth for:

- aliases;
- protected topics;
- blocklist entries;
- surface type;
- display labels.

### 5. Make cross-issue eligibility a candidate state, not an afterthought

Instead of persisting issue topics and later discovering whether they qualify globally, represent candidate lifecycle explicitly:

```text
local_proposal
→ locally_valid
→ corpus_eligible     # appears in ≥2 issues or is protected/event/burst exception
→ public_topic
```

D1 tables could reflect this:

```sql
issue_topic_candidates(
  issue_id,
  canonical,
  local_rank,
  local_score,
  eligibility_status,
  evidence_json
)

corpus_topics(
  canonical,
  topic_type,
  doc_frequency,
  domain_distinctiveness,
  public_rank_score
)
```

Public APIs query only `eligibility_status = 'public_topic'` or equivalent views.

### 6. Replace post-hoc phrase filtering with phrase grammar

Current filters say “reject if phrase looks bad.” Correct-by-construction uses a phrase grammar before candidate construction:

```text
ValidPhrase := ProtectedPhrase | ContentWord (InternalWord*) ContentWord
InternalWord := ContentWord | AllowedInternalStopword
```

Invalid examples fail construction:

```text
as treasury              # invalid start
seeing like              # weak end
good reason you can      # clause fragment
img src                  # markup token
exchange commission      # denied fragment unless full canonical exists
```

Valid examples construct:

```text
seeing like a state
large language models
simple habits for complex times
systems thinking
```

### 7. Rank from evidence objects, not inferred strings

Issue ranking should consume structured evidence:

```ts
type LocalEvidence = {
  occurrences: number;
  sentenceSpread: number;
  sectionSpread: number;
  firstOccurrencePercentile: number;
  inTitle: boolean;
  inSubtitle: boolean;
  inLeadEssayTitle: boolean;
  inHeading: boolean;
  sectionKinds: IssueSectionKind[];
};
```

Then issue ranking becomes deterministic and inspectable:

```text
local_score =
  salience
  × title/heading boost
  × section-spread boost
  × domain-distinctiveness boost
  × type/surface policy
```

No ranker should parse raw issue text to rediscover position.

### 8. Make domain-distinctiveness generated data reproducible

Current implementation now has:

```text
scripts/build-background-frequency.mjs
src/lib/background-frequency.generated.ts
data/background/manifest.json
docs/background-frequency-attribution.md
```

Correct-by-construction extension:

- CI verifies generated table hash matches manifest;
- CI fails if generated file changes without manifest update;
- runtime imports generated table only;
- offline dependency (`nodewordfreq`) never enters Worker bundle.

### 9. Use D1 constraints/views to enforce public invariants

Instead of relying only on route code:

```sql
CREATE VIEW public_topics AS
SELECT * FROM corpus_topics
WHERE eligibility_status = 'public_topic'
  AND quality_status = 'valid';
```

Public routes query `public_topics`, not raw candidate tables.

This prevents accidental leakage from a new route.

## Testing strategy

### Constructor/property tests

- `CleanText` never contains HTML or decoded tag-shaped artifacts;
- candidate construction rejects invalid phrase grammar;
- protected registry entries always construct when evidence exists;
- blocklisted/deny registry entries never construct;
- unknown words never produce NaN scores.

### Golden issue tests

Keep and expand the representative issue gold set:

```text
IssueTopicPrecision@5
```

Use it to tune weights, not to patch individual strings.

### Corpus audit tests

- public topics all have `corpus_eligible` state;
- public topics all have valid registry/type/quality state;
- generic phrase leakage decreases;
- protected routes remain 200.

### Generated-data tests

- manifest source/version matches package lock;
- manifest hash matches generated file;
- attribution file exists;
- Worker bundle does not include `nodewordfreq`.

## Migration path from current system

1. Introduce `TopicRegistry` as a generated module from current known entities + blocklist.
2. Add `CleanText` constructor and switch extractors to require it internally.
3. Store structured evidence JSON in `issue_topics` or a new `issue_topic_candidates` table.
4. Move phrase-quality rules into `constructCandidate()`.
5. Add `public_topics` view and migrate public routes to it.
6. Retire scattered post-hoc filters once constructor coverage is proven.

## Expected benefits

- fewer recurring artifact regressions;
- less need for emergency blocklists;
- clearer audit trail for every public topic;
- issue-level ranking can improve from evidence rather than guesswork;
- invalid topic states become hard to represent and harder to accidentally expose.

## Tradeoffs

- more upfront modeling work;
- more migrations;
- requires topic registry discipline;
- less forgiving during ingestion because malformed inputs fail earlier;
- may slow experimentation unless proposal/constructor boundaries are ergonomic.

## Summary

The current pipeline uses defense-in-depth successfully, but at the cost of allowing bad candidates to move through many layers before being suppressed. A correct-by-construction design would make public topics emerge only from typed, validated, evidence-backed candidates. The central change is moving from “strings plus filters” to “constructed topic objects with invariants.”
