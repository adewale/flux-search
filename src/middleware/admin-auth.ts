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

  const valid = timingSafeEqual(token, c.env.ADMIN_TOKEN);
  if (!valid) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await next();
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  // Use constant-time comparison via XOR
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
