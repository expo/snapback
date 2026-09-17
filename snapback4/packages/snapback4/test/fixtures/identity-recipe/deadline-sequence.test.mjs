import assert from "node:assert/strict";
import test from "node:test";
import { proveDeadlineSequence } from "./deadline-sequence.mjs";

const run = { id: "deadline-1", held: { attempt: 3 } };
const requireValue = (condition, code) => { if (!condition) throw new Error(code); };

test("deadline proof pulses status before public collection and lease refusal", async () => {
  const calls = [];
  await proveDeadlineSequence({
    run,
    waitPastDeadline: async () => { calls.push("wait"); },
    status: async () => { calls.push("status"); return { invocation: {
      id: run.id, attempt: run.held.attempt, state: "failed", errorCode: "E_ACTION_DEADLINE",
    } }; },
    collect: async () => { calls.push("collect"); return { state: "failed", why: { code: "E_ACTION_DEADLINE" } }; },
    mint: async () => { calls.push("mint"); return { denied: { code: "E_ACTION_LEASE" } }; },
    require: requireValue,
  });
  assert.deepEqual(calls, ["wait", "status", "collect", "mint"]);
});

test("missing deadline status receipt cannot false-green", async () => {
  await assert.rejects(proveDeadlineSequence({ run, waitPastDeadline: async () => {}, status: async () => ({}),
    collect: async () => ({ state: "failed", why: { code: "E_ACTION_DEADLINE" } }),
    mint: async () => ({ denied: { code: "E_ACTION_LEASE" } }), require: requireValue }), /deadline-status-receipt/);
});

test("mismatched deadline status receipt cannot false-green", async () => {
  await assert.rejects(proveDeadlineSequence({ run, waitPastDeadline: async () => {}, status: async () => ({ invocation: {
    id: "other", attempt: run.held.attempt, state: "failed", errorCode: "E_ACTION_DEADLINE",
  } }), collect: async () => ({ state: "failed", why: { code: "E_ACTION_DEADLINE" } }),
  mint: async () => ({ denied: { code: "E_ACTION_LEASE" } }), require: requireValue }), /deadline-status-receipt/);
});
