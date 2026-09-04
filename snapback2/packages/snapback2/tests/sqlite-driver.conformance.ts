import type { SqliteDriver } from "../src/store/sqlite-driver.js";

export interface SqliteConformanceResult { journalMode: string; checks: string[] }

/** Portable: the witness passes two independently opened connections to the same scratch database. */
export async function runSqliteDriverConformance(open: () => SqliteDriver | Promise<SqliteDriver>): Promise<SqliteConformanceResult> {
  const first = await open();
  const second = await open();
  const checks: string[] = [];
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(`sqlite conformance: ${message}`); };
  try {
    const mode = await first.get<{ journal_mode: string }>("PRAGMA journal_mode=WAL");
    const readback = await first.get<{ journal_mode: string }>("PRAGMA journal_mode");
    check(mode?.journal_mode === readback?.journal_mode, "journal_mode readback");
    checks.push("journal_mode readback");
    await first.exec("CREATE TABLE IF NOT EXISTS conformance (key TEXT PRIMARY KEY, value BLOB NOT NULL); DELETE FROM conformance;");
    for (const length of [1, 1024 * 1024, 0]) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index++) bytes[index] = index % 251;
      await first.run("INSERT INTO conformance VALUES (?, ?)", [String(length), bytes]);
      const held = await first.get<{ value: Uint8Array }>("SELECT value FROM conformance WHERE key = ?", [String(length)]);
      check(held?.value instanceof Uint8Array && held.value.length === length && held.value.every((value, index) => value === bytes[index]), `BLOB ${length}`);
      checks.push(`BLOB ${length}`);
    }
    const keys = [["messages", "m\0x"], ["messages", "m\0y"], ["messages", ""], ["messages", "quote\",雪"],
      ["thread", JSON.stringify({ nested: { words: ["a", "b"], empty: null } })]];
    for (const key of keys) await first.run("INSERT INTO conformance VALUES (?, ?)", [JSON.stringify(key), new Uint8Array([9])]);
    for (const key of keys) {
      const held = await first.get<{ key: string }>("SELECT key FROM conformance WHERE key = ?", [JSON.stringify(key)]);
      check(held?.key === JSON.stringify(key), "JSON tuple key round trip");
    }
    checks.push("JSON tuple key round trip");
    const absent = await first.get("SELECT key FROM conformance WHERE key = ?", ["missing"]);
    check(absent === undefined, "missing row is undefined");
    checks.push("missing row is undefined");
    const marker = new Error("rollback marker");
    try {
      await first.transaction(async (tx) => {
        await tx.run("INSERT INTO conformance VALUES (?, ?)", ["rollback", new Uint8Array([1])]);
        await Promise.resolve();
        throw marker;
      });
      throw new Error("transaction swallowed throw");
    } catch (error) { check(error === marker, "rollback propagates the body error"); }
    check(await first.get("SELECT key FROM conformance WHERE key = ?", ["rollback"]) === undefined, "rollback on throw");
    checks.push("rollback on throw");
    let release!: () => void;
    let reached!: () => void;
    let committed = false;
    let interleaved = false;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const atBarrier = new Promise<void>((resolve) => { reached = resolve; });
    const write = first.transaction(async (tx) => {
      await tx.run("INSERT INTO conformance VALUES (?, ?)", ["barrier", new Uint8Array([2])]);
      reached();
      await barrier;
      return 42;
    }).then((value) => { committed = true; return value; });
    await atBarrier;
    const competing = second.run("INSERT INTO conformance VALUES (?, ?)", ["competing", new Uint8Array([3])])
      .then(() => { if (!committed) interleaved = true; }, (error) => {
        check(/busy|locked/i.test(String(error)), `competing writer must busy or wait: ${error}`);
      });
    // Also prove that an outer operation on this driver cannot enter its suspended transaction.
    let outerFinished = false;
    const outer = first.run("INSERT INTO conformance VALUES (?, ?)", ["outer", new Uint8Array([4])]).then(() => { outerFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const prematureOuter = outerFinished;
    release();
    check(await write === 42, "transaction result");
    await Promise.all([competing, outer]);
    check(!interleaved && !prematureOuter, "late beforeCommit holds transaction");
    checks.push("late beforeCommit holds transaction", "transaction result");
    return { journalMode: readback!.journal_mode, checks };
  } finally {
    await first.close();
    await second.close();
  }
}
