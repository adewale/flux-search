/** Fence a rebuild at its actual database writes, not at an earlier RPC.
 *
 * The newest persisted topic_rebuild is the generation. Each write/batch puts
 * the generation assertion in the SAME D1 transaction as the effect. The
 * deliberately invalid JSON in the stale branch makes the transaction abort;
 * a zero-row ownership UPDATE would not. No lease, heartbeat or extra RPC.
 *
 * This prevents superseded writers, not partial visibility across the whole
 * multi-stage rebuild. Each existing replacement should still be atomic.
 */
export function topicPublicationDatabase(db: D1Database, runId: string): D1Database {
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const guard = () => db.prepare(`
    SELECT json_extract(
      CASE WHEN ? = (
        SELECT id FROM pipeline_runs WHERE mode = 'topic_rebuild'
        ORDER BY rowid DESC LIMIT 1
      ) THEN '{"current":true}' ELSE 'superseded topic rebuild' END,
      '$.current'
    )
  `).bind(runId);
  const batch = async <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> =>
    (await db.batch<T>([guard(), ...statements.map(statement => originals.get(statement) ?? statement)])).slice(1);
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
        if (property === 'run') return async () => (await batch([target]))[0];
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    originals.set(wrapped, statement);
    return wrapped;
  };
  return {
    prepare: (sql: string) => wrap(db.prepare(sql)),
    batch,
  } as D1Database;
}
