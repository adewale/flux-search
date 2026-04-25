/**
 * Integration tests for topic surfaces in the HTTP API.
 *
 * Each route is a seam that the frontend depends on:
 * - GET /issues/:id           → issue-page sticky side panel
 * - GET /latest-issue         → landing card
 * - GET /search               → result-card topic subtitle
 * - GET /topics               → landing "Recurring themes" strip + /topics page
 * - GET /topics/:keyword      → topic detail page
 *
 * Using Hono's `app.request` so we exercise the real handlers without a
 * running worker. The DB is the real node:sqlite shim.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { makeD1, seedIssue } from './helpers-d1';
import { replaceIssueTopics, buildCorpusTopics, buildTopicTimeline } from '../src/db/topic-queries';
import { issueRoutes } from '../src/routes/issues';
import { searchRoutes } from '../src/routes/search';
import { topicRoutes } from '../src/routes/topics';

type Env = { DB: D1Database };

function makeApp(db: ReturnType<typeof makeD1>) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', issueRoutes);
  app.route('/', searchRoutes);
  app.route('/', topicRoutes);
  return {
    app,
    env: { DB: db as any } as Env,
  };
}

async function seedWithTopics(
  db: ReturnType<typeof makeD1>,
  issue: Parameters<typeof seedIssue>[1],
  keywords: Array<{ keyword: string; display?: string; rank?: number; score?: number }>,
): Promise<string> {
  const id = await seedIssue(db as any, issue);
  await replaceIssueTopics(
    db as any,
    id,
    keywords.map((k, i) => ({
      keyword: k.keyword,
      keyword_display: k.display ?? k.keyword,
      score: k.score ?? 0.1 * (i + 1),
      rank: k.rank ?? i + 1,
      ngram_size: k.keyword.split(' ').length,
    })),
  );
  return id;
}

describe('GET /issues/:id → topics', () => {
  it('includes a topics array sorted by rank', async () => {
    const db = makeD1();
    const id = await seedWithTopics(db, { issue_number: 42 }, [
      { keyword: 'institutional trust', display: 'Institutional Trust', rank: 1, score: 0.1 },
      { keyword: 'civic repair', display: 'Civic Repair', rank: 2, score: 0.2 },
      { keyword: 'legitimacy', display: 'Legitimacy', rank: 3, score: 0.3 },
    ]);

    const { app, env } = makeApp(db);
    const res = await app.request(`/issues/${id}`, {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { topics: Array<{ keyword: string; keyword_display: string }> };
    expect(body.topics).toBeDefined();
    expect(body.topics).toHaveLength(3);
    expect(body.topics[0].keyword).toBe('institutional trust');
    expect(body.topics[0].keyword_display).toBe('Institutional Trust');
  });

  it('returns empty topics array for an issue without topics', async () => {
    const db = makeD1();
    const id = await seedIssue(db as any, { issue_number: 1 });
    const { app, env } = makeApp(db);
    const res = await app.request(`/issues/${id}`, {}, env);
    const body = await res.json() as { topics: unknown[] };
    expect(body.topics).toEqual([]);
  });
});

describe('GET /issues/issue/:number/sections → topics', () => {
  it('includes topics for the issue page', async () => {
    const db = makeD1();
    await seedWithTopics(
      db,
      { issue_number: 7, source_url: 'x://7' },
      [
        { keyword: 'governance', display: 'Governance' },
        { keyword: 'civic repair', display: 'Civic Repair' },
      ],
    );
    const { app, env } = makeApp(db);
    const res = await app.request('/issues/issue/7/sections', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { topics: Array<{ keyword: string }> };
    expect(body.topics.map(t => t.keyword)).toEqual(['governance', 'civic repair']);
  });
});

describe('GET /search → per-result topics', () => {
  it('attaches topic chips to filter-only result cards', async () => {
    const db = makeD1();
    await seedWithTopics(
      db,
      { issue_number: 1, source_url: 'x://1', published_at: '2024-01-01', year: 2024, month: 1 },
      [
        { keyword: 'institutional trust', display: 'Institutional Trust' },
        { keyword: 'governance', display: 'Governance' },
      ],
    );
    await seedWithTopics(
      db,
      { issue_number: 2, source_url: 'x://2', published_at: '2024-06-01', year: 2024, month: 6 },
      [
        { keyword: 'alignment', display: 'Alignment' },
      ],
    );

    const { app, env } = makeApp(db);
    const res = await app.request('/search?q=year:2024', {}, env);
    const body = await res.json() as { results: Array<{ topics?: string[] }> };
    expect(body.results.length).toBe(2);
    for (const r of body.results) {
      expect(r.topics).toBeDefined();
      expect(Array.isArray(r.topics)).toBe(true);
    }
    const all = body.results.flatMap(r => r.topics ?? []);
    expect(all).toContain('Institutional Trust');
    expect(all).toContain('Alignment');
  });
});

describe('GET /topics (corpus index)', () => {
  it('returns corpus topics ranked by aggregate score', async () => {
    const db = makeD1();
    const bothKeys = [
      { keyword: 'governance', display: 'governance', rank: 1, score: 0.1 },
    ];
    await seedWithTopics(
      db,
      { issue_number: 1, source_url: 'x://1', published_at: '2024-01-01', year: 2024, month: 1 },
      bothKeys,
    );
    await seedWithTopics(
      db,
      { issue_number: 2, source_url: 'x://2', published_at: '2024-02-01', year: 2024, month: 2 },
      bothKeys,
    );
    await buildCorpusTopics(db as any);
    await buildTopicTimeline(db as any);

    const { app, env } = makeApp(db);
    const res = await app.request('/topics', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { topics: Array<{ keyword: string; doc_frequency: number }> };
    expect(body.topics.length).toBeGreaterThan(0);
    const gov = body.topics.find(t => t.keyword === 'governance');
    expect(gov).toBeDefined();
    expect(gov!.doc_frequency).toBe(2);
  });

  it('supports ?sort=recency', async () => {
    const db = makeD1();
    await seedWithTopics(
      db,
      { issue_number: 1, source_url: 'x://1', published_at: '2023-01-01', year: 2023, month: 1 },
      [{ keyword: 'old', display: 'old', rank: 1, score: 0.1 }],
    );
    await seedWithTopics(
      db,
      { issue_number: 2, source_url: 'x://2', published_at: '2023-02-01', year: 2023, month: 2 },
      [{ keyword: 'old', display: 'old', rank: 1, score: 0.1 }],
    );
    await seedWithTopics(
      db,
      { issue_number: 3, source_url: 'x://3', published_at: '2024-01-01', year: 2024, month: 1 },
      [{ keyword: 'fresh', display: 'fresh', rank: 1, score: 0.1 }],
    );
    await seedWithTopics(
      db,
      { issue_number: 4, source_url: 'x://4', published_at: '2024-02-01', year: 2024, month: 2 },
      [{ keyword: 'fresh', display: 'fresh', rank: 1, score: 0.1 }],
    );
    await buildCorpusTopics(db as any);

    const { app, env } = makeApp(db);
    const res = await app.request('/topics?sort=recency', {}, env);
    const body = await res.json() as { topics: Array<{ keyword: string }> };
    expect(body.topics[0].keyword).toBe('fresh');
  });
});

describe('GET /topics/:keyword', () => {
  it('returns issues that reference the topic, plus timeline', async () => {
    const db = makeD1();
    const a = await seedWithTopics(
      db,
      { issue_number: 1, source_url: 'x://1', published_at: '2024-01-01', year: 2024, month: 1 },
      [{ keyword: 'governance', display: 'Governance', rank: 1, score: 0.1 }],
    );
    const b = await seedWithTopics(
      db,
      { issue_number: 2, source_url: 'x://2', published_at: '2024-06-01', year: 2024, month: 6 },
      [{ keyword: 'governance', display: 'Governance', rank: 1, score: 0.1 }],
    );
    await seedWithTopics(
      db,
      { issue_number: 3, source_url: 'x://3', published_at: '2024-07-01', year: 2024, month: 7 },
      [{ keyword: 'other', display: 'Other', rank: 1, score: 0.1 }],
    );
    await buildCorpusTopics(db as any);
    await buildTopicTimeline(db as any);

    const { app, env } = makeApp(db);
    const res = await app.request('/topics/governance', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      keyword: string;
      keyword_display: string;
      issues: Array<{ issue_id: string }>;
      timeline: Array<{ year: number; month: number; occurrences: number }>;
    };
    expect(body.keyword).toBe('governance');
    expect(body.keyword_display).toBe('Governance');
    const ids = body.issues.map(i => i.issue_id).sort();
    expect(ids).toEqual([a, b].sort());
    expect(body.timeline.length).toBe(2);
  });

  it('returns 404 for an unknown topic', async () => {
    const db = makeD1();
    const { app, env } = makeApp(db);
    const res = await app.request('/topics/not-a-topic', {}, env);
    expect(res.status).toBe(404);
  });

  it('normalizes the keyword (URL decode + lowercase + collapse spaces)', async () => {
    const db = makeD1();
    await seedWithTopics(
      db,
      { issue_number: 1, source_url: 'x://1', published_at: '2024-01-01', year: 2024, month: 1 },
      [{ keyword: 'institutional trust', display: 'Institutional Trust', rank: 1, score: 0.1 }],
    );
    await seedWithTopics(
      db,
      { issue_number: 2, source_url: 'x://2', published_at: '2024-02-01', year: 2024, month: 2 },
      [{ keyword: 'institutional trust', display: 'Institutional Trust', rank: 1, score: 0.1 }],
    );
    await buildCorpusTopics(db as any);

    const { app, env } = makeApp(db);
    const res = await app.request('/topics/Institutional%20Trust', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { keyword: string };
    expect(body.keyword).toBe('institutional trust');
  });
});
