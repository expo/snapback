// LLP 3000.018 §3.2: remembered server answers are ordered by the store cut a
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

test("forgetting an expired answer preserves its highest store cut", () => {
  const answers = new RememberedAnswers();
  answers.view().set("expired", answer("cut 10"), 10);
  answers.forget("expired");
  assert.equal(answers.get("expired"), undefined);
  answers.view().set("expired", answer("late cut 9"), 9);
  assert.equal(answers.get("expired"), undefined, "expiry must not admit an older reply");
  answers.view().set("expired", answer("new cut 10"), 10);
  assert.equal(answers.get("expired")?.read.data, "new cut 10", "a newer read at the highest cut can still replace it");
});

for (const cut of [undefined, 10, 11]) test(`forget fences a pre-expiry reply at cut ${cut}, including later arrivals`, () => {
  const answers = new RememberedAnswers();
  answers.view().set("k", answer("expired"), 10);
  const held = answers.view();
  answers.forget("k");
  held.set("k", answer("withdrawn"), cut);
  assert.equal(answers.get("k"), undefined, "a later ticket or higher cut cannot cross expiry");
  const next = answers.view();
  next.set("k", answer("new"), cut ?? 10);
  assert.equal(answers.get("k")?.read.data, "new", "a read begun after forget can remember an answer");
  held.set("k", answer("higher but pre-expiry"), 12);
  assert.equal(answers.get("k")?.read.data, "new", "accepting a new answer does not erase the barrier");
  held.delete("k", 13);
  assert.equal(answers.get("k")?.read.data, "new", "pre-expiry refusals cannot cross the barrier either");
  next.set("k", answer("below refused cut"), 12);
  assert.equal(answers.get("k")?.read.data, "new", "even a barrier-rejected refusal contributes its highest cut");
  held.renew();
  held.set("k", answer("renewed"), 13);
  assert.equal(answers.get("k")?.read.data, "renewed");
});

test("forget fences absent keys too and a rejected answer still names its cut", () => {
  const answers = new RememberedAnswers(), held = answers.view();
  answers.forget("k");
  held.set("k", answer("expired"), 15);
  assert.equal(answers.get("k"), undefined);
  answers.view().set("k", answer("old cut"), 14);
  assert.equal(answers.get("k"), undefined);
  answers.view().set("k", answer("current"), 15);
  assert.equal(answers.get("k")?.read.data, "current");
});

for (const cut of [undefined, 10, 11]) test(`selective clear fences an in-flight remembered answer at cut ${cut}`, () => {
  const answers = new RememberedAnswers();
  const row = value => ({ ...answer(value), tables: new Set(['rows']) });
  answers.view().set('row', row('before'), 10);
  answers.view().set('other', { ...answer('unrelated'), tables: new Set(['notes']) }, 10);
  const held = answers.view(), unrelated = answers.get('other');
  answers.clear(['rows']);
  held.set('row', row('pre-change'), cut);
  assert.equal(answers.get('row'), undefined, 'a late pre-clear reply cannot restore fallback');
  assert.equal(answers.get('other'), unrelated, 'disjoint remembered data is untouched');
  const next = answers.view(); next.set('row', row('after'), 11);
  assert.equal(answers.get('row')?.read.data, 'after');
  held.delete('row', 12);
  assert.equal(answers.get('row')?.read.data, 'after', 'an old refusal cannot remove replacement memory');
});

test('selective deletion rejects an older ticket with a higher sequence', () => {
  const answers = new RememberedAnswers();
  const row = value => ({ ...answer(value), tables: new Set(['rows']) });
  answers.view().set('row', row('before'), 10);
  answers.view().set('other', { ...answer('unrelated'), tables: new Set(['notes']) }, 10);
  const older = answers.view(), unrelated = answers.get('other');
  answers.clear(['rows']);
  assert.equal(answers.get('row'), undefined);
  older.set('row', row('higher sequence, older ticket'), 20);
  assert.equal(answers.get('row'), undefined, 'the ticket barrier wins over a higher sequence after selective deletion');
  assert.equal(answers.get('other'), unrelated);
  answers.view().set('row', row('after'), 20);
  assert.equal(answers.get('row')?.read.data, 'after', 'a ticket begun after deletion is accepted');
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
test("the final memory checkpoint rejects a change after the earlier acceptance check", async () => {
  const answers = new RememberedAnswers(); let current = true;
  const env = reading(answers, {
    call: async () => ({ ok: { loading: true, unknown: true, tables: [] } }),
    reply: () => ({ data: 'before change', complete: true, seq: 10 }),
  });
  env.current = () => current;
  env.serverDeadlineWithdrawn = () => { current = false; return false; };
  const result = await evaluateLocal(env, { kind: 'query', name: 'read' }, {}, 0, 0);
  assert.equal(current, false, 'the read reached the final acceptance boundary');
  assert.deepEqual(result.read, { loading: true });
  assert.equal(answers.get('read:{}'), undefined, 'an obsolete body must not enter memory before the final checkpoint');
});

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
  // Composition clears nothing before its reply: a later read's answer, remembered while
  // the composed read observed its device, stays.
  const early = new RememberedAnswers();
  const observed = reading(early, { call: async () => { early.view().set(key, answer("meanwhile"), 7); return retained; }, reply: () => refused(6) });
  await evaluateLocal(observed, { kind: "query", name: "read" }, {}, 0, 0);
  assert.equal(early.get(key)?.read.data, "meanwhile", "a composed read does not erase a later read's answer");
});

