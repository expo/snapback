// @ref LLP 3000.013.000#9 — the device-less browser write journal over the
// online intent journal: capture, admission, markers, recovery and refusals.
import { waitFor } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { onlineCustody } from "../dist/app-online.js";
import { OnlineCapture } from "../dist/online-capture.js";
import { memorySessionStore } from "../dist/auth.js";
import { createClient, mintId } from "../dist/client.js";
import { identifyDispatch } from "../dist/online-dispatch.js";
import { storeKey } from "../dist/app-storage.js";

const url = "https://journal.invalid", op = { kind: "mutation", name: "write" };
const SESSION = storeKey("session", url);
const hex = text => Array.from(text, c => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
const PREFIX = `snapback4-online-admission:${hex(url)}:`;
const journalKey = storeKey("writes", url, "dev:alice");

class MemoryStorage {
  map = new Map(); full = false;
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { if (this.full) throw new DOMException("the quota has been exceeded", "QuotaExceededError"); this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  records() { return [...this.map.keys()].filter(key => key.startsWith(PREFIX)); }
}

function browser(t) {
  const storage = new MemoryStorage();
  const window = Object.assign(new EventTarget(), { location: { href: "http://127.0.0.1:5173/" } });
  for (const [name, value] of Object.entries({ window, localStorage: storage })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  t.mock.method(console, "warn", () => {});
  return storage;
}

/** The IndexedDB session authority, reduced to what sameAdmissionAuthority reads. */
function sessions(principal = "dev:alice", epoch = "1") {
  const state = { principal, epoch };
  const authority = (as = "dev:alice", source = "test-authority") => ({
    capture: () => ({ key: SESSION, epoch: state.epoch, principal: as, source }),
    read: async key => key === SESSION ? JSON.stringify({ principal: state.principal, snapback4Epoch: state.epoch }) : null,
    recheck() {},
  });
  return { state, authority };
}

/** One store, at-most-once by id; `hold` parks responses. */
function server() {
  const executed = new Map(), posts = [], held = [];
  let seq = 0, hold = false;
  const fetch = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/probe") return Response.json({ ok: true, store_id: "A", seq });
    if (path.startsWith("/m/")) {
      const body = JSON.parse(init.body);
      posts.push(body.id);
      const respond = () => {
        if (executed.has(body.id)) return Response.json({ state: "sent", seq: executed.get(body.id), replayed: true });
        executed.set(body.id, ++seq);
        return Response.json({ state: "sent", seq });
      };
      return hold ? new Promise(resolve => held.push(() => resolve(respond()))) : respond();
    }
    return new Promise(() => {});
  };
  return { fetch, executed, posts, held, set hold(value) { hold = value; } };
}

async function open(t, srv, store, authority, { start = true } = {}) {
  const raw = createClient({ url, persona: "alice", fetch: srv.fetch });
  await identifyDispatch(raw);
  const errors = [];
  const custody = await onlineCustody(raw, url, store, error => errors.push(error), false, authority);
  t.after(() => custody.client.close());
  if (start) custody.start();
  return { ...custody, errors };
}
const journal = async store => JSON.parse(await store.get(journalKey) ?? "null");
/** A record left by a runtime that is gone (its liveness lock released). */
async function orphan(authority, id, args, storeId = "A") {
  const capture = new OnlineCapture(url, authority.capture().principal, authority);
  await capture.ready;
  const record = capture.capture(id, "write", args, storeId);
  capture.close();
  return record;
}

test("a click is in localStorage before mutate returns, then admitted, sent once and cleaned up", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const c = await open(t, srv, store, authority());
  const write = c.client.mutate(op, { body: "hello" }, { waitSeconds: 0 });
  assert.equal(write.state, undefined, "not refused");
  assert.equal(storage.records().length, 1, "captured synchronously, in the calling stack");
  const record = JSON.parse(storage.getItem(storage.records()[0]));
  assert.deepEqual([record.id, record.op, record.args, record.storeId, record.authority.epoch], [(await write).id, "write", { body: "hello" }, "A", "1"]);
  await waitFor(() => srv.executed.size === 1, "sent");
  await waitFor(() => storage.records().length === 0, "record removed after the commit");
  await waitFor(async () => (await c.client.pendingWrites()).length === 0, "settled");
  await waitFor(async () => !(await journal(store)).captured, "the remover drops its marker");
  assert.deepEqual(srv.posts, [record.id]);
});

test("unusable localStorage refuses synchronously with E_ADMISSION and sends nothing; the same id retries", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const c = await open(t, srv, store, authority());
  storage.full = true;
  const id = mintId(), refused = c.client.mutate(op, { body: "x" }, { id });
  assert.equal(refused.state, "failed"); assert.equal(refused.why.code, "E_ADMISSION");
  assert.match(refused.why.message, /QuotaExceededError|quota/);
  assert.equal(refused.why.rewrite, "restore writable localStorage (not full, not blocked), then retry with the same id");
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(srv.posts, []); assert.equal(await store.get(journalKey) === null || (await journal(store)).pending.length === 0, true);
  storage.full = false;
  assert.equal((await c.client.mutate(op, { body: "x" }, { id, waitSeconds: 0 })).state, "pending", "the same id is admitted after repair");
  await waitFor(() => srv.executed.has(id));
});

