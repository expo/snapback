import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adaptAdvisoryFamily } from "../adapters/advisory.mjs";
import { adaptClaudeSession } from "../adapters/claude-session.mjs";
import { adaptCodexSession } from "../adapters/codex-session.mjs";
import {
  mergeBoundaryMaps,
  normalizeBoundaryMap,
  readReceiptBoundaryFiles,
} from "../boundaries.mjs";
import { joinUsageToMilestones } from "../joiner.mjs";
import { parseJsonLines } from "../jsonl.mjs";
import { TokenCapWatchdog } from "../watchdog.mjs";
import { validateJsonSchema } from "../../../lib/json-schema.mjs";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const ROOT = new URL("../../../../../", import.meta.url);
const extensionSchema = JSON.parse(await readFile(
  new URL("benchmarks/schema/social-messenger/run-record-extension.schema.json", ROOT),
  "utf8",
));

function assertSchema(schema, value) {
  assert.deepEqual(validateJsonSchema(schema, value), []);
}

async function fixtureText(name) {
  return readFile(new URL(name, FIXTURES), "utf8");
}

async function fixtureJson(name) {
  return JSON.parse(await fixtureText(name));
}

test("Claude native usage joins exact boundary prefixes into milestone phases", async () => {
  const channel = adaptClaudeSession(parseJsonLines(
    await fixtureText("claude-session.jsonl"),
    "claude fixture",
  ));
  assert.equal(channel.turns.length, 5, "duplicate message IDs must count once");

  const receiptBoundaries = await readReceiptBoundaryFiles([
    new URL("receipts-m1.jsonl", FIXTURES),
    new URL("receipts-m2.jsonl", FIXTURES),
  ]);
  const boundaries = mergeBoundaryMaps(
    receiptBoundaries,
    normalizeBoundaryMap(await fixtureJson("boundaries.json")),
  );
  const result = joinUsageToMilestones({
    channel,
    boundaries,
    firstProductEdit: await fixtureJson("first-product-edit.json"),
  });

  assert.equal(result.source, "claude-code-session-usage");
  assert.equal(result.available, true);
  assert.deepEqual(result.milestones.M1.authoring.tokens, {
    input: 200,
    output: 40,
    cacheRead: 270,
    cacheWrite: 20,
    reasoning: 10,
  });
  assert.deepEqual(result.boundarySnapshots.M1.tokens, result.milestones.M1.authoring.tokens);
  assert.deepEqual(result.milestones.M2.authoring.tokens, {
    input: 50,
    output: 12,
    cacheRead: 270,
    cacheWrite: 10,
    reasoning: 3,
  });
  assert.deepEqual(result.boundarySnapshots.M2.tokens, {
    input: 250,
    output: 52,
    cacheRead: 540,
    cacheWrite: 30,
    reasoning: 13,
  });
  assert.deepEqual(result.firstProductEdit, {
    at: "2026-08-21T10:00:30.000Z",
    orientationBytes: 12103,
    selectedSkills: ["snapback-authoring", "llp-orient"],
    orientationTokens: {
      input: 100,
      output: 10,
      cacheRead: 50,
      cacheWrite: 20,
      reasoning: 2,
    },
  });
  for (const milestone of Object.values(result.milestones)) {
    assertSchema(extensionSchema.$defs.tokenCounts, milestone.authoring.tokens);
  }
  assertSchema(extensionSchema.$defs.firstProductEditSnapshot, result.firstProductEdit);
  assertSchema(extensionSchema.$defs.tokenCounts, result.firstProductEdit.orientationTokens);
});

