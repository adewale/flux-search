export interface IssueRow {
  id: string;
  issue_number: number | null;
  title: string;
  subtitle: string | null;
  published_at: string | null;
  source_url: string;
  canonical_url: string | null;
  authors: string | null;
  contributors: string | null;
  summary: string | null;
  headings: string | null;
  lead_essay_title: string | null;
  opening_quote: string | null;
  full_text_markdown: string | null;
  full_text_plain: string | null;
  crawl_run_id: string | null;
  content_hash: string | null;
  ingested_at: string;
  word_count: number | null;
  status: 'active' | 'quarantined' | 'deleted';
  year: number | null;
  month: number | null;
  has_semantic_chunks: number;
}

export interface IssueChunkRow {
  id: string;
  issue_id: string;
  chunk_index: number;
  section_label: string | null;
  chunk_text: string;
  token_estimate: number;
  content_hash: string;
}

export interface CrawlRunRow {
  id: string;
  seed_url: string | null;
  mode: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed' | 'partial';
  records_found: number;
  issues_created: number;
  issues_updated: number;
  issues_skipped: number;
  notes: string | null;
}

export interface SearchFilters {
  before?: string;
  after?: string;
  year?: number;
  issueNumber?: number;
  section?: string;
  topic?: string;
}

export interface IssueTopicRow {
  issue_id: string;
  keyword: string;
  keyword_display: string;
  score: number;
  rank: number;
  ngram_size: number;
}

export interface CorpusTopicRow {
  keyword: string;
  keyword_display: string;
  doc_frequency: number;
  avg_score: number;
  aggregate_score: number;
  distinctiveness: number | null;
  first_seen: string | null;
  last_seen: string | null;
  ngram_size: number | null;
  updated_at: string;
  confidence: 'high' | 'medium' | 'low' | null;
  burst_score: number | null;
  burst_quarter: string | null;
}

export interface TopicTimelineRow {
  keyword: string;
  year: number;
  month: number;
  occurrences: number;
}
