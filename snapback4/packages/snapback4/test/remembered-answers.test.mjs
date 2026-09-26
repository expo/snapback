// LLP 3000.017 §3.2: remembered server answers are ordered by the store cut a
// reply read, then by when its read attempt began; a refetch within an attempt
// is a new read, and a cut once named stays known.
import test from "node:test";
import assert from "node:assert/strict";
import { RememberedAnswers } from "../dist/local-reads.js";
import { evaluateLocal } from "../dist/local-query.js";

const answer = data => ({ read: { data, complete: true, cut: null, fresh: true, next: null }, at: 1, nextExpiry: null, tables: new Set() });

test("a later cut wins; at one cut, or without one, the read that began later wins", () => {
  const answers = new RememberedAnswers();
  const early = answers.view(), late = answers.view();
  late.set("k", answer("late"), 5);
  early.set("k", answer("early"), 5);
  assert.equal(answers.get("k").read.data, "late", "at one cut the later read wins");
  early.set("k", answer("newer cut"), 6);
  assert.equal(answers.get("k").read.data, "newer cut", "a later cut wins whenever the read began");
  late.delete("k", 5);
  assert.equal(answers.get("k").read.data, "newer cut", "an older cut's refusal removes nothing");
  const unnamed = answers.view();
  unnamed.set("k", answer("unnamed"));
  assert.equal(answers.get("k").read.data, "unnamed", "without a cut, the read that began later wins");
  early.set("k", answer("stale"));
  assert.equal(answers.get("k").read.data, "unnamed", "and an earlier read without a cut loses");
  unnamed.forget("k");
  early.set("k", answer("after cleanup"));
  assert.equal(answers.get("k"), undefined, "local cleanup keeps the order it forgot under");
});

test("a reply below a cut already named is older, through replies without one", () => {
  // Three reads begin in order. The first is refused at cut 8, the second is loading
  // with no cut, and the third, which reached its transaction first, answers at cut 7.
  const answers = new RememberedAnswers();
  const [first, second, third] = [answers.view(), answers.view(), answers.view()];
  first.delete("k", 8);
  second.delete("k");
  third.set("k", answer("cut 7"), 7);
  assert.equal(answers.get("k"), undefined, "the answer at cut 7 is older than the refusal at cut 8");
  // A reply that loses on its ticket still names its cut.
  const lost = new RememberedAnswers();
  const [a, b, c] = [lost.view(), lost.view(), lost.view()];
  b.delete("k");
  a.delete("k", 8);
  c.set("k", answer("cut 7"), 7);
  assert.equal(lost.get("k"), undefined, "the cut of a refusal that lost to a later read stays known");
  c.set("k", answer("cut 9"), 9);
  assert.equal(lost.get("k").read.data, "cut 9", "and a later cut still wins");
});

// A read of a device program: the device's observation, then the server's reply.
function reading(answers, { call, reply }) {
  const program = { name: "read", kind: "Query", args: {}, body: [], runs: "device" };
  return {
    backend: { generation: 1, schema: { tables: {} }, programs: [program] }, partitionDenied: null, credentialRevision: 0, incarnation: 0, authority: 0,
    refreshing: null, link: "online", caughtUp: true, identityChecked: true, lastSyncAt: 1, principal: "alice",
    partitionCurrent: true, nativeReady: true, signal: new AbortController().signal,
    deviceNow: () => 1_000, serverNow: () => 1_000, unavailable: () => null, queued: async () => [],
    call, installNative: async () => false, notify: () => {},
    offline: () => ({ code: "E_OFFLINE", family: "link", message: "offline" }), serverAnswers: answers.view(),
    post: async () => ({ ok: true, json: reply(), obsoleteAuth: false }),
  };
}
// The device holds retained rows: the read composes them with the server's answer and
// remembers no whole answer of its own.
const retained = { ok: { data: [{ id: "kept" }], unknown: true, complete: false, retainedRows: [true], tables: [] } };
const refused = seq => ({ denied: { code: "NOT_HERE", family: "rule", message: "not here" }, seq });

test("a composed read's refusal removes no answer a later read remembered", async () => {
  const answers = new RememberedAnswers();
  const key = `read:${JSON.stringify({})}`;
  // While the composed read waits for the server, a later read, whose retained rows have
  // expired, remembers the server's whole answer at the same cut.
  const env = reading(answers, { call: async () => retained, reply: () => { answers.view().set(key, answer("later"), 7); return refused(7); } });
  const result = await evaluateLocal(env, { kind: "query", name: "read" }, {}, 0, 0);
  assert.equal(result.read.denied?.code, "NOT_HERE", JSON.stringify(result.read));
  assert.equal(answers.get(key)?.read.data, "later", "the composed read began first, so its refusal at the same cut is older");
  // Composition's own cleanup is ordered too: a later read's answer, remembered while
  // the composed read observed its device, stays.
  const early = new RememberedAnswers();
  const observed = reading(early, { call: async () => { early.view().set(key, answer("meanwhile"), 7); return retained; }, reply: () => refused(6) });
  await evaluateLocal(observed, { kind: "query", name: "read" }, {}, 0, 0);
  assert.equal(early.get(key)?.read.data, "meanwhile", "a composed read does not erase a later read's answer");
});

