import test from "node:test";
import assert from "node:assert/strict";
import { execute, generate, minimize, operations } from "./helpers/app-session-model.mjs";

test("identity custody: offline first save remains pending while a peer recovers its stable ID (seed 1807)", () => execute([
  { op: "guest", app: 0 },
  { op: "reopenOffline", app: 2, account: 1, hold: false, fault: { kind: "delete", at: 9 }, holdDispatch: false },
  { op: "handleMutate", app: 2, account: 0, hold: false, fault: { kind: "set", at: 10 }, holdDispatch: false },
  { op: "reopen", app: 1, account: 1, hold: false, fault: { kind: "set", at: 11 }, holdDispatch: false },
], {}, "online"));

for (const [name, schedule] of [["native state-read overlap", 0], ["deferred/ordinary exact-input race", 1], ["peer dispatch before expiry", 2]]) {
  test(`identity custody session schedule: ${name}`, () => execute([{ op: "identityCustody", schedule, variant: 0 }]));
}

// Keep the full 5,000 seeds per tier and the existing per-test timeout. Native
// process schedules add real host work; five serial slices keep it bounded.
const custodyCoverage = { online: {}, local: {} };
for (const tier of ["online", "local"]) for (let slice = 0; slice < 5; slice++) test(`${tier} session state machine preserves I1–I13 and custody (slice ${slice + 1}/5)`, { timeout: 240_000 }, async t => {
  const coverage = custodyCoverage[tier], count = Number(process.env.SNAPBACK4_SESSION_SEQUENCES ?? 5000);
  const first = Math.floor(count * slice / 5) + 1, last = Math.floor(count * (slice + 1) / 5);
  for (let seed = first; seed <= last; seed++) {
    t.signal.throwIfAborted();
    const sequence = generate(seed);
    try { await execute(sequence, coverage, tier); }
    catch (error) {
      if (t.signal.aborted) throw error;
      const minimal = await minimize(sequence, error, tier);
      assert.fail(`tier=${tier} seed=${seed}: ${error.message}\nminimal sequence=${JSON.stringify(minimal)}`);
    }
  }
  if (count >= 5000 && slice === 4) for (const name of ["read-overlap", "dedup", "expiry"]) assert.ok(coverage[`custody.${name}`] >= 1666, `exercised ${name}`);
  if (count >= 5000 && slice === 4) for (const event of ["write.outcome", "write.outcomeAfterFence", "write.unknownAtClose", "write.knownAtDelivery", "global.attempt", "global.attemptRefused", "global.ackWithLaterToken", "global.newerAccountEpoch", "retirement.removed", "wire.retirementOffline", "handle.resultSettled", "held.dispatch/auth/signup", "held.dispatch/auth/login", "held.dispatch/auth/guest"]) assert.ok(coverage[event] > 0, `exercised ${event}`);
  if (count >= 5000 && slice === 4) {
    for (const op of operations) assert.ok(coverage[`op.${op}`] > 0, `generated ${op}`);
    for (const kind of ["get", "set", "delete"]) assert.ok(coverage[`fault.${kind}`] > 0, `injected ${kind}`);
    for (const path of ["signup", "login", "guest", "refresh", "logout", "logout-all"]) assert.ok(coverage[`held./auth/${path}`] > 0, `held committed ${path} response`);
  }
  if (count >= 5000 && slice === 4) for (const event of ["held.storage.set", "held./q/viewer", "held./m/write", "server.revoke", "wire.offline", "interleaving.storage.peer", "fault.rotationSave", "handle.captured", "handle.sessionNotification", "handle.viewerNotification", "handle.hidden.handleQuery", "handle.hidden.handleMutate", "handle.hidden.handleRefresh", "observation.data", "observation.notification", "observation.hidden", "server.externalSibling", "global.peerPersistedRotation", "global.peerHeldRotation", "global.rotatedBearer", "global.externalSiblingRevoked"]) assert.ok(coverage[event] > 0, `exercised ${event}`);
  if (count >= 5000 && slice === 4) for (const event of ["write.outcome.sent", "write.outcome.failed", "write.outcomeAfterFence.sent", "write.outcomeAfterFence.failed", `open.${tier}`]) assert.ok(coverage[event] > 0, `exercised ${event}`);
  if (tier === "local" && count >= 5000 && slice === 4) for (const path of ["/schema", "/sync"]) assert.ok(coverage[`wire.${path}`] > 0, `local client used ${path}`);
  if (count >= 5000 && slice === 4) {
    for (const state of ["sent", "failed"]) for (const source of ["mutate", "write", "onWrite"])
      assert.ok(coverage[`consistent.${source}.${state}`] > 0, `I13 ${source} ${state}`);
    assert.ok(coverage["consistent.writeDuringReceiptFailure"] > 0, "looked up known outcomes during persistent failure");
    assert.ok(coverage["fault.receiptSave"] > 0, "kept receipt saves failing on this tier");
  }
  t.diagnostic(`tier=${tier} sequences=${last - first + 1} seed=${first}..${last} coverage=${JSON.stringify(coverage)}`);
});

