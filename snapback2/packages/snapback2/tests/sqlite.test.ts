import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient, SnapbackRefusal } from "../dist/client.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { nodeSqliteDriver, SqliteBackend, inProcessLocks, projectState, unprojectState,
  runSqliteDriverConformance, sqliteState, fixtureAsset } from "../dist/sqlite-test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { sqliteFactory } from "./sqlite-fixture.ts";

const temporary = () => mkdtemp(join(tmpdir(), "s2-sqlite-"));
const noBytes = { put: [], remove: [] };

test("SQLite driver conformance: BLOBs, JSON keys, rollback, late beforeCommit, and journal mode", async (t) => {
  const root = await temporary();
  try {
    const result = await runSqliteDriverConformance(() => nodeSqliteDriver(join(root, "conformance.db")));
    t.diagnostic(`journal_mode=${result.journalMode}; ${result.checks.join(", ")}`);
    assert.equal(result.journalMode, "wal");
    assert.equal(result.checks.length, 9);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("every PersistedRangeState field round-trips on file, IndexedDB, and SQLite", async () => {
  const root = await temporary();
  const state = { ...sqliteState(), currentGrant: undefined, facts: undefined,
    futureMetadata: { stillHeld: ["yes", undefined, null], omitted: undefined, explicit: null } };
  const row = Object.values(state.rows)[0].row;
  row.omitted = undefined;
  row.explicit = null;
  Object.values(state.answers)[0].reason = undefined;
  const expected = JSON.parse(JSON.stringify(state));
  assert.deepEqual(unprojectState(projectState(state)), expected);
  assert.equal(Object.hasOwn(expected, "currentGrant"), false);
  assert.equal(Object.hasOwn(Object.values(expected.rows)[0].row, "omitted"), false);
  assert.deepEqual(expected.futureMetadata, { stillHeld: ["yes", null, null], explicit: null });
  const factories = [fileRangeStore(root),
    indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() }),
    sqliteFactory(join(root, "state.db"))];
  try {
    for (const factory of factories) {
      const store: any = factory();
      // Exercise the carrier projection directly, before the common store's normalization.
      const backend = store.backend;
      assert.equal(await backend.open("projection"), undefined);
      try {
        for (const value of [sqliteState(), state]) {
          await backend.replace(value, { put: [{ key: fixtureAsset, bytes: new Uint8Array([1, 2, 3]) }], remove: [] });
          await backend.close();
          assert.deepEqual(await backend.open("projection"), value === state ? expected : value, factory.carrier);
          assert.deepEqual(await backend.readBytes(fixtureAsset), new Uint8Array([1, 2, 3]));
        }
      } finally { await backend.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("IndexedDB rows without meta survive open with version 1 and default maps on every carrier", async () => {
  const root = await temporary();
  const database = new FakeIndexedDb();
  const name = "snapback2:partial";
  database.seedVersion1(name, ["rows", "answers", "outbox", "meta", "ranges", "absences", "verdicts"]);
  const opened = database.open(name);
  const db = await new Promise<any>((resolve) => { opened.onsuccess = () => resolve(opened.result); });
  const state = sqliteState();
  const rows = projectState(state).rows;
  const transaction = db.transaction(["rows"], "readwrite");
  for (const entry of rows) transaction.objectStore("rows").put(entry);
  await new Promise<void>((resolve) => { transaction.oncomplete = () => resolve(); });
  db.close();
  const indexed: any = indexedDbRangeStore({ indexedDB: database as any, locks: new FakeLocks() })();
  const path = join(root, "partial.db");
  const sqlite = new SqliteBackend(nodeSqliteDriver(path));
  const raw = nodeSqliteDriver(path);
  const file: any = fileRangeStore(root)();
  try {
    await sqlite.open("partial");
    await sqlite.replace(state, noBytes);
    await sqlite.close();
    await raw.run("DELETE FROM state");
    await raw.run("DELETE FROM answers");
    await raw.run("DELETE FROM outbox");
    await raw.close();
    await file.backend.open("partial");
    await file.backend.replace({ rows: state.rows }, noBytes);
    await file.backend.close();
    const expected = { ...sqliteState(), version: 1, sealed: false, clock: 0, rows: state.rows };
    const defaults = ["answers", "outbox", "watermarks", "grants", "overlay", "overlayMisses", "bounds", "programs", "negative", "rowSeq", "assets", "viewed"];
    for (const backend of [indexed.backend, sqlite, file.backend]) {
      const restored = await backend.open("partial");
      assert.deepEqual(restored.rows, expected.rows, backend.carrier);
      assert.equal(restored.version, 1);
      assert.equal(restored.sealed, false);
      assert.equal(restored.clock, 0);
      for (const field of defaults) assert.deepEqual(restored[field], {}, `${backend.carrier}: ${field}`);
      await backend.close();
    }
  } finally { await indexed.close(); await sqlite.close(); await raw.close(); await file.close(); await rm(root, { recursive: true, force: true }); }
});

test("SQLite replace rolls state and byte deltas back when beforeCommit throws", async () => {
  const root = await temporary();
  let reject = false;
  const backend = new SqliteBackend(nodeSqliteDriver(join(root, "state.db")), { beforeCommit() { if (reject) throw new Error("late failure"); } });
  try {
    await backend.open("rollback");
    await backend.replace(sqliteState(1), { put: [{ key: "old", bytes: new Uint8Array([1]) }], remove: [] });
    reject = true;
    await assert.rejects(backend.replace(sqliteState(2), { put: [{ key: "new", bytes: new Uint8Array([2]) }], remove: ["old"] }), /late failure/);
    assert.deepEqual(await backend.open("rollback"), sqliteState(1));
    assert.deepEqual(await backend.readBytes("old"), new Uint8Array([1]));
    assert.equal(await backend.readBytes("new"), undefined);
  } finally { await backend.close(); await rm(root, { recursive: true, force: true }); }
});

for (const stage of ["before", "after"]) {
  test(`SIGKILL ${stage} COMMIT preserves exactly the ${stage === "before" ? "pre" : "post"}-swap rows and bytes`, { timeout: 5000 }, async () => {
    const root = await temporary();
    const path = join(root, "kill.db");
    const child = fork(new URL("./sqlite-crash-child.mjs", import.meta.url), [path, stage], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let stderr = "";
    child.stderr!.on("data", (data) => { stderr += data; });
    const exited = once(child, "exit");
    const backend = new SqliteBackend(nodeSqliteDriver(path));
    try {
      const [message] = await Promise.race([
        once(child, "message"), exited.then(() => { throw new Error(`child exited before barrier: ${stderr}`); }),
      ]);
      assert.equal(message.reached, stage);
      assert.equal(child.kill("SIGKILL"), true);
      assert.deepEqual(await exited, [null, "SIGKILL"]);
      const clock = stage === "before" ? 1 : 2;
      assert.deepEqual(await backend.open("kill-partition"), sqliteState(clock));
      assert.deepEqual(await backend.readBytes(fixtureAsset), new Uint8Array([clock, clock, clock]));
      assert.deepEqual(await backend.readBytes("old-only"), stage === "before" ? new Uint8Array([5]) : undefined);
      assert.deepEqual(await backend.readBytes("new-only"), stage === "after" ? new Uint8Array([6]) : undefined);
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
      await backend.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("in-process locks refuse a second client on the partition and release on close", async () => {
  const root = await temporary();
  const store = sqliteFactory(join(root, "locks.db"));
  const first = createClient({ url: "http://lock.test", as: "alice", offline: { store } });
  await first.ready;
  const second = createClient({ url: "http://lock.test", as: "alice", offline: { store } });
  try {
    await assert.rejects(second.ready, (error) => error instanceof SnapbackRefusal && error.code === "E_OFFLINE_LOCK"
      && error.envelope.rewrite.includes("another client"));
    second.close();
    first.close();
    await first.close();
    const third: any = store();
    await third.open("dev:alice");
    await third.close();
    await assert.rejects(inProcessLocks().request("throwing", { ifAvailable: true }, () => { throw new Error("release"); }));
    await inProcessLocks().request("throwing", { ifAvailable: true }, (lock) => assert.ok(lock));
  } finally { first.close(); second.close(); await first.close(); await second.close(); await rm(root, { recursive: true, force: true }); }
});

test("in-process locks scope one partition to its database across separate factories", async () => {
  const root = await temporary();
  const first = sqliteFactory(join(root, "first.db"))();
  const duplicate = sqliteFactory(join(root, ".", "first.db"))();
  const second = sqliteFactory(join(root, "second.db"))();
  const file = fileRangeStore(root)();
  try {
    await first.open("dev:alice");
    await second.open("dev:alice");
    await file.open("dev:alice");
    await assert.rejects(duplicate.open("dev:alice"), (error: any) => error.code === "E_OFFLINE_LOCK");
    await duplicate.close();
    await first.close();
    await duplicate.open("dev:alice");
    await second.commit({ bounds: { second: 2 } });
    assert.deepEqual(await second.outbox.bounds(), { second: 2 });
  } finally { await first.close(); await duplicate.close(); await second.close(); await file.close(); await rm(root, { recursive: true, force: true }); }
});

test("SQLite refuses unopenable files, a journal mismatch, and competing writes as E_OFFLINE_CARRIER", async () => {
  const root = await temporary();
  const bad = new SqliteBackend(nodeSqliteDriver(join(root, "missing", "db")));
  const memory = new SqliteBackend(nodeSqliteDriver(":memory:"));
  const path = join(root, "busy.db");
  const driver = nodeSqliteDriver(path);
  const backend = new SqliteBackend(nodeSqliteDriver(path));
  const carrierFailure = (error: any) => error.code === "E_OFFLINE_CARRIER";
  try {
    await assert.rejects(bad.open("unopenable"), (error: any) => carrierFailure(error) && /writable database/.test(error.rewrite));
    await assert.rejects(memory.open("mismatch"), (error: any) => carrierFailure(error) && /journal_mode/.test(error.message));
    await backend.open("busy");
    await driver.transaction(async (tx) => {
      await tx.run("INSERT INTO state VALUES (?, ?)", ["other", "{}"]);
      await assert.rejects(backend.replace(sqliteState(), noBytes), (error: any) => carrierFailure(error)
        && error.rewrite === "another writer holds the store; close it or wait");
      const client = createClient({ url: "http://busy.test", as: "alice", offline: { store: sqliteFactory(path) } });
      try {
        await assert.rejects(client.ready, (error: any) => error instanceof SnapbackRefusal && carrierFailure(error)
          && error.envelope.rewrite === "another writer holds the store; close it or wait"
          && error.envelope.family === "offline" && error.envelope.guide === "offline" && !!error.envelope.site);
      } finally { await client.close(); }
    });
  } finally { await bad.close(); await memory.close(); await backend.close(); await driver.close(); await rm(root, { recursive: true, force: true }); }
});

test("SQLite wipe deletes only the named partition; shared database and sidecars remain", async () => {
  const root = await temporary();
  const path = join(root, "partitions.db");
  const alice = new SqliteBackend(nodeSqliteDriver(path));
  const bob = new SqliteBackend(nodeSqliteDriver(path));
  try {
    await alice.open("alice");
    await alice.replace(sqliteState(1), { put: [{ key: "payload", bytes: new Uint8Array([1]) }], remove: [] });
    await bob.open("bob");
    await bob.replace(sqliteState(2), { put: [{ key: "payload", bytes: new Uint8Array([2]) }], remove: [] });
    await alice.wipe("alice");
    for (const suffix of ["", "-wal", "-shm"]) assert.ok((await stat(path + suffix)).isFile());
    assert.deepEqual(await bob.readBytes("payload"), new Uint8Array([2]));
    assert.equal(await alice.open("alice"), undefined);
    assert.equal(await alice.readBytes("payload"), undefined);
    // A wipe of another unowned partition preserves this backend's connection.
    await bob.close();
    await alice.wipe("bob");
    await alice.replace(sqliteState(), noBytes);
    assert.equal(await bob.open("bob"), undefined);
  } finally { await alice.close(); await bob.close(); await rm(root, { recursive: true, force: true }); }
});
