import { describe, it, expect, beforeEach } from 'vitest';
import { makeD1, seedIssue, type D1Like } from './helpers-d1';
import type { ExtractedTopic } from '../src/lib/topic-extractor';
import {
  replaceIssueTopics,
  getTopicsByIssueId,
  getTopicsForIssueIds,
  getIssueIdsByTopic,
  getBlocklist,
  addToBlocklist,
  buildCorpusTopics,
  buildTopicTimeline,
  getCorpusTopics,
  getTopicTimeline,
  getRelatedIssuesByTopic,
} from '../src/db/topic-queries';

function topic(partial: Partial<ExtractedTopic> & { keyword: string; rank: number }): ExtractedTopic {
  return {
    keyword: partial.keyword,
    keyword_display: partial.keyword_display ?? partial.keyword,
    score: partial.score ?? 0.1 * partial.rank,
    rank: partial.rank,
    ngram_size: partial.ngram_size ?? partial.keyword.split(' ').length,
  };
}

describe('replaceIssueTopics', () => {
  let db: D1Like;
  let issueId: string;

  beforeEach(async () => {
    db = makeD1();
    issueId = await seedIssue(db as any);
  });

  it('inserts topics for an issue', async () => {
    await replaceIssueTopics(db as any, issueId, [
      topic({ keyword: 'trust', rank: 1 }),
      topic({ keyword: 'legitimacy', rank: 2 }),
    ]);

    const rows = await getTopicsByIssueId(db as any, issueId);
    expect(rows).toHaveLength(2);
    expect(rows[0].keyword).toBe('trust');
    expect(rows[0].rank).toBe(1);
    expect(rows[1].keyword).toBe('legitimacy');
  });

  it('replaces prior topics (no accumulation)', async () => {
    await replaceIssueTopics(db as any, issueId, [topic({ keyword: 'trust', rank: 1 })]);
    await replaceIssueTopics(db as any, issueId, [
      topic({ keyword: 'legitimacy', rank: 1 }),
      topic({ keyword: 'governance', rank: 2 }),
    ]);

    const rows = await getTopicsByIssueId(db as any, issueId);
    expect(rows.map(r => r.keyword)).toEqual(['legitimacy', 'governance']);
  });

  it('handles empty topic list (clears existing)', async () => {
    await replaceIssueTopics(db as any, issueId, [topic({ keyword: 'trust', rank: 1 })]);
    await replaceIssueTopics(db as any, issueId, []);

    const rows = await getTopicsByIssueId(db as any, issueId);
    expect(rows).toEqual([]);
  });

  it('is idempotent when called twice with identical topics', async () => {
    const topics = [
      topic({ keyword: 'trust', rank: 1, score: 0.05 }),
      topic({ keyword: 'governance', rank: 2, score: 0.08 }),
    ];
    await replaceIssueTopics(db as any, issueId, topics);
    const first = await getTopicsByIssueId(db as any, issueId);
    await replaceIssueTopics(db as any, issueId, topics);
    const second = await getTopicsByIssueId(db as any, issueId);
    expect(second).toEqual(first);
  });

  it('cascades on issue deletion (ON DELETE CASCADE)', async () => {
    await replaceIssueTopics(db as any, issueId, [topic({ keyword: 'trust', rank: 1 })]);
    db._sqlite.prepare('DELETE FROM issues WHERE id = ?').run(issueId);

    const rows = await getTopicsByIssueId(db as any, issueId);
    expect(rows).toEqual([]);
  });
});

describe('getTopicsForIssueIds', () => {
  it('returns empty map for empty input', async () => {
    const db = makeD1();
    const result = await getTopicsForIssueIds(db as any, []);
    expect(result.size).toBe(0);
  });

  it('returns top-N topics per issue, ordered by rank', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, { issue_number: 1 });
    const b = await seedIssue(db as any, { issue_number: 2 });

    await replaceIssueTopics(db as any, a, [
      topic({ keyword: 'trust', rank: 1 }),
      topic({ keyword: 'legitimacy', rank: 2 }),
      topic({ keyword: 'civic repair', rank: 3 }),
      topic({ keyword: 'governance', rank: 4 }),
    ]);
    await replaceIssueTopics(db as any, b, [
      topic({ keyword: 'ai safety', rank: 1 }),
    ]);

    const result = await getTopicsForIssueIds(db as any, [a, b], 3);
    expect(result.get(a)).toEqual(['trust', 'legitimacy', 'civic repair']);
    expect(result.get(b)).toEqual(['ai safety']);
  });
});

