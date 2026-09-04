import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { driverQueue, type SqliteDriver, type SqliteExecutor } from "./sqlite-driver.js";

function executor(database: SQLiteDatabase): SqliteExecutor {
  return {
    async run(sql, params = []) { await database.runAsync(sql, params); },
    async get<T>(sql: string, params = []) { return await database.getFirstAsync<T>(sql, params) ?? undefined; },
    async all<T>(sql: string, params = []) { return database.getAllAsync<T>(sql, params); },
  };
}

/** Requires Expo SDK 54's initialized runtime (including structuredClone). */
export function expoSqliteDriver(name = "snapback2.db"): SqliteDriver {
  let database: Promise<SQLiteDatabase> | undefined;
  const db = () => database ??= openDatabaseAsync(name, { useNewConnection: true });
  const queue = driverQueue();
  return {
    identity: `expo-sqlite:${name}`,
    run: (sql, params) => queue(async () => executor(await db()).run(sql, params)),
    get: (sql, params) => queue(async () => executor(await db()).get(sql, params)),
    all: (sql, params) => queue(async () => executor(await db()).all(sql, params)),
    exec: (sql) => queue(async () => (await db()).execAsync(sql)),
    // @ref LLP 1013#3-the-sqlite-carrier — Expo owns BEGIN/COMMIT on a separate
    // connection. Every statement uses that connection, never the outer handle.
    transaction: <T>(body: (tx: SqliteExecutor) => Promise<T>) => queue(async () => {
      let result!: T;
      await (await db()).withExclusiveTransactionAsync(async (transaction) => {
        result = await body(executor(transaction));
      });
      return result;
    }),
    close: () => queue(async () => {
      const pending = database;
      database = undefined;
      if (pending) await (await pending).closeAsync();
    }),
  };
}