test("the journal's 32-record bound refuses loudly", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const c = await open(t, srv, store, authority());
  for (let i = 0; i < 32; i++) storage.setItem(`${PREFIX}filler:${i}`, "{}");
  const refused = c.client.mutate(op, { body: "x" });
  assert.equal(refused.why.code, "E_ADMISSION"); assert.match(refused.why.message, /32 records or 256 KiB/);
});

test("a gone runtime's click is adopted once, before new clicks; a later open does not re-admit it", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const lost = mintId();
  await orphan(authority(), lost, { body: "before the crash" });
  const c = await open(t, srv, store, authority(), { start: false });
  // A click before start (a signed-in listener) waits behind recovery.
  const fresh = c.client.mutate(op, { body: "after reload" }, { waitSeconds: 0 });
  assert.equal(fresh.state, undefined);
  c.start();
  await waitFor(() => srv.executed.size === 2, "both sent");
  assert.equal(srv.posts[0], lost, "the recovered click reaches the transport first");
  await waitFor(() => storage.records().length === 0);
  const again = await open(t, srv, store, authority());
  await again.client.pendingWrites();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(srv.posts.filter(id => id === lost).length, 1, "no second admission or send");
});

test("a live runtime's record is never adopted; it is once that runtime is gone", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const live = new OnlineCapture(url, "dev:alice", authority());
  await live.ready;
  const id = mintId();
  live.capture(id, "write", { body: "in flight elsewhere" }, "A");
  const peer = await open(t, srv, store, authority());
  await peer.client.pendingWrites();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(srv.posts.length, 0, "the live tab's click is its own");
  assert.equal(storage.records().length, 1);
  live.close();
  const next = await open(t, srv, store, authority());
  await waitFor(() => srv.executed.has(id), "adopted after its runtime ended");
  await next.client.pendingWrites();
});

test("an ended session's and another account's records are cancelled; another authority source is untouched", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { state, authority } = sessions();
  const warned = []; console.warn.mock.mockImplementation(message => warned.push(String(message)));
  await orphan(authority(), mintId(), { body: "old epoch" });
  await orphan(authority("dev:bob"), mintId(), { body: "bob's" });
  const foreign = await orphan(authority("dev:alice", "other-namespace"), mintId(), { body: "other namespace" });
  state.epoch = "2";
  const c = await open(t, srv, store, authority());
  await waitFor(() => storage.records().length === 1, "two cancelled");
  assert.equal(storage.records()[0], foreign.key, "another source is never read as ended");
  await c.client.pendingWrites();
  assert.deepEqual(srv.posts, []);
  assert.ok(warned.some(line => /2 browser writes captured under a session that has since ended were not sent/.test(line)), warned.join("\n"));
});

test("a logout between capture and commit refuses E_AUTH and cancels the record", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { state, authority } = sessions();
  const c = await open(t, srv, store, authority());
  const write = c.client.mutate(op, { body: "x" });
  assert.equal(storage.records().length, 1);
  state.epoch = "2";
  const outcome = await write;
  assert.equal(outcome.state, "failed"); assert.equal(outcome.why.code, "E_AUTH");
  assert.equal(storage.records().length, 0); assert.deepEqual(srv.posts, []);
});

