// The deliberately small common surface between node:sqlite and expo-sqlite.
// Native bindings stay in their own entrypoints; browser builds can include the
// storage contract without resolving either host package.

export type SqliteValue = string | number | null | Uint8Array;
export type SqliteParams = readonly SqliteValue[];

export interface SqliteExecutor {
  run(sql: string, params?: SqliteParams): Promise<void>;
  get<T>(sql: string, params?: SqliteParams): Promise<T | undefined>;
  all<T>(sql: string, params?: SqliteParams): Promise<T[]>;
}

export interface SqliteDriver extends SqliteExecutor {
  /** Stable identity shared by separate connections to the same database. */
  readonly identity: string;
  exec(sql: string): Promise<void>;
  /** Commit only after body resolves; throw/rollback when it rejects. */
  transaction<T>(body: (tx: SqliteExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Keep suspended async transaction bodies isolated from outer statements.
 * Adapted from Snapback2 at a93edb979a5cbe6357f1fc1f95b66f85bd308844,
 * packages/snapback2/src/store/sqlite-driver.ts. */
export function sqliteDriverQueue(): <T>(body: () => Promise<T>) => Promise<T> {
  let tail = Promise.resolve();
  return body => {
    const result = tail.then(body);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
