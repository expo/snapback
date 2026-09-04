import { defaultDatabaseDirectory, openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { driverQueue, type SqliteDriver, type SqliteExecutor } from "./sqlite-driver.js";

function executor(database: SQLiteDatabase): SqliteExecutor {
  return {
    async run(sql, params = []) { await database.runAsync(sql, params); },
    async get<T>(sql: string, params = []) { return await database.getFirstAsync<T>(sql, params) ?? undefined; },
    async all<T>(sql: string, params = []) { return database.getAllAsync<T>(sql, params); },
  };
}

const DATABASE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** Requires Expo SDK 54's initialized runtime (including structuredClone). */
export function expoSqliteDriver(name = "snapback2.db"): SqliteDriver {
  // The identity is the lock key for one writer per database (LLP 1013 §2 decision 4):
  // a name is an unambiguous basename in Expo's default directory, never a path, so two
  // spellings of one file cannot earn two locks (expo-sqlite joins directory and name
  // without collapsing dot segments before native open).
  if (!DATABASE_NAME.test(name)) {
    throw new TypeError(`expoSqliteDriver: the database name must be a plain file name (letters, digits, ., _, -), not a path: ${JSON.stringify(name)}`);
  }
  let database: Promise<SQLiteDatabase> | undefined;
  const db = () => database ??= openDatabaseAsync(name, { useNewConnection: true });
  const queue = driverQueue();
  return {
    identity: `expo-sqlite:${defaultDatabaseDirectory.replace(/\/*$/, "")}/${name}`,
    run: (sql, params) => queue(async () => executor(await db()).run(sql, params)),
    get: (sql, params) => queue(async () => executor(await db()).get(sql, params)),
    all: (sql, params) => queue(async () => executor(await db()).all(sql, params)),
    exec: (sql) => queue(async () => (await db()).execAsync(sql)),
    // @ref LLP 1013#3-the-sqlite-carrier — Expo owns BEGIN/COMMIT on a separate
    // connection. Every statement uses that connection, never the outer handle.
    // Its COMMIT failure rolls back and closes that connection; the outer handle stays usable.
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
