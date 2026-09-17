import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCrashCutObservation, requireCrashCutWorkers, requireInitialMintCut,
  requireMintStepDoneCut, requireMintStepDurableObservation, selectMintStepDoneCut,
} from "./crash-cut-plan.mjs";

const requireValue = (condition, code) => { if (!condition) throw new Error(code); };
const invocation = "complete-1";
const binding = { invocationId: invocation, intent: "identity-session/v1" };
const receipt = { ok: true, step: { state: "done", result: { minted: true } } };

test("ordered crash cuts require the initial mint and exact committed step receipt", () => {
  requireInitialMintCut({ invocation, phase: "initial", path: "/auth/session", binding }, requireValue);
  requireMintStepDoneCut({ invocation, phase: "await-step-done",
    path: `/actions/${invocation}/steps/oidc.mint/done`, upstreamOk: true, reply: receipt }, requireValue);
});

for (const [name, patch, code] of [
  ["wrong invocation", { path: "/actions/other/steps/oidc.mint/done" }, "cut-mint-step-path"],
  ["wrong path", { path: `/actions/${invocation}/steps/other/done` }, "cut-mint-step-path"],
  ["wrong phase", { phase: "recovery" }, "cut-mint-step-path"],
  ["failed upstream", { upstreamOk: false }, "cut-mint-step-receipt"],
  ["missing terminal receipt", { reply: { ok: true } }, "cut-mint-step-receipt"],
]) test(`${name} cannot trigger the step-done cut`, () => {
  assert.throws(() => requireMintStepDoneCut({ invocation, phase: "await-step-done",
    path: `/actions/${invocation}/steps/oidc.mint/done`, upstreamOk: true, reply: receipt, ...patch }, requireValue), new RegExp(code));
});

test("crash-cut observation appends only after clean teardown", () => {
  const observations = [];
  assert.throws(() => appendCrashCutObservation(observations, "before-mint", false, requireValue), /cut-observation-before-cleanup/);
  assert.deepEqual(observations, []);
  appendCrashCutObservation(observations, "before-mint", true, requireValue);
  assert.deepEqual(observations, ["before-mint-commit-process-crash-first-binding"]);
});

test("after-step selection is exact, phase-gated and single-shot", () => {
  const candidate = { getInvocation: () => invocation, mode: "after-step", phase: "await-step-done",
    path: `/actions/${invocation}/steps/oidc.mint/done`, selected: false };
  assert.equal(selectMintStepDoneCut(candidate), invocation);
  assert.equal(selectMintStepDoneCut({ ...candidate, selected: true }), null);
  assert.equal(selectMintStepDoneCut({ ...candidate, phase: "final-recovery" }), null);
  assert.equal(selectMintStepDoneCut({ ...candidate, path: `${candidate.path}/later` }), null);
  assert.equal(selectMintStepDoneCut({ ...candidate, mode: "primary" }), null);
});

test("unrelated initial traffic never resolves a missing completion invocation", () => {
  const missing = () => { throw new Error("completion-id-unavailable"); };
  assert.equal(selectMintStepDoneCut({ getInvocation: missing, mode: "after-step", phase: "initial",
    path: "/actions/begin-1/steps/oidc.exchange/done", selected: false }), null);
  assert.equal(selectMintStepDoneCut({ getInvocation: missing, mode: "after-step", phase: "await-step-done",
    path: "/auth/session", selected: false }), null);
  let resolved = 0;
  assert.equal(selectMintStepDoneCut({ getInvocation: () => { resolved += 1; return invocation; }, mode: "after-step",
    phase: "await-step-done", path: `/actions/${invocation}/steps/oidc.mint/done`, selected: false }), invocation);
  assert.equal(resolved, 1);
});

const durable = {
  requestId: invocation, requestName: "completeOidc", requestState: "running",
  requestResult: null, requestSettledAt: null, stepInvocation: invocation,
  stepName: "oidc.mint", stepState: "done",
  stepResult: { minted: true, principal: "oidc:principal", kind: "oidc", expiresAt: 1234 },
};
const durableExpected = { principal: "oidc:principal", kind: "oidc", expiresAt: 1234 };

test("durable cut observation binds the exact done step and unsettled request", () => {
  requireMintStepDurableObservation({ invocation, observation: durable, expected: durableExpected }, requireValue);
});

for (const [name, observation, code] of [
  ["wrong invocation", { ...durable, stepInvocation: "other" }, "cut-mint-durable-invocation"],
  ["missing step", { ...durable, stepInvocation: null, stepName: null }, "cut-mint-durable-step-missing"],
  ["step not done", { ...durable, stepState: "started" }, "cut-mint-durable-step-not-done"],
  ["mismatched metadata", { ...durable, stepResult: { ...durable.stepResult, expiresAt: 9999 } }, "cut-mint-durable-step-result"],
  ["settled request", { ...durable, requestState: "done", requestResult: "{}", requestSettledAt: 55 }, "cut-mint-request-settled"],
]) test(`${name} refuses the durable step cut`, () => {
  assert.throws(() => requireMintStepDurableObservation({ invocation, observation, expected: durableExpected }, requireValue),
    new RegExp(code));
});

test("worker binding accepts the valid A/B/B/C sequence", () => {
  requireCrashCutWorkers({ firstKilledPid: 101, recoveredMintPid: 202, donePid: 202, finalMintPid: 303 }, requireValue);
});

for (const [name, workers, code] of [
  ["B-recovers/C-done/B-final", { firstKilledPid: 101, recoveredMintPid: 202, donePid: 303, finalMintPid: 202 }, "cut-recovered-worker-binding"],
  ["missing recovered PID", { firstKilledPid: 101, recoveredMintPid: undefined, donePid: 202, finalMintPid: 303 }, "cut-worker-pid-missing"],
  ["wrong done PID", { firstKilledPid: 101, recoveredMintPid: 202, donePid: 303, finalMintPid: 404 }, "cut-recovered-worker-binding"],
  ["final reuses first worker", { firstKilledPid: 101, recoveredMintPid: 202, donePid: 202, finalMintPid: 101 }, "cut-final-worker-distinct"],
  ["final reuses recovered worker", { firstKilledPid: 101, recoveredMintPid: 202, donePid: 202, finalMintPid: 202 }, "cut-final-worker-distinct"],
]) test(`${name} refuses the crash worker sequence`, () => {
  assert.throws(() => requireCrashCutWorkers(workers, requireValue), new RegExp(code));
});
