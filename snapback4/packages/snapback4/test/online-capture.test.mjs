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

test("the journal's 32-record bound refuses loudly; cancellation placeholders neither count nor stay", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const placeholders = [];
  for (let i = 0; i < 40; i++) {
    const record = await orphan(authority("dev:alice", "placeholder-source"), mintId(), { n: i });
    storage.setItem(record.key, JSON.stringify({ key: record.key, cancelled: true }));
    placeholders.push(record.key);
  }
  const live = new OnlineCapture(url, "dev:alice", authority());
  await live.ready;
  t.after(() => live.close());
  for (let i = 0; i < 32; i++) assert.equal(live.capture(mintId(), "write", { i }, "A").v, 1, "placeholders take no slot");
  const c = await open(t, srv, store, authority("dev:alice", "placeholder-source"));
  const refused = c.client.mutate(op, { body: "x" });
  assert.equal(refused.why.code, "E_ADMISSION"); assert.match(refused.why.message, /32 records or 256 KiB/);
  await c.client.pendingWrites();
  await waitFor(() => placeholders.every(key => storage.getItem(key) === null), "recovery sweeps placeholders of its source");
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
    receipts: [{ state: "sent", id: settled, seq: 7 }], captured: [`${settled}:${mintId()}`, `${forgotten}:${mintId()}`] }));
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

test("two captures of one id: the other capture's removal never drops the admitted capture's marker", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const id = mintId();
  const first = await orphan(authority(), id, { body: "same" });
  const second = await orphan(authority(), id, { body: "same" });
  // The first capture's removal fails after its admission commits.
  const removeItem = storage.removeItem.bind(storage);
  let failing = true;
  storage.removeItem = key => { if (failing && key === first.key) throw new DOMException("refused", "SecurityError"); removeItem(key); };
  srv.hold = true;
  const c = await open(t, srv, store, authority());
  await waitFor(() => srv.posts.includes(id), "sent");
  const marks = (await journal(store)).captured;
  assert.ok(marks.includes(`${id}:${first.nonce}`), `the admitted capture keeps its marker: ${marks}`);
  assert.equal(storage.getItem(second.key), null);
  assert.notEqual(storage.getItem(first.key), null, "the failed removal left the first record");
  srv.hold = false; srv.held.splice(0).forEach(release => release());
  await waitFor(async () => (await journal(store)).receipts.some(write => write.id === id), "settled");
  // Evict the receipt: only the marker remembers the id now.
  const evicted = await journal(store);
  await store.set(journalKey, JSON.stringify({ ...evicted, receipts: [] }));
  await c.client.close();
  const again = await open(t, srv, store, authority());
  await again.client.pendingWrites();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(srv.posts, [id], "the surviving record is never admitted again");
  failing = false;
  const last = await open(t, srv, store, authority());
  await waitFor(() => storage.getItem(first.key) === null, "a later recovery removes it");
  await last.client.pendingWrites();
  assert.deepEqual(srv.posts, [id]);
});

test("a peer that committed an intent and died before sending it: recovery replays it", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const c = await open(t, srv, store, authority(), { start: false });
  await c.client.pendingWrites();
  // Between this runtime's opening read and its recovery, a peer commits P and its marker, then dies.
  const id = mintId(), record = await orphan(authority(), id, { body: "peer" });
  await store.set(journalKey, JSON.stringify({ owner: "dev:alice", backend: url, receipts: [],
    pending: [{ owner: "dev:alice", id, op: "write", args: { body: "peer" }, storeId: "A", dispatched: false }], captured: [`${id}:${record.nonce}`] }));
  const fresh = c.client.mutate(op, { body: "new" }, { waitSeconds: 0 });
  c.start();
  await waitFor(() => srv.executed.size === 2, "both sent");
  assert.equal(srv.posts[0], id, "the stranded intent goes first");
  assert.equal(storage.getItem(record.key), null);
  assert.equal((await fresh).state, "pending");
});

test("two openers race for one orphan: admitted once, marker kept while pending", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const id = mintId();
  const record = await orphan(authority(), id, { body: "orphan" });
  srv.hold = true;
  const [a, b] = await Promise.all([open(t, srv, store, authority()), open(t, srv, store, authority())]);
  await waitFor(() => srv.posts.includes(id));
  await waitFor(() => storage.getItem(record.key) === null);
  const held = await journal(store);
  assert.equal(held.pending.filter(intent => intent.id === id).length, 1, "one pending entry");
  assert.ok(held.captured?.includes(`${id}:${record.nonce}`), "a removal never drops the marker of a pending id");
  srv.hold = false; srv.held.splice(0).forEach(release => release());
  await waitFor(async () => (await a.client.pendingWrites()).length === 0 && (await b.client.pendingWrites()).length === 0);
  assert.equal(srv.executed.size, 1);
});

