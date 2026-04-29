import { describe, expect, it } from 'vitest';
import { makeD1 } from './helpers-d1';

function explain(db: ReturnType<typeof makeD1>, sql: string): string {
  return db._sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
    .map((row: any) => String(row.detail))
    .join('\n');
}

describe('D1 hot-path query plans', () => {
  it('uses indexes for topic detail issue lookup instead of large IN lists', () => {
    const db = makeD1();
    const plan = explain(db, `
      SELECT i.*
      FROM issue_topics it
      CROSS JOIN issues i ON i.id = it.issue_id
      WHERE it.keyword = 'systems thinking' AND i.status = 'active'
      ORDER BY i.published_at DESC
    `);

    expect(plan).toContain('idx_issue_topics_keyword_issue');
    expect(plan).toContain('sqlite_autoindex_issues_1');
    expect(plan).not.toContain('IN (');
  });

  it('uses timeline, similarity, issue number, and queue-job hot-path indexes', () => {
    const db = makeD1();

    expect(explain(db, `
      SELECT * FROM topic_timeline WHERE keyword = 'systems thinking' ORDER BY year, month
    `)).toContain('idx_topic_timeline_keyword_date');

    expect(explain(db, `
      SELECT keyword_b, blended FROM topic_similarity
      WHERE keyword_a = 'systems thinking'
      ORDER BY blended DESC LIMIT 12
    `)).toContain('idx_topic_similarity_keyword_blended');

    expect(explain(db, `
      SELECT * FROM issues WHERE issue_number = 214 AND status = 'active'
    `)).toContain('idx_issues_issue_number_status');

    expect(explain(db, `
      SELECT * FROM pipeline_jobs
      WHERE status = 'queued' AND next_attempt_at <= '2026-04-29T00:00:00Z'
      ORDER BY queued_at LIMIT 10
    `)).toContain('idx_pipeline_jobs_status_next_attempt');
  });
});
