export interface D1RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  jitterMs?: number;
  shouldRetry?: (error: unknown, nextAttempt: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 25;
const DEFAULT_JITTER_MS = 25;

export function isRetryableD1WriteError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes('network connection lost')
    || message.includes('storage caused object to be reset')
    || message.includes('reset because its code was updated')
    || message.includes('temporarily unavailable')
    || message.includes('database is locked')
    || message.includes('too many requests')
    || message.includes('rate limit');
}

export async function retryD1Write<T>(
  operation: () => Promise<T>,
  options: D1RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const jitterMs = options.jitterMs ?? DEFAULT_JITTER_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const shouldRetry = options.shouldRetry ?? ((err, nextAttempt) => (
    nextAttempt <= maxAttempts && isRetryableD1WriteError(err)
  ));

  let attempt = 1;
  while (true) {
    try {
      return await operation();
    } catch (err) {
      const nextAttempt = attempt + 1;
      if (!shouldRetry(err, nextAttempt)) throw err;
      const exponential = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = jitterMs <= 0 ? 0 : Math.floor(Math.random() * jitterMs);
      await sleep(exponential + jitter);
      attempt = nextAttempt;
    }
  }
}
