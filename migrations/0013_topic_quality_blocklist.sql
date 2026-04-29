-- Topic quality blocklist: editorial boilerplate and generic singleton noise
-- that should never appear as navigational topics.

INSERT OR IGNORE INTO topic_blocklist (keyword, reason, added_at) VALUES
  ('signposts clues', 'editorial boilerplate heading', '2026-04-29T00:00:00Z'),
  ('signpost clues', 'editorial boilerplate heading', '2026-04-29T00:00:00Z'),
  ('editor note', 'editorial boilerplate', '2026-04-29T00:00:00Z'),
  ('editors note', 'editorial boilerplate', '2026-04-29T00:00:00Z'),
  ('editor s note', 'editorial boilerplate', '2026-04-29T00:00:00Z'),
  ('move', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('moves', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('point', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('points', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('direction', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('directions', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('life', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('work', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('idea', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('ideas', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('story', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('stories', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('problem', 'generic singleton navigation noise', '2026-04-29T00:00:00Z'),
  ('problems', 'generic singleton navigation noise', '2026-04-29T00:00:00Z');