for (const tier of ["online", "local"]) for (const refuse of [false, true]) {
  test(`I13 ${tier}: ${refuse ? "failed" : "sent"} stays known through receipt-store failure and repair`, () => execute([
    { op: "guest", app: 0 }, { op: "receiptOffline", app: 0 },
    { op: "handleMutate", app: 0, refuse }, { op: "handleWrite", app: 0 },
    { op: "handleWrite", app: 0 }, { op: "receiptOnline", app: 0 }, { op: "handleWrite", app: 0 },
  ], {}, tier));
}

test("model regression: a peer-fenced provisional local opener cannot leave auth restoring", () => execute([
  { op: "signup", app: 0, account: 1 }, { op: "signup", app: 1, account: 1 },
  { op: "release", app: 1 }, { op: "reopen", app: 1 },
  { op: "holdStore", app: 2, hold: true, fault: { kind: "get", at: 8 } },
  { op: "closeClient", app: 2 }, { op: "guest", app: 0, fault: { kind: "get", at: 11 } },
  { op: "signup", app: 1, account: 1 }, { op: "release", app: 2, fault: { kind: "delete", at: 3 } },
], {}, "local"));

for (const tier of ["online", "local"]) for (const refuse of [false, true]) for (const ending of ["close", "logout"]) {
  test(`model regression: ${tier} held ${refuse ? "refusal" : "commit"} remains pending with its id across ${ending}`, () => execute([
    { op: "guest", app: 0 }, { op: "handleMutate", app: 0, hold: true, refuse },
    { op: ending, app: 0 }, { op: "release", app: 0 },
  ], {}, tier));
}
test("model regression: failed local rotation persistence cannot be committed by a second notification save", () => execute([
  { op: "signup", app: 0 }, { op: "refreshFault", app: 0 },
], {}, "local"));
test("model regression: obsolete predecessor refusal waits for the held local rotation", () => execute([
  { op: "guest", app: 0 }, { op: "reopen", app: 1 },
  { op: "refreshFault", app: 1, hold: true }, { op: "query", app: 1 }, { op: "reopenOffline", app: 0 },
], {}, "local"));

