import test from "node:test";
import assert from "node:assert/strict";
import { execute, generate, minimize, operations } from "./helpers/app-session-model.mjs";

test("session state machine preserves I1–I8 across 5,000 seeded three-runtime sequences", { timeout: 240_000 }, async t => {
  const coverage = {}, count = Number(process.env.SNAPBACK4_SESSION_SEQUENCES ?? 5000);
  for (let seed = 1; seed <= count; seed++) {
    const sequence = generate(seed);
    try { await execute(sequence, coverage); }
    catch (error) {
      const minimal = await minimize(sequence, error);
      assert.fail(`seed=${seed}: ${error.message}\nminimal sequence=${JSON.stringify(minimal)}`);
    }
  }
  if (count >= 5000) {
    for (const op of operations) assert.ok(coverage[`op.${op}`] > 0, `generated ${op}`);
    for (const kind of ["get", "set", "delete"]) assert.ok(coverage[`fault.${kind}`] > 0, `injected ${kind}`);
    for (const path of ["signup", "login", "guest", "refresh", "logout", "logout-all"]) assert.ok(coverage[`held./auth/${path}`] > 0, `held committed ${path} response`);
  }
  if (count >= 5000) for (const event of ["held.storage.set", "held./q/viewer", "held./m/write", "server.revoke", "wire.offline", "interleaving.storage.peer", "fault.rotationSave", "handle.captured", "handle.sessionNotification", "handle.viewerNotification", "handle.hidden.handleQuery", "handle.hidden.handleMutate", "handle.hidden.handleRefresh", "observation.data", "observation.notification", "observation.hidden"]) assert.ok(coverage[event] > 0, `exercised ${event}`);
  t.diagnostic(`sequences=${count} seed=1..${count} coverage=${JSON.stringify(coverage)}`);
});

for (const [name, sequence] of [
  ["offline reopening starts after close commits the owned rotation", [
    { op: "guest", app: 0 }, { op: "reopen", app: 1 }, { op: "refreshFault", app: 1 },
    { op: "reopenOffline", app: 1, fault: { kind: "get", at: 6 } },
  ]],
  ["refusal after a failed rotation save also excludes its consumed predecessor", [
    { op: "guest", app: 0 }, { op: "refreshFault", app: 0 }, { op: "revokeCurrent", app: 0 }, { op: "reopenOffline", app: 1 },
  ]],
  ["failed global fencing revokes retained handles and observations", [
    { op: "guest", app: 0 }, { op: "capture", app: 0 }, { op: "observeHandle", app: 0 },
    { op: "logoutEverywhere", app: 0, fault: { kind: "set", at: 1 } },
    { op: "handleQuery", app: 0 }, { op: "handleMutate", app: 0 }, { op: "handleRefresh", app: 0 }, { op: "readObservation", app: 0 },
  ]],
  ["a failed read during signup cannot revoke the saved session", [{ op: "signup", app: 2, account: 1, fault: { kind: "get", at: 11 } }]],
  ["close retains custody of a late guest response", [{ op: "guest", app: 1, hold: true }, { op: "close", app: 1 }]],
  ["replacement retires a rotation whose persistence read failed", [{ op: "guest", app: 1 }, { op: "refresh", app: 1, fault: { kind: "get", at: 5 } }, { op: "guest", app: 1, hold: true }]],
  ["a closed runtime cannot return to restoring after a peer's replacement", [
    { op: "signup", app: 2, account: 1 }, { op: "reopen", app: 0 }, { op: "login", app: 0, account: 1, hold: true },
    { op: "login", app: 0, account: 1 }, { op: "close", app: 0 }, { op: "login", app: 1, account: 1 }, { op: "release", app: 1 },
  ]],
  ["refusal fencing retries a transient tombstone failure before offline reopen", [
    { op: "guest", app: 0 }, { op: "reopen", app: 1 },
    { op: "revoke", app: 1, account: 0, fault: { kind: "set", at: 2 } }, { op: "reopenOffline", app: 2 },
  ]],
  ["refusal cleanup cannot wait behind a held sign-in", [
    { op: "signup", app: 0, account: 1 }, { op: "guest", app: 0, hold: true },
    { op: "revoke", app: 0, account: 0 }, { op: "reopenOffline", app: 2 },
  ]],
  ["an older queued global logout cannot suppress a newer logout's completion", [
    { op: "holdStore", app: 0 }, { op: "logout", app: 2 },
    { op: "logoutEverywhere", app: 2 }, { op: "logout", app: 2 }, { op: "release", app: 0 },
  ]],
  ["closed auth actions cannot leave a held logout restoring", [
    { op: "close", app: 0 }, { op: "holdStore", app: 0 }, { op: "logout", app: 0 },
    { op: "logoutEverywhere", app: 0 }, { op: "release", app: 2 },
  ]],
  ["a queued global retry completes the signed-out public view", [
    { op: "guest", app: 0 }, { op: "holdStore", app: 2 }, { op: "logoutEverywhere", app: 0 },
    { op: "revoke", app: 1, account: 1, fault: { kind: "get", at: 4 } },
    { op: "logoutEverywhere", app: 0 }, { op: "release", app: 1 },
  ]],
  ["late refusal cannot republish restoring after close", [
    { op: "guest", app: 0 }, { op: "reopen", app: 1 }, { op: "holdStore", app: 0 },
    { op: "refresh", app: 0 }, { op: "refresh", app: 1 }, { op: "logoutEverywhere", app: 1 },
    { op: "close", app: 1 }, { op: "release", app: 2, fault: { kind: "get", at: 7 } },
  ]],
  ["acknowledged global revocation retries cleanup after a failed deletion", [
    { op: "signup", app: 1, account: 1 }, { op: "logoutEverywhere", app: 1, fault: { kind: "delete", at: 1 } },
  ]],
  ["epoch fencing hides the public client before retirement notifications", [
    { op: "holdStore", app: 0 }, { op: "guest", app: 2, hold: true, fault: { kind: "delete", at: 5 } },
    { op: "release", app: 2 }, { op: "logout", app: 1, hold: true, fault: { kind: "get", at: 10 } },
  ]],
  ["a retiring runtime clears its acknowledged global tombstone after a read failure", [
    { op: "guest", app: 1, fault: { kind: "delete", at: 4 } }, { op: "reopenOffline", app: 1 },
    { op: "logoutEverywhere", app: 1, fault: { kind: "delete", at: 11 } }, { op: "reopen", app: 2, hold: true },
    { op: "release", app: 1, hold: true, fault: { kind: "get", at: 2 } }, { op: "reopen", app: 2, fault: { kind: "delete", at: 5 } },
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
