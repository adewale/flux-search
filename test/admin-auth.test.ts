import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { adminAuth } from '../src/middleware/admin-auth';

const VALID_TOKEN = 'test-secret-token-12345';

function createApp() {
  const app = new Hono<{ Bindings: { ADMIN_TOKEN: string } }>();
  app.use('*', adminAuth);
  app.get('/admin/test', (c) => c.json({ ok: true }));
  return app;
}

function req(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, { headers });
}

describe('adminAuth middleware', () => {
  it('returns 401 when no Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/admin/test', {}, { ADMIN_TOKEN: VALID_TOKEN });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when Authorization header is not Bearer', async () => {
    const app = createApp();
    const res = await app.fetch(
      req('/admin/test', { Authorization: 'Basic abc123' }),
      { ADMIN_TOKEN: VALID_TOKEN },
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when token is wrong', async () => {
    const app = createApp();
    const res = await app.fetch(
      req('/admin/test', { Authorization: 'Bearer wrong-token' }),
      { ADMIN_TOKEN: VALID_TOKEN },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });

  it('returns 401 for empty bearer token', async () => {
    const app = createApp();
    const res = await app.fetch(
      req('/admin/test', { Authorization: 'Bearer ' }),
      { ADMIN_TOKEN: VALID_TOKEN },
    );
    expect(res.status).toBe(401);
  });

  it('passes through with valid token', async () => {
    const app = createApp();
    const res = await app.fetch(
      req('/admin/test', { Authorization: `Bearer ${VALID_TOKEN}` }),
      { ADMIN_TOKEN: VALID_TOKEN },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('rejects token that is a prefix of the valid token', async () => {
    const app = createApp();
    const res = await app.fetch(
      req('/admin/test', { Authorization: 'Bearer test-secret' }),
      { ADMIN_TOKEN: VALID_TOKEN },
    );
    expect(res.status).toBe(403);
  });

  it('rejects token that is the valid token plus extra chars', async () => {
    const app = createApp();
    const res = await app.fetch(
      req('/admin/test', { Authorization: `Bearer ${VALID_TOKEN}extra` }),
      { ADMIN_TOKEN: VALID_TOKEN },
    );
    expect(res.status).toBe(403);
  });
});
