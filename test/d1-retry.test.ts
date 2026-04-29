import { describe, expect, it } from 'vitest';
import { isRetryableD1WriteError, retryD1Write } from '../src/lib/d1-retry';

describe('D1 write retry helper', () => {
  it('recognizes Cloudflare-recommended transient D1 errors', () => {
    expect(isRetryableD1WriteError(new Error('Network connection lost'))).toBe(true);
    expect(isRetryableD1WriteError(new Error('storage caused object to be reset'))).toBe(true);
    expect(isRetryableD1WriteError(new Error('reset because its code was updated'))).toBe(true);
    expect(isRetryableD1WriteError(new Error('syntax error near SELECT'))).toBe(false);
  });

  it('retries retryable write failures with backoff', async () => {
    const sleeps: number[] = [];
    let attempts = 0;

    const result = await retryD1Write(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('Network connection lost');
      return 'ok';
    }, {
      baseDelayMs: 10,
      jitterMs: 0,
      sleep: async ms => { sleeps.push(ms); },
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('does not retry non-transient write failures', async () => {
    let attempts = 0;
    await expect(retryD1Write(async () => {
      attempts += 1;
      throw new Error('UNIQUE constraint failed');
    }, { sleep: async () => undefined })).rejects.toThrow('UNIQUE constraint failed');
    expect(attempts).toBe(1);
  });
});
