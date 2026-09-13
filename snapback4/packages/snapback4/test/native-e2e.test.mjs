// The native tier against the real module — `snapback4 device`, the same
// Rust the Expo module and the Exact2 host link, as a process — and a live
// `snapback4 dev`: two devices converge through the stream, a send is
// pending then sent, a device offline queues durably and flushes in order,
// a cold start offline opens on the backend the device kept.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { isReady } from "../dist/contract.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = join(root, "target/debug/snapback4");
const port = 4550 + (process.pid % 20);
const url = `http://127.0.0.1:${port}`;
const api = { thread: { kind: "query", name: "thread" }, inbox: { kind: "query", name: "inbox" }, send: { kind: "mutation", name: "send" } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 10_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await sleep(25);
  }
}

test("the native module follows the server, predicts, queues, and starts cold offline", { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-native-"));
  cpSync(join(root, "apps/chat/snapback"), join(dir, "snapback"), { recursive: true });
  rmSync(join(dir, "snapback/generated"), { recursive: true, force: true });
  const server = spawn(binary, ["dev", "--port", String(port), "--no-watch", "--fresh"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const data = join(dir, "devices");
  rmSync(data, { recursive: true, force: true });
  const open = [];
  try {
    await until(async () => { try { await fetch(url); return true; } catch { return false; } });
    await fetch(`${url}/seed`, { method: "POST", body: JSON.stringify([
      { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
      { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
      { table: "memberships", row: { id: "m2", conversationId: "c1", principal: "dev:bob", role: "member", joinedAt: 2 } },
      ...Array.from({ length: 30 }, (_, n) => ({ table: "messages", row: { id: `seed${String(n).padStart(3, "0")}`, conversationId: "c1", authorId: "dev:alice", body: `seed ${n}`, at: 1000 + n } })),
    ]) });
    const { mkdirSync } = await import("node:fs");
    mkdirSync(data, { recursive: true });
    const native = processDevice(binary, data, (command, args) => spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] }), async (path, text) => writeFileSync(path, text));
    let offline = false;
    const gated = (input, init) => offline ? Promise.reject(new TypeError("offline")) : fetch(input, init);
    const alice = await createLocalClient({ url, persona: "alice", device: native, fetch: gated, waitSeconds: 2 });
    let bobCore;
    const bobDevice = { open: async (name, backend) => (bobCore = await native.open(name, backend)) };
    const bob = await createLocalClient({ url, persona: "bob", device: bobDevice, waitSeconds: 2 });
    open.push(alice, bob);
    // Bob's device holds the partition: the thread pages, the count is right.
    const thread = await bob.query(api.thread, { conversationId: "c1", c: null });
    assert.ok(isReady(thread) && thread.data.length === 30 && thread.complete && thread.fresh, JSON.stringify(thread).slice(0, 200));
    const inbox = await bob.query(api.inbox, {});
    assert.equal(inbox.data[0].count, 30);
    // Alice sends: predicted pending on her device, sent by the server, live on bob's.
    const bobThread = bob.observe(api.thread, { conversationId: "c1", c: null });
    const sent = await alice.mutate(api.send, { conversationId: "c1", body: "hello from the module" });
    assert.equal(sent.state, "sent", JSON.stringify(sent));
    const seen = await until(() => { const r = bobThread.getSnapshot(); return isReady(r) && r.data[0]?.body === "hello from the module" ? r : null; });
    assert.equal(seen.data[0].pending, undefined, "the server's image carries no pending");
    assert.equal((await bob.query(api.inbox, {})).data[0].count, 31);
    // Offline: a burst queues durably in order and renders pending; it flushes in order on reconnect.
    offline = true;
    await until(async () => { await alice.mutate(api.send, { conversationId: "c1", body: "probe" }); return alice.link() === "offline"; });
    const burst = await Promise.all(Array.from({ length: 5 }, (_, n) => alice.mutate(api.send, { conversationId: "c1", body: `q${n}` })));
    assert.ok(burst.every((w) => w.state === "pending"));
    const local = await alice.query(api.thread, { conversationId: "c1", c: null });
    assert.ok(isReady(local) && local.fresh === false && local.data.filter((m) => m.pending === true).length >= 5, JSON.stringify(local).slice(0, 300));
    offline = false;
    const reconnectDeadline = Date.now() + 20_000;
    const landed = await until(async () => { const r = await bob.query(api.thread, { conversationId: "c1", c: null }); return isReady(r) && r.data.filter((m) => /^q\d$/.test(m.body)).length === 5 ? r : null; }, Math.max(0, reconnectDeadline - Date.now()));
    assert.deepEqual(landed.data.filter((m) => /^q\d$/.test(m.body)).map((m) => m.body).reverse(), ["q0", "q1", "q2", "q3", "q4"]);
    // A complete online query can come from the server. Wait for Bob's
    // own committed rows before close aborts the follower's next request.
    await until(async () => {
      const result = await bobCore.call({ op: "query", name: "thread", viewer: "dev:bob", args: { conversationId: "c1", c: null }, now: Date.now() });
      const rows = result.ok?.data;
      return Array.isArray(rows) && rows.length === 37 && rows.filter((row) => /^q\d$/.test(row.body)).length === 5;
    }, Math.max(0, reconnectDeadline - Date.now()));
    await alice.close();
    await bob.close();
    // A cold start with the server unreachable: the device opens on the backend it kept.
    const dead = () => Promise.reject(new TypeError("no network"));
    const cold = await createLocalClient({ url, persona: "bob", device: native, fetch: dead, waitSeconds: 1 });
    open.push(cold);
    assert.equal(cold.link(), "offline");
    const held = await cold.query(api.thread, { conversationId: "c1", c: null });
    assert.ok(isReady(held) && held.fresh === false && held.data.length === 37, JSON.stringify(held).slice(0, 200));
    await cold.close();
  } catch (error) {
    error.message += `\n--- server log ---\n${log}`;
    throw error;
  } finally {
    for (const client of open) await client.close().catch(() => {});
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
