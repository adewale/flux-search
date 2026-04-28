import { describe, it, expect } from 'vitest';
import { makeD1, seedIssue } from './helpers-d1';
import { persistIssueTopics } from '../src/lib/topic-extractor';
import { getTopicsByIssueId } from '../src/db/topic-queries';

const FLUX_TEXT = `
Institutional trust is collapsing. Every conversation about governance,
from city councils to large language models, now begins with the question
of legitimacy. When civic repair becomes a line item on a product roadmap,
something has shifted. Institutional trust does not recover by accident;
it recovers through design. Large language models may make institutional
trust harder to rebuild by eroding the shared factual substrate that
legitimacy depends upon.
`.repeat(3);

describe('persistIssueTopics', () => {
  it('extracts and persists topics for the issue', async () => {
    const db = makeD1();
    const id = await seedIssue(db as any, { full_text_plain: FLUX_TEXT });

    await persistIssueTopics(db as any, id, FLUX_TEXT);

    const topics = await getTopicsByIssueId(db as any, id);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.map(t => t.keyword)).toContain('institutional trust');
  });

  it('is a no-op on empty text (no topics inserted)', async () => {
    const db = makeD1();
    const id = await seedIssue(db as any);

    await persistIssueTopics(db as any, id, '');

    const topics = await getTopicsByIssueId(db as any, id);
    expect(topics).toEqual([]);
  });

  it('is a no-op on null text', async () => {
    const db = makeD1();
    const id = await seedIssue(db as any);

    await persistIssueTopics(db as any, id, null);

    const topics = await getTopicsByIssueId(db as any, id);
    expect(topics).toEqual([]);
  });

  it('replaces topics on re-run (not accumulating)', async () => {
    const db = makeD1();
    const id = await seedIssue(db as any, { full_text_plain: FLUX_TEXT });

    await persistIssueTopics(db as any, id, FLUX_TEXT);
    const first = await getTopicsByIssueId(db as any, id);

    await persistIssueTopics(db as any, id, FLUX_TEXT);
    const second = await getTopicsByIssueId(db as any, id);

    expect(second.length).toBe(first.length);
    expect(second.map(t => t.keyword)).toEqual(first.map(t => t.keyword));
  });

  it('does not throw when extraction fails on unusual input', async () => {
    const db = makeD1();
    const id = await seedIssue(db as any);

    await expect(persistIssueTopics(db as any, id, '\u0000\u0000\u0000')).resolves.not.toThrow();
  });
});
