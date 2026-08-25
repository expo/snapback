import assert from "node:assert/strict";
import test from "node:test";

import { projectMechanicalAggregates } from "./generate-aggregates.mjs";
import { observeScaleStatus } from "./scale-observer.mjs";

test("scale observer projects a bounded detached observation", () => {
  const observed = observeScaleStatus({
    schemaVersion: "social-messenger.scale-status.v1",
    runId: "lane/scale-1",
    pid: 42,
    state: "running",
    actions: { applied: 25, total: 100, failed: 0 },
    updatedAt: "2026-08-25T12:00:00.000Z",
    outcomeClass: null,
    receipt: null,
  }, { observedAt: "2026-08-25T12:00:01.000Z" });
  assert.equal(observed.actions.percent, 25);
  assert.equal(observed.ageMs, 1_000);
  assert.equal(observed.terminal, false);
  assert.ok(JSON.stringify(observed).length < 1_000);
});

test("scale observer refuses unclassified terminal failure", () => {
  assert.throws(() => observeScaleStatus({
    schemaVersion: "social-messenger.scale-status.v1",
    runId: "lane/scale-1",
    pid: 42,
    state: "failed",
    actions: { applied: 25, total: 100, failed: 1 },
    updatedAt: "2026-08-25T12:00:00.000Z",
    outcomeClass: null,
    receipt: "scale-receipt.json",
  }), /requires an outcomeClass/u);
});

test("run and diary aggregates share one projection and source identity", () => {
  const result = projectMechanicalAggregates({
    lane: "snapback",
    laneVariant: "skill",
    harness: { name: "calibration" },
    timestamps: { startedAt: "2026-08-25T00:00:00Z", finishedAt: "2026-08-25T00:01:00Z" },
    wallClock: { totalSeconds: 60 },
    tokens: { input: 10, output: 20 },
    correctionLoops: [{ attribution: "agent" }],
    socialMessenger: {
      instrumentVersion: "social-messenger@0.3.4-m8",
      milestones: {
        M1: { status: "green", authoring: { wallSeconds: 60, tokens: { input: 10, output: 20 }, firstGreenAt: "2026-08-25T00:01:00Z" } },
      },
    },
  }, "sha256:fixture");
  assert.match(result.runMarkdown, /sha256:fixture/u);
  assert.match(result.diaryMarkdown, /sha256:fixture/u);
  assert.match(result.runMarkdown, /\| M1 \| green \| 60s \| 10 \| 20 \|/u);
  assert.match(result.diaryMarkdown, /Qualitative diary narrative belongs below/u);
});
