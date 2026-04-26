-- Time-aware + confidence enrichment of corpus_topics.
-- Plus topic_similarity table (cosine + jaccard agreement).

ALTER TABLE corpus_topics ADD COLUMN confidence TEXT;
ALTER TABLE corpus_topics ADD COLUMN burst_score REAL;
ALTER TABLE corpus_topics ADD COLUMN burst_quarter TEXT;

CREATE INDEX IF NOT EXISTS idx_corpus_topics_burst ON corpus_topics(burst_score DESC);

-- Pairwise agreement between corpus topics. Populated optionally during
-- rebuildAllTopics when a Workers-AI embedder is available. Each row is
-- one direction (a → b) and we store the symmetric pair both ways for
-- cheap lookup. cosine and jaccard are precomputed; the route blends.
CREATE TABLE IF NOT EXISTS topic_similarity (
  keyword_a   TEXT NOT NULL,
  keyword_b   TEXT NOT NULL,
  cosine      REAL NOT NULL,
  jaccard     REAL NOT NULL,
  blended     REAL NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (keyword_a, keyword_b)
);

CREATE INDEX IF NOT EXISTS idx_topic_similarity_blended
  ON topic_similarity(keyword_a, blended DESC);
