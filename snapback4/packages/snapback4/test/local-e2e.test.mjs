// The local-first client against a live `snapback4 dev`: two devices on one
// conversation, a send that renders pending then sent, a device that goes
// offline and comes back, and the other device's replica following the
// stream. Memory stores here; IndexedDB is the Chromium witness's job.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { memorySessionStore } from "../dist/auth.js";
import { isReady } from "../dist/contract.js";
import { nodeSqliteDriver, openSqlite } from "../dist/replica/index.js";
import { DatabaseSync } from "node:sqlite";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = join(root, "target/debug/snapback4");
const port = 4470 + (process.pid % 20);
const url = `http://127.0.0.1:${port}`;
const api = { thread: { kind: "query", name: "thread" }, inbox: { kind: "query", name: "inbox" }, send: { kind: "mutation", name: "send" }, invite: { kind: "mutation", name: "invite" } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await sleep(25);
  }
}

test("two devices converge through the partition stream", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-chat-"));
  cpSync(join(root, "apps/chat/snapback"), join(dir, "snapback"), { recursive: true });
  rmSync(join(dir, "snapback/generated"), { recursive: true, force: true });
  const server = spawn(binary, ["dev", "--port", String(port), "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  try {
    await until(async () => { try { await fetch(url); return true; } catch { return false; } });
    const seeded = await fetch(`${url}/seed`, { method: "POST", body: JSON.stringify([
      { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
      { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
      { table: "memberships", row: { id: "m2", conversationId: "c1", principal: "dev:bob", role: "member", joinedAt: 2 } },
    ]) }).then((r) => r.json());
    assert.equal(seeded.seeded, 3);

    // A switchable fetch models the link.
    let offline = false;
    const gated = (input, init) => offline ? Promise.reject(new TypeError("offline")) : fetch(input, init);
    const alice = await createLocalClient({ url, persona: "alice", store: "memory", fetch: gated, waitSeconds: 2 });
    const bob = await createLocalClient({ url, persona: "bob", store: "memory", waitSeconds: 2 });

    // Bob's replica holds the conversation from the snapshot.
    const bobInbox = bob.observe(api.inbox, {});
    const inbox = await until(() => { const r = bobInbox.getSnapshot(); return isReady(r) ? r : null; });
    assert.equal(inbox.data[0].conversation.title, "General");
    assert.equal(inbox.data[0].count, 0);
    assert.equal(inbox.fresh, true);

    // Alice sends: the outcome is sent with a sequence; bob's thread shows it.
    const sent = await alice.mutate(api.send, { conversationId: "c1", body: "hello bob" });
    assert.equal(sent.state, "sent", JSON.stringify(sent));
    // Two writes at once on a healthy link both land: a write queued while
    // a flush runs is flushed by that flush's next pass, not by the next
    // link change.
    const pair = await Promise.all([alice.mutate(api.send, { conversationId: "c1", body: "one" }), alice.mutate(api.send, { conversationId: "c1", body: "two" })]);
    assert.deepEqual(pair.map((w) => w.state), ["sent", "sent"], JSON.stringify(pair));
    for (const w of pair) assert.ok(w.seq > 0);
    const bobThread = bob.observe(api.thread, { conversationId: "c1" });
    const thread = await until(() => { const r = bobThread.getSnapshot(); return isReady(r) && r.data.length === 3 ? r : null; });
    assert.equal(thread.data[2].body, "hello bob");
    assert.equal(thread.data[0].pending, undefined);
    await until(() => { const r = bobInbox.getSnapshot(); return isReady(r) && r.data[0].count === 3; });

    // Alice goes offline: her send is pending on her own thread, her reads say when they are from.
    offline = true;
    const pending = await alice.mutate(api.send, { conversationId: "c1", body: "queued" });
    assert.equal(pending.state, "pending");
    const aliceThread = alice.observe(api.thread, { conversationId: "c1" });
    const mine = await until(() => { const r = aliceThread.getSnapshot(); return isReady(r) && r.data.some((m) => m.body === "queued") ? r : null; });
    assert.equal(mine.data[0].pending, true);
    await until(() => alice.link() === "offline");
    assert.equal(mine.fresh, false);
    assert.ok(typeof mine.since === "number");

    // Back online: the queued write lands on the server and reaches bob.
    offline = false;
    await until(() => { const r = bobThread.getSnapshot(); return isReady(r) && r.data.length === 4 ? r : null; }, 15_000);
    const confirmed = await until(() => { const r = aliceThread.getSnapshot(); return isReady(r) && r.data.every((m) => !m.pending) ? r : null; }, 15_000);
    assert.equal(confirmed.data.length, 4);
    assert.equal(alice.link(), "online");

    // A stranger's local read is denied by the author's code, offline or on.
    const mallory = await createLocalClient({ url, persona: "mallory", store: "memory", waitSeconds: 2 });
    const denied = await mallory.query(api.thread, { conversationId: "c1" });
    assert.equal(denied.denied?.code, "MEMBERSHIP_REQUIRED");
    await Promise.all([alice.close(), bob.close(), mallory.close()]);
  } catch (error) {
    console.error(log);
    throw error;
  } finally {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a device restores its session on its own", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-chat-"));
  cpSync(join(root, "apps/chat/snapback"), join(dir, "snapback"), { recursive: true });
  rmSync(join(dir, "snapback/generated"), { recursive: true, force: true });
  const port2 = port + 20;
  const url2 = `http://127.0.0.1:${port2}`;
  const server = spawn(binary, ["dev", "--port", String(port2), "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  try {
    await until(async () => { try { await fetch(url2); return true; } catch { return false; } });
    const sessions = memorySessionStore();
    // A cold start with no session: the client mints a guest and keeps it.
    const first = await createLocalClient({ url: url2, guest: true, store: "memory", sessionStore: sessions, waitSeconds: 1 });
    const principal = first.viewer();
    assert.match(principal, /^guest:/);
    assert.equal(first.session().principal, principal);
    const inbox = await first.query(api.inbox, {});
    assert.ok(isReady(inbox) && inbox.data.length === 0 && inbox.complete && inbox.fresh, JSON.stringify(inbox));
    await first.close();
    // The next start restores the same principal without asking anyone.
    const again = await createLocalClient({ url: url2, store: "memory", sessionStore: sessions, waitSeconds: 1 });
    assert.equal(again.viewer(), principal);
    await again.signOut();
    // Signed out: no session to restore, and the old token is dead on the server.
    await assert.rejects(createLocalClient({ url: url2, store: "memory", sessionStore: sessions, waitSeconds: 1 }), /no session/);
    const dead = await fetch(`${url2}/q/inbox`, { method: "POST", headers: { authorization: `Bearer ${first.session()?.token ?? "x"}`, "content-type": "application/json" }, body: "{}" }).then((r) => r.json());
    assert.equal(dead.denied?.code, "E_AUTH");
    const fresh = await createLocalClient({ url: url2, guest: true, store: "memory", sessionStore: sessions, waitSeconds: 1 });
    assert.notEqual(fresh.viewer(), principal);
    await fresh.close();
    // A cold start with no network: the device opens on the backend and
    // rows it kept, reads locally with `fresh: false`, and says it is offline.
    const file = join(dir, "device.sqlite");
    const sqlite = { open: async (_name, schema) => openSqlite(nodeSqliteDriver(new DatabaseSync(file)), schema) };
    const online = await createLocalClient({ url: url2, guest: true, store: sqlite, sessionStore: sessions, waitSeconds: 1 });
    const onlineInbox = await online.query(api.inbox, {});
    assert.ok(isReady(onlineInbox) && onlineInbox.fresh);
    await online.close();
    const noNetwork = () => Promise.reject(new TypeError("no network"));
    const offline = await createLocalClient({ url: url2, store: sqlite, sessionStore: sessions, fetch: noNetwork, waitSeconds: 1 });
    assert.equal(offline.link(), "offline");
    assert.equal(offline.viewer(), online.viewer());
    const offlineInbox = await offline.query(api.inbox, {});
    assert.ok(isReady(offlineInbox), JSON.stringify(offlineInbox));
    assert.equal(offlineInbox.fresh, false);
    assert.ok(typeof offlineInbox.since === "number");
    await offline.close();
    await assert.rejects(createLocalClient({ url: url2, guest: true, store: "memory", sessionStore: memorySessionStore(), fetch: noNetwork, waitSeconds: 1 }), /cannot reach|E_OFFLINE/);
  } finally {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
