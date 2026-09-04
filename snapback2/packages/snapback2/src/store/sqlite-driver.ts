export type SqliteParams = Array<string | number | null | Uint8Array>;

export interface SqliteExecutor {
  run(sql: string, params?: SqliteParams): Promise<void>;
  get<T>(sql: string, params?: SqliteParams): Promise<T | undefined>;
  all<T>(sql: string, params?: SqliteParams): Promise<T[]>;
}

export interface SqliteDriver extends SqliteExecutor {
  /** Stable identity of the database, shared by every connection/factory opening it. */
  readonly identity: string;
  exec(sql: string): Promise<void>;
  /** All statements in body must use tx. Commit only after its promise resolves. */
  transaction<T>(body: (tx: SqliteExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Outer operations wait for an async transaction; its executor bypasses the queue. */
export function driverQueue(): <T>(body: () => Promise<T>) => Promise<T> {
  let tail = Promise.resolve();
  return (body) => {
    const result = tail.then(body);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