describe('getIssueIdsByTopic', () => {
  it('returns issue ids where the keyword appears', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, { issue_number: 1 });
    const b = await seedIssue(db as any, { issue_number: 2 });
    const c = await seedIssue(db as any, { issue_number: 3 });

    await replaceIssueTopics(db as any, a, [topic({ keyword: 'trust', rank: 1 })]);
    await replaceIssueTopics(db as any, b, [topic({ keyword: 'other', rank: 1 })]);
    await replaceIssueTopics(db as any, c, [topic({ keyword: 'trust', rank: 2 })]);

    const ids = await getIssueIdsByTopic(db as any, 'trust');
    expect(ids.sort()).toEqual([a, c].sort());
  });

  it('returns empty array for unknown keyword', async () => {
    const db = makeD1();
    const ids = await getIssueIdsByTopic(db as any, 'nope');
    expect(ids).toEqual([]);
  });
});

describe('blocklist', () => {
  it('round-trips entries', async () => {
    const db = makeD1();
    // Migration 0007 seeds a domain-specific blocklist; the test
    // asserts user-added entries land alongside the seeds.
    const initial = await getBlocklist(db as any);
    const seedSize = initial.size;

    await addToBlocklist(db as any, 'flux review', 'masthead');
    await addToBlocklist(db as any, 'read more');

    const blocklist = await getBlocklist(db as any);
    expect(blocklist.has('flux review')).toBe(true);
    expect(blocklist.has('read more')).toBe(true);
    // 'flux review' is already a seed, so size grows by 1 (just 'read more').
    expect(blocklist.size).toBe(seedSize + 1);
  });

  it('addToBlocklist is idempotent on repeated inserts', async () => {
    const db = makeD1();
    const before = (await getBlocklist(db as any)).size;
    await addToBlocklist(db as any, 'same-key-not-in-seed', 'reason-1');
    await addToBlocklist(db as any, 'same-key-not-in-seed', 'reason-2');
    const blocklist = await getBlocklist(db as any);
    expect(blocklist.size).toBe(before + 1);
  });
});

