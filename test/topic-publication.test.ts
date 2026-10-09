import { describe, expect, it } from 'vitest';
import { makeD1 } from './helpers-d1';
import { topicPublicationDatabase } from '../src/lib/topic-publication';
import { replaceIssueTopics, replaceTopicSimilarities } from '../src/db/topic-queries';

describe('topic publication generation', () => {
  it('rejects a stale batch at the write and keeps current rows, even when start timestamps tie', async () => {
    const db = makeD1();
    await db.prepare("INSERT INTO pipeline_runs (id, mode, started_at) VALUES ('old', 'topic_rebuild', '2026-01-01')").run();
    const old = topicPublicationDatabase(db as any, 'old');
    await old.prepare("INSERT INTO topic_similarity (keyword_a, keyword_b, cosine, jaccard, blended, updated_at) VALUES ('a', 'b', 1, 1, 1, 'now')").run();
    await db.prepare("INSERT INTO pipeline_runs (id, mode, started_at) VALUES ('new', 'topic_rebuild', '2026-01-01')").run();
    const current = topicPublicationDatabase(db as any, 'new');
    await replaceTopicSimilarities(current, [{ keyword_a: 'new', keyword_b: 'corpus', cosine: 0.5, jaccard: 0.25, blended: 0.4 }]);
    await expect(old.batch([
      old.prepare('DELETE FROM topic_similarity'),
      old.prepare("UPDATE pipeline_runs SET status = 'completed' WHERE id = 'old'"),
    ])).rejects.toThrow();
    expect((await db.prepare('SELECT keyword_a, keyword_b FROM topic_similarity').all()).results)
      .toEqual([{ keyword_a: 'new', keyword_b: 'corpus' }]);
    expect(await db.prepare("SELECT status FROM pipeline_runs WHERE id = 'old'").first()).toEqual({ status: 'running' });
    await expect(topicPublicationDatabase(db as any, 'unknown').prepare('DELETE FROM topic_similarity').run()).rejects.toThrow();
  });

  it('rolls back failed replacements and retains unrelated similarities on incremental replay', async () => {
    const db = makeD1();
    await db.prepare("INSERT INTO issues (id, title, source_url, ingested_at) VALUES ('i', 'Issue', 'https://i', 'now')").run();
    const original = [{ keyword: 'old', keyword_display: 'Old', score: 1, rank: 1, ngram_size: 1 }];
    await replaceIssueTopics(db as any, 'i', original);
    await expect(replaceIssueTopics(db as any, 'i', [{ ...original[0], keyword: null as any }])).rejects.toThrow();
    expect((await db.prepare("SELECT keyword FROM issue_topics WHERE issue_id = 'i'").all()).results).toEqual([{ keyword: 'old' }]);
    const pair = { keyword_a: 'a', keyword_b: 'b', cosine: 1, jaccard: 1, blended: 1 };
    await replaceTopicSimilarities(db as any, [pair, { ...pair, keyword_a: 'c', keyword_b: 'd' }]);
    for (let replay = 0; replay < 2; replay++) {
      await replaceTopicSimilarities(db as any, [{ ...pair, blended: 0.5 }], ['a']);
    }
    expect((await db.prepare('SELECT keyword_a, keyword_b, blended FROM topic_similarity ORDER BY keyword_a').all()).results)
      .toEqual([{ keyword_a: 'a', keyword_b: 'b', blended: 0.5 }, { keyword_a: 'c', keyword_b: 'd', blended: 1 }]);
  });
});
