// @ref LLP 3000.000.000#22-wave-29-release-identity-rel2 — kernel writer ownership survives arbitrary lease and reclaimer scheduling.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, lstatSync } from "node:fs";

/** A stable SQLite writer lock is the authority. The JSON lease is diagnostic:
 * expiry never evicts a live writer; process death releases the kernel lock.
 * Never unlink the database: concurrent reclaimers must lock the same inode. */
export function rosterLock(path: string) {
  const database = path + ".sqlite";
  for (const file of [path, database]) {
    try { if (!lstatSync(file).isFile()) throw Error("E_PRODUCTION_ROSTER: lock must be a regular file"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const fd = openSync(database, "a", 0o600); closeSync(fd);
  const db = new DatabaseSync(database);
  try { db.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE"); }
  catch (error) {
    db.close();
    if ((error as {errcode?:number}).errcode === 5) throw Error("E_PRODUCTION_ROSTER_BUSY: roster has a live kernel lock; holder and lease are recorded in its .lock file; retry after the driver exits");
    throw error;
  }
  const token = randomUUID(), holder = {pid:process.pid, host:hostname(), startedAt:Date.now()};
  let fault: unknown;
  const write = (released = false) => {
    const temporary = path + "." + token + ".tmp";
    const file = openSync(temporary, "wx", 0o600);
    try {
      const renewedAt = Date.now();
      writeFileSync(file, JSON.stringify({version:2, token, holder, lease:{renewedAt, expiresAt:released ? renewedAt : renewedAt + 30_000}, released}));
      fsyncSync(file);
    } finally { closeSync(file); }
    try { renameSync(temporary, path); } finally { try { unlinkSync(temporary); } catch {} }
  };
  try { write(); } catch (error) { db.close(); throw error; }
  const timer = setInterval(() => { try { write(); } catch (error) { fault = error; } }, 10_000);
  timer.unref();
  return {
    assertHeld() { if (fault) throw Error("E_PRODUCTION_ROSTER: unable to renew holder lease; stop and inspect the lock file"); },
    release() { clearInterval(timer); try { write(true); } catch { /* Kernel release remains authoritative; preserve the account error. */ } finally { db.close(); } },
  };
}
