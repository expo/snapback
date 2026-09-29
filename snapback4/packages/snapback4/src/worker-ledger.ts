// @ref LLP 3000.009#5.2 — completion is durable before acknowledgement, not atomic with provider I/O.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

class LedgerUnavailable extends Error {}

/** Node-only, local durable completion ledger. One writer at a time, including
 * the handler: another process sharing this file cannot perform the same key.
 * SQLite releases the lock on process death; uncommitted work may run again. */
export class WorkerLedger {
  private readonly db: DatabaseSync;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  static async open(path: string, signal: AbortSignal): Promise<WorkerLedger> {
    for (;;) {
      signal.throwIfAborted();
      try { return new WorkerLedger(path); }
      catch (error) {
        if ((error as { errcode?: number }).errcode !== 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  }
  constructor(path: string) {
    if (!path || path === ":memory:") throw new Error("worker ledger needs a durable file path");
    mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA busy_timeout = 0; PRAGMA synchronous = FULL;");
      this.db.exec("BEGIN IMMEDIATE");
      this.db.exec("CREATE TABLE IF NOT EXISTS completions (key TEXT PRIMARY KEY, result TEXT NOT NULL) WITHOUT ROWID");
      const columns = this.db.prepare("PRAGMA table_info(completions)").all();
      if (columns.length !== 2 || columns[0]?.name !== "key" || columns[0]?.pk !== 1 || columns[1]?.name !== "result" || columns[1]?.notnull !== 1) throw new Error("worker ledger has an incompatible completions table");
      // Check persisted receipts before claiming anything, including JSON corruption.
      for (const row of this.db.prepare("SELECT result FROM completions").iterate()) JSON.parse(row.result as string);
      this.db.exec("COMMIT");
    } catch (error) { this.db.close(); throw error; }
  }
  run(key: string, handler: () => Promise<unknown>, signal: AbortSignal): Promise<unknown> {
    const result = this.tail.then(async () => {
      if (this.closed) throw new LedgerUnavailable("worker ledger is closed; polling stopped");
      // Never block Node's event loop waiting for another worker's provider.
      for (;;) {
        signal.throwIfAborted();
        try { this.db.exec("BEGIN IMMEDIATE"); break; }
        catch (error) {
          if ((error as { errcode?: number }).errcode !== 5) throw this.unavailable(error);
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      let handlerFailed = false;
      try {
        const previous = this.db.prepare("SELECT result FROM completions WHERE key = ?").get(key);
        if (previous) { this.db.exec("COMMIT"); return JSON.parse(previous.result as string); }
        let result: unknown;
        try { result = (await handler()) ?? null; }
        catch (error) { handlerFailed = true; throw error; }
        const encoded = JSON.stringify(result);
        if (encoded === undefined) throw new Error("worker ledger result must be JSON serializable");
        this.db.prepare("INSERT INTO completions VALUES (?, ?)").run(key, encoded);
        this.db.exec("COMMIT");
        return JSON.parse(encoded);
      } catch (error) {
        try { this.db.exec("ROLLBACK"); }
        catch { throw this.unavailable(error); }
        if (handlerFailed) throw error;
        throw this.unavailable(error);
      }
    });
    this.tail = result.catch(() => {});
    return result;
  }
  isUnavailable(error: unknown): boolean { return error instanceof LedgerUnavailable; }
  private unavailable(error: unknown): LedgerUnavailable {
    this.close();
    return new LedgerUnavailable(`worker ledger unavailable; polling stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
