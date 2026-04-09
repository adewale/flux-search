import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';

export const adminAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = auth.slice(7);
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const valid = await timingSafeEqual(token, c.env.ADMIN_TOKEN);
  if (!valid) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await next();
});

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  // Hash both inputs to fixed-length digests before comparing.
  // This prevents leaking the token length through timing.
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);

  const bufA = new Uint8Array(hashA);
  const bufB = new Uint8Array(hashB);

  let mismatch = 0;
  for (let i = 0; i < bufA.length; i++) {
    mismatch |= bufA[i] ^ bufB[i];
  }
  return mismatch === 0;
}
