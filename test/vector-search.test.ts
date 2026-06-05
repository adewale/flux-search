import { describe, expect, it } from 'vitest';
import { makeD1, seedIssue } from './helpers-d1';
import { replaceIssueTopics } from '../src/db/topic-queries';
import { searchVectorize } from '../src/lib/vector-search';

function d1WithBatchAll() {
  const db = makeD1() as any;
  db.batch = async (stmts: Array<{ all: () => Promise<unknown> }>) => Promise.all(stmts.map(s => s.all()));
  return db;
}

function makeVectorize(matches: Array<{ id: string; score: number; metadata: Record<string, unknown> }>, capture: unknown[]) {
  return {
    query: async (_vector: number[], options: unknown) => {
      capture.push(options);
      return { matches };
    },
  };
}

describe('searchVectorize', () => {
  it('passes date/year/section filters into Vectorize before topK', async () => {
    const db = d1WithBatchAll();
    await seedIssue(db, { id: 'i-2024', source_url: 'x://2024', published_at: '2024-06-01', year: 2024 });
    const queryOptions: unknown[] = [];
    const env = {
      DB: db,
      AI: { run: async () => ({ data: [[0.1, 0.2]] }) },
      VECTORIZE: makeVectorize([
        { id: 'chunk-1', score: 0.9, metadata: { issue_id: 'i-2024', section_label: 'lens', chunk_text: 'Lens text' } },
      ], queryOptions),
    } as any;

    const results = await searchVectorize(env, 'unique-vector-filter-query', {
      year: 2024,
      before: '2024-12-31',
      section: 'lens',
    });

    expect(results.map(r => r.issueId)).toEqual(['i-2024']);
    expect(queryOptions[0]).toMatchObject({
      topK: 15,
      returnMetadata: 'all',
      filter: {
        published_at: { $gte: '2024-01-01', $lt: '2024-12-31' },
        section_label_public: 'lens',
      },
    });
  });

  it('uses topic issue ids as a Vectorize metadata prefilter', async () => {
    const db = d1WithBatchAll();
    await seedIssue(db, { id: 'topic-hit', source_url: 'x://topic-hit' });
    await replaceIssueTopics(db, 'topic-hit', [{
      keyword: 'governance',
      keyword_display: 'governance',
      score: 1,
      rank: 1,
      ngram_size: 1,
    }]);
    const queryOptions: unknown[] = [];
    const env = {
      DB: db,
      AI: { run: async () => ({ data: [[0.3, 0.4]] }) },
      VECTORIZE: makeVectorize([
        { id: 'chunk-1', score: 0.91, metadata: { issue_id: 'topic-hit', section_label: 'lead_essay', chunk_text: 'Governance text' } },
      ], queryOptions),
    } as any;

    await searchVectorize(env, 'unique-topic-filter-query', { topic: 'governance' });

    expect(queryOptions[0]).toMatchObject({
      filter: { issue_id: { $in: ['topic-hit'] } },
    });
  });

  it('caches repeated normalized query embeddings in the worker isolate', async () => {
    const db = d1WithBatchAll();
    await seedIssue(db, { id: 'cache-hit', source_url: 'x://cache-hit' });
    let aiCalls = 0;
    const env = {
      DB: db,
      AI: { run: async () => { aiCalls += 1; return { data: [[0.5, 0.6]] }; } },
      VECTORIZE: makeVectorize([
        { id: 'chunk-1', score: 0.93, metadata: { issue_id: 'cache-hit', section_label: 'lens', chunk_text: 'Cached text' } },
      ], []),
    } as any;

    await searchVectorize(env, '  Unique   Cache Query  ', {});
    await searchVectorize(env, 'unique cache query', {});

    expect(aiCalls).toBe(1);
  });
});
