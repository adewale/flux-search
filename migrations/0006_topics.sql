-- Topic extraction tables (Yaket)

CREATE TABLE IF NOT EXISTS issue_topics (
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  keyword         TEXT NOT NULL,
  keyword_display TEXT NOT NULL,
  score           REAL NOT NULL,
  rank            INTEGER NOT NULL,
  ngram_size      INTEGER NOT NULL,
  PRIMARY KEY (issue_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_issue_topics_keyword ON issue_topics(keyword);
CREATE INDEX IF NOT EXISTS idx_issue_topics_rank    ON issue_topics(issue_id, rank);

CREATE TABLE IF NOT EXISTS corpus_topics (
  keyword         TEXT PRIMARY KEY,
  keyword_display TEXT NOT NULL,
  doc_frequency   INTEGER NOT NULL,
  avg_score       REAL NOT NULL,
  aggregate_score REAL NOT NULL,
  first_seen      TEXT,
  last_seen       TEXT,
  ngram_size      INTEGER,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_corpus_topics_agg ON corpus_topics(aggregate_score DESC);

CREATE TABLE IF NOT EXISTS topic_timeline (
  keyword     TEXT NOT NULL,
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL,
  occurrences INTEGER NOT NULL,
  PRIMARY KEY (keyword, year, month)
);

CREATE TABLE IF NOT EXISTS topic_blocklist (
  keyword  TEXT PRIMARY KEY,
  reason   TEXT,
  added_at TEXT NOT NULL
);
