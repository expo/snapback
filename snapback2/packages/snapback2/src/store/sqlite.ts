import {
  OfflineStoreFailure, PersistentRangeStore,
  type PersistedRangeState, type RangeStoreBackend, type RangeStoreFactory,
} from "./range-store.js";
import type { ByteDelta } from "./byte-cache.js";
import { acquireStoreLock, inProcessLocks, type StoreLocks } from "./locks.js";
import { decodeStateKey, encodeStateKey, projectState, unprojectState, type StateEntry } from "./projection.js";
import type { SqliteDriver } from "./sqlite-driver.js";

export type { SqliteDriver, SqliteExecutor, SqliteParams } from "./sqlite-driver.js";
export { inProcessLocks } from "./locks.js";

export interface SqliteRangeStoreOptions {
  locks?: StoreLocks;
  /** Witness barrier, after all DML and inside the transaction, before COMMIT. */
  beforeCommit?: (state: PersistedRangeState, bytes: ByteDelta) => void | Promise<void>;
}

const STATE_TABLES = ["state", "rows", "answers", "outbox"] as const;
const TABLES = [...STATE_TABLES, "bytes"] as const;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS state (partition TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rows (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS answers (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS outbox (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS bytes (partition TEXT NOT NULL, key TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (partition, key));
`;
type DriverSource = SqliteDriver | (() => SqliteDriver | Promise<SqliteDriver>);

/** Public backend seam: byte deltas share replace's transaction; wipe deletes all five tables. */
export class SqliteBackend implements RangeStoreBackend {
  readonly carrier = "SQLite";
  private driver?: SqliteDriver;
  private partition?: string;
  private release?: () => Promise<void>;

  constructor(private readonly source: DriverSource, private readonly options: SqliteRangeStoreOptions = {}) {}

  private async guard<T>(body: () => Promise<T>): Promise<T> {
    try { return await body(); }
    catch (error) {
      if (error instanceof OfflineStoreFailure) throw error;
      throw new OfflineStoreFailure("E_OFFLINE_CARRIER", `SQLite carrier: ${error instanceof Error ? error.message : String(error)}; open a writable database with expo-sqlite ^16`);
    }
  }

  async open(partition: string): Promise<PersistedRangeState | undefined> {
    await this.close();
    return this.guard(async () => {
      this.release = await acquireStoreLock(this.options.locks ?? inProcessLocks(), partition);
      try {
        this.driver = typeof this.source === "function" ? await this.source() : this.source;
        this.partition = partition;
        const mode = await this.driver.get<{ journal_mode: string }>("PRAGMA journal_mode=WAL");
        if (mode?.journal_mode.toLowerCase() !== "wal") throw new Error(`journal_mode is ${mode?.journal_mode ?? "missing"}, expected wal`);
        await this.driver.exec(SCHEMA);
        return await this.driver.transaction(async (tx) => {
          const meta = await tx.get<{ value: string }>("SELECT value FROM state WHERE partition = ?", [partition]);
          if (!meta) return undefined;
          const read = async (table: "rows" | "answers" | "outbox"): Promise<StateEntry[]> =>
            (await tx.all<{ key: string; value: string }>(`SELECT key, value FROM ${table} WHERE partition = ?`, [partition]))
              .map(({ key, value }) => ({ key: decodeStateKey(key), value: JSON.parse(value) }));
          return unprojectState({ rows: await read("rows"), answers: await read("answers"), outbox: await read("outbox"),
            meta: [{ key: "state", value: JSON.parse(meta.value) }] });
        });
      } catch (error) {
        await this.close().catch(() => undefined);
        throw error;
      }
    });
  }

  // @ref LLP 1013#3-the-sqlite-carrier — state rewrite plus byte delta in one
  // transaction; the byte table is never rewritten wholesale and has no MIME column.
  async replace(state: PersistedRangeState, bytes: ByteDelta): Promise<void> {
    return this.guard(async () => {
      if (!this.driver || this.partition === undefined) throw new Error("not open");
      const partition = this.partition;
      const projected = projectState(state);
      await this.driver.transaction(async (tx) => {
        for (const table of STATE_TABLES) await tx.run(`DELETE FROM ${table} WHERE partition = ?`, [partition]);
        await tx.run("INSERT INTO state (partition, value) VALUES (?, ?)", [partition, JSON.stringify(projected.meta[0].value)]);
        for (const table of ["rows", "answers", "outbox"] as const) {
          for (const { key, value } of projected[table]) {
            await tx.run(`INSERT INTO ${table} (partition, key, value) VALUES (?, ?, ?)`,
              [partition, encodeStateKey(key, table !== "outbox"), JSON.stringify(value)]);
          }
        }
        for (const item of bytes.put) {
          await tx.run("INSERT OR REPLACE INTO bytes (partition, key, value) VALUES (?, ?, ?)",
            [partition, encodeStateKey(item.key, false), item.bytes]);
        }
        for (const key of bytes.remove) await tx.run("DELETE FROM bytes WHERE partition = ? AND key = ?", [partition, encodeStateKey(key, false)]);
        await this.options.beforeCommit?.(state, bytes);
      });
    });
  }

  async readBytes(key: string): Promise<Uint8Array | undefined> {
    return this.guard(async () => {
      if (!this.driver || this.partition === undefined) return undefined;
      const row = await this.driver.get<{ value: Uint8Array }>("SELECT value FROM bytes WHERE partition = ? AND key = ?",
        [this.partition, encodeStateKey(key, false)]);
      return row?.value;
    });
  }

  async wipe(partition: string): Promise<void> {
    if (!this.driver) {
      await this.open(partition);
      return this.wipe(partition);
    }
    if (this.partition !== partition) {
      const release = await acquireStoreLock(this.options.locks ?? inProcessLocks(), partition);
      try {
        await this.guard(() => this.driver!.transaction(async (tx) => {
          for (const table of TABLES) await tx.run(`DELETE FROM ${table} WHERE partition = ?`, [partition]);
        }));
      } finally { await release(); }
      return;
    }
    await this.guard(async () => {
      await this.driver!.transaction(async (tx) => {
        for (const table of TABLES) await tx.run(`DELETE FROM ${table} WHERE partition = ?`, [partition]);
      });
    });
    await this.close();
  }

  async close(): Promise<void> {
    const driver = this.driver;
    const release = this.release;
    this.driver = undefined;
    this.partition = undefined;
    this.release = undefined;
    try { if (driver) await this.guard(() => driver.close()); }
    finally { await release?.(); }
  }
}

/** Pass a driver factory when this factory will construct multiple clients. */
export function sqliteRangeStore(driver: DriverSource, options: SqliteRangeStoreOptions = {}): RangeStoreFactory {
  const factory = (() => new PersistentRangeStore(new SqliteBackend(driver, options))) as RangeStoreFactory;
  Object.defineProperty(factory, "carrier", { value: "SQLite" });
  return factory;
}
