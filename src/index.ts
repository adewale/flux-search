import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './env';
import { searchRoutes } from './routes/search';
import { issueRoutes } from './routes/issues';
import { adminRoutes } from './routes/admin';
import { weeklySync } from './cron/weekly-sync';

const app = new Hono<{ Bindings: Env }>();

app.use('*', logger());
app.use('*', cors());

app.route('/', searchRoutes);
app.route('/', issueRoutes);
app.route('/admin', adminRoutes);

app.get('/health', (c) => c.json({ status: 'ok' }));

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(weeklySync(controller, env));
  },
};
