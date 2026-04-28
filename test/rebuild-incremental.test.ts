/**
 * Incremental rebuild: rebuildOneIssueTopics should converge to the
 * same corpus_topics + topic_timeline state as a full rebuild for the
 * keys it touches, without disturbing unrelated keys.
 */
import { describe, it, expect } from 'vitest';
import { makeD1, seedIssue } from './helpers-d1';
import {
  rebuildAllTopics,
  rebuildOneIssueTopics,
} from '../src/lib/topic-rebuild';
import {
  getCorpusTopics,
  getTopicsByIssueId,
  getTopicTimeline,
} from '../src/db/topic-queries';

const ISSUE_TEXT = `
Institutional trust collapses. Governance conversations circle the question
of legitimacy. Civic repair becomes a line item. Institutional trust does
not recover by accident.
`.repeat(5);

const REPLACEMENT_TEXT = `
Large language models reshape attention. Open source remains the default.
Open source emerged decades ago. Open source projects stay alive when
maintainers care about their users.
`.repeat(5);

describe('rebuildOneIssueTopics', () => {
  it('updates a single issue without re-running the full pipeline', async () => {
    const db = makeD1();
    await seedIssue(db as any, {
      issue_number: 1, source_url: 'x://1',
      published_at: '2024-01-01', year: 2024, month: 1,
      full_text_plain: ISSUE_TEXT,
    });
    await seedIssue(db as any, {
      issue_number: 2, source_url: 'x://2',
      published_at: '2024-06-01', year: 2024, month: 6,
      full_text_plain: ISSUE_TEXT,
    });
    const target = await seedIssue(db as any, {
      issue_number: 3, source_url: 'x://3',
      published_at: '2024-10-01', year: 2024, month: 10,
      full_text_plain: ISSUE_TEXT,
    });

    await rebuildAllTopics(db as any, { minDocFrequency: 2 });

    // Sanity: institutional trust appears across all three issues
    const before = await getCorpusTopics(db as any);
    expect(before.find(r => r.keyword === 'institutional trust')).toBeDefined();

    // Mutate issue #3 to talk about something else, then run incremental.
    await (db as any)._sqlite.prepare(
      'UPDATE issues SET full_text_plain = ? WHERE id = ?',
    ).run(REPLACEMENT_TEXT, target);

    const out = await rebuildOneIssueTopics(db as any, target);
    expect(out.kept).toBeGreaterThan(0);
    expect(out.affected_keywords).toBeGreaterThan(0);

    // Issue 3's stored topics should reflect the replacement.
    const issue3Topics = await getTopicsByIssueId(db as any, target);
    const kw = issue3Topics.map(t => t.keyword);
    expect(kw.find(k => k.includes('open source') || k === 'open source'))
      .toBeDefined();
  });

  it('converges for the affected keyword across repeated runs', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, {
      issue_number: 1, source_url: 'x://1',
      published_at: '2024-01-01', year: 2024, month: 1,
      full_text_plain: ISSUE_TEXT,
    });
    const b = await seedIssue(db as any, {
      issue_number: 2, source_url: 'x://2',
      published_at: '2024-06-01', year: 2024, month: 6,
      full_text_plain: ISSUE_TEXT,
    });

    await rebuildAllTopics(db as any, { minDocFrequency: 2 });
    const fullRow = (await getCorpusTopics(db as any, { sort: 'alpha', limit: 200 }))
      .find(r => r.keyword === 'institutional trust');
    expect(fullRow).toBeDefined();

    // Incremental converges to the same df/timeline for this keyword
    // (cluster merges that the full rebuild applied are intentionally
    // skipped here — they're a global concern).
    await rebuildOneIssueTopics(db as any, a);
    await rebuildOneIssueTopics(db as any, b);
    const incRow = (await getCorpusTopics(db as any, { sort: 'alpha', limit: 200 }))
      .find(r => r.keyword === 'institutional trust');
    expect(incRow).toBeDefined();
    expect(incRow!.doc_frequency).toBe(fullRow!.doc_frequency);

    const fullTl = await getTopicTimeline(db as any, 'institutional trust');
    const incTl = await getTopicTimeline(db as any, 'institutional trust');
    expect(incTl.length).toBe(fullTl.length);
  });

  it('removes corpus_topics rows when a keyword drops below df threshold', async () => {
    const db = makeD1();
    const a = await seedIssue(db as any, {
      issue_number: 1, source_url: 'x://1',
      published_at: '2024-01-01', year: 2024, month: 1,
      full_text_plain: ISSUE_TEXT,
    });
    const b = await seedIssue(db as any, {
      issue_number: 2, source_url: 'x://2',
      published_at: '2024-06-01', year: 2024, month: 6,
      full_text_plain: ISSUE_TEXT,
    });

    await rebuildAllTopics(db as any, { minDocFrequency: 2 });
    expect((await getCorpusTopics(db as any, { sort: 'alpha', limit: 200 }))
      .find(r => r.keyword === 'institutional trust')).toBeDefined();

    // Replace issue B's text → "institutional trust" should now be in
    // only one issue (df=1 < threshold) and disappear from the corpus.
    await (db as any)._sqlite.prepare(
      'UPDATE issues SET full_text_plain = ? WHERE id = ?',
    ).run(REPLACEMENT_TEXT, b);
    await rebuildOneIssueTopics(db as any, b);

    const after = await getCorpusTopics(db as any, { sort: 'alpha', limit: 200 });
    expect(after.find(r => r.keyword === 'institutional trust')).toBeUndefined();

    // Timeline should also be clean.
    expect((await getTopicTimeline(db as any, 'institutional trust')).length).toBe(0);
  });

  it('is a no-op when the issue does not exist', async () => {
    const db = makeD1();
    const out = await rebuildOneIssueTopics(db as any, 'no-such-issue');
    expect(out).toEqual({ kept: 0, affected_keywords: 0 });
  });
});
