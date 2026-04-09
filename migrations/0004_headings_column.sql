-- Add headings column for separate FTS weighting of section headings.
-- Headings were previously buried in full_text_plain at body weight (1.0).
-- With a separate column they get their own FTS weight (~8.0).

ALTER TABLE issues ADD COLUMN headings TEXT;

-- Rebuild FTS table with headings column
DROP TRIGGER IF EXISTS issues_ai;
DROP TRIGGER IF EXISTS issues_ad;
DROP TRIGGER IF EXISTS issues_au;
DROP TABLE IF EXISTS issues_fts_vocab;
DROP TABLE IF EXISTS issues_fts;

CREATE VIRTUAL TABLE issues_fts USING fts5(
  title,
  subtitle,
  headings,
  summary,
  full_text_plain,
  contributors,
  content='issues',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER issues_ai AFTER INSERT ON issues BEGIN
  INSERT INTO issues_fts(rowid, title, subtitle, headings, summary, full_text_plain, contributors)
  VALUES (new.rowid, new.title, new.subtitle, new.headings, new.summary, new.full_text_plain, new.contributors);
END;

CREATE TRIGGER issues_ad AFTER DELETE ON issues BEGIN
  INSERT INTO issues_fts(issues_fts, rowid, title, subtitle, headings, summary, full_text_plain, contributors)
  VALUES ('delete', old.rowid, old.title, old.subtitle, old.headings, old.summary, old.full_text_plain, old.contributors);
END;

CREATE TRIGGER issues_au AFTER UPDATE ON issues BEGIN
  INSERT INTO issues_fts(issues_fts, rowid, title, subtitle, headings, summary, full_text_plain, contributors)
  VALUES ('delete', old.rowid, old.title, old.subtitle, old.headings, old.summary, old.full_text_plain, old.contributors);
  INSERT INTO issues_fts(rowid, title, subtitle, headings, summary, full_text_plain, contributors)
  VALUES (new.rowid, new.title, new.subtitle, new.headings, new.summary, new.full_text_plain, new.contributors);
END;

CREATE VIRTUAL TABLE issues_fts_vocab USING fts5vocab(issues_fts, instance);