test("Codex adapter differences cumulative rollout counters without double-counting", async () => {
  const channel = adaptCodexSession(parseJsonLines(
    await fixtureText("codex-rollout.jsonl"),
    "codex fixture",
  ));
  assert.equal(channel.source, "codex-rollout-token-count");
  assert.equal(channel.turns.length, 3, "repeated cumulative snapshots must not create turns");
  assert.deepEqual(channel.turns.map((turn) => turn.usage), [
    { input: 60, output: 30, cacheRead: 120, cacheWrite: 20, reasoning: 10 },
    { input: 90, output: 20, cacheRead: 180, cacheWrite: 30, reasoning: 5 },
    { input: 150, output: 30, cacheRead: 200, cacheWrite: 50, reasoning: 5 },
  ]);
  const joined = joinUsageToMilestones({
    channel,
    boundaries: {
      M1: {
        suitePassAt: "2026-08-21T11:00:19.000Z",
        choreoPassAt: "2026-08-21T11:00:20.000Z",
      },
      M2: {
        suitePassAt: "2026-08-21T11:00:29.000Z",
        choreoPassAt: "2026-08-21T11:00:30.000Z",
      },
    },
  });
  assert.deepEqual(joined.milestones.M1.authoring.tokens, {
    input: 150,
    output: 50,
    cacheRead: 300,
    cacheWrite: 50,
    reasoning: 15,
  });
  assert.deepEqual(joined.milestones.M2.authoring.tokens, {
    input: 150,
    output: 30,
    cacheRead: 200,
    cacheWrite: 50,
    reasoning: 5,
  });
});

test("cap-advisory families preserve honest null milestone and orientation tokens", async () => {
  const result = joinUsageToMilestones({
    channel: adaptAdvisoryFamily("grok-advisory"),
    boundaries: normalizeBoundaryMap(await fixtureJson("boundaries.json")),
    firstProductEdit: await fixtureJson("first-product-edit.json"),
  });
  const nulls = {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
  };
  assert.equal(result.available, false);
  assert.equal(result.source, null);
  assert.equal(result.unavailableReason, "harness-no-per-turn-usage");
  assert.deepEqual(result.milestones.M1.authoring.tokens, nulls);
  assert.deepEqual(result.milestones.M2.authoring.tokens, nulls);
  assert.deepEqual(result.firstProductEdit.orientationTokens, nulls);
  assertSchema(extensionSchema.$defs.tokenCounts, nulls);
});

test("watchdog trips once at fresh-input-plus-output cap and emits schema charging", () => {
  const trips = [];
  const watchdog = new TokenCapWatchdog({ onTrip: (trip) => trips.push(trip) });
  watchdog.arm({
    capFamily: "gpt-frontier",
    milestone: "M2",
    tokenCap: 100,
    startedAt: "2026-08-21T12:00:00.000Z",
  });
  const first = {
    id: "turn-1",
    completedAt: "2026-08-21T12:00:05.000Z",
    usage: { input: 40, output: 10, cacheRead: 1000, cacheWrite: 500, reasoning: 4 },
  };
  assert.equal(watchdog.observe(first), null);
  assert.equal(watchdog.observe(first), null, "duplicate turn ID must not recharge the cap");
  const trip = watchdog.observe({
    id: "turn-2",
    completedAt: "2026-08-21T12:00:12.000Z",
    usage: { input: 55, output: 5, cacheRead: 9000, cacheWrite: 7000, reasoning: 2 },
  });
  assert.deepEqual(trip, {
    type: "token-cap-exhausted",
    capFamily: "gpt-frontier",
    milestone: "M2",
    status: "capability-failure",
    tokenCap: 100,
    actualTokens: 110,
    observedAt: "2026-08-21T12:00:12.000Z",
    charging: {
      chargedWallSeconds: 12,
      chargedTokens: 100,
      flags: ["capped-tokens"],
    },
  });
  watchdog.observe({
    id: "turn-3",
    completedAt: "2026-08-21T12:00:13.000Z",
    usage: { input: 100, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  });
  assert.equal(trips.length, 1);

  const advisory = new TokenCapWatchdog();
  assert.deepEqual(advisory.arm({
    capFamily: "kimi-advisory",
    milestone: "M1",
    tokenCap: null,
  }), {
    armed: false,
    reason: "cap-advisory-family",
    capFamily: "kimi-advisory",
    milestone: "M1",
  });
});
