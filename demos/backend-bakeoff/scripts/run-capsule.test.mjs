import test from "node:test";
import assert from "node:assert/strict";
import { newCapsule, verifyCapsule } from "./run-capsule.mjs";

async function validCapsule() {
  const capsule = await newCapsule({
    app: "todo",
    provider: "snapback",
    attemptId: "fixture",
  });
  capsule.result = "complete";
  capsule.actors.alice.principalIdHash = "sha256:alice";
  capsule.actors.bob.principalIdHash = "sha256:bob";
  capsule.actors.mallory.principalIdHash = "sha256:mallory";
  capsule.cleanup.status = "complete";
  capsule.cleanup.targetBoundPlanPath = "receipts/cleanup-plan.json";
  capsule.cleanup.receiptPaths = ["receipts/cleanup.json"];
  capsule.cleanup.postCleanupProbe = "exact target absent";
  capsule.targets.local = {
    status: "cleaned",
    identityHash: "sha256:local",
    profile: "fixture",
    gapReason: "",
    receiptPaths: ["receipts/local-target.json"],
  };
  capsule.targets.hosted = {
    status: "explicit-gap",
    identityHash: "",
    profile: "fixture",
    plan: "GAP",
    region: "GAP",
    gapReason: "fixture has no hosted target",
    receiptPaths: [],
  };
  for (const confidence of Object.values(capsule.evidenceConfidence)) {
    confidence.score = 2;
    confidence.reason = "direct fixture evidence";
    confidence.evidencePaths = ["receipts/confidence.json"];
  }
  capsule.commands.push({
    command: "fixture",
    startedMonotonicMs: 1,
    finishedMonotonicMs: 2,
    exitStatus: 0,
    classification: "fixture",
  });
  for (const scenario of capsule.scenarioResults) {
    scenario.status = "pass";
    scenario.evidencePaths = [`receipts/${scenario.id}.json`];
    scenario.authoritativeCheck = "fixture authoritative check";
  }
  return capsule;
}

test("accepts a complete non-vacuous capsule", async () => {
  assert.deepEqual(await verifyCapsule(await validCapsule()), []);
});

test("new capsule binds the immutable freeze, machine, provider versions, and target profiles", async () => {
  const capsule = await newCapsule({ app: "todo", provider: "spacetimedb", attemptId: "binding-fixture" });
  assert.match(capsule.environment.freezeAggregateSha256, /^[0-9a-f]{64}$/);
  assert.match(capsule.environment.sourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(capsule.environment.providerVersions.cli, "2.7.0");
  assert.match(capsule.environment.machine, /Mac17,3/);
  assert.match(capsule.targets.hosted.profile, /Maincloud/);
});

test("rejects a vacuous result set", async () => {
  const capsule = await validCapsule();
  capsule.scenarioResults = [];
  const problems = await verifyCapsule(capsule);
  assert.ok(problems.some((message) => message.includes("scenario count")));
  assert.ok(problems.some((message) => message.includes("scenario IDs")));
});

test("rejects a pass without evidence or authority", async () => {
  const capsule = await validCapsule();
  capsule.scenarioResults[0].evidencePaths = [];
  capsule.scenarioResults[0].authoritativeCheck = "";
  const problems = await verifyCapsule(capsule);
  assert.ok(problems.some((message) => message.includes("requires evidence")));
  assert.ok(problems.some((message) => message.includes("requires authoritative check")));
});

test("rejects silent pending checks in a final capsule", async () => {
  const capsule = await validCapsule();
  capsule.scenarioResults[0].status = "pending";
  const problems = await verifyCapsule(capsule);
  assert.ok(problems.some((message) => message.includes("pending final status")));
});

test("rejects secret-shaped fields anywhere in a capsule", async () => {
  const capsule = await validCapsule();
  capsule.environment.apiKey = "forbidden-even-if-fake";
  const problems = await verifyCapsule(capsule);
  assert.ok(problems.some((message) => message.includes("secret-shaped keys")));
});

test("retains reasons and evidence for every confidence dimension", async () => {
  const capsule = await validCapsule();
  capsule.evidenceConfidence.transport.reason = "";
  capsule.evidenceConfidence.settlement.evidencePaths = [];
  const problems = await verifyCapsule(capsule);
  assert.ok(problems.some((message) => message.includes("transport: final evidence-confidence score requires a reason")));
  assert.ok(problems.some((message) => message.includes("settlement: nonzero evidence-confidence score requires evidence")));
});

test("rejects unfinished or unproven target cleanup", async () => {
  const capsule = await validCapsule();
  capsule.targets.local.status = "pending";
  capsule.cleanup.postCleanupProbe = "";
  const problems = await verifyCapsule(capsule);
  assert.ok(problems.some((message) => message.includes("unfinished target status")));
  assert.ok(problems.some((message) => message.includes("post-cleanup probe")));
});
