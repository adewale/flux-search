-- Remove known text/HTML and editorial-boilerplate artifacts from topic surfaces.

INSERT OR REPLACE INTO topic_blocklist (keyword, reason, added_at) VALUES
  ('img src', 'markup_artifact', datetime('now')),
  ('src href', 'markup_artifact', datetime('now')),
  ('href img', 'markup_artifact', datetime('now')),
  ('alt text', 'markup_artifact', datetime('now')),
  ('xers highlighting', 'markup_artifact', datetime('now')),
  ('fluxers highlighting', 'markup_artifact', datetime('now')),
  ('highlighting independent publications', 'boilerplate_phrase', datetime('now')),
  ('more from fluxers', 'boilerplate_phrase', datetime('now'));