test("an earlier read's answer at a higher cut, landing while a composed read is out, is remembered", async () => {
  // Grok, round 14: a cleanup before the composed read's reply named no cut, took the
  // order's place, and turned this earlier read's newer answer away.
  const answers = new RememberedAnswers();
  const key = `read:${JSON.stringify({})}`;
  const earlier = answers.view();
  const env = reading(answers, { call: async () => retained, reply: () => { earlier.set(key, answer("cut 100"), 100); return refused(40); } });
  const result = await evaluateLocal(env, { kind: "query", name: "read" }, {}, 0, 0);
  assert.equal(result.read.denied?.code, "NOT_HERE", JSON.stringify(result.read));
  assert.equal(answers.get(key)?.read.data, "cut 100", "the answer read at cut 100 is newer than the composed read's refusal at cut 40");
});

test("a composed read's refusal at a later cut removes an older answer a later read remembered", async () => {
  const answers = new RememberedAnswers();
  const key = `read:${JSON.stringify({})}`;
  const env = reading(answers, { call: async () => retained, reply: () => { answers.view().set(key, answer("cut 8"), 8); return refused(9); } });
  const result = await evaluateLocal(env, { kind: "query", name: "read" }, {}, 0, 0);
  assert.equal(result.read.denied?.code, "NOT_HERE", JSON.stringify(result.read));
  assert.equal(answers.get(key), undefined, "the refusal read at cut 9 is newer, though its read began first");
});

// The other composition: a field the device retains beside one only the server knows.
const fields = { ok: { data: { own: 1, kept: 2 }, unknown: true, complete: false, components: { own: { unknown: true }, kept: { retained: true, complete: true } }, tables: [] } };

test("a composed answer takes its place in the order, so an older answer that lands later loses", async () => {
  for (const [name, observation] of [["retained rows", retained], ["a retained field", fields]]) {
    const answers = new RememberedAnswers();
    const key = `read:${JSON.stringify({})}`;
    // A later read begins while this one is out, and evaluates first, at cut 8; this one reads at cut 9.
    let later;
    const env = reading(answers, { call: async () => observation, reply: () => { later = answers.view(); return { data: name === "a retained field" ? { own: 9, kept: 9 } : [{ id: "server" }], complete: true, seq: 9 }; } });
    const result = await evaluateLocal(env, { kind: "query", name: "read" }, {}, 0, 0);
    assert.equal(result.read.fresh, false, `${name}: the answer is composed: ${JSON.stringify(result.read)}`);
    later.set(key, answer("cut 8"), 8);
    assert.equal(answers.get(key), undefined, `${name}: the answer read at cut 8 is older than the composed one`);
  }
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

test("displayed expiry fences old bodies while preserving unexpired memory and its cuts", () => {
  const answers = new RememberedAnswers(), initial = answers.view();
  const newer = { ...answer("B"), nextExpiry: 200 };
  initial.set("k", newer, 8);
  const held = answers.view();
  answers.expire("k", 100);
  assert.equal(answers.get("k"), newer, "displayed A's expiry does not delete B");
  held.set("k", answer("old body at higher cut"), 9);
  held.delete("k", 10);
  assert.equal(answers.get("k"), newer, "pre-expiry bodies and refusals cannot replace B");
  const fresh = answers.view();
  fresh.set("k", answer("below highest"), 9);
  assert.equal(answers.get("k"), newer, "rejected bodies still contribute their highest cut");
  fresh.set("k", { ...answer("C"), nextExpiry: 300 }, 10);
  assert.equal(answers.get("k").read.data, "C", "a post-expiry read can replace B");
  answers.expire("k", 300);
  assert.equal(answers.get("k"), undefined, "memory itself expires at the exact deadline");
  fresh.set("k", answer("old attempt"), 11);
  assert.equal(answers.get("k"), undefined);
});
