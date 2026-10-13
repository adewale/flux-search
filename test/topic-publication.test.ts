import { describe, expect, it } from 'vitest';
import { makeD1 } from './helpers-d1';
import { topicPublicationDatabase } from '../src/lib/topic-publication';
import { replaceIssueTopics, replaceTopicSimilarities, replaceTopicEmbeddings, rebuildSimilaritiesFromStoredEmbeddings } from '../src/db/topic-queries';

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

  it.each(['new keyword', 'changed vector'] as const)('retains current similarities when an older snapshot precedes a %s', async (change) => {
    const db = makeD1();
    for (const keyword of ['a', 'b', 'c']) await db.prepare(`INSERT INTO corpus_topics
      (keyword, keyword_display, doc_frequency, avg_score, aggregate_score, updated_at)
      VALUES (?, ?, 1, 1, 1, 'now')`).bind(keyword, keyword).run();
    await replaceTopicEmbeddings(db as any, ['a', 'c', ...(change === 'changed vector' ? ['b'] : [])]
      .map(keyword => ({ keyword, vector: [1, 0] })));
    let captured!: () => void;
    let release!: () => void;
    const seen = new Promise<void>(resolve => { captured = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const paused = { ...db, prepare: (sql: string) => {
      const statement = db.prepare(sql);
      if (sql !== 'SELECT keyword, vector_json FROM topic_embeddings') return statement;
      return { ...statement, all: async () => {
        const snapshot = await statement.all();
        captured();
        await proceed;
        return snapshot;
      } };
    } };
    const older = rebuildSimilaritiesFromStoredEmbeddings(paused as any, ['a']);
    await seen;
    try {
      await replaceTopicEmbeddings(db as any, [{ keyword: 'b', vector: change === 'new keyword' ? [1, 0] : [0, 1] }]);
      await rebuildSimilaritiesFromStoredEmbeddings(db as any, ['b']);
    } finally {
      release();
    }
    await older;
    const query = 'SELECT keyword_a, keyword_b, blended FROM topic_similarity ORDER BY keyword_a, keyword_b';
    const actual = (await db.prepare(query).all()).results;
    // A complete rebuild with the final vectors is an independent schedule control.
    await rebuildSimilaritiesFromStoredEmbeddings(db as any);
    const expected = (await db.prepare(query).all()).results;
    expect(expected).toHaveLength(change === 'new keyword' ? 6 : 2);
    expect(actual).toEqual(expected);
  });

  it('keeps a 134-topic, 768-dimension snapshot within D1 binding limits', async () => {
    const db = makeD1();
    const vector = Array.from({ length: 768 }, (_, i) => Math.sin(i + 1) / Math.sqrt(768));
    const vectorJson = JSON.stringify(vector);
    const snapshot = new Map(Array.from({ length: 134 }, (_, i) => [`t${i}`, vectorJson]));
    expect(Buffer.byteLength(JSON.stringify(Object.fromEntries(snapshot)))).toBeGreaterThan(2_000_000);
    await db.batch([...snapshot].flatMap(([keyword, value]) => [
      db.prepare(`INSERT INTO corpus_topics (keyword, keyword_display, doc_frequency, avg_score, aggregate_score, updated_at)
        VALUES (?, ?, 1, 1, 1, 'now')`).bind(keyword, keyword),
      db.prepare("INSERT INTO topic_embeddings (keyword, model, vector_json, updated_at) VALUES (?, 'test', ?, 'now')")
        .bind(keyword, value),
    ]));
    const bounded = { ...db, prepare: (sql: string) => {
      const statement = db.prepare(sql);
      return { ...statement, bind: (...values: unknown[]) => {
        expect(values.length).toBeLessThanOrEqual(100);
        for (const value of values) if (typeof value === 'string') {
          expect(Buffer.byteLength(value)).toBeLessThanOrEqual(2_000_000);
        }
        return statement.bind(...values);
      } };
    } };
    const pair = { keyword_a: 't0', keyword_b: 't133', cosine: 1, jaccard: 0, blended: 0.6 };
    await replaceTopicSimilarities(bounded as any, [pair], ['t0'], snapshot);
    expect((await db.prepare('SELECT keyword_a, keyword_b FROM topic_similarity').all()).results)
      .toEqual([{ keyword_a: 't0', keyword_b: 't133' }]);
    await replaceTopicSimilarities(bounded as any, [], ['t0'], snapshot);
    expect((await db.prepare('SELECT keyword_a, keyword_b FROM topic_similarity').all()).results).toEqual([]);
  });
});
