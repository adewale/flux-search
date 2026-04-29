import { describe, expect, it } from 'vitest';
import { makeTopicEmbeddingMessages, handleEnrichmentMessage, type EnrichmentMessage } from '../src/jobs/enrichment-queue';

function keywordRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({ keyword: `topic-${i + 1}` }));
}

describe('enrichment queue helpers', () => {
  it('fans out corpus topics into bounded embed messages', () => {
    const messages = makeTopicEmbeddingMessages(keywordRows(53), 'run-1', 25);
    expect(messages).toHaveLength(3);
    expect(messages.map(m => m.keywords.length)).toEqual([25, 25, 3]);
    expect(messages.every(m => m.type === 'embed-corpus-topics' && m.run_id === 'run-1')).toBe(true);
  });

  it('handles empty topic lists without producing poison messages', () => {
    expect(makeTopicEmbeddingMessages([], 'run-1', 25)).toEqual([]);
  });

  it('rejects invalid batch sizes', () => {
    expect(() => makeTopicEmbeddingMessages(keywordRows(1), 'run-1', 0)).toThrow(/batch/i);
  });

  it('processes the initial embed-corpus-topics message variant', async () => {
    const message: EnrichmentMessage = { type: 'embed-corpus-topics', run_id: 'run-1', keywords: ['trust', 'governance'] };
    await expect(handleEnrichmentMessage(message)).resolves.toEqual({ embedded: 2 });
  });
});
