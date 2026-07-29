import test from "node:test";
import assert from "node:assert/strict";
import { summarizeProgram } from "./program-status.mjs";

test("does not confuse a frozen protocol with a completed 35-arm program", () => {
  const arms = Array.from({ length: 35 }, (_, index) => ({
    round: index < 14 ? "calibration" : "deep",
    state: "not-scaffolded",
  }));
  const result = summarizeProgram({
    health: { readyForTimedArms: false },
    freeze: { readinessAtFreeze: "not-ready" },
    arms,
    reportPresence: {
      "reports/calibration-remediation.v1.json": false,
      "reports/deep-remediation.v1.json": false,
    },
  });
  assert.equal(result.complete, false);
  assert.equal(result.stages.freeze, "in-progress");
  assert.equal(result.arms.allAttempted, false);
  assert.equal(result.complete, false);
});

test("requires all 35 attempted capsules and every final report", () => {
  const arms = Array.from({ length: 35 }, (_, index) => ({
    round: index < 14 ? "calibration" : "deep",
    state: index === 34 ? "pending" : "complete",
  }));
  const reports = {
    "reports/calibration-report.md": true,
    "reports/calibration-remediation.v1.json": true,
    "reports/deep-round-report.md": true,
    "reports/deep-remediation.v1.json": true,
    "reports/final-ratings.v1.json": true,
    "reports/final-scoring.v1.json": true,
    "reports/final-report.md": true,
    "reports/completion-audit.v1.json": true,
  };
  const result = summarizeProgram({
    health: { readyForTimedArms: true },
    freeze: { readinessAtFreeze: "ready" },
    arms,
    reportPresence: reports,
  });
  assert.equal(result.complete, false);
  arms[34].state = "stopped";
  const completeArtifacts = summarizeProgram({
    health: { readyForTimedArms: true },
    freeze: { readinessAtFreeze: "ready" },
    arms,
    reportPresence: reports,
  });
  assert.equal(completeArtifacts.artifactSetComplete, true);
  assert.equal(completeArtifacts.complete, false);
  assert.equal(summarizeProgram({
    health: { readyForTimedArms: true },
    freeze: { readinessAtFreeze: "ready" },
    arms,
    reportPresence: reports,
    completionAuditVerified: true,
  }).complete, true);
});