for (const [name, sequence] of [
  ["a global caller waiting for rotation cannot select an intervening replacement", [
    { op: "signup", app: 2 }, { op: "refreshFault", app: 2, hold: true },
    { op: "logoutEverywhere", app: 2 }, { op: "login", app: 1 },
  ]],
  ["receipt storage failure retains custody without replacing a dispatched outcome", [
    { op: "guest", app: 0 }, { op: "reopen", app: 1 },
    { op: "handleMutate", app: 1, hold: true }, { op: "release", app: 1, fault: { kind: "get", at: 2 } },
  ]],
  ["an undelivered write remains pending with its id across logout", [
    { op: "guest", app: 0 }, { op: "handleMutate", app: 0, hold: true }, { op: "logout", app: 0 }, { op: "release", app: 0 },
  ]],
  ["a facade hidden after dispatch preserves the raw rotation outcome", [
    { op: "guest", app: 0 }, { op: "handleRefresh", app: 0, hold: true }, { op: "close", app: 0 }, { op: "release", app: 0 },
  ]],
  ["a refresh result fulfilled before hiding is not a new disclosure by its later handler", [
    { op: "guest", app: 0 }, { op: "reopen", app: 1 }, { op: "handleRefresh", app: 1, account: 1, hold: true },
    { op: "holdStore", app: 2 }, { op: "refresh", app: 0 }, { op: "handleQuery", app: 1, account: 1, fault: { kind: "get", at: 8 } },
  ]],
  ["storage observation follows delivery, not entry into the backing adapter", [
    { op: "guest", app: 0 }, { op: "reopen", app: 1 }, { op: "holdStore", app: 1 },
    { op: "handleRefresh", app: 1, hold: true }, { op: "guest", app: 0 }, { op: "observeHandle", app: 1, account: 1 },
  ]],
  ["an acknowledgement cannot retire a login minted after its attempt", [
    { op: "signup", app: 0 }, { op: "reopen", app: 1 }, { op: "login", app: 1, holdDispatch: true },
    { op: "logoutEverywhere", app: 0, hold: true }, { op: "retireOffline", app: 0 }, { op: "retireOffline", app: 1 },
    { op: "release", app: 1 }, { op: "close", app: 1 }, { op: "release", app: 0 },
    { op: "retireOnline", app: 0 }, { op: "reopen", app: 2 },
  ]],
  ["a dormant global caller cannot adopt a later login's account epoch", [
    { op: "signup", app: 0 }, { op: "reopen", app: 1 }, { op: "logoutEverywhere", app: 1 },
    { op: "login", app: 1 }, { op: "sibling", app: 1 }, { op: "logoutEverywhere", app: 0, expectOk: false },
  ]],
  ["a queued login cannot suppress the committed global logout's publication", [
    { op: "guest", app: 0 }, { op: "holdStore", app: 0 }, { op: "logoutEverywhere", app: 0, hold: true },
    { op: "login", app: 0 }, { op: "release", app: 0 },
  ]],
  ["a stale global retry does not recreate an acknowledged retirement", [
    { op: "guest", app: 2 }, { op: "reopen", app: 1 },
    { op: "logoutEverywhere", app: 2 }, { op: "logoutEverywhere", app: 1 },
  ]],
  ["global logout selects a peer's persisted successor", [
    { op: "signup", app: 0 }, { op: "reopen", app: 1 }, { op: "sibling", app: 0 },
    { op: "refresh", app: 0 }, { op: "logoutEverywhere", app: 1, expectOk: true, expectRevoked: true },
  ]],
  ["a late successor inherits a closed peer's global fence", [
    { op: "signup", app: 0 }, { op: "reopen", app: 1 }, { op: "sibling", app: 0 },
    { op: "refresh", app: 0, hold: true }, { op: "logoutEverywhere", app: 1, expectOk: false },
    { op: "close", app: 1 }, { op: "release", app: 0, expectRevoked: true },
  ]],
  ["offline reopening starts after close commits the owned rotation", [
    { op: "guest", app: 0 }, { op: "reopen", app: 1 }, { op: "refreshFault", app: 1 },
    { op: "reopenOffline", app: 1, fault: { kind: "get", at: 6 } },
  ]],
  ["refusal after a failed rotation save also excludes its consumed predecessor", [
    { op: "guest", app: 0 }, { op: "refreshFault", app: 0 }, { op: "revokeCurrent", app: 0 }, { op: "reopenOffline", app: 1 },
  ]],
  ["failed global fencing keeps retained handles and observations usable", [
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

test("I12 local close retains a body delivered while cleanup awaits another runtime", () => execute([
  { op: "guest", app: 0 }, { op: "reopen", app: 1 },
  { op: "handleMutate", app: 1, account: 1, hold: true }, { op: "holdStore", app: 0 },
  { op: "refreshFault", app: 0, account: 1, hold: true, fault: { kind: "get", at: 7 } },
  { op: "handleQuery", app: 1, fault: { kind: "delete", at: 10 } }, { op: "close", app: 1 },
], {}, "local"));

for (const tier of ["online", "local"]) test(`I12 ${tier}: the full terminal oracle catches an in-memory refusal-message corruption`, async () => {
  const commands = [{ op: "guest", app: 0 }, { op: "handleMutate", app: 0, refuse: true }];
  await execute(commands, {}, tier);
  let mutated = false;
  await assert.rejects(execute(commands, {}, tier, { mutateOutcome(result) {
    if (result.state === "failed") { result.why.message = "corrupted refusal message"; mutated = true; }
  } }), /I12.*corrupted refusal message/);
  assert.equal(mutated, true);
});

// These schedules retain a received refusal across a credential fence. The
// oracle must compare full outcomes even after its caller has been hidden.
for (const [tier, commands] of [
  ["online", [
    { op: "guest", app: 0 }, { op: "reopen", app: 1 },
    { op: "handleMutate", app: 0, account: 1, hold: true },
    { op: "holdStore", app: 0 }, { op: "release", app: 0 },
    { op: "refresh", app: 1 }, { op: "refreshFault", app: 0 },
  ]],
  ["local", [
    { op: "guest", app: 0 }, { op: "reopen", app: 1 },
    { op: "release", app: 2 }, { op: "login", app: 2 },
    { op: "holdStore", app: 1 }, { op: "release", app: 2 },
    { op: "handleMutate", app: 0, account: 1, hold: true },
    { op: "logoutEverywhere", app: 1 }, { op: "handleRefresh", app: 0 },
  ]],
]) test(`I12 ${tier}: full refusal equality also holds after the caller is fenced`, async () => {
  await execute(commands, {}, tier);
  let mutated = false;
  await assert.rejects(execute(commands, {}, tier, { mutateOutcome(result, ended) {
    if (ended && result.state === "failed") { result.why.message = "corrupted fenced refusal"; mutated = true; }
  } }), /I12.*corrupted fenced refusal/);
  assert.equal(mutated, true, "the control corrupted a terminal outcome only after the fence");
});

// Exact minimized sequence from the second 0.4.1 publication dry run. A timed
// out online test can still be executing when node:test starts the local test.
const publicationSeed11 = [
  {"op": "guest", "app": 0},
  {"op": "reopen", "app": 1},
  {"op": "logoutEverywhere", "app": 2, "account": 0, "hold": false, "fault": null, "holdDispatch": false},
  {"op": "retireOffline", "app": 0, "account": 1, "hold": false, "fault": null, "holdDispatch": false},
  {"op": "sibling", "app": 0, "account": 0, "hold": false, "fault": {"kind": "get", "at": 2}, "holdDispatch": false},
  {"op": "query", "app": 0, "account": 0, "hold": false, "fault": {"kind": "get", "at": 9}, "holdDispatch": false},
  {"op": "retireOnline", "app": 0, "account": 0, "hold": true, "fault": null, "holdDispatch": false},
  {"op": "logoutEverywhere", "app": 1, "account": 1, "hold": false, "fault": null, "holdDispatch": false},
  {"op": "holdStore", "app": 1, "account": 0, "hold": true, "fault": {"kind": "delete", "at": 9}, "holdDispatch": false},
  {"op": "reopen", "app": 1, "account": 1, "hold": false, "fault": null, "holdDispatch": true},
  {"op": "holdStore", "app": 0, "account": 1, "hold": false, "fault": {"kind": "delete", "at": 9}, "holdDispatch": false},
  {"op": "capture", "app": 0, "account": 1, "hold": false, "fault": {"kind": "get", "at": 1}, "holdDispatch": false},
  {"op": "login", "app": 1, "account": 1, "hold": false, "fault": {"kind": "get", "at": 2}, "holdDispatch": false},
  {"op": "refresh", "app": 0, "account": 0, "hold": false, "fault": null, "holdDispatch": false},
  {"op": "query", "app": 0, "account": 1, "hold": false, "fault": null, "holdDispatch": false},
  {"op": "handleRefresh", "app": 1, "account": 1, "hold": false, "fault": {"kind": "delete", "at": 1}, "holdDispatch": false},
  {"op": "release", "app": 0, "account": 1, "hold": false, "fault": {"kind": "set", "at": 7}, "holdDispatch": false},
  {"op": "capture", "app": 0, "account": 0, "hold": true, "fault": null, "holdDispatch": false},
  {"op": "logoutEverywhere", "app": 1, "account": 0, "hold": false, "fault": null, "holdDispatch": false},
  {"op": "sibling", "app": 0, "account": 1, "hold": false, "fault": {"kind": "set", "at": 2}, "holdDispatch": false},
  {"op": "handleQuery", "app": 0, "account": 1, "hold": false, "fault": null, "holdDispatch": false},
  {"op": "reopenOffline", "app": 0, "account": 1, "hold": true, "fault": {"kind": "delete", "at": 9}, "holdDispatch": false},
  {"op": "capture", "app": 1, "account": 1, "hold": false, "fault": {"kind": "get", "at": 3}, "holdDispatch": true},
];

test("publication seed 11: fair recovery waits for overlapping model work before owning its clock", { timeout: 30_000 }, async () => {
  for (let replay = 0; replay < 20; replay++) {
    await Promise.all([
      execute(generate(11), {}, "online"),
      execute(publicationSeed11, {}, "local"),
      execute(publicationSeed11, {}, "local"),
    ]);
  }
});
