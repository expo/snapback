import { imageState } from '../../../evaluator/src/row-image.js';
import { preparedProjection, jsonState } from "./range-store.js";
import type { ChangedRecords } from "./swap-journal.js";
import {
  OfflineStoreFailure, PersistentRangeStore,
  type PersistedRangeState, type RangeStoreBackend, type RangeStoreFactory,
} from "./range-store.js";
import type { ByteDelta } from "./byte-cache.js";
import { acquireStoreLock, inProcessLocks, type StoreLocks } from "./locks.js";
import { decodeStateKey, encodeStateKey, ProjectionCache, unprojectState, type StateEntry } from "./projection.js";
import type { SqliteDriver } from "./sqlite-driver.js";

export type { SqliteDriver, SqliteExecutor, SqliteParams } from "./sqlite-driver.js";
export { inProcessLocks } from "./locks.js";

export interface SqliteRangeStoreOptions {
  locks?: StoreLocks;
  /** Witness barrier, after all DML and inside the transaction, before COMMIT. */
  beforeCommit?: (state: PersistedRangeState, bytes: ByteDelta) => void | Promise<void>;
}

const STATE_TABLES = ["state", "metadata", "rows", "answers", "outbox"] as const;
const TABLES = [...STATE_TABLES, "bytes"] as const;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS state (partition TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS metadata (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS rows (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS answers (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS outbox (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS bytes (partition TEXT NOT NULL, key TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (partition, key));
`;
type DriverSource = SqliteDriver | (() => SqliteDriver | Promise<SqliteDriver>);

/** Public backend seam: state and byte deltas share one transaction. */
export class SqliteBackend implements RangeStoreBackend {
  readonly [preparedProjection] = true as const;
  readonly carrier = "SQLite";
  private driver?: SqliteDriver;
  private partition?: string;
  private release?: () => Promise<void>;
  private locks?: StoreLocks;
  private readonly projection = new ProjectionCache();

  constructor(private readonly source: DriverSource, private readonly options: SqliteRangeStoreOptions = {}) {}

  private async guard<T>(body: () => Promise<T>): Promise<T> {
    try { return await body(); }
    catch (error) {
      if (error instanceof OfflineStoreFailure) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const busy = /SQLITE_BUSY|SQLITE_LOCKED|database (?:is )?(?:busy|locked)/i.test(message);
      const rewrite = busy ? "another writer holds the store; close it or wait" : "open a writable database with expo-sqlite ^16";
      throw new OfflineStoreFailure("E_OFFLINE_CARRIER", `SQLite carrier: ${message}; ${rewrite}`, rewrite);
    }
  }

  async open(partition: string): Promise<PersistedRangeState | undefined> {
    await this.close();
    return this.guard(async () => {
      const driver = typeof this.source === "function" ? await this.source() : this.source;
      try {
        const identity = driver.identity;
        if (typeof identity !== "string" || !identity.trim()) {
          throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "driver has no database identity",
            "supply a stable database identity on the SQLite driver");
        }
        this.locks = this.options.locks ?? inProcessLocks(identity);
        this.release = await acquireStoreLock(this.locks, partition);
      }
      catch (error) {
        // A factory may open eagerly; a refused client owns that fresh connection.
        // A caller-supplied driver may belong to the client holding the lock.
        if (typeof this.source === "function") await driver.close().catch(() => undefined);
        throw error;
      }
      try {
        this.driver = driver;
        this.partition = partition;
        const mode = await this.driver.get<{ journal_mode: string }>("PRAGMA journal_mode=WAL");
        if (mode?.journal_mode.toLowerCase() !== "wal") throw new Error(`journal_mode is ${mode?.journal_mode ?? "missing"}, expected wal`);
        await this.driver.exec(SCHEMA);
        return await this.driver.transaction(async (tx) => {
          const meta = await tx.get<{ value: string }>("SELECT value FROM state WHERE partition = ?", [partition]);
          const read = async (table: "rows" | "answers" | "outbox" | "metadata"): Promise<StateEntry[]> =>
            (await tx.all<{ key: string; value: string }>(`SELECT key, value FROM ${table} WHERE partition = ?`, [partition]))
              .map(({ key, value }) => ({ key: decodeStateKey(key), value: JSON.parse(value) }));
          const projected = { rows: await read("rows"), answers: await read("answers"), outbox: await read("outbox"),
            meta: [...(meta ? [{ key: "state", value: JSON.parse(meta.value) }] : []), ...await read("metadata")] };
          this.projection.reset(projected);
          return unprojectState(projected);
        });
      } catch (error) {
        await this.close().catch(() => undefined);
        throw error;
      }
    });
  }

  // @ref LLP 1013#3-the-sqlite-carrier — journaled state entries and bytes share
  // one transaction; direct replacements rewrite entries against a body-free key baseline.
  async replace(state: PersistedRangeState, bytes: ByteDelta, previous?: PersistedRangeState, changed?: ChangedRecords): Promise<void> {
    return this.guard(async () => {
      if (!this.driver || this.partition === undefined) throw new Error("not open");
      const partition = this.partition;
      const { delta, committed } = this.projection.prepare(state, previous, changed);
      await this.driver.transaction(async (tx) => {
        for (const name of ["rows", "answers", "outbox", "meta"] as const) {
          const table = name === "meta" ? "metadata" : name;
          for (const key of delta[name].remove) {
            if (name === "meta" && key === "state") await tx.run("DELETE FROM state WHERE partition = ?", [partition]);
            else await tx.run(`DELETE FROM ${table} WHERE partition = ? AND key = ?`,
              [partition, encodeStateKey(key, name === "rows" || name === "answers")]);
          }
          for (const { key, value } of delta[name].put) {
            if (name === "meta" && key === "state") {
              await tx.run("INSERT OR REPLACE INTO state (partition, value) VALUES (?, ?)", [partition, JSON.stringify(value)]);
            } else {
              await tx.run(`INSERT OR REPLACE INTO ${table} (partition, key, value) VALUES (?, ?, ?)`,
                [partition, encodeStateKey(key, name === "rows" || name === "answers"), JSON.stringify(value)]);
            }
          }
        }
        for (const item of bytes.put) {
          await tx.run("INSERT OR REPLACE INTO bytes (partition, key, value) VALUES (?, ?, ?)",
            [partition, encodeStateKey(item.key, false), item.bytes]);
        }
        for (const key of bytes.remove) await tx.run("DELETE FROM bytes WHERE partition = ? AND key = ?", [partition, encodeStateKey(key, false)]);
        await this.options.beforeCommit?.(jsonState(imageState(state)), bytes);
      });
      committed();
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
      const release = await acquireStoreLock(this.locks!, partition);
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
    this.projection.reset();
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
