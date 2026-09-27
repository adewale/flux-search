import { Hono } from 'hono';
import { searchRoutes } from '../src/routes/search';
import { makeD1, enableFts, type D1Like } from './helpers-d1';
import { defaultEnv } from './helpers';

/**
 * Offline harness for GET /search: the real route handler over real SQL
 * (node:sqlite with FTS5) plus in-memory Workers AI and Vectorize doubles.
 *
 * These replace checks that used to call the deployed Worker from `npm test`
 * (see test/live/ for the deployment checks that remain).
 */

export interface VectorMatch {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * Minimal Vectorize double. Faithful to the parts of the interface the
 * search path uses: `query(vector, { topK, returnMetadata, filter })`
 * returns `{ matches, count }`, sorted by score and capped at `topK`.
 * It refuses metadata filters instead of silently ignoring them, so a test
 * cannot pass because the double skipped a filter production would apply.
 */
export function fakeVectorize(matches: VectorMatch[]) {
  const calls: Array<{ vector: number[]; options: Record<string, unknown> }> = [];
  return {
    calls,
    async query(vector: number[], options: Record<string, unknown> = {}) {
      calls.push({ vector, options });
      if (options.filter !== undefined) {
        throw new Error('fakeVectorize does not implement metadata filters');
      }
      const topK = typeof options.topK === 'number' ? options.topK : 5;
      const sorted = [...matches].sort((a, b) => b.score - a.score).slice(0, topK);
      return { matches: sorted, count: sorted.length };
    },
  };
}

/** Workers AI double for the bge-base embedding call: one vector per input text. */
export function fakeAi(dimensions = 768) {
  return {
    async run(_model: string, input: { text: string[] }) {
      return {
        shape: [input.text.length, dimensions],
        data: input.text.map(() => new Array(dimensions).fill(0.01)),
      };
    },
  };
}

/**
 * node:sqlite D1 whose batch() returns per-statement results like real D1
 * (vector-search fetches candidate issues with a batch of SELECTs).
 */
export function searchDb(): D1Like {
  const db = makeD1();
  enableFts(db);
  db.batch = async (stmts: any[]) => Promise.all(stmts.map(s => s.all()));
  return db;
}

export async function searchRoute(
  env: Record<string, unknown>,
  q: string,
  params: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const app = new Hono();
  app.route('/', searchRoutes as any);
  const qs = new URLSearchParams({ q, ...params });
  const res = await app.request('/search?' + qs.toString(), {}, { ...defaultEnv, ...env } as any);
  return { status: res.status, body: await res.json() };
}
