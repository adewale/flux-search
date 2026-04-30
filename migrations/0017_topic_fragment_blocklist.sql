-- Remove malformed/weak topic fragments identified in the topic-quality audit.

INSERT OR REPLACE INTO topic_blocklist (keyword, reason, added_at) VALUES
  ('secretary of defense rock', 'malformed_phrase', datetime('now')),
  ('exchange commission', 'malformed_phrase', datetime('now')),
  ('many americans', 'malformed_phrase', datetime('now')),
  ('top-right quadrant', 'malformed_phrase', datetime('now')),
  ('labor day', 'malformed_phrase', datetime('now')),
  ('golden state', 'malformed_phrase', datetime('now')),
  ('complex times', 'malformed_phrase', datetime('now')),
  ('world war', 'malformed_phrase', datetime('now')),
  ('le guin', 'malformed_phrase', datetime('now')),
  ('packy mc', 'malformed_phrase', datetime('now')),
  ('native american', 'malformed_phrase', datetime('now')),
  ('technology review', 'malformed_phrase', datetime('now')),
  ('census bureau', 'malformed_phrase', datetime('now')),
  ('air force', 'malformed_phrase', datetime('now'));
