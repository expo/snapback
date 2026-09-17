import assert from "node:assert/strict";
import test from "node:test";
import { appendCrashCutObservation, requireInitialMintCut, requireMintStepDoneCut } from "./crash-cut-plan.mjs";

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