describe('buildCorpusTopics', () => {
  it('uses background English frequencies to rank Flux-distinctive phrases above generic phrases', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, { issue_number: 1 });
    const b = await seedIssue(db as any, { issue_number: 2 });
    const c = await seedIssue(db as any, { issue_number: 3 });

    for (const issueId of [a, b, c]) {
      await replaceIssueTopics(db as any, issueId, [
        topic({ keyword: 'systems thinking', keyword_display: 'Systems Thinking', rank: 1, score: 0.05 }),
        topic({ keyword: 'good ideas', keyword_display: 'Good Ideas', rank: 2, score: 0.05 }),
      ]);
    }

    await buildCorpusTopics(db as any, { minDocFrequency: 3 });
    const corpus = await getCorpusTopics(db as any, { limit: 10 });
    const systems = corpus.find(t => t.keyword === 'systems thinking')!;
    const generic = corpus.find(t => t.keyword === 'good ideas')!;

    expect(systems.aggregate_score).toBeGreaterThan(generic.aggregate_score);
  });

  it('prunes nested shorter phrases when they mostly occur inside a longer topic', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, { issue_number: 1 });
    const b = await seedIssue(db as any, { issue_number: 2 });
    const c = await seedIssue(db as any, { issue_number: 3 });

    await replaceIssueTopics(db as any, a, [
      topic({ keyword: 'language models', keyword_display: 'Language Models', rank: 1 }),
      topic({ keyword: 'large language models', keyword_display: 'Large Language Models', rank: 2 }),
    ]);
    await replaceIssueTopics(db as any, b, [
      topic({ keyword: 'language models', keyword_display: 'Language Models', rank: 1 }),
      topic({ keyword: 'large language models', keyword_display: 'Large Language Models', rank: 2 }),
    ]);
    await replaceIssueTopics(db as any, c, [
      topic({ keyword: 'large language models', keyword_display: 'Large Language Models', rank: 1 }),
    ]);

    await buildCorpusTopics(db as any, { minDocFrequency: 2 });
    const corpus = await getCorpusTopics(db as any, { limit: 10 });

    expect(corpus.map(t => t.keyword)).toContain('large language models');
    expect(corpus.map(t => t.keyword)).not.toContain('language models');
  });

  it('carries the dominant non-unknown topic_type into corpus_topics', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, { issue_number: 1 });
    const b = await seedIssue(db as any, { issue_number: 2 });
    const c = await seedIssue(db as any, { issue_number: 3 });

    await replaceIssueTopics(db as any, a, [{ ...topic({ keyword: 'attention', rank: 1 }), topic_type: 'theme' }]);
    await replaceIssueTopics(db as any, b, [{ ...topic({ keyword: 'attention', rank: 1 }), topic_type: 'theme' }]);
    await replaceIssueTopics(db as any, c, [{ ...topic({ keyword: 'attention', rank: 1 }), topic_type: 'unknown' }]);

    await buildCorpusTopics(db as any, { minDocFrequency: 3 });
    const row = (await getCorpusTopics(db as any)).find(r => r.keyword === 'attention');
    expect(row?.topic_type).toBe('theme');
    expect(row?.quality_status).toBe('valid');
    expect(row?.eligibility_status).toBe('public_topic');
  });

  it('keeps crypto and cryptocurrency separate but demotes cryptocurrency in public corpus ranking', async () => {
    const db = makeD1();
    for (let i = 1; i <= 3; i++) {
      const issue = await seedIssue(db as any, { issue_number: i });
      await replaceIssueTopics(db as any, issue, [
        { ...topic({ keyword: 'crypto', keyword_display: 'Crypto', rank: 1, score: 0.05 }), topic_type: 'technology' },
        { ...topic({ keyword: 'cryptocurrency', keyword_display: 'Cryptocurrency', rank: 2, score: 0.05 }), topic_type: 'technology' },
      ]);
    }

    await buildCorpusTopics(db as any, { minDocFrequency: 3 });
    const corpus = await getCorpusTopics(db as any, { limit: 10 });
    const crypto = corpus.find(r => r.keyword === 'crypto')!;
    const cryptocurrency = corpus.find(r => r.keyword === 'cryptocurrency')!;
    expect(crypto).toBeDefined();
    expect(cryptocurrency).toBeDefined();
    expect(crypto.aggregate_score).toBeGreaterThan(cryptocurrency.aggregate_score);
  });

  it('aggregates keyword frequencies across issues', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, { issue_number: 1, published_at: '2024-01-01' });
    const b = await seedIssue(db as any, { issue_number: 2, published_at: '2024-06-01' });
    const c = await seedIssue(db as any, { issue_number: 3, published_at: '2024-12-01' });

    await replaceIssueTopics(db as any, a, [
      topic({ keyword: 'trust-rare', rank: 1, score: 0.05 }),
      topic({ keyword: 'once', rank: 2, score: 0.1 }),
    ]);
    await replaceIssueTopics(db as any, b, [
      topic({ keyword: 'trust-rare', rank: 1, score: 0.07 }),
    ]);
    await replaceIssueTopics(db as any, c, [
      topic({ keyword: 'trust-rare', rank: 1, score: 0.03 }),
    ]);

    await buildCorpusTopics(db as any, { minDocFrequency: 3 });

    const corpus = await getCorpusTopics(db as any);
    const trust = corpus.find(r => r.keyword === 'trust-rare');
    expect(trust).toBeDefined();
    expect(trust!.doc_frequency).toBe(3);
    expect(trust!.avg_score).toBeCloseTo(0.05, 2);
    expect(trust!.first_seen).toBe('2024-01-01');
    expect(trust!.last_seen).toBe('2024-12-01');
  });

  it('drops keywords below the doc-frequency threshold', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, { issue_number: 1 });

    await replaceIssueTopics(db as any, a, [
      topic({ keyword: 'hapax', rank: 1 }),
    ]);

    await buildCorpusTopics(db as any);
    const corpus = await getCorpusTopics(db as any);
    expect(corpus.find(r => r.keyword === 'hapax')).toBeUndefined();
  });

  it('excludes blocklisted keywords', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, { issue_number: 1 });
    const b = await seedIssue(db as any, { issue_number: 2 });

    // 'subscribe' is in the seeded migration blocklist already.
    await replaceIssueTopics(db as any, a, [topic({ keyword: 'subscribe', rank: 1 })]);
    await replaceIssueTopics(db as any, b, [topic({ keyword: 'subscribe', rank: 1 })]);

    await buildCorpusTopics(db as any, { minDocFrequency: 2 });

    const corpus = await getCorpusTopics(db as any);
    expect(corpus.find(r => r.keyword === 'subscribe')).toBeUndefined();
  });

  it('aggregate_score = doc_frequency / avg_score (higher is better)', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, { issue_number: 1 });
    const b = await seedIssue(db as any, { issue_number: 2 });

    // Both keywords appear in 2 issues; differ only in YAKE score.
    await replaceIssueTopics(db as any, a, [
      topic({ keyword: 'rare', rank: 1, score: 0.01 }),
      topic({ keyword: 'weak', rank: 2, score: 0.5 }),
    ]);
    await replaceIssueTopics(db as any, b, [
      topic({ keyword: 'rare', rank: 1, score: 0.01 }),
      topic({ keyword: 'weak', rank: 2, score: 0.5 }),
    ]);

    await buildCorpusTopics(db as any, { minDocFrequency: 2 });

    const rare = (await getCorpusTopics(db as any)).find(r => r.keyword === 'rare');
    const weak = (await getCorpusTopics(db as any)).find(r => r.keyword === 'weak');
    expect(rare).toBeDefined();
    expect(weak).toBeDefined();
    // rare (score 0.01, df=2) beats weak (score 0.5, df=2) because lower YAKE score → higher aggregate
    expect(rare!.aggregate_score).toBeGreaterThan(weak!.aggregate_score);
  });

  it('is idempotent — running twice yields the same table', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, { issue_number: 1 });
    const b = await seedIssue(db as any, { issue_number: 2 });
    await replaceIssueTopics(db as any, a, [topic({ keyword: 'trust', rank: 1, score: 0.05 })]);
    await replaceIssueTopics(db as any, b, [topic({ keyword: 'trust', rank: 1, score: 0.07 })]);

    await buildCorpusTopics(db as any, { minDocFrequency: 2 });
    const first = await getCorpusTopics(db as any);

    await buildCorpusTopics(db as any, { minDocFrequency: 2 });
    const second = await getCorpusTopics(db as any);

    // updated_at moves; everything else stays stable
    const stripUpdated = (rows: typeof first) =>
      rows.map(r => ({ ...r, updated_at: '_' }));
    expect(stripUpdated(second)).toEqual(stripUpdated(first));
  });
});

