# Topic Artifact Investigation — HTML/text artifacts and n-grams

## Findings

### `img src`

`img src` came from encoded pseudo-tags in issue content/captions. The crawl path removed real HTML tags before entity decoding, but some source text contained escaped tags such as:

```html
&lt;img src&gt;
```

The pipeline then decoded entities after tag stripping, producing literal text:

```text
<img src>
```

That survived into `full_text_plain`, where YAKE/phrase extraction treated `img src` as a recurring bigram. It appeared in 6 issues, passed the minimum document-frequency threshold, got the multi-word phrase boost, and surfaced as a corpus topic.

Fixes:

- `htmlToSimpleMarkdown()` now strips tag-shaped text exposed after entity decoding while preserving natural comparisons like `A < B > C`.
- topic quality now suppresses markup tokens/phrases such as `img`, `src`, `href`, and `alt text`.
- migration `0015_topic_artifact_blocklist.sql` blocklists known artifacts for existing data/rebuild safety.

### `xers highlighting`

`xers highlighting` is a recurring editorial-furniture artifact from the section text:

```text
More from FLUXers
Highlighting independent publications from FLUX contributors.
```

Topic extraction sees this repeated language across issues. Depending on tokenization/canonicalization, it can appear as `FLUXers highlighting` or the malformed/stemmed-looking `xers highlighting`. It is not a topic; it is recurring newsletter chrome.

Fixes:

- topic quality suppresses both `fluxers highlighting` and `xers highlighting` as markup/editorial artifacts.
- migration `0015_topic_artifact_blocklist.sql` blocklists the existing variants.

### `seeing like`

`seeing like` surfaced because the existing PMI lexicon only handled bigrams and filtered stopwords. The meaningful title phrase is:

```text
Seeing Like a State
```

The internal stopword `a` caused the phrase to be missed by bigram-only/stopword-filtered phrase mining, while YAKE could still emit the weaker fragment `seeing like`.

Fixes:

- the phrase lexicon now considers contiguous n-grams up to 4 tokens;
- stopwords are allowed inside phrases, but not at phrase boundaries;
- recurring 3–4 gram exact phrases can be kept even when endpoint PMI is weak because their endpoint words are common.

This lets the system learn phrases like `seeing like a state` while still relying on quality filters/blocklists to remove recurring artifacts.

## TDD coverage added

- `test/crawl-client.test.ts` — encoded tags exposed by entity decoding are stripped.
- `test/topic-quality-improvements.test.ts` — text/HTML artifacts are suppressed with reason `markup_artifact`.
- `test/topic-multi-extract.test.ts` — FLUXers highlighting boilerplate is suppressed.
- `test/topic-multi-extract.test.ts` — stopword-bridged four-gram phrase `seeing like a state` is learned.

## Remaining caution

Expanding n-gram support increases recall and can improve phrase completeness, but it also increases the candidate space for recurring boilerplate. The safe pattern is:

```text
expand phrase candidates → add deterministic artifact/boilerplate filters → audit top topics after rebuild
```
