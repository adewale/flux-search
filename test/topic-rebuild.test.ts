import { describe, it, expect } from 'vitest';
import { makeD1, seedIssue } from './helpers-d1';
import { rebuildAllTopics } from '../src/lib/topic-rebuild';
import { getTopicsByIssueId, getCorpusTopics, getTopicTimeline } from '../src/db/topic-queries';

const SAMPLE = `
Institutional trust collapses. Governance conversations circle the question
of legitimacy. Civic repair becomes a line item. Institutional trust does
not recover by accident. Large language models may erode the shared factual
substrate that legitimacy depends upon.
`.repeat(5);

describe('rebuildAllTopics', () => {
  it('extracts topics for every active issue and builds aggregates', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, {
      issue_number: 1, published_at: '2024-01-01', year: 2024, month: 1,
      full_text_plain: SAMPLE,
    });
    const b = await seedIssue(db as any, {
      issue_number: 2, published_at: '2024-06-15', year: 2024, month: 6,
      full_text_plain: SAMPLE,
    });

    const stats = await rebuildAllTopics(db as any, { minDocFrequency: 2 });

    expect(stats.issues_processed).toBe(2);
    expect(stats.corpus_topics).toBeGreaterThan(0);
    expect(stats.timeline_rows).toBeGreaterThan(0);
    expect(stats.lexicon_phrases).toBeGreaterThanOrEqual(0);

    const aTopics = await getTopicsByIssueId(db as any, a);
    const bTopics = await getTopicsByIssueId(db as any, b);
    expect(aTopics.length).toBeGreaterThan(0);
    expect(bTopics.length).toBeGreaterThan(0);

    const corpus = await getCorpusTopics(db as any);
    // "institutional trust" appears in both issues → should be a corpus topic
    expect(corpus.find(c => c.keyword === 'institutional trust')).toBeDefined();

    const timeline = await getTopicTimeline(db as any, 'institutional trust');
    expect(timeline.length).toBeGreaterThan(0);
  });

  it('skips inactive issues', async () => {
    const db = makeD1();
    await seedIssue(db as any, {
      issue_number: 1, status: 'quarantined', full_text_plain: SAMPLE,
    });

    const stats = await rebuildAllTopics(db as any);
    expect(stats.issues_processed).toBe(0);
  });

  it('is idempotent across repeated runs', async () => {
    const db = makeD1();
    await seedIssue(db as any, {
      issue_number: 1, published_at: '2024-01-01', year: 2024, month: 1,
      full_text_plain: SAMPLE,
    });
    await seedIssue(db as any, {
      issue_number: 2, published_at: '2024-06-01', year: 2024, month: 6,
      full_text_plain: SAMPLE,
    });

    await rebuildAllTopics(db as any, { minDocFrequency: 2 });
    const first = await getCorpusTopics(db as any);

    await rebuildAllTopics(db as any, { minDocFrequency: 2 });
    const second = await getCorpusTopics(db as any);

    const strip = (rows: typeof first) => rows.map(r => ({ ...r, updated_at: '_' }));
    expect(strip(second)).toEqual(strip(first));
  });

  it('does not crash when corpus is empty', async () => {
    const db = makeD1();
    const stats = await rebuildAllTopics(db as any);
    expect(stats.issues_processed).toBe(0);
    expect(stats.corpus_topics).toBe(0);
    expect(stats.timeline_rows).toBe(0);
  });
});
