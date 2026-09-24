import test from "node:test";
import assert from "node:assert/strict";
import { execute, generate, minimize, operations } from "./helpers/app-session-model.mjs";

test("session state machine preserves I1–I5 across 2,000 seeded three-runtime sequences", { timeout: 120_000 }, async t => {
  const coverage = {}, count = Number(process.env.SNAPBACK4_SESSION_SEQUENCES ?? 2000);
  for (let seed = 1; seed <= count; seed++) {
    const sequence = generate(seed);
    try { await execute(sequence, coverage); }
    catch (error) {
      const minimal = await minimize(sequence, error);
      assert.fail(`seed=${seed}: ${error.message}\nminimal sequence=${JSON.stringify(minimal)}`);
    }
  }
  if (count >= 2000) {
    for (const op of operations) assert.ok(coverage[`op.${op}`] > 0, `generated ${op}`);
    for (const kind of ["get", "set", "delete"]) assert.ok(coverage[`fault.${kind}`] > 0, `injected ${kind}`);
    for (const path of ["signup", "login", "guest", "refresh", "logout"]) assert.ok(coverage[`held./auth/${path}`] > 0, `held committed ${path} response`);
  }
  t.diagnostic(`sequences=${count} seed=1..${count} coverage=${JSON.stringify(coverage)}`);
});

for (const [name, sequence] of [
  ["a failed read during signup cannot revoke the saved session", [{ op: "signup", app: 2, account: 1, fault: { kind: "get", at: 11 } }]],
  ["close retains custody of a late guest response", [{ op: "guest", app: 1, hold: true }, { op: "close", app: 1 }]],
  ["replacement retires a rotation whose persistence read failed", [{ op: "guest", app: 1 }, { op: "refresh", app: 1, fault: { kind: "get", at: 5 } }, { op: "guest", app: 1, hold: true }]],
  ["a closed runtime cannot return to restoring after a peer's replacement", [
    { op: "signup", app: 2, account: 1 }, { op: "reopen", app: 0 }, { op: "login", app: 0, account: 1, hold: true },
    { op: "login", app: 0, account: 1 }, { op: "close", app: 0 }, { op: "login", app: 1, account: 1 }, { op: "release", app: 1 },
  ]],
]) test(`model regression: ${name}`, () => execute(sequence));

test("session model sweeps 120 failure points after an unpersisted rotation", async () => {
  for (const kind of ["get", "set", "delete"]) for (let at = 1; at <= 40; at++) {
    const sequence = [{ op: "guest", app: 0 }, { op: "refresh", app: 0, fault: { kind: "get", at: 5 } },
      { op: "guest", app: 0, fault: { kind, at } }];
    try { await execute(sequence); }
    catch (error) { assert.fail(`${kind} #${at}: ${error.message}\nminimal sequence=${JSON.stringify(await minimize(sequence, error))}`); }
  }
});
