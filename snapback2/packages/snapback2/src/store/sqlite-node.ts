import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { driverQueue, type SqliteDriver, type SqliteExecutor } from "./sqlite-driver.js";

/** Test-only Node 24 driver. Opening is lazy so carrier failures use E_OFFLINE_CARRIER. */
export function nodeSqliteDriver(path: string): SqliteDriver {
  let database: DatabaseSync | undefined;
  let identity: string | undefined;
  const db = () => database ??= new DatabaseSync(path);
  const queue = driverQueue();
  const executor: SqliteExecutor = {
    async run(sql, params = []) { db().prepare(sql).run(...params); },
    async get<T>(sql: string, params = []) { return (db().prepare(sql).get(...params) ?? undefined) as T | undefined; },
    async all<T>(sql: string, params = []) { return db().prepare(sql).all(...params) as T[]; },
  };
  return {
    get identity() {
      db(); // Resolve after open creates the file; symlinks must share ownership.
      return identity ??= path === ":memory:" || path === ""
        ? `sqlite:temporary:${randomUUID()}`
        : (() => {
            const opened = statSync(path, { bigint: true });
            return `sqlite:inode:${opened.dev}:${opened.ino}`;
          })();
    },
    run: (sql, params) => queue(() => executor.run(sql, params)),
    get: (sql, params) => queue(() => executor.get(sql, params)),
    all: (sql, params) => queue(() => executor.all(sql, params)),
    exec: (sql) => queue(async () => { db().exec(sql); }),
    // @ref LLP 1013#3-the-sqlite-carrier — await the async body before COMMIT;
    // a synchronous callback transaction would commit while the body is suspended.
    transaction: (body) => queue(async () => {
      db().exec("BEGIN IMMEDIATE");
      try {
        const result = await body(executor);
        db().exec("COMMIT");
        return result;
      } catch (error) {
        try {
          db().exec("ROLLBACK");
        } catch {
          // A connection that could not roll back may still own an open
          // transaction. Drop it so the next queued turn reopens cleanly,
          // while preserving the body/COMMIT failure as the primary error.
          const poisoned = database;
          database = undefined;
          try { poisoned?.close(); } catch { /* The primary failure still wins. */ }
        }
        throw error;
      }
    }),
    close: () => queue(async () => { database?.close(); database = undefined; }),
  };
}
