# Background frequency attribution

Flux topic domain-distinctiveness uses a small generated English Zipf-frequency table at build/runtime:

```text
src/lib/background-frequency.generated.ts
```

The table is generated offline by:

```text
scripts/build-background-frequency.mjs
```

## Source

The offline builder uses:

```text
nodewordfreq 0.2.1
https://www.npmjs.com/package/nodewordfreq
https://github.com/realchendahuang/nodewordfreq
```

`nodewordfreq` is a Node/TypeScript port that reuses Robyn Speer's Python `wordfreq` data/API:

```text
wordfreq
https://github.com/rspeer/wordfreq
```

## Required attribution and license notes

`nodewordfreq` package code is published with an Apache-2.0 license field. Its bundled frequency data is inherited from `wordfreq` and has additional attribution/source-license notes.

The `nodewordfreq` / `wordfreq` notice identifies Robyn Speer as the author of `wordfreq` and says data includes material from sources including:

- Google Books Ngrams and Google Books Syntactic Ngrams;
- Leeds Internet Corpus;
- Wikipedia;
- ParaCrawl;
- OPUS OpenSubtitles 2018 / OpenSubtitles;
- SUBTLEX word lists;
- aggregate Twitter-derived statistics.

The notice states that some included data files may be redistributed under Creative Commons Attribution-ShareAlike 4.0 and that attribution is required for several sources.

We use `nodewordfreq` only as an offline calibration/build input. The Cloudflare Worker does not bundle `nodewordfreq`; it imports only the small generated table.

If this project distributes the generated table, preserve this attribution file and the package lock entry for provenance.
