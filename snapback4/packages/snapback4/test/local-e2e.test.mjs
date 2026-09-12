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
import { isReady } from "../dist/contract.js";

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
    const bobThread = bob.observe(api.thread, { conversationId: "c1" });
    const thread = await until(() => { const r = bobThread.getSnapshot(); return isReady(r) && r.data.length === 1 ? r : null; });
    assert.equal(thread.data[0].body, "hello bob");
    assert.equal(thread.data[0].pending, undefined);
    await until(() => { const r = bobInbox.getSnapshot(); return isReady(r) && r.data[0].count === 1; });

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
    await until(() => { const r = bobThread.getSnapshot(); return isReady(r) && r.data.length === 2 ? r : null; }, 15_000);
    const confirmed = await until(() => { const r = aliceThread.getSnapshot(); return isReady(r) && r.data.every((m) => !m.pending) ? r : null; }, 15_000);
    assert.equal(confirmed.data.length, 2);
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
