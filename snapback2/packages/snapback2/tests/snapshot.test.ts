import assert from "node:assert/strict";
import { test } from "node:test";
import { intentLabel, readiness, readinessMessages, reasonMessages, summarize } from "../dist/client.mjs";

// @ref LLP 1018.003#2-derive-never-add — the summary table is the whole
// contract: every axis combination the reducer can emit maps to exactly one
// status and at most one reason, and nothing in the summary is a fact the
// view did not already carry.

const refusal = { code: "E_AUTH", family: "auth", message: "session ended", guide: "auth/session", rewrite: "Sign in again." };
const data = [{ id: "one" }];
const predicted = [{ table: "messages", id: "one", intent: "i:0" }];
const connections = ["connected", "reconnecting", "offline"] as const;

type Case = { name: string; view: any; status: string; reason?: string; receipt?: string; source?: string; connected?: { status: string; reason?: string } };
const cases: Case[] = [
  { name: "first render", view: { state: "hydrating", live: false }, status: "loading" },
  // The twin's "nothing held" marker is unavailable only while the device is not connected; connected, a fetch is in flight.
  { name: "twin held nothing", view: { state: "hydrating", live: false, offline: true }, status: "unavailable", reason: "offline", connected: { status: "loading" } },
  { name: "refused", view: { state: "refused", live: false, refusal }, status: "unavailable", reason: "refused" },
  { name: "denied by the server", view: { state: "denied", live: true, source: "server", seq: 3, rule: "members only" }, status: "unavailable", reason: "denied", receipt: "denied", source: "server" },
  { name: "denied by the twin", view: { state: "denied", live: false, source: "twin", seq: 3, rule: "members only", stale: { since: 1 } }, status: "unavailable", reason: "denied", receipt: "denied", source: "twin" },
  { name: "partial without data", view: { state: "partial", live: false, source: "twin", seq: 3, reason: "never-held", stale: { since: 1 }, site: "thread.range", sites: [{ site: "thread.range", reason: "never-held" }] }, status: "unavailable", reason: "partial", receipt: "partial" },
  { name: "partial with data", view: { state: "partial", live: false, source: "twin", seq: 3, reason: "evicted", data, stale: { since: 1 }, predicted }, status: "ready", reason: "partial", receipt: "partial" },
  { name: "complete, live", view: { state: "complete", live: true, source: "server", seq: 3, next: null, data }, status: "ready", receipt: "complete", source: "server" },
  { name: "capped, live, with a continuation", view: { state: "capped", live: true, source: "server", seq: 3, next: "tok", data }, status: "ready", receipt: "capped" },
  { name: "complete, retained history", view: { state: "complete", live: true, source: "server", seq: 3, next: null, data, retained: true }, status: "ready", receipt: "complete" },
  { name: "complete from the twin (stale fact)", view: { state: "complete", live: false, source: "twin", seq: 3, next: null, data, stale: { since: 7 } }, status: "ready", reason: "stale", receipt: "complete", source: "twin" },
  { name: "complete with a prediction", view: { state: "complete", live: true, source: "server", seq: 3, next: null, data, predicted }, status: "ready", reason: "predicted", receipt: "complete" },
  { name: "stale and predicted: stale first", view: { state: "complete", live: false, source: "twin", seq: 3, next: null, data, stale: { since: 7 }, predicted }, status: "ready", reason: "stale", receipt: "complete" },
  { name: "stale view keeping its receipt", view: { state: "stale", live: false, since: 9, data, seq: 3, next: null, outcome: "capped", source: "server" }, status: "ready", reason: "stale", receipt: "capped", source: "server" },
  { name: "stale view of a denial", view: { state: "stale", live: false, since: 9, seq: 3, outcome: "denied", rule: "members only" }, status: "unavailable", reason: "denied", receipt: "denied" },
  { name: "drain exposing data before caughtUp", view: { state: "complete", live: true, source: "server", seq: 3, next: null, data, caughtUp: false, watermark: "w" }, status: "ready", receipt: "complete" },
  { name: "held: data with no receipt (the lane's state)", view: { state: "stale", live: false, since: 9, data }, status: "ready", reason: "held" },
];

test("summarize maps every axis combination the reducer emits to one status and at most one reason", () => {
  for (const item of cases) {
    for (const connection of connections) {
      const snapshot = summarize(item.view, connection);
      const label = `${item.name} @ ${connection}`;
      const expected = connection === "connected" && item.connected ? item.connected : item;
      assert.equal(snapshot.status, expected.status, label);
      assert.equal(snapshot.reason?.code, expected.reason, label);
      // The sentence stays generic; the rule a denial named or the reason a partial gave rides as detail.
      if (snapshot.reason?.code === "denied") assert.equal(snapshot.reason.detail, item.view.rule, label);
      if (snapshot.reason?.code === "partial") assert.equal(snapshot.reason.detail, item.view.reason, label);
      if (item.view.sites) assert.deepEqual(snapshot.receipt?.sites, item.view.sites, label);
      assert.equal(snapshot.receipt?.outcome, item.receipt, label);
      if (item.source) assert.equal(snapshot.receipt?.source, item.source, label);
      assert.equal(snapshot.freshness.connection, connection, label);
      assert.equal(snapshot.freshness.live, item.view.live, label);
      // The value keeps its identity; the summary never copies or invents data.
      assert.strictEqual(snapshot.data, "data" in item.view ? item.view.data : undefined, label);
      // Every fact stays reachable one property down.
      assert.deepEqual(snapshot.local.predicted, item.view.predicted ?? [], label);
      assert.equal(snapshot.local.retained, item.view.retained === true, label);
      if (item.view.state === "refused") assert.strictEqual(snapshot.refusal, refusal, label);
      if (expected.reason) assert.equal(typeof snapshot.reason?.message, "string", label);
      assert.deepEqual(summarize(item.view, connection), snapshot, `${label}: pure`);
    }
  }
  assert.equal(summarize({ state: "refused", live: false, refusal }, "connected").reason?.message, "Sign in again.", "a refusal's rewrite is the sentence");
  assert.equal(summarize({ state: "complete", live: false, source: "twin", seq: 1, next: null, data, stale: { since: 7 } }, "offline").freshness.staleSince, 7);
  assert.equal(summarize({ state: "stale", live: false, since: 9, data, seq: 3, outcome: "complete" }, "offline").freshness.staleSince, 9);
  assert.equal(summarize({ state: "complete", live: true, source: "server", seq: 3, next: null, data, caughtUp: false }, "connected").local.caughtUp, false);
  for (const code of Object.keys(reasonMessages)) assert.equal(typeof reasonMessages[code], "string", code);
});