test("a composed read's whole answer is not remembered", async () => {
  const answers = new RememberedAnswers();
  const key = `read:${JSON.stringify({})}`;
  // The device composes retained rows, then cannot observe again: the server's whole
  // answer is published, and a later recovery must not show it without the retained rows.
  let calls = 0;
  const env = reading(answers, {
    call: async () => ++calls === 1 ? retained : { ok: { loading: true, unknown: true, tables: [] } },
    reply: () => ({ data: [{ id: "server" }], complete: true, seq: 7 }),
  });
  const result = await evaluateLocal(env, { kind: "query", name: "read" }, {}, 0, 0);
  assert.deepEqual(result.read.data, [{ id: "server" }], JSON.stringify(result.read));
  assert.equal(answers.get(key), undefined, "nothing is remembered for a composed read");
});

test("a refusal is ordered by the cut its evaluation read, not the head taken before it", async () => {
  const answers = new RememberedAnswers();
  const key = `read:${JSON.stringify({})}`;
  // A later read remembers an answer at cut 8; this read's refusal names cut 9, and a
  // head of 7 taken before its evaluation.
  const env = reading(answers, {
    call: async () => ({ ok: { loading: true, unknown: true, tables: [] } }),
    reply: () => { answers.view().set(key, answer("cut 8"), 8); return { ...refused(9), head: 7 }; },
  });
  const result = await evaluateLocal(env, { kind: "query", name: "read" }, {}, 0, 0);
  assert.equal(result.read.denied?.code, "NOT_HERE", JSON.stringify(result.read));
  assert.equal(answers.get(key), undefined, "the refusal at cut 9 is newer than the answer at cut 8");
});

test("a refetch after the credentials change takes a new place in the order", async () => {
  const answers = new RememberedAnswers();
  const key = `read:${JSON.stringify({})}`;
  const cache = answers.view();
  let posts = 0;
  const env = {
    backend: { generation: 1, schema: { tables: {} }, programs: [] }, partitionDenied: null, credentialRevision: 0, incarnation: 0, authority: 0,
    refreshing: null, link: "online", caughtUp: true, identityChecked: true, lastSyncAt: 1, principal: "alice",
    partitionCurrent: true, nativeReady: true, signal: new AbortController().signal,
    deviceNow: () => Date.now(), serverNow: () => Date.now(), unavailable: () => null, queued: async () => [],
    call: async () => ({ ok: { loading: true, unknown: true } }), installNative: async () => false, notify: () => {},
    offline: () => ({ code: "E_OFFLINE", family: "link", message: "offline" }), serverAnswers: cache,
    post: async () => {
      if (++posts === 1) {
        // The session rotates while this read is out; a read that began meanwhile remembers an answer.
        answers.view().set(key, answer("meanwhile"), 5);
        return { ok: true, json: { denied: { code: "E_AUTH", family: "auth", message: "rotated" }, head: 5 }, obsoleteAuth: true };
      }
      return { ok: true, json: { denied: { code: "NOT_HERE", family: "rule", message: "not here" }, head: 5 }, obsoleteAuth: false };
    },
  };
  const result = await evaluateLocal(env, { kind: "query", name: "read" }, {}, 0, 0);
  assert.equal(result.read.denied?.code, "NOT_HERE");
  assert.equal(posts, 2, "the read was fetched again under the new credentials");
  assert.equal(answers.get(key), undefined, "the refetched refusal is newer than the answer remembered meanwhile");
});

test("an expired device answer re-routed to the server takes a new place in the order", async () => {
  const answers = new RememberedAnswers();
  const key = `read:${JSON.stringify({})}`;
  const program = { name: "read", kind: "Query", args: {}, body: [], runs: "device" };
  let calls = 0;
  const env = {
    backend: { generation: 1, schema: { tables: {} }, programs: [program] }, partitionDenied: null, credentialRevision: 0, incarnation: 0, authority: 0,
    refreshing: null, link: "online", caughtUp: true, identityChecked: true, lastSyncAt: 1, principal: "alice",
    partitionCurrent: true, nativeReady: true, signal: new AbortController().signal,
    deviceNow: () => 1_000, serverNow: () => 1_000, unavailable: () => null, queued: async () => [],
    // The device answers first with a page whose deadline has passed. While it is asked again, a read
    // begins and remembers an answer; then the device cannot answer, and the re-route goes to the server.
    call: async () => {
      if (++calls === 1) return { ok: { data: ["device"], complete: true, unknown: false, nextExpiry: 500, tables: [] } };
      answers.view().set(key, answer("meanwhile"), 5);
      return { ok: { loading: true, unknown: true, tables: [] } };
    },
    installNative: async () => false, notify: () => {},
    offline: () => ({ code: "E_OFFLINE", family: "link", message: "offline" }), serverAnswers: answers.view(),
    post: async () => ({ ok: true, json: { denied: { code: "NOT_HERE", family: "rule", message: "not here" }, seq: 5 }, obsoleteAuth: false }),
  };
  const result = await evaluateLocal(env, { kind: "query", name: "read" }, {}, 0, 0);
  assert.equal(result.read.denied?.code, "NOT_HERE", JSON.stringify(result.read));
  assert.equal(answers.get(key), undefined, "the re-routed refusal is newer than the answer remembered while it waited");
});
