import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { driverQueue, type SqliteDriver, type SqliteExecutor } from "./sqlite-driver.js";

/** Test-only Node 24 driver. Opening is lazy so carrier failures use E_OFFLINE_CARRIER. */
export function nodeSqliteDriver(path: string): SqliteDriver {
  let database: DatabaseSync | undefined;
  const db = () => database ??= new DatabaseSync(path);
  const queue = driverQueue();
  const executor: SqliteExecutor = {
    async run(sql, params = []) { db().prepare(sql).run(...params); },
    async get<T>(sql: string, params = []) { return (db().prepare(sql).get(...params) ?? undefined) as T | undefined; },
    async all<T>(sql: string, params = []) { return db().prepare(sql).all(...params) as T[]; },
  };
  return {
    identity: `sqlite:${resolve(path)}`,
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
        db().exec("ROLLBACK");
        throw error;
      }
    }),
    close: () => queue(async () => { database?.close(); database = undefined; }),
  };
}