test("a failed commit stays pending in its own runtime and recovers before the next admission", async t => {
  const storage = browser(t), srv = server(), memory = memorySessionStore(), { authority } = sessions();
  let failing = false;
  const store = { ...memory, async set(key, value) { if (failing && key === journalKey) throw Error("IndexedDB refused"); return memory.set(key, value); } };
  const c = await open(t, srv, store, authority());
  failing = true;
  const id = mintId();
  const first = await c.client.mutate(op, { body: "first" }, { id, waitSeconds: 0 });
  assert.equal(first.state, "pending"); assert.match(first.reason, /journaled in this browser/);
  assert.equal(storage.records().length, 1, "custody stays in localStorage");
  assert.equal((await c.client.write(id)).state, "pending");
  assert.equal((await c.client.mutate(op, { body: "first" }, { id, waitSeconds: 0 })).state, "pending", "a same-id retry joins it");
  assert.deepEqual(srv.posts, []);
  failing = false;
  const second = await c.client.mutate(op, { body: "second" }, { waitSeconds: 0 });
  await waitFor(() => srv.executed.size === 2, "both sent once the journal commits");
  assert.deepEqual(srv.posts, [id, second.id], "the recovered click goes first");
  await waitFor(async () => (await c.client.write(id))?.state === "sent");
  assert.equal(storage.records().length, 0);
});

test("a retained receipt wins over a marker; a marker alone refuses E_WRITE_RECEIPT_EXPIRED", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const settled = mintId(), forgotten = mintId();
  const c = await open(t, srv, store, authority());
  await c.client.pendingWrites();
  // A peer tab settled these after this runtime opened (so its MutationIds never saw them).
  await store.set(journalKey, JSON.stringify({ owner: "dev:alice", backend: url, pending: [],
    receipts: [{ state: "sent", id: settled, seq: 7 }], captured: [settled, forgotten] }));
  const receipt = await c.client.mutate(op, { body: "x" }, { id: settled });
  assert.equal(receipt.state, "sent"); assert.equal(receipt.seq, 7);
  const expired = await c.client.mutate(op, { body: "y" }, { id: forgotten });
  assert.equal(expired.state, "failed"); assert.equal(expired.why.code, "E_WRITE_RECEIPT_EXPIRED");
  await waitFor(() => storage.records().length === 0, "known ids leave no executable record");
  assert.deepEqual(srv.posts, []);
});

test("a saturated journal refuses the live caller with no marker, and keeps a recovered record", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  await store.set(journalKey, JSON.stringify({ owner: "dev:alice", backend: url, pending: [], receipts: [], retirementFull: true }));
  const kept = await orphan(authority(), mintId(), { body: "waiting" });
  const c = await open(t, srv, store, authority());
  await waitFor(() => c.errors.some(error => error.why?.code === "E_WRITE_RECEIPT_EXPIRED"), "reported");
  assert.deepEqual(storage.records(), [kept.key], "the recovered record stays");
  const refused = await c.client.mutate(op, { body: "new" });
  assert.equal(refused.state, "failed"); assert.equal(refused.why.code, "E_WRITE_RECEIPT_EXPIRED");
  assert.deepEqual(storage.records(), [kept.key], "the refused click is cancelled");
  assert.equal((await journal(store)).captured, undefined, "no marker for a refused unknown id");
  assert.deepEqual(srv.posts, []);
});

test("two captures of one id (an explicit id in two tabs) admit once; different input is refused", async t => {
  browser(t);
  const srv = server(), store = memorySessionStore(), { authority } = sessions();
  const id = mintId();
  await orphan(authority(), id, { body: "same" });
  await orphan(authority(), id, { body: "same" });
  const c = await open(t, srv, store, authority());
  await waitFor(() => srv.executed.has(id));
  await c.client.pendingWrites();
  const reused = await c.client.mutate(op, { body: "different" }, { id });
  assert.equal(reused.state, "failed");
  assert.equal(srv.posts.filter(post => post === id).length, 1);
});
