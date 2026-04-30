import { describe, expect, it } from 'vitest';
import { cleanTextFromHtml, type CleanText } from '../src/lib/clean-text';
import { constructCandidate } from '../src/lib/topic-candidate';
import { getTopicRegistry } from '../src/lib/topic-registry';

describe('correct-by-construction topic boundaries', () => {
  it('constructs CleanText without decoded HTML artifacts', () => {
    const clean = cleanTextFromHtml('<p>Before &lt;img src&gt; after A &lt; B &gt; C</p>');
    expect(String(clean)).not.toContain('<img src>');
    expect(String(clean)).not.toContain('img src');
    expect(String(clean)).toContain('A < B > C');
  });

  it('constructs protected registry topics with type and evidence', () => {
    const text = 'Crypto and Rest of World appear early.' as CleanText;
    const topic = constructCandidate({ surface: 'Rest of World', source: 'known_entity' }, text, getTopicRegistry());
    expect(topic.ok).toBe(true);
    if (topic.ok) {
      expect(topic.value.canonical).toBe('rest of world');
      expect(topic.value.topicType).toBe('publication');
      expect(topic.value.qualityStatus).toBe('valid');
      expect(topic.value.evidence.inOpening).toBe(true);
    }
  });

  it('rejects invalid phrase grammar before ranking or persistence', () => {
    const text = 'As treasury would say, good reason you can is a bad fragment.' as CleanText;
    for (const surface of ['as treasury', 'good reason you can', 'img src']) {
      const result = constructCandidate({ surface, source: 'yake' }, text, getTopicRegistry());
      expect(result).toEqual(expect.objectContaining({ ok: false }));
    }
  });

  it('uses registry deny entries as construction failures', () => {
    const result = constructCandidate(
      { surface: 'exchange commission', source: 'yake' },
      'exchange commission appeared' as CleanText,
      getTopicRegistry(),
    );
    expect(result).toEqual({ ok: false, reason: 'registry_deny' });
  });
});
