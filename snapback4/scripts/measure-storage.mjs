#!/usr/bin/env node
// What the store weighs at scale (after the Snapback 2 Clique 0.0.29 run:
// 5.2 GB, 70% indexes, recipient delivery records). The chat backend
// seeded with many groups of many messages and members; `snapback4 doctor
// --json` weighs the rows, the index entries and the partition log. One
// line to metrics/storage.jsonl.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir, platform, arch, cpus } from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { binary as binaryPath, root, scaleSeed } from "../witness/lib.mjs";

// --workloads adds HTTP and local replica measurements to the same seed.
// These are within-Snapback measurements, not competitor wins: the transport,
// hardware, durability and dataset must also match in a comparison run.
const workloads = process.argv.includes("--workloads");
const sizes = process.argv.slice(2).filter((s) => s !== "--workloads");
const groups = Number(sizes[0] ?? 40);
const messages = Number(sizes[1] ?? 500);
const members = Number(sizes[2] ?? 10);
assert.ok([groups, messages, members].every((n) => Number.isSafeInteger(n) && n > 0));
assert.ok(members >= 2 && members <= 50 && groups <= 1000);
const binary = binaryPath();
const app = mkdtempSync(join(tmpdir(), "sb4-storage-"));
cpSync(join(root, "apps/chat/snapback"), join(app, "snapback"), { recursive: true });
rmSync(join(app, "snapback/generated"), { recursive: true, force: true });
if (workloads) appendFileSync(join(app, "snapback/schema.q"), `
query point(messageId: messages):
  return messages[messageId]

query feed(c: cursor ?):
  return merge messages after c last 20 by byConvTime:
    [m.conversationId] for m in memberships[viewer] first 1000 by byPrincipalConversation
`);
const server = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: app, stdio: ["ignore", "pipe", "inherit"] });
const exited = new Promise((resolve) => { server.once("exit", resolve); server.once("error", resolve); });
const ready = new Promise((resolve, reject) => {
  let output = "";
  const timer = setTimeout(() => reject(new Error("server did not become ready")), 30_000);
  server.on("error", reject);
  server.stdout.on("data", (data) => {
    output += data;
    const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (match) { clearTimeout(timer); resolve(match[0]); }
  });
  exited.then((code) => { clearTimeout(timer); reject(new Error(`server exited ${code} before readiness`)); });
});
let out;
try {
  const api = await ready;
  const request = async (path, body) => {
    if (path.startsWith("/q/")) body = { args: body };
    const response = await fetch(`${api}${path}`, { headers: { "x-snapback-persona": "bob", "content-type": "application/json" }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000) });
    const value = await response.json();
    assert.ok(response.ok && !value.denied && value.state !== "failed", JSON.stringify(value));
    return value;
  };
  const seed = scaleSeed({ groups, messages, members });
  const t0 = performance.now();
  const seeded = await request("/seed", seed);
  assert.equal(seeded.seeded, seed.length);
  const seedMs = +(performance.now() - t0).toFixed(0);
  const measurements = workloads ? await measureWorkloads(request, seed) : undefined;
  server.kill();
  await exited;
  const doctor = spawnSync(binary, ["doctor", "--json"], { cwd: app, encoding: "utf8" });
  const report = JSON.parse(doctor.stdout.trim().split("\n").pop());
  const s = report.storage;
  assert.equal(doctor.status, 0, doctor.stderr);
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const client = workloads ? Buffer.concat(["store", "sqlite", "interpreter", "replica", "key", "cursor"].map((name) => readFileSync(join(root, `packages/snapback4/dist/replica/${name}.js`)))) : undefined;
  out = { at: new Date().toISOString(), binary, binarySha256: digest(readFileSync(binary)), clientSha256: client && digest(client), workloadSha256: digest(readFileSync(new URL(import.meta.url))), seedSha256: digest(JSON.stringify(seed)), sha: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), dirty: !!spawnSync("git", ["status", "--porcelain", "--untracked-files=no", "--", "snapback4"], { cwd: join(root, ".."), encoding: "utf8" }).stdout.trim(), node: process.version, host: `${platform()}-${arch()} ${cpus()[0].model}`, transport: "loopback HTTP; dev personas; file-backed server SQLite WAL/NORMAL", replicas: workloads ? "MemoryStore; node:sqlite :memory: (not Expo or durable device storage)" : undefined, groups, messages, members, seeded: seeded.seeded, seedMs, rowsBytes: s.rows, rowCount: s.row_count, indexBytes: s.indexes, logBytes: s.log, logEvents: s.log_events, fileBytes: s.file, logPerRows: +(s.log / s.rows).toFixed(2), filePerRows: +(s.file / s.rows).toFixed(2), measurements };
} finally {
  server.kill();
  await exited;
  rmSync(app, { recursive: true, force: true });
}
console.log(JSON.stringify(out));
const path = join(root, "metrics/storage.jsonl");
let existing = "";
try { existing = readFileSync(path, "utf8"); } catch { /* first line */ }
writeFileSync(path, `${existing}${JSON.stringify(out)}\n`);

