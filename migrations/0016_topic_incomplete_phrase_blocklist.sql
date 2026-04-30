-- Remove incomplete n-gram fragments now covered by weak_phrase filtering.

INSERT OR REPLACE INTO topic_blocklist (keyword, reason, added_at) VALUES
  ('seeing like', 'weak_phrase', datetime('now'));
