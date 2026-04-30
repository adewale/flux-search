/**
 * Adjacent (co-occurring) topics for the topic detail panel.
 * Pure SQL, no extraction logic, so we exercise it against the in-memory DB.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { makeD1, seedIssue } from './helpers-d1';
import {
  replaceIssueTopics,
  getAdjacentTopics,
  buildCorpusTopics,
  buildTopicTimeline,
} from '../src/db/topic-queries';
import { topicRoutes } from '../src/routes/topics';

async function seed(
  db: ReturnType<typeof makeD1>,
  issueOverrides: Parameters<typeof seedIssue>[1],
  keywords: string[],
): Promise<string> {
  const id = await seedIssue(db as any, issueOverrides);
  await replaceIssueTopics(
    db as any,
    id,
    keywords.map((k, i) => ({
      keyword: k,
      keyword_display: k,
      score: 0.1 * (i + 1),
      rank: i + 1,
      ngram_size: k.split(' ').length,
    })),
  );
  return id;
}

describe('getAdjacentTopics', () => {
  it('returns topics that co-occur with the seed in the same issues', async () => {
    const db = makeD1();
    await seed(db, { issue_number: 1, source_url: 'x://1' }, ['governance', 'trust', 'civic repair']);
    await seed(db, { issue_number: 2, source_url: 'x://2' }, ['governance', 'trust']);
    await seed(db, { issue_number: 3, source_url: 'x://3' }, ['governance', 'alignment']);
    await seed(db, { issue_number: 4, source_url: 'x://4' }, ['ai']);

    const adj = await getAdjacentTopics(db as any, 'governance');
    const map = new Map(adj.map(a => [a.keyword, a.cooccurrence]));
    // 'trust' co-occurs with governance in issues 1 and 2 → 2
    expect(map.get('trust')).toBe(2);
    // 'civic repair' and 'alignment' each co-occur once
    expect(map.get('civic repair')).toBe(1);
    expect(map.get('alignment')).toBe(1);
    // 'ai' never co-occurs → not present
    expect(map.has('ai')).toBe(false);
    // The seed itself is excluded from results
    expect(map.has('governance')).toBe(false);
  });

  it('orders by descending co-occurrence', async () => {
    const db = makeD1();
    await seed(db, { issue_number: 1, source_url: 'x://1' }, ['a', 'b', 'c']);
    await seed(db, { issue_number: 2, source_url: 'x://2' }, ['a', 'b']);
    await seed(db, { issue_number: 3, source_url: 'x://3' }, ['a', 'b']);
    await seed(db, { issue_number: 4, source_url: 'x://4' }, ['a', 'c']);

    const adj = await getAdjacentTopics(db as any, 'a');
    expect(adj[0].keyword).toBe('b'); // 3 co-occurrences
    expect(adj[1].keyword).toBe('c'); // 2 co-occurrences
  });

  it('respects the limit', async () => {
    const db = makeD1();
    const partners = ['p1', 'p2', 'p3', 'p4', 'p5'];
    for (let i = 0; i < partners.length; i++) {
      await seed(db, { issue_number: i + 1, source_url: 'x://' + i }, ['anchor', partners[i]]);
    }
    const adj = await getAdjacentTopics(db as any, 'anchor', 2);
    expect(adj.length).toBe(2);
  });

  it('returns empty for unknown keyword', async () => {
    const db = makeD1();
    await seed(db, { issue_number: 1, source_url: 'x://1' }, ['governance']);
    const adj = await getAdjacentTopics(db as any, 'no-such-topic');
    expect(adj).toEqual([]);
  });
});

describe('GET /topics/:keyword exposes adjacent topics + timeline', () => {
  function makeApp(db: ReturnType<typeof makeD1>) {
    const app = new Hono<{ Bindings: { DB: D1Database } }>();
    app.route('/', topicRoutes);
    return { app, env: { DB: db as any } };
  }

  it('returns adjacent topics in the response', async () => {
    const db = makeD1();
    await seed(db, { issue_number: 1, source_url: 'x://1', published_at: '2024-01-01', year: 2024, month: 1 }, ['governance', 'trust']);
    await seed(db, { issue_number: 2, source_url: 'x://2', published_at: '2024-02-01', year: 2024, month: 2 }, ['governance', 'trust', 'civic repair']);
    await buildCorpusTopics(db as any, { minDocFrequency: 2 });
    await buildTopicTimeline(db as any);

    const { app, env } = makeApp(db);
    const res = await app.request('/topics/governance', {}, env);
    const body = await res.json() as { adjacent: Array<{ keyword: string }> };
    expect(body.adjacent).toBeDefined();
    expect(body.adjacent.find(a => a.keyword === 'trust')).toBeDefined();
  });
});
