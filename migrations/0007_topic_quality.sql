-- Topic-quality additions:
-- 1. Provenance + suppression metadata on each extracted topic.
-- 2. Domain-specific blocklist seeds (FLUX boilerplate / generic noise).

ALTER TABLE issue_topics ADD COLUMN provenance TEXT;
ALTER TABLE issue_topics ADD COLUMN suppression_reason TEXT;
ALTER TABLE issue_topics ADD COLUMN stem TEXT;

CREATE INDEX IF NOT EXISTS idx_issue_topics_stem ON issue_topics(stem);

-- Domain-specific blocklist additions: publication-specific boilerplate
-- plus generic filler that yaket sometimes promotes.
INSERT OR IGNORE INTO topic_blocklist (keyword, reason, added_at) VALUES
  ('flux',         'publication name',           '2026-04-25T00:00:00Z'),
  ('flux review',  'publication name',           '2026-04-25T00:00:00Z'),
  ('the flux',     'publication name',           '2026-04-25T00:00:00Z'),
  ('newsletter',   'publication boilerplate',    '2026-04-25T00:00:00Z'),
  ('subscribe',    'publication boilerplate',    '2026-04-25T00:00:00Z'),
  ('substack',     'platform',                   '2026-04-25T00:00:00Z'),
  ('archive',      'navigation boilerplate',     '2026-04-25T00:00:00Z'),
  ('issue',        'publication boilerplate',    '2026-04-25T00:00:00Z'),
  ('week',         'low-information filler',     '2026-04-25T00:00:00Z'),
  ('weekly',       'low-information filler',     '2026-04-25T00:00:00Z'),
  ('really',       'filler adverb',              '2026-04-25T00:00:00Z'),
  ('actually',     'filler adverb',              '2026-04-25T00:00:00Z'),
  ('thing',        'low-information singleton',  '2026-04-25T00:00:00Z'),
  ('things',       'low-information singleton',  '2026-04-25T00:00:00Z'),
  ('stuff',        'low-information singleton',  '2026-04-25T00:00:00Z'),
  ('something',    'pronoun-like',               '2026-04-25T00:00:00Z'),
  ('someone',      'pronoun-like',               '2026-04-25T00:00:00Z'),
  ('everything',   'pronoun-like',               '2026-04-25T00:00:00Z'),
  ('everyone',     'pronoun-like',               '2026-04-25T00:00:00Z'),
  ('anything',     'pronoun-like',               '2026-04-25T00:00:00Z');
