#!/usr/bin/env node
// Descriptive browser acquisition and offline-reopen evidence, not the full-hub
// floor comparison. The constructor awaits sync; no earlier app render is measured.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cpus, platform, arch } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { binary, launch, record, root, scaleSeed } from "./lib.mjs";

const [groups, messages, members] = [process.argv[2] ?? 40, process.argv[3] ?? 500, process.argv[4] ?? 10].map(Number);
assert.ok([groups, messages, members].every(Number.isSafeInteger) && groups > 0 && messages > 0 && members >= 2 && members <= 50, "usage: scale.mjs [positive groups] [positive messages/group] [members 2..50]");
const group = n => `c${String(n).padStart(3, "0")}`;
const finalGroup = group(groups - 1);
const seed = scaleSeed({ groups, messages, members });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const artifact = path => { const bytes = readFileSync(path); return { bytes: bytes.length, sha256: sha256(bytes) }; };
const sourcePaths = ["bun.lock", "witness/scale.mjs", "witness/lib.mjs", "apps/chat/snapback/schema.q", "packages/snapback4/src/contract.ts", "packages/snapback4/src/local.ts", "packages/snapback4/src/web.ts"];
const out = {
  at: new Date().toISOString(), witness: "chromium-scale", measurement: "cold constructor acquisition then useful queries; fresh-realm offline reopen",
  sourceCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  sourceArtifacts: Object.fromEntries(sourcePaths.map(path => [path, artifact(join(root, path))])),
  binary: { path: binary(), ...artifact(binary()) }, wasm: artifact(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")),
  host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version },
  packageVersion: JSON.parse(readFileSync(join(root, "packages/snapback4/package.json"), "utf8")).version,
  groups, messages, members, finalGroup, seed: { rows: seed.length, ...(() => { const bytes = Buffer.from(JSON.stringify(seed)); return { bytes: bytes.length, sha256: sha256(bytes) }; })() },
  limits: "browser client/replica only; app shell served for each realm; no app auth/render, native, power-loss, external workers or full-hub 2x-floor claim",
  requiredReplica: { conversations: groups, memberships: groups * members, messages: groups * Math.min(messages, 500), messageCounts: groups },
  heapMeasurement: "CDP JSHeapUsedSize snapshots without forced GC; not peak memory; wasm linear memory not separately measured",
  pageErrors: [], ok: false,
};
let witness;
try {
  witness = await launch({ seed });
  Object.assign(out, { chromium: witness.chromium, browserVersion: witness.page.context().browser().version(), seeded: witness.seeded, seedMs: witness.seedMs });
  assert.equal(witness.seeded, seed.length);
  witness.page.on("pageerror", error => out.pageErrors.push(String(error)));
  out.heapMbBefore = await witness.heapMb();
  out.first = await witness.page.evaluate(async ({ api, finalGroup }) => {
    window.__scaleRealm = "cold";
    let onlineQueryRequests = 0;
    const sync = { pages: 0, snapshotPages: 0, bytes: 0, events: 0, snapshotEvents: 0, tables: {}, caughtUp: false };
    const measuredFetch = async (...args) => {
      if (String(args[0]).startsWith(api + "/q/")) onlineQueryRequests++;
      const response = await window.fetch(...args);
      if (String(args[0]).endsWith("/sync")) {
        // Count every acquisition page, including stream catch-up. This clone
        // and JSON decode are part of the reported instrumented wall time.
        const text = await response.clone().text(), page = JSON.parse(text);
        sync.pages++; sync.bytes += new TextEncoder().encode(text).byteLength;
        sync.events += page.events?.length ?? 0;
        if (page.snapshot) {
          sync.snapshotPages++; sync.snapshotEvents += page.events.length;
          for (const event of page.events) sync.tables[event.table] = (sync.tables[event.table] ?? 0) + 1;
        }
        if (!page.denied && !page.snapshot && page.more === false) sync.caughtUp = true;
      }
      return response;
    };
    const start = performance.now();
    const client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1, fetch: measuredFetch });
    const opened = performance.now();
    try {
      const first = await client.query({ kind: "query", name: "thread" }, { conversationId: "c000", c: null });
      const useful = performance.now();
      const last = await client.query({ kind: "query", name: "thread" }, { conversationId: finalGroup, c: null });
      const inbox = await client.query({ kind: "query", name: "inbox" }, {});
      return { openAndAcquireMs: opened - start, firstUsefulMs: useful - start, firstQueryMs: useful - opened, requiredQueriesMs: performance.now() - opened, onlineQueryRequests, sync, first, last, inbox, link: client.link() };
    } finally { await client.close(); }
  }, { api: witness.api, finalGroup });
  out.heapMbAfter = await witness.heapMb();
  const check = (result, fresh) => {
    for (const [read, conversationId] of [[result.first, "c000"], [result.last, finalGroup]]) {
      assert.ok("data" in read, JSON.stringify(read));
      assert.equal(read.complete, true);
      assert.equal(read.fresh, fresh);
      const expected = seed.filter(entry => entry.table === "messages" && entry.row.conversationId === conversationId).slice(-50).map(entry => entry.row);
      assert.deepEqual(read.data.map(row => row.id).sort(), expected.map(row => row.id).sort());
      for (const row of read.data) {
        const original = expected.find(item => item.id === row.id);
        assert.equal(row.body, original.body); assert.equal(row.at, original.at); assert.equal(row.conversationId, original.conversationId);
      }
    }
    assert.ok("data" in result.inbox, JSON.stringify(result.inbox));
    assert.equal(result.inbox.fresh, fresh);
    assert.equal(result.inbox.complete, groups <= 50);
    const inboxGroups = Array.from({ length: groups }, (_, n) => group(n)).sort().slice(0, 50);
    assert.deepEqual(result.inbox.data.map(row => row.conversationId).sort(), inboxGroups);
    for (const row of result.inbox.data) { assert.equal(row.count, messages); assert.equal(row.conversation.id, row.conversationId); }
  };
  check(out.first, true);
  assert.equal(out.first.sync.caughtUp, true, "constructor completed snapshot plus stream catch-up");
  assert.deepEqual(out.first.sync.tables, out.requiredReplica);
  assert.equal(out.first.onlineQueryRequests, 0, "useful reads ran on the acquired local replica");
  out.offline = { blockedApiRequests: 0, wasmRequests: 0, appShell: "served into a new JS realm; backend and wasm network blocked" };
  await witness.page.route(`${witness.api}/**`, route => { out.offline.blockedApiRequests++; return route.abort("internetdisconnected"); });
  await witness.page.route("**/*.wasm", route => { out.offline.wasmRequests++; return route.abort("internetdisconnected"); });
  await witness.reload();
  out.second = await witness.page.evaluate(async ({ api, finalGroup }) => {
    if (window.__scaleRealm) throw Error("offline reopen reused the previous JS realm");
    const start = performance.now();
    const client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1 });
    const opened = performance.now();
    try {
      const first = await client.query({ kind: "query", name: "thread" }, { conversationId: "c000", c: null });
      const last = await client.query({ kind: "query", name: "thread" }, { conversationId: finalGroup, c: null });
      const inbox = await client.query({ kind: "query", name: "inbox" }, {});
      return { reopenMs: opened - start, requiredQueriesMs: performance.now() - opened, first, last, inbox, link: client.link() };
    } finally { await client.close(); }
  }, { api: witness.api, finalGroup });
  out.heapMbAfterOfflineReopen = await witness.heapMb();
  check(out.second, false);
  assert.equal(out.second.link, "offline");
  assert.equal(out.offline.wasmRequests, 0, "reopen uses the persisted runtime");
  assert.deepEqual(out.pageErrors, []);
  out.ok = true;
} catch (error) {
  out.error = { message: error.message, stack: error.stack };
} finally {
  try { await witness?.close(); }
  catch (error) { out.ok = false; out.cleanupError = String(error); }
}
// Preserve exact result identities without recording every row's full body.
for (const phase of [out.first, out.second]) if (phase) for (const name of ["first", "last", "inbox"]) {
  const read = phase[name];
  if (read && "data" in read) phase[name] = { rows: read.data.length, complete: read.complete, fresh: read.fresh, next: !!read.next, dataSha256: sha256(JSON.stringify(read.data)), ids: read.data.map(row => row.id ?? row.conversationId) };
}
console.log(JSON.stringify(out));
record(out);
process.exitCode = out.ok ? 0 : 1;