test("readiness maps every outbox status, the fence, and the op-scoped queue to send, action, and reason", () => {
  const status = (reason: string, over: Record<string, unknown> = {}) =>
    ({ ready: reason === "ready", reason, action: "none", remaining: 0, fence: "inside", ...over }) as any;
  const table: Array<[any, string, number, boolean, string | undefined, string | undefined]> = [
    [status("ready"), "connected", 0, true, undefined, undefined],
    [status("ready"), "offline", 0, true, undefined, undefined],
    [status("ready"), "connected", 2, true, "connect", "pending"],
    [status("ready"), "offline", 1, true, "connect", "pending"],
    [status("ready", { fence: "past" }), "connected", 0, true, "connect", "fence"],
    [status("ready", { fence: "past" }), "offline", 3, true, "connect", "fence"],
    [status("sealed", { fence: "past" }), "connected", 0, false, "sign-in", "sealed"],
    [status("grant-missing"), "connected", 0, false, "connect", "grant-missing"],
    [status("grant-expired"), "offline", 0, false, "connect", "grant-expired"],
    [status("ids-exhausted"), "connected", 5, false, "connect", "ids-exhausted"],
    [status("program-missing"), "connected", 0, false, "connect", "program-missing"],
    [status("follower"), "connected", 0, false, "other-tab", "follower"],
    // @ref LLP 1018.004#3-readiness-on-a-follower — a follower's rows are durable: forwarding and an unresponsive writer are reasons on a sendable status.
    [status("forwarding", { ready: true }), "connected", 0, true, undefined, undefined],
    [status("forwarding", { ready: true }), "connected", 2, true, "wait", "pending"],
    [status("writer-unresponsive", { ready: true, remaining: 1 }), "connected", 1, true, "wait", "writer-unresponsive"],
    [status("inbox-full"), "connected", 256, false, "wait", "inbox-full"],
  ];
  for (const [value, connection, queued, send, action, code] of table) {
    const can = readiness(value, connection as any, queued);
    const label = `${value.reason}/${value.fence}/${connection}/${queued}`;
    assert.equal(can.send, send, label);
    assert.equal(can.action, action, label);
    assert.equal(can.reason?.code, code, label);
    if (code && code !== "pending") assert.equal(can.reason?.message, readinessMessages[code], label);
    assert.deepEqual(readiness(value, connection as any, queued), can, `${label}: pure`);
  }
  assert.match(readiness(status("ready"), "connected", 2).reason!.message, /^2 queued · Waiting for the server\.$/);
  assert.match(readiness(status("ready"), "reconnecting", 1).reason!.message, /^1 queued · Waiting for connection\.$/);
  assert.match(readiness(status("forwarding", { ready: true }), "connected", 2).reason!.message, /^2 queued · Waiting for the sending tab\.$/);
  // The status's partition-wide `remaining` is not the op-scoped queue: it must not leak into the sentence.
  assert.equal(readiness(status("ready", { remaining: 9 }), "connected", 0).reason, undefined);
});

test("intentLabel never shows a client clock and reads a conflict the same way from a trace or a recipe", () => {
  const base = { intent: "i:0", grant: "g", offset: 0, count: 1, ids: ["m"], op: "deliveries.post", args: {}, issuedSeq: 0, createdAt: 0, updatedAt: 0 };
  assert.equal(intentLabel({ ...base, state: "queued", predicted: true } as any), "Sending… · Preview");
  assert.equal(intentLabel({ ...base, state: "queued", predicted: false } as any), "Sending… · Awaiting confirmation");
  assert.equal(intentLabel({ ...base, state: "queued", predicted: false, reason: "fence" } as any), "Will be checked by the server");
  assert.equal(intentLabel({ ...base, state: "committed" } as any), "Sent");
  assert.equal(intentLabel({ ...base, state: "expired" } as any), "Expired");
  assert.equal(intentLabel({ ...base, state: "rejected", response: { reason: "conflict" } } as any), "Not sent · Message changed");
  assert.equal(intentLabel({ ...base, state: "rejected", response: { code: "CONFLICT" } } as any), "Not sent · Message changed");
  assert.equal(intentLabel({ ...base, state: "rejected", response: { code: "NOT_MEMBER", rewrite: "Join first." } } as any), "Not sent · Join first.");
  assert.equal(intentLabel({ ...base, state: "rejected", response: { code: "NOT_MEMBER", message: "not a member" } } as any), "Not sent · not a member");
  assert.equal(intentLabel({ ...base, state: "rejected" } as any), "Not sent · refused");
});
