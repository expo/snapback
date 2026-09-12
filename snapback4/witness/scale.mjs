#!/usr/bin/env node
// The cold-sync witness at scale (after the Snapback 2 Clique 0.0.29 run,
// where cold sync took 62 s and 748 MB of heap): bob's partition is many
// groups of many messages; a fresh device syncs it into IndexedDB. Wall
// time, JS heap, a local read, and the reopen are the line. Prints one
// JSON line and appends it to metrics/witness.jsonl.
import { launch, record, scaleSeed } from "./lib.mjs";

const groups = Number(process.argv[2] ?? 40);
const messages = Number(process.argv[3] ?? 500);
const members = Number(process.argv[4] ?? 10);
const seed = scaleSeed({ groups, messages, members });
const witness = await launch({ seed });
const out = { at: new Date().toISOString(), witness: "chromium-scale", binary: process.env.SNAPBACK4_BIN ? "release" : "debug", chromium: witness.chromium, groups, messages, members, seeded: witness.seeded, seedMs: witness.seedMs };
try {
  // The snapshot's size on the wire, as the client will receive it.
  const snapshot = await fetch(`${witness.api}/sync?from=0`, { headers: { "x-snapback-persona": "bob" } }).then((r) => r.text());
  out.snapshotBytes = Buffer.byteLength(snapshot);
  out.snapshotEvents = JSON.parse(snapshot).events.length;
  const heapBefore = await witness.heapMb();
  const first = await witness.page.evaluate(async (api) => {
    const t0 = performance.now();
    const client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1, fetch: (...args) => window.fetch(...args) });
    const syncMs = performance.now() - t0;
    const t1 = performance.now();
    const thread = await client.query({ kind: "query", name: "thread" }, { conversationId: "c000" });
    const threadMs = performance.now() - t1;
    const t2 = performance.now();
    const inbox = await client.query({ kind: "query", name: "inbox" }, {});
    const inboxMs = performance.now() - t2;
    const state = await client.replica.state();
    await client.close();
    return { syncMs: +syncMs.toFixed(0), threadRows: thread.data.length, threadComplete: thread.complete, threadMs: +threadMs.toFixed(1), inboxRows: inbox.data.length, inboxMs: +inboxMs.toFixed(1), watermark: state.watermark };
  }, witness.api);
  const heapAfter = await witness.heapMb();
  Object.assign(out, { first, heapMbBefore: heapBefore, heapMbAfter: heapAfter });
  await witness.reload();
  const second = await witness.page.evaluate(async (api) => {
    const t0 = performance.now();
    const client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1, fetch: (...args) => window.fetch(...args) });
    const reopenMs = performance.now() - t0;
    const t1 = performance.now();
    const thread = await client.query({ kind: "query", name: "thread" }, { conversationId: "c039" });
    const threadMs = performance.now() - t1;
    await client.close();
    return { reopenMs: +reopenMs.toFixed(1), threadRows: thread.data.length, threadMs: +threadMs.toFixed(1) };
  }, witness.api);
  out.second = second;
  out.ok = first.threadRows === 50 && first.threadComplete && first.inboxRows === groups && second.threadRows === 50;
} finally {
  await witness.close();
}
console.log(JSON.stringify(out));
record(out);
process.exit(out.ok ? 0 : 1);
