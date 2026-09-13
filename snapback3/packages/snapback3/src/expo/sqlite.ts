import { defaultDatabaseDirectory, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { sqliteDriverQueue, type SqliteDriver, type SqliteExecutor } from '../resource/sqlite-driver.js';

const DATABASE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
export interface ExpoSQLiteModule {
  readonly defaultDatabaseDirectory: unknown;
  openDatabaseAsync(name: string, options: { useNewConnection: true }): Promise<SQLiteDatabase>;
}
const installedExpoSQLite: ExpoSQLiteModule = { defaultDatabaseDirectory, openDatabaseAsync };

function executor(database: SQLiteDatabase): SqliteExecutor {
  return {
    async run(sql, params = []) { await database.runAsync(sql, params as any); },
    async get<T>(sql: string, params = []) { return await database.getFirstAsync<T>(sql, params as any) ?? undefined; },
    async all<T>(sql: string, params = []) { return database.getAllAsync<T>(sql, params as any); },
  };
}

/** expo-sqlite connection adapter. Requires Expo native SQLite; browser users
 * continue through snapback3/client and IndexedDB instead. */
export function expoSqliteDriver(name: string, sqlite: ExpoSQLiteModule = installedExpoSQLite): SqliteDriver {
  if (typeof name !== 'string') {
    throw new TypeError('expoSqliteDriver: database name is required; createExpoClient scopes its default to the owner URL.');
  }
  if (!DATABASE_NAME.test(name)) {
    throw new TypeError(`expoSqliteDriver: database name must be a plain file name, not a path: ${JSON.stringify(name)}`);
  }
  let database: Promise<SQLiteDatabase> | undefined;
  const db = (): Promise<SQLiteDatabase> => database ??= sqlite.openDatabaseAsync(name, { useNewConnection: true })
    .catch(error => { database = undefined; throw error; });
  const queue = sqliteDriverQueue();
  return {
    identity: `expo-sqlite:${String(sqlite.defaultDatabaseDirectory).replace(/\/*$/, '')}/${name}`,
    run: (sql, params) => queue(async () => executor(await db()).run(sql, params)),
    get: (sql, params) => queue(async () => executor(await db()).get(sql, params)),
    all: (sql, params) => queue(async () => executor(await db()).all(sql, params)),
    exec: sql => queue(async () => { await (await db()).execAsync(sql); }),
    // Adapted from packages/snapback2/src/store/sqlite-expo.ts at
    // a93edb979a5cbe6357f1fc1f95b66f85bd308844. Expo owns BEGIN/COMMIT on a
    // separate connection, so every statement must use the supplied tx handle.
    transaction: <T>(body: (tx: SqliteExecutor) => Promise<T>) => queue(async () => {
      let result!: T;
      await (await db()).withExclusiveTransactionAsync(async transaction => {
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
