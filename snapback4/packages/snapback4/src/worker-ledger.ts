// @ref LLP 3000.009#5.2 — completion is durable before acknowledgement, not atomic with provider I/O.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Node-only, local durable completion ledger. One writer at a time, including
 * the handler: another process sharing this file cannot perform the same key.
 * SQLite releases the lock on process death; uncommitted work may run again. */
export class WorkerLedger {
  private readonly db: DatabaseSync;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(path: string) {
    if (!path || path === ":memory:") throw new Error("worker ledger needs a durable file path");
    mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout = 0; PRAGMA synchronous = FULL;");
  }
  run(key: string, handler: () => Promise<unknown>, signal: AbortSignal): Promise<unknown> {
    const result = this.tail.then(async () => {
      // Never block Node's event loop waiting for another worker's provider.
      for (;;) {
        signal.throwIfAborted();
        try { this.db.exec("BEGIN IMMEDIATE"); break; }
        catch (error) {
          if ((error as { errcode?: number }).errcode !== 5) throw error;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      try {
        this.db.exec("CREATE TABLE IF NOT EXISTS completions (key TEXT PRIMARY KEY, result TEXT NOT NULL) WITHOUT ROWID");
        const previous = this.db.prepare("SELECT result FROM completions WHERE key = ?").get(key);
        if (previous) { this.db.exec("COMMIT"); return JSON.parse(previous.result as string); }
        const result = (await handler()) ?? null;
        const encoded = JSON.stringify(result);
        if (encoded === undefined) throw new Error("worker ledger result must be JSON serializable");
        this.db.prepare("INSERT INTO completions VALUES (?, ?)").run(key, encoded);
        this.db.exec("COMMIT");
        return JSON.parse(encoded);
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
    this.tail = result.catch(() => {});
    return result;
  }
  close(): void { this.db.close(); }
}
