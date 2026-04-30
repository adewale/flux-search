-- Correct-by-construction topic evidence/status fields.

ALTER TABLE issue_topics ADD COLUMN topic_type TEXT;
ALTER TABLE issue_topics ADD COLUMN quality_status TEXT DEFAULT 'valid';
ALTER TABLE issue_topics ADD COLUMN eligibility_status TEXT DEFAULT 'local_valid';
ALTER TABLE issue_topics ADD COLUMN evidence_json TEXT;

ALTER TABLE corpus_topics ADD COLUMN topic_type TEXT;
ALTER TABLE corpus_topics ADD COLUMN quality_status TEXT DEFAULT 'valid';
ALTER TABLE corpus_topics ADD COLUMN eligibility_status TEXT DEFAULT 'public_topic';

CREATE VIEW IF NOT EXISTS public_topics AS
SELECT * FROM corpus_topics
WHERE COALESCE(quality_status, 'valid') = 'valid'
  AND COALESCE(eligibility_status, 'public_topic') = 'public_topic';

CREATE INDEX IF NOT EXISTS idx_issue_topics_status_type
  ON issue_topics(quality_status, eligibility_status, topic_type);