describe('buildTopicTimeline', () => {
  it('groups occurrences by year/month', async () => {
    const db = makeD1();
    const jan = await seedIssue(db as any, { issue_number: 1, published_at: '2024-01-15', year: 2024, month: 1 });
    const jun = await seedIssue(db as any, { issue_number: 2, published_at: '2024-06-15', year: 2024, month: 6 });
    const jun2 = await seedIssue(db as any, { issue_number: 3, published_at: '2024-06-22', year: 2024, month: 6 });

    await replaceIssueTopics(db as any, jan, [topic({ keyword: 'trust', rank: 1 })]);
    await replaceIssueTopics(db as any, jun, [topic({ keyword: 'trust', rank: 1 })]);
    await replaceIssueTopics(db as any, jun2, [topic({ keyword: 'trust', rank: 1 })]);

    await buildTopicTimeline(db as any);

    const timeline = await getTopicTimeline(db as any, 'trust');
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ year: 2024, month: 1, occurrences: 1 });
    expect(timeline[1]).toMatchObject({ year: 2024, month: 6, occurrences: 2 });
  });

  it('returns empty array for unknown keyword', async () => {
    const db = makeD1();
    const timeline = await getTopicTimeline(db as any, 'unknown');
    expect(timeline).toEqual([]);
  });
});

describe('getRelatedIssuesByTopic', () => {
  it('returns issues sharing topics, ordered by overlap desc', async () => {
    const db = makeD1();
    const anchor = await seedIssue(db as any, { issue_number: 1 });
    const closest = await seedIssue(db as any, { issue_number: 2 });
    const partial = await seedIssue(db as any, { issue_number: 3 });
    const unrelated = await seedIssue(db as any, { issue_number: 4 });

    await replaceIssueTopics(db as any, anchor, [
      topic({ keyword: 'trust', rank: 1 }),
      topic({ keyword: 'legitimacy', rank: 2 }),
      topic({ keyword: 'governance', rank: 3 }),
    ]);
    await replaceIssueTopics(db as any, closest, [
      topic({ keyword: 'trust', rank: 1 }),
      topic({ keyword: 'legitimacy', rank: 2 }),
      topic({ keyword: 'governance', rank: 3 }),
    ]);
    await replaceIssueTopics(db as any, partial, [
      topic({ keyword: 'trust', rank: 1 }),
    ]);
    await replaceIssueTopics(db as any, unrelated, [
      topic({ keyword: 'something else', rank: 1 }),
    ]);

    const related = await getRelatedIssuesByTopic(db as any, anchor, 5);

    expect(related[0].issue_id).toBe(closest);
    expect(related[0].overlap).toBe(3);
    expect(related[1].issue_id).toBe(partial);
    expect(related[1].overlap).toBe(1);
    expect(related.find(r => r.issue_id === unrelated)).toBeUndefined();
    expect(related.find(r => r.issue_id === anchor)).toBeUndefined();
  });
});
