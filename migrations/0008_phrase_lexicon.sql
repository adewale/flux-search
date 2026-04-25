-- Stored output of buildPhraseLexicon — bigram phrases that survived the
-- PMI + cooccurrence thresholds. Refreshed each rebuildAllTopics run.

CREATE TABLE IF NOT EXISTS phrase_lexicon (
  phrase        TEXT PRIMARY KEY,
  pmi           REAL NOT NULL,
  cooccurrence  INTEGER NOT NULL,
  quality       REAL NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phrase_lexicon_quality ON phrase_lexicon(quality DESC);
