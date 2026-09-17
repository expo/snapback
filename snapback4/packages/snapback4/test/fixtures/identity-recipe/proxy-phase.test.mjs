import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createProxyPhase, stopOwnedChild } from "./proxy-phase.mjs";

test("an active proof request failure is fatal with a fixed code", () => {
  let failure = null;
  const phase = createProxyPhase(code => { failure ??= code; });
  const request = phase.beginRequest();
  phase.failRequest(request, "protocol");
  phase.finishRequest(request);
  assert.equal(failure, "proxy-proof-protocol");
});

test("new traffic during explicit teardown is refused without latching a failure", () => {
  let failure = null;
  const phase = createProxyPhase(code => { failure ??= code; });
  assert.equal(phase.beginExpectedTeardown(), true);
  const request = phase.beginRequest();
  assert.equal(request.phase, "expected-teardown");
  phase.failRequest(request, "request");
  phase.finishRequest(request);
  assert.equal(failure, null);
});

test("a preexisting failure cannot be erased by teardown", () => {
  let failure = "engine-spawn";
  const phase = createProxyPhase(code => { failure ??= code; });
  phase.beginExpectedTeardown();
  phase.failServer("server");
  assert.equal(failure, "engine-spawn");
});

test("a request begun in proof remains fatal when it fails after transition", async () => {
  let failure = null;
  const phase = createProxyPhase(code => { failure ??= code; });
  const request = phase.beginRequest();
  phase.beginExpectedTeardown();
  phase.failRequest(request, "request");
  phase.finishRequest(request);
  assert.equal(await phase.waitForProofDrain(20), true);
  assert.equal(failure, "proxy-proof-request");
});

test("unknown error text cannot enter the diagnostic code", () => {
  let failure = null;
  const secret = "secret-message-and-url";
  const phase = createProxyPhase(code => { failure ??= code; });
  const request = phase.beginRequest();
  phase.failRequest(request, secret);
  assert.equal(failure, "proxy-proof-request");
  assert.equal(failure.includes(secret), false);
});

test("cleanup returns immediately for an owned signal-exited child", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = "SIGTERM";
  child.kill = () => assert.fail("terminal child must not be signalled again");
  const owned = new Set([child]);
  await stopOwnedChild(child, owned, 20);
  assert.equal(owned.size, 0);
});

test("cleanup observes a synchronous signal exit after subscribing", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const signals = [];
  child.kill = signal => {
    signals.push(signal);
    child.signalCode = signal;
    child.emit("exit", null, signal);
    return true;
  };
  const owned = new Set([child]);
  await stopOwnedChild(child, owned, 20);
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(owned.size, 0);
});
