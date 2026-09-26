// LLP 3000.017 §3.2: remembered server answers are ordered by the store cut a
// reply read, then by when its read attempt began; a refetch within an attempt
// is a new read.
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