async function measureWorkloads(request, seed) {
  const results = {};
  const timed = async (name, body, check) => {
    const times = [];
    let value;
    for (let n = 0; n < 23; n++) {
      const start = performance.now();
      value = await body(n);
      const elapsed = performance.now() - start;
      check(value);
      if (n >= 3) times.push(elapsed);
    }
    times.sort((a, b) => a - b);
    results[name] = { samples: times.length, p50Ms: +times[9].toFixed(3), p95Ms: +times[18].toFixed(3), maxMs: +times[19].toFixed(3), ...(value.complete === undefined ? {} : { complete: value.complete }), ...(Array.isArray(value.data) ? { rows: value.data.length } : {}) };
    return value;
  };
  const threadArgs = { conversationId: "c000", c: null };
  const pointArgs = { messageId: `c000-msg${String(messages - 1).padStart(5, "0")}` };
  const checkPoint = (r) => assert.equal(r.data.id, pointArgs.messageId);
  const checkThread = (r) => { assert.equal(r.data.length, Math.min(50, messages)); assert.equal(r.data[0].id, `c000-msg${String(messages - 1).padStart(5, "0")}`); };
  const feedExpected = seed.filter((x) => x.table === "messages").map((x) => x.row).sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).slice(0, 20).map((r) => r.id);
  const checkFeed = (r) => {
    assert.ok(r.data.length <= 20);
    if (r.complete) assert.deepEqual(r.data.map((r) => r.id), feedExpected);
  };
  await timed("httpPoint", () => request("/q/point", pointArgs), checkPoint);
  const first = await timed("httpThread", () => request("/q/thread", threadArgs), checkThread);
  if (first.next) await timed("httpNextPage", () => request("/q/thread", { ...threadArgs, c: first.next }), (r) => { assert.equal(r.data.length, Math.min(50, messages - 50)); assert.ok(!r.data.some((x) => first.data.some((y) => x.id === y.id))); });
  const inbox = await timed("httpInbox", () => request("/q/inbox", {}), (r) => assert.equal(r.data.length, Math.min(50, groups)));
  await timed("httpFeed", () => request("/q/feed", { c: null }), checkFeed);

  const { MemoryStore } = await import("../packages/snapback4/dist/replica/store.js");
  const { openSqlite, nodeSqliteDriver } = await import("../packages/snapback4/dist/replica/sqlite.js");
  const { Interpreter } = await import("../packages/snapback4/dist/replica/interpreter.js");
  const { Replica } = await import("../packages/snapback4/dist/replica/replica.js");
  const { DatabaseSync } = await import("node:sqlite");
  const backend = await request("/schema");
  const programs = Object.fromEntries(backend.programs.map((p) => [p.name, p]));
  for (const kind of ["memory", "sqlite"]) {
    const store = kind === "memory" ? new MemoryStore(backend.schema) : await openSqlite(nodeSqliteDriver(new DatabaseSync(":memory:")), backend.schema);
    let pages = 0, events = 0;
    const replica = new Replica(store, backend.schema, { async sync(from, limit, after) {
      const p = await request(`/sync?from=${from}&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`);
      pages++; events += p.events.length;
      return p;
    } }, backend.generation);
    try {
      const start = performance.now();
      assert.equal((await replica.syncOnce()).ok, true);
      results[`${kind}ColdSync`] = { ms: +(performance.now() - start).toFixed(1), pages, events };
      const run = (op, args) => store.read((tx) => new Interpreter(tx, backend.schema, { viewer: "dev:bob", args, now: Date.now(), newIds: [], mint: () => { throw new Error("query minted an id"); } }, "query").run(programs[op]));
      await timed(`${kind}Point`, () => run("point", pointArgs), checkPoint);
      await timed(`${kind}Thread`, () => run("thread", threadArgs), checkThread);
      await timed(`${kind}Inbox`, () => run("inbox", {}), (r) => assert.deepEqual(r.data, inbox.data));
      await timed(`${kind}Feed`, () => run("feed", { c: null }), checkFeed);
      assert.equal(await store.read((tx) => tx.count("messages", "byId", [], Number.MAX_SAFE_INTEGER)), groups * Math.min(messages, 500));
    } finally { await replica.close(); }
  }
  const sent = await timed("httpSend", (n) => request("/m/send", { id: `perf-send-${n}`, args: { conversationId: "c000", body: "measured send" } }), (r) => assert.equal(r.state, "sent"));
  await timed("httpEdit", () => request("/m/edit", { args: { messageId: sent.result.id, body: "measured edit" } }), (r) => assert.equal(r.state, "sent"));
  return results;
}
