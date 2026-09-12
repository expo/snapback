// The replica store on SQLite: the server's two-table layout, one BLOB key
// per index entry, for hosts where SQLite is native — Expo (`expo-sqlite`)
// and Node (`node:sqlite`). The driver is the smallest thing both offer: run
// a statement, read rows, wrap a transaction. SQLite compares BLOBs byte by
// byte, so `key.ts` orders here exactly as it does in IndexedDB and on the
// server.

import { encodeKey, upperBound, type Kind } from "./key.ts";
import { indexKey, indexKinds, scanRange, type Bounds, type Row, type SchemaJson, type SideTx, type Store, type StoreTx } from "./store.ts";

/** What a SQLite binding must offer. `expo-sqlite`'s async database and
 * `node:sqlite`'s `DatabaseSync` both fit behind a few lines. */
export interface SqliteDriver {
  run(sql: string, params?: readonly unknown[]): Promise<void>;
  all(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  /** Run `body` inside one transaction; roll back when it throws. */
  transaction<T>(body: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS r (t TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (t, id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS i (ti TEXT NOT NULL, k BLOB NOT NULL, id TEXT NOT NULL, PRIMARY KEY (ti, k)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS side (name TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (name, key)) WITHOUT ROWID;
`;

export async function openSqlite(driver: SqliteDriver, schema: SchemaJson): Promise<Store> {
  for (const statement of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await driver.run(statement);
  return new SqliteStore(driver, schema);
}

class SqliteStore implements Store {
  constructor(private db: SqliteDriver, public schema: SchemaJson) {}
  setSchema(schema: SchemaJson) { this.schema = schema; }

  private tx(): StoreTx {
    const db = this.db;
    const schema = this.schema;
    const enc = (table: string, index: string, values: readonly unknown[]) => {
      const { kinds } = indexKinds(schema, table, index);
      return encodeKey(values.map((v, i) => [kinds[i] ?? "string", v] as [Kind, unknown]));
    };
    const parse = (rows: Record<string, unknown>[]) => rows.map((r) => JSON.parse(r.data as string) as Row);
    const side = (name: string): SideTx => ({
      async get(key) {
        const rows = await db.all("SELECT value FROM side WHERE name = ? AND key = ?", [name, key]);
        return rows[0] ? JSON.parse(rows[0].value as string) : undefined;
      },
      async put(key, value) { await db.run("INSERT INTO side(name, key, value) VALUES (?, ?, ?) ON CONFLICT(name, key) DO UPDATE SET value = excluded.value", [name, key, JSON.stringify(value)]); },
      async delete(key) { await db.run("DELETE FROM side WHERE name = ? AND key = ?", [name, key]); },
      async all() { return (await db.all("SELECT key, value FROM side WHERE name = ? ORDER BY key", [name])).map((r) => ({ key: r.key as string, value: JSON.parse(r.value as string) })); },
      async clear() { await db.run("DELETE FROM side WHERE name = ?", [name]); },
    });
    return {
      async get(table, id) {
        return parse(await db.all("SELECT data FROM r WHERE t = ? AND id = ?", [table, id]))[0];
      },
      async lookup(table, index, key) {
        const prefix = enc(table, index, key);
        const rows = await db.all("SELECT r.data FROM i JOIN r ON r.t = ? AND r.id = i.id WHERE i.ti = ? AND i.k >= ? AND i.k < ? ORDER BY i.k LIMIT 1", [table, `${table}.${index}`, prefix, upperBound(prefix)]);
        return parse(rows)[0];
      },
      async scan(table, index, prefix, bounds: Bounds, dir, limit) {
        const range = scanRange(schema, table, index, prefix, bounds, dir);
        if (!range || limit <= 0) return [];
        const rows = await db.all(`SELECT r.data, i.k AS k FROM i JOIN r ON r.t = ? AND r.id = i.id WHERE i.ti = ? AND i.k >= ? AND i.k < ? ORDER BY i.k ${dir === "asc" ? "ASC" : "DESC"} LIMIT ?`, [table, `${table}.${index}`, range[0], range[1], limit]);
        return rows.map((r) => ({ row: JSON.parse(r.data as string) as Row, key: new Uint8Array(r.k as ArrayBuffer | Uint8Array) }));
      },
      async count(table, index, prefix, limit) {
        const range = scanRange(schema, table, index, prefix, {}, "asc");
        if (!range) return 0;
        const rows = await db.all("SELECT COUNT(*) AS n FROM (SELECT 1 FROM i WHERE ti = ? AND k >= ? AND k < ? LIMIT ?)", [`${table}.${index}`, range[0], range[1], limit]);
        return Number(rows[0]?.n ?? 0);
      },
      async put(table, row) {
        const old = parse(await db.all("SELECT data FROM r WHERE t = ? AND id = ?", [table, row.id]))[0];
        const definition = schema.tables[table];
        if (!definition) throw new Error(`unknown table ${table}`);
        for (const index of Object.keys(definition.indexes)) {
          const ti = `${table}.${index}`;
          if (old) await db.run("DELETE FROM i WHERE ti = ? AND k = ?", [ti, indexKey(schema, table, index, old)]);
          await db.run("INSERT INTO i(ti, k, id) VALUES (?, ?, ?) ON CONFLICT(ti, k) DO UPDATE SET id = excluded.id", [ti, indexKey(schema, table, index, row), row.id]);
        }
        await db.run("INSERT INTO r(t, id, data) VALUES (?, ?, ?) ON CONFLICT(t, id) DO UPDATE SET data = excluded.data", [table, row.id, JSON.stringify(row)]);
      },
      async delete(table, id) {
        const old = parse(await db.all("SELECT data FROM r WHERE t = ? AND id = ?", [table, id]))[0];
        if (!old) return;
        for (const index of Object.keys(schema.tables[table]?.indexes ?? {})) await db.run("DELETE FROM i WHERE ti = ? AND k = ?", [`${table}.${index}`, indexKey(schema, table, index, old)]);
        await db.run("DELETE FROM r WHERE t = ? AND id = ?", [table, id]);
      },
      async getMeta(key) {
        const rows = await db.all("SELECT value FROM meta WHERE key = ?", [key]);
        return rows[0] ? JSON.parse(rows[0].value as string) : undefined;
      },
      async setMeta(key, value) { await db.run("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, JSON.stringify(value)]); },
      side,
    };
  }

  read<T>(body: (tx: StoreTx) => Promise<T>): Promise<T> { return this.db.transaction(() => body(this.tx())); }
  write<T>(body: (tx: StoreTx) => Promise<T>): Promise<T> { return this.db.transaction(() => body(this.tx())); }
  async clearRows() { await this.db.run("DELETE FROM r"); await this.db.run("DELETE FROM i"); }
  close() { return this.db.close(); }
}

/** `node:sqlite`'s synchronous database behind the driver, for tests and
 * for Node hosts. (`expo-sqlite` fits the same way with its async calls.) */
export function nodeSqliteDriver(db: { exec(sql: string): void; prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] }; close(): void }): SqliteDriver {
  let depth = 0;
  return {
    async run(sql, params = []) { db.prepare(sql).run(...(params as unknown[])); },
    async all(sql, params = []) { return db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[]; },
    async transaction(body) {
      if (depth > 0) return body();
      depth++;
      db.exec("BEGIN");
      try {
        const result = await body();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        depth--;
      }
    },
    async close() { db.close(); },
  };
}

/** `expo-sqlite`'s async database behind the driver. */
export function expoSqliteDriver(db: { runAsync(sql: string, ...p: unknown[]): Promise<unknown>; getAllAsync(sql: string, ...p: unknown[]): Promise<unknown[]>; withExclusiveTransactionAsync?(body: (tx: unknown) => Promise<void>): Promise<void>; withTransactionAsync(body: () => Promise<void>): Promise<void>; closeAsync(): Promise<void> }): SqliteDriver {
  let depth = 0;
  return {
    async run(sql, params = []) { await db.runAsync(sql, ...(params as unknown[])); },
    async all(sql, params = []) { return (await db.getAllAsync(sql, ...(params as unknown[]))) as Record<string, unknown>[]; },
    async transaction(body) {
      if (depth > 0) return body();
      depth++;
      let result!: Awaited<ReturnType<typeof body>>;
      try {
        await db.withTransactionAsync(async () => { result = await body(); });
      } finally {
        depth--;
      }
      return result;
    },
    async close() { await db.closeAsync(); },
  };
}
