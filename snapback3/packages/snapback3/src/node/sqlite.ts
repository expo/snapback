import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sqliteDriverQueue, type SqliteDriver, type SqliteExecutor } from '../resource/sqlite-driver.js';

/** A real node:sqlite connection for tests and native Node hosts. The storage
 * adapter owns this driver and closes it with the client-owned store. */
export function nodeSqliteDriver(path: string): SqliteDriver {
  let database: DatabaseSync | undefined;
  let databaseIdentity: string | undefined;
  const db = (): DatabaseSync => database ??= new DatabaseSync(path);
  const queue = sqliteDriverQueue();
  const executor: SqliteExecutor = {
    async run(sql, params = []) { db().prepare(sql).run(...params); },
    async get<T>(sql: string, params = []) { return (db().prepare(sql).get(...params) ?? undefined) as T | undefined; },
    async all<T>(sql: string, params = []) { return db().prepare(sql).all(...params) as T[]; },
  };
  return {
    get identity() {
      db();
      return databaseIdentity ??= path === ':memory:' || path === ''
        ? `node:sqlite:temporary:${randomUUID()}`
        : (() => {
            const opened = statSync(path, { bigint: true });
            return `node:sqlite:inode:${opened.dev}:${opened.ino}`;
          })();
    },
    run: (sql, params) => queue(() => executor.run(sql, params)),
    get: (sql, params) => queue(() => executor.get(sql, params)),
    all: (sql, params) => queue(() => executor.all(sql, params)),
    exec: sql => queue(async () => { db().exec(sql); }),
    // Adapted from packages/snapback2/src/store/sqlite-node.ts at
    // a93edb979a5cbe6357f1fc1f95b66f85bd308844: the async body must settle
    // before COMMIT, and a failed rollback poisons/closes this connection.
    transaction: body => queue(async () => {
      db().exec('BEGIN IMMEDIATE');
      try {
        const result = await body(executor);
        db().exec('COMMIT');
        return result;
      } catch (error) {
        try { db().exec('ROLLBACK'); }
        catch {
          const poisoned = database;
          database = undefined;
          try { poisoned?.close(); } catch { /* Preserve the primary failure. */ }
        }
        throw error;
      }
    }),
    close: () => queue(async () => {
      database?.close();
      database = undefined;
    }),
  };
}