test("a store refusal with a failed retirement keeps the capture rather than dropping it", async t => {
  const storage = browser(t), srv = server(), memory = memorySessionStore(), { authority } = sessions();
  let failing = false;
  const store = { ...memory, async set(key, value) { if (failing && key === journalKey) throw Error("IndexedDB refused"); return memory.set(key, value); } };
  const c = await open(t, srv, store, authority(), { start: false });
  await c.client.pendingWrites();
  const id = mintId(), write = c.client.mutate(op, { body: "x" }, { id, waitSeconds: 0 });
  assert.equal(storage.records().length, 1, "captured; waiting behind the recovery gate");
  failing = true;
  const retiring = c.refuseStore({ code: "E_STORE_REPLACED", family: "store", message: "replaced" }).catch(() => {});
  c.start();
  const outcome = await write;
  await retiring;
  assert.equal(outcome.state, "pending", "no terminal refusal reached the caller");
  assert.equal(storage.records().length, 1, "so the only durable custody stays");
  failing = false;
  await c.client.close(); // the app retires a refused scope; its liveness lock goes with it
  const next = await open(t, srv, store, authority());
  await waitFor(() => srv.executed.has(id), "a later open admits it");
  await next.client.pendingWrites();
});

test("recovery compares input like admission: key order does not make a reuse", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const id = mintId(), record = await orphan(authority(), id, { b: 2, a: 1 });
  srv.hold = true;
  const c = await open(t, srv, store, authority(), { start: false });
  await store.set(journalKey, JSON.stringify({ owner: "dev:alice", backend: url, receipts: [],
    pending: [{ owner: "dev:alice", id, op: "write", args: { a: 1, b: 2 }, storeId: "A", dispatched: true }] }));
  c.start();
  await waitFor(() => storage.getItem(record.key) === null);
  assert.ok(!c.errors.some(error => error.why?.code === "E_WRITE_ID_REUSE"), "not reported as a reuse");
  srv.hold = false; srv.held.splice(0).forEach(release => release());
});

test("a failed recovery save keeps a dead peer's pending intent owed: the retry replays it", async t => {
  const storage = browser(t), srv = server(), memory = memorySessionStore(), { authority } = sessions();
  let failures = 0;
  const store = { ...memory, async set(key, value) { if (key === journalKey && failures-- > 0) throw Error("IndexedDB refused"); return memory.set(key, value); } };
  const c = await open(t, srv, store, authority(), { start: false });
  await c.client.pendingWrites();
  const id = mintId(), peer = await orphan(authority(), id, { body: "peer" });
  const other = await orphan(authority(), mintId(), { body: "unrelated" });
  await memory.set(journalKey, JSON.stringify({ owner: "dev:alice", backend: url, receipts: [],
    pending: [{ owner: "dev:alice", id, op: "write", args: { body: "peer" }, storeId: "A", dispatched: false }], captured: [`${id}:${peer.nonce}`] }));
  failures = 1;
  c.start();
  await waitFor(() => srv.executed.size === 2, "the retry sends both", { work: 3 });
  assert.equal(srv.posts[0], id, "the peer's intent is not stranded behind the retry");
  assert.ok(srv.posts.includes(other.id));
  await waitFor(() => storage.records().length === 0);
});

test("a second opener that sees a surviving capture beside a committed intent keeps its marker", async t => {
  const storage = browser(t), srv = server(), store = memorySessionStore(), { authority } = sessions();
  const id = mintId(), record = await orphan(authority(), id, { body: "orphan" });
  const removeItem = storage.removeItem.bind(storage);
  let failing = true;
  storage.removeItem = key => { if (failing && key === record.key) throw new DOMException("refused", "SecurityError"); removeItem(key); };
  srv.hold = true;
  const a = await open(t, srv, store, authority());
  await waitFor(() => srv.posts.includes(id), "A admitted and sent it");
  assert.notEqual(storage.getItem(record.key), null, "A's removal failed: the capture survives beside P");
  const b = await open(t, srv, store, authority());
  await waitFor(() => srv.posts.filter(post => post === id).length === 2, "B's recovery took the known-pending branch and replays it");
  const held = await journal(store);
  assert.equal(held.pending.filter(intent => intent.id === id).length, 1);
  assert.ok(held.captured.includes(`${id}:${record.nonce}`), "the marker is kept");
  srv.hold = false; srv.held.splice(0).forEach(release => release());
  await waitFor(async () => (await a.client.pendingWrites()).length === 0 && (await b.client.pendingWrites()).length === 0);
  assert.equal(srv.executed.size, 1, "executed once");
  failing = false;
});
