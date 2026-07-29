import test from "node:test";
import assert from "node:assert/strict";
import { verifyLedger } from "./remediation-ledger.mjs";

function entry() {
  return {
    id: "SB-001",
    title: "Make first read ordinary",
    sourceApps: ["todo"],
    backendComparisons: ["convex"],
    evidencePaths: ["diaries/todo.md"],
    frequency: 1,
    classification: "experience",
    severity: "medium",
    reach: "general",
    competitorOutcome: "First authoritative read requires little ceremony.",
    snapbackPropertyToPreserve: "Explicit target and authority.",
    snapbackNativeOutcome: "A guided path reaches the same outcome with explicit target identity.",
    acceptanceWitness: "A clean external app completes the frozen first-read check.",
    destination: "filesystem-issue",
    decision: "investigate",
    status: "proposed",
  };
}

test("accepts a fully evidenced proposed remediation", () => {
  assert.deepEqual(verifyLedger({
    schemaVersion: 1,
    tranche: "calibration",
    startingSnapbackCommit: "a".repeat(40),
    entries: [entry()],
  }), []);
});

test("landed remediation requires before/after evidence and an ending commit", () => {
  const landed = entry();
  landed.decision = "accept";
  landed.status = "landed";
  const problems = verifyLedger({
    schemaVersion: 1,
    tranche: "calibration",
    startingSnapbackCommit: "a".repeat(40),
    entries: [landed],
  });
  assert.ok(problems.some((problem) => problem.includes("ending commit")));
  assert.ok(problems.some((problem) => problem.includes("before evidence")));
  assert.ok(problems.some((problem) => problem.includes("after evidence")));
});

test("benchmark-only findings cannot become immediate product fixes", () => {
  const benchmark = entry();
  benchmark.classification = "benchmark-only";
  benchmark.destination = "immediate-fix";
  const problems = verifyLedger({
    schemaVersion: 1,
    tranche: "calibration",
    startingSnapbackCommit: "a".repeat(40),
    entries: [benchmark],
  });
  assert.ok(problems.some((problem) => problem.includes("benchmark-only")));
});
