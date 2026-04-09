-- FTS5 virtual table for full-text search
-- Column weights are applied at query time via bm25() function

CREATE VIRTUAL TABLE IF NOT EXISTS issues_fts USING fts5(
  title,
  subtitle,
  summary,
  full_text_plain,
  contributors,
  content='issues',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Triggers to keep FTS index in sync with issues table

CREATE TRIGGER IF NOT EXISTS issues_ai AFTER INSERT ON issues BEGIN
  INSERT INTO issues_fts(rowid, title, subtitle, summary, full_text_plain, contributors)
  VALUES (new.rowid, new.title, new.subtitle, new.summary, new.full_text_plain, new.contributors);
END;

CREATE TRIGGER IF NOT EXISTS issues_ad AFTER DELETE ON issues BEGIN
  INSERT INTO issues_fts(issues_fts, rowid, title, subtitle, summary, full_text_plain, contributors)
  VALUES ('delete', old.rowid, old.title, old.subtitle, old.summary, old.full_text_plain, old.contributors);
END;

CREATE TRIGGER IF NOT EXISTS issues_au AFTER UPDATE ON issues BEGIN
  INSERT INTO issues_fts(issues_fts, rowid, title, subtitle, summary, full_text_plain, contributors)
  VALUES ('delete', old.rowid, old.title, old.subtitle, old.summary, old.full_text_plain, old.contributors);
  INSERT INTO issues_fts(rowid, title, subtitle, summary, full_text_plain, contributors)
  VALUES (new.rowid, new.title, new.subtitle, new.summary, new.full_text_plain, new.contributors);
END;

-- Vocabulary table for autocomplete
CREATE VIRTUAL TABLE IF NOT EXISTS issues_fts_vocab USING fts5vocab(issues_fts, instance);
