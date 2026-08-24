import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  adaptClaudeSession,
  adaptClaudeSessionTree,
} from "../adapters/claude-session.mjs";
import {
  adaptCodexSession,
  adaptCodexSessionTree,
  CODEX_0149_ZERO_DELTA_RULE,
  CODEX_ADAPTER_VERSION,
} from "../adapters/codex-session.mjs";
import { adaptUnavailableFamily } from "../adapters/unavailable.mjs";
import {
  mergeBoundaryMaps,
  normalizeBoundaryMap,
  readReceiptBoundaryFiles,
} from "../boundaries.mjs";
import { joinUsageToMilestones } from "../joiner.mjs";
import { recoverCodexSignalSettlements } from "../codex-native-evidence.mjs";
import { parseJsonLines } from "../jsonl.mjs";
import {
  applyR2DriverV1TerminalCompatibility,
  loadMeteringManifest,
  R2_DRIVER_V1_TERMINAL_RULE,
} from "../manifest.mjs";
import {
  loadLaneControllerConfig,
  R2LaneController,
} from "../lane-controller.mjs";
import {
  admissionIdentity,
  createAdmissionArtifact,
  inspectCommittedSeriality,
  verifyAdmissionArtifact,
} from "../r2-cell-admission.mjs";
import {
  OBSERVABILITY_BLOCKS,
  OBSERVATION_VERSION,
  ObservationWriter,
  LaneObservationHarness,
  parseObservationJsonLines,
  projectMilestoneObservability,
  scorecardEligibility,
} from "../observations.mjs";
import { assertTokenCounts, capTokenCount } from "../counts.mjs";
import {
  TokenCapEnforcedError,
  TokenMeteringReconciliationError,
  TokenCapWatchdog,
} from "../watchdog.mjs";
import { validateJsonSchema } from "../../../lib/json-schema.mjs";
import { validateMachineRecord } from "../../../lib/record-loader.mjs";
import {
  validateSocialMessengerRecordSemantics,
  validateSocialMessengerRunRecord,
} from "../../record-validator.mjs";
import { validateDryRunEvidence } from "../../../../runs/2026-08-23-r2-published-0125/validate-dry-run-evidence.mjs";

const execFileAsync = promisify(execFile);
const FIXTURES = new URL("./fixtures/", import.meta.url);
const ROOT = new URL("../../../../../", import.meta.url);
const meterPath = fileURLToPath(new URL("../meter.mjs", import.meta.url));
const extensionSchema = JSON.parse(await readFile(
  new URL("benchmarks/schema/social-messenger/run-record-extension.schema.json", ROOT),
  "utf8",
));
const baseSchema = JSON.parse(await readFile(
  new URL("benchmarks/schema/run-record.schema.json", ROOT),
  "utf8",
));
const composedSchema = JSON.parse(await readFile(
  new URL("benchmarks/schema/social-messenger/run-record.schema.json", ROOT),
  "utf8",
));

function assertSchema(schema, value, schemas = []) {
  assert.deepEqual(validateJsonSchema(schema, value, { schemas }), []);
}

function assertExtensionDefinition(name, value) {
  assertSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://snapback.dev/benchmarks/test/${name}.schema.json`,
    $ref: `${extensionSchema.$id}#/$defs/${name}`,
  }, value, [extensionSchema]);
}

async function fixtureText(name) {
  return readFile(new URL(name, FIXTURES), "utf8");
}

async function fixtureJson(name) {
  return JSON.parse(await fixtureText(name));
}

function counts(input, output, cacheRead = 0, cacheWrite = 0, reasoning = 0) {
  return { input, output, cacheRead, cacheWrite, reasoning };
}

function nullCounts() {
  return counts(null, null, null, null, null);
}

function sha256(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function immediateController(id = "fixture-enforcer") {
  return {
    id,
    terminate: async (trip) => ({
      acknowledged: true,
      acknowledgedAt: trip.observedAt,
      evidence: `terminated:${trip.milestone}`,
    }),
  };
}

test("Claude native usage joins exact terminal prefixes into milestone phases", async () => {
  const channel = adaptClaudeSession(parseJsonLines(
    await fixtureText("claude-session.jsonl"),
    "claude fixture",
  ));
  assert.equal(channel.turns.length, 5, "duplicate message IDs must count once");

  const receiptBoundaries = await readReceiptBoundaryFiles([
    new URL("receipts-m1.jsonl", FIXTURES),
    new URL("receipts-m2.jsonl", FIXTURES),
  ]);
  assert.equal(
    receiptBoundaries.M1.suitePassAt,
    "2026-08-21T10:01:30.000Z",
    "the real segment-summary suite.pass stamps suitePassAt",
  );
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
  assert.equal(result.capAdjudicationEligible, true);
  assert.deepEqual(result.executionOrder, ["M1", "M2"]);
  assert.deepEqual(result.milestones.M1.authoring.tokens, counts(200, 40, 270, 20, 10));
  assert.deepEqual(result.boundarySnapshots.M1.tokens, result.milestones.M1.authoring.tokens);
  assert.deepEqual(result.milestones.M2.authoring.tokens, counts(50, 12, 270, 10, 3));
  assert.deepEqual(result.totals, counts(250, 52, 540, 30, 13));
  assert.deepEqual(result.firstProductEdit, {
    at: "2026-08-21T10:00:30.000Z",
    orientationBytes: 12103,
    selectedSkills: ["snapback-authoring", "llp-orient"],
    orientationTokens: counts(100, 10, 50, 20, 2),
  });
  for (const milestone of Object.values(result.milestones)) {
    assertExtensionDefinition("tokenCounts", milestone.authoring.tokens);
    for (const block of OBSERVABILITY_BLOCKS) {
      if (block === "browserAssertionWait") {
        for (const owner of ["suite", "choreography"]) {
          assert.equal(milestone[block][owner].claimed, false);
          assert.match(milestone[block][owner].reason, /unavailable/u);
        }
        continue;
      }
      assert.equal(milestone[block].claimed, false, `${block} must be an explicit non-claim`);
      assert.match(milestone[block].reason, /unavailable/u);
    }
  }
  assert.equal(result.efficiencyScorecardEligibility.eligible, false);
  assert.equal(result.efficiencyScorecardEligibility.correctionActionTargetEligible, false);
  assertExtensionDefinition("firstProductEditSnapshot", result.firstProductEdit);
});

test("failed, green, and final aborted milestones each retain their own tokens", async () => {
  const channel = {
    source: "claude-code-session-usage",
    unavailableReason: null,
    turns: [
      { id: "m1-turn", completedAt: "2026-08-21T13:00:30.000Z", usage: counts(80, 20) },
      { id: "m2-turn", completedAt: "2026-08-21T13:01:30.000Z", usage: counts(40, 10) },
      { id: "m3-turn", completedAt: "2026-08-21T13:02:30.000Z", usage: counts(20, 5) },
    ],
  };
  const result = joinUsageToMilestones({
    channel,
    boundaries: await fixtureJson("non-green-boundaries.json"),
  });
  assert.deepEqual(result.executionOrder, ["M1", "M2", "M3"]);
  assert.equal(result.milestones.M1.status, "capability-failure");
  assert.deepEqual(result.milestones.M1.authoring.tokens, counts(80, 20));
  assert.equal(result.milestones.M1.authoring.firstGreenAt, null);
  assert.equal(result.milestones.M2.status, "green");
  assert.deepEqual(result.milestones.M2.authoring.tokens, counts(40, 10));
  assert.equal(result.milestones.M3.status, "aborted");
  assert.deepEqual(result.milestones.M3.authoring.tokens, counts(20, 5));
  assert.equal(result.milestones.M3.authoring.firstGreenAt, null);
  assert.deepEqual(result.totals, counts(140, 35));
});

test("usage after the final terminal boundary fails closed instead of disappearing", async () => {
  await assert.rejects(async () => joinUsageToMilestones({
    channel: await fixtureJson("post-terminal-channel.json"),
    boundaries: {
      M1: {
        status: "aborted",
        firstGreenAt: null,
        suitePassAt: null,
        choreoPassAt: null,
        terminalAt: "2026-08-21T13:01:00.000Z",
        terminalSequence: 1,
        terminalReason: "abort",
      },
    },
    maxClockSkewMs: 100,
  }), /completes after the final M1 usage settlement/u);
});

test("recorded clock-skew bounds reject ambiguous timestamp joins", async () => {
  assert.throws(() => joinUsageToMilestones({
    channel: {
      source: "claude-code-session-usage",
      turns: [{
        id: "near-boundary",
        completedAt: "2026-08-21T13:00:59.950Z",
        usage: counts(1, 1),
      }],
    },
    boundaries: {
      M1: {
        status: "capability-failure",
        firstGreenAt: null,
        suitePassAt: null,
        choreoPassAt: null,
        terminalAt: "2026-08-21T13:01:00.000Z",
        terminalSequence: 1,
        terminalReason: "token-cap",
      },
    },
    maxClockSkewMs: 100,
  }), /within the recorded 100ms clock-skew bound/u);
});

test("Codex adapter differences every session's cumulative counters", async () => {
  const records = parseJsonLines(await fixtureText("codex-rollout.jsonl"), "codex fixture");
  const channel = adaptCodexSession(records);
  assert.equal(channel.source, "codex-rollout-token-count");
  assert.equal(channel.turns.length, 3, "repeated cumulative snapshots must not create turns");
  assert.deepEqual(channel.turns.map((turn) => turn.usage), [
    counts(60, 30, 120, 20, 10),
    counts(90, 20, 180, 30, 5),
    counts(150, 30, 200, 50, 5),
  ]);
  const tree = adaptCodexSessionTree([
    { sourceId: "builder", nativeSessionId: "codex-parent", records },
    { sourceId: "descendant", nativeSessionId: "codex-child", records },
  ]);
  assert.equal(tree.turns.length, 6, "builder and descendant counters are both charged");
  assert.equal(tree.turns.reduce((sum, turn) => sum + turn.usage.output, 0), 160);

  const truncated = structuredClone(records);
  truncated[2].payload.info.last_token_usage.output_tokens += 1;
  truncated[2].payload.info.last_token_usage.total_tokens += 1;
  assert.throws(
    () => adaptCodexSession(truncated),
    /cumulative delta does not equal last_token_usage/u,
  );
});

test("Codex 0.149 unchanged cumulative snapshot ignores only its malformed advisory total", async () => {
  const fixture = await fixtureText("real-codex-0149-zero-delta.jsonl");
  const lines = fixture.trimEnd().split("\n");
  assert.equal(
    sha256(lines.at(-1)),
    "sha256:144d9413f662621e63bdd63f622b0da791d31c30ef63befe53b2f604a7489254",
    "the malformed token_count line must retain the exact retained bytes",
  );
  const records = parseJsonLines(fixture, "retained Codex 0.149 zero-delta fixture");
  const retainedSession = {
    sourceId: "builder",
    nativeSessionId: "01a03304-e4e2-71d0-892e-bf0440eac5b2",
    records,
  };
  const channel = adaptCodexSessionTree([retainedSession]);
  assert.equal(channel.adapterVersion, CODEX_ADAPTER_VERSION);
  assert.equal(channel.turns.length, 111, "the repeated cumulative snapshot cannot create a turn");
  assert.deepEqual(channel.compatibilityEvents, [{
    ruleId: CODEX_0149_ZERO_DELTA_RULE,
    sourceId: "builder",
    nativeSessionId: "01a03304-e4e2-71d0-892e-bf0440eac5b2",
    recordIndex: 113,
    recordedAt: "2026-08-24T09:38:08.701Z",
    nativeCliVersion: "0.149.0",
    cumulativeUnchanged: true,
    ignoredLastTokenUsage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 15_283,
    },
  }]);

  const joined = joinUsageToMilestones({
    channel,
    boundaries: {
      M1: {
        status: "aborted",
        firstGreenAt: null,
        suitePassAt: null,
        choreoPassAt: null,
        terminalAt: "2026-08-24T09:38:09.000Z",
        terminalSequence: 1,
        terminalReason: "abort",
      },
    },
  });
  assert.deepEqual(joined.totals, counts(321_961, 64_301, 15_223_040, 0, 20_864));
  assert.deepEqual(joined.milestones.M1.authoring.tokens, joined.totals);

  const advancing = structuredClone(records);
  const advancingUsage = advancing.at(-1).payload.info.total_token_usage;
  advancingUsage.input_tokens += 1;
  advancingUsage.total_tokens += 1;
  assert.throws(
    () => adaptCodexSessionTree([{ ...retainedSession, records: advancing }]),
    /last_token_usage\.total_tokens does not equal input_tokens \+ output_tokens/u,
    "the 0.149 rule must not excuse malformed last usage when cumulative usage advances",
  );

  const wrongVersion = structuredClone(records);
  wrongVersion[0].payload.cli_version = "0.148.0";
  assert.throws(
    () => adaptCodexSessionTree([{ ...retainedSession, records: wrongVersion }]),
    /last_token_usage\.total_tokens does not equal input_tokens \+ output_tokens/u,
    "the compatibility rule must stay tied to the observed 0.149.0 native shape",
  );
});

test("Codex preserves an absent optional reasoning counter as null", () => {
  const channel = adaptCodexSession([{
    timestamp: "2026-08-24T11:00:00.000Z",
    type: "session_meta",
    payload: { id: "optional-reasoning", cli_version: "0.149.0" },
  }, {
    timestamp: "2026-08-24T11:00:01.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 12,
          cached_input_tokens: 2,
          cache_write_input_tokens: 0,
          output_tokens: 3,
          total_tokens: 15,
        },
        last_token_usage: {
          input_tokens: 12,
          cached_input_tokens: 2,
          cache_write_input_tokens: 0,
          output_tokens: 3,
          total_tokens: 15,
        },
      },
    },
  }]);
  assert.equal(channel.turns[0].usage.reasoning, null);
});

test("optional null cache and reasoning orientation counters preserve measured orientation evidence", () => {
  const joined = joinUsageToMilestones({
    channel: {
      source: "synthetic-native",
      turns: [{
        id: "orientation-turn",
        completedAt: "2026-08-24T11:00:10.000Z",
        usage: { input: 12, output: 3, cacheRead: null, cacheWrite: null, reasoning: null },
      }],
    },
    boundaries: {
      M1: {
        status: "green",
        firstGreenAt: "2026-08-24T11:00:20.000Z",
        suitePassAt: "2026-08-24T11:00:20.000Z",
        choreoPassAt: "2026-08-24T11:00:20.000Z",
        terminalAt: "2026-08-24T11:00:20.000Z",
        terminalSequence: 1,
        terminalReason: "green",
      },
    },
    firstProductEdit: {
      at: "2026-08-24T11:00:10.000Z",
      orientationBytes: 42,
      selectedSkills: [],
    },
  });
  assert.equal(
    joined.efficiencyScorecardEligibility.ineligibilityReasons.includes(
      "orientation-evidence-unavailable",
    ),
    false,
  );
});

test("retained R2 Codex ordering settles signal usage without stealing the next milestone", async () => {
  const cellRoot = new URL(
    "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-explicit/",
    ROOT,
  );
  const manifestText = await readFile(new URL("metering-manifest.json", cellRoot), "utf8");
  const manifest = JSON.parse(manifestText);
  const boundaryValue = JSON.parse(await readFile(
    new URL("terminal-boundaries.json", cellRoot),
    "utf8",
  ));
  const rolloutText = await readFile(new URL("events/codex-rollout.jsonl", cellRoot), "utf8");
  assert.equal(
    sha256(rolloutText),
    "sha256:f9838d32f9f1357eb40ed7661d350cc9e341431ab0fcc3df0dc6e280e2035c0d",
    "the exact retained native fixture bytes must not change",
  );
  const records = parseJsonLines(rolloutText, "retained R2 Codex rollout");
  for (const [ordinal, at, type] of [
    [222, "2026-08-24T09:12:14.377Z", "item_completed"],
    [1229, "2026-08-24T09:54:54.149Z", "item_completed"],
    [1231, "2026-08-24T09:54:54.157Z", "token_count"],
    [1413, "2026-08-24T10:02:30.901Z", "item_completed"],
    [1415, "2026-08-24T10:02:30.911Z", "token_count"],
    [1557, "2026-08-24T10:10:14.089Z", "item_completed"],
    [1564, "2026-08-24T10:10:21.856Z", "token_count"],
    [1565, "2026-08-24T10:10:21.954Z", "task_complete"],
  ]) {
    assert.equal(records[ordinal].ordinal, ordinal);
    assert.equal(records[ordinal].timestamp, at);
    assert.equal(records[ordinal].payload.type, type);
  }
  assert.equal(records[222].payload.item.type, "FileChange");
  assert.deepEqual(
    Object.keys(records[222].payload.item.changes).map((path) => path.split("/").at(-1)),
    ["package.json"],
  );
  const observationEvents = [];
  for (const source of manifest.observations) {
    const events = parseObservationJsonLines(
      await readFile(new URL(source.path, cellRoot), "utf8"),
      source.path,
    );
    observationEvents.push(...events.map((event) => ({
      ...event,
      evidenceSourceId: source.sourceId,
    })));
  }
  const result = applyR2DriverV1TerminalCompatibility({
    manifest,
    boundaryValue,
    observationEvents,
    clockCorrelation: manifest.clockCorrelation,
    loadedSessions: [{
      ...manifest.sessions[0],
      records,
      nativeCliVersion: "0.149.0",
      resolvedSha256: manifest.sessions[0].sha256,
    }],
  });

  assert.equal(
    boundaryValue.milestones.M1.terminalAt,
    "2026-08-24T09:54:04.184Z",
    "the immutable original boundary remains unchanged",
  );
  assert.deepEqual(
    Object.values(result.boundaryValue.milestones).map((boundary) => boundary.terminalAt),
    [
      "2026-08-24T09:54:04.184Z",
      "2026-08-24T10:01:49.197Z",
      "2026-08-24T10:05:46.005Z",
    ],
  );
  assert.equal(result.clockCorrelation.maxSkewMillis, 0);
  assert.deepEqual(
    result.compatibilityEvents[0].usageSettlements.map((adjustment) => ({
      milestone: adjustment.milestone,
      signalRecordOrdinal: adjustment.signalRecordOrdinal,
      usageRecordOrdinal: adjustment.usageRecordOrdinal,
      usageSettledAt: adjustment.usageSettledAt,
      settlementKind: adjustment.settlementKind,
    })),
    [
      { milestone: "M1", signalRecordOrdinal: 1229, usageRecordOrdinal: 1231, usageSettledAt: "2026-08-24T09:54:54.157Z", settlementKind: "signal-turn-token-count" },
      { milestone: "M2", signalRecordOrdinal: 1413, usageRecordOrdinal: 1415, usageSettledAt: "2026-08-24T10:02:30.911Z", settlementKind: "signal-turn-token-count" },
      { milestone: "M3", signalRecordOrdinal: 1557, usageRecordOrdinal: 1564, usageSettledAt: "2026-08-24T10:10:21.856Z", settlementKind: "final-native-token-count" },
    ],
  );
  assert.equal(result.compatibilityEvents[0].ruleId, R2_DRIVER_V1_TERMINAL_RULE);
  assert.deepEqual(
    result.compatibilityEvents[0].observationHandoffExclusions.map((event) => event.sequence),
    [209, 244],
  );
  assert.deepEqual(
    result.compatibilityEvents[0].usageSettlements.map((event) => event.usageSettledAt),
    [
      "2026-08-24T09:54:54.157Z",
      "2026-08-24T10:02:30.911Z",
      "2026-08-24T10:10:21.856Z",
    ],
  );

  const joined = joinUsageToMilestones({
    channel: adaptCodexSessionTree([{
      sourceId: "builder",
      nativeSessionId: manifest.sessions[0].nativeSessionId,
      records,
    }]),
    boundaries: result.boundaryValue,
    usageSettlements: result.usageSettlements,
    firstProductEdit: null,
    wallClockOrigin: manifest.driver.startedAt,
  });
  assert.deepEqual(joined.milestones.M1.authoring.tokens, counts(544_314, 103_534, 24_087_808, 0, 29_142));
  assert.deepEqual(joined.milestones.M2.authoring.tokens, counts(50_096, 7_770, 5_335_296, 0, 2_314));
  assert.deepEqual(joined.milestones.M3.authoring.tokens, counts(62_057, 13_299, 4_985_856, 0, 4_668));
  assert.deepEqual(joined.totals, counts(656_467, 124_603, 34_408_960, 0, 36_124));

  const unversioned = applyR2DriverV1TerminalCompatibility({
    manifest: { driver: { id: "some-other-driver" } },
    boundaryValue,
    observationEvents,
    clockCorrelation: manifest.clockCorrelation,
  });
  assert.equal(unversioned.boundaryValue, boundaryValue);
  assert.deepEqual(unversioned.compatibilityEvents, []);
});

test("closed Codex failure without a later native token_count is explicitly unavailable", () => {
  const records = [{
    ordinal: 0,
    timestamp: "2026-08-24T12:00:01.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: { input_tokens: 10 } },
    },
  }];
  const boundaryValue = {
    M1: {
      status: "aborted",
      firstGreenAt: null,
      suitePassAt: null,
      choreoPassAt: null,
      terminalAt: "2026-08-24T12:00:02.000Z",
      terminalSequence: 1,
      terminalReason: "abort",
    },
  };
  assert.throws(
    () => recoverCodexSignalSettlements({ records, boundaryValue }),
    /successful M1 signal|task_complete/u,
  );
  const recovered = recoverCodexSignalSettlements({
    records,
    boundaryValue,
    streamClosedAt: "2026-08-24T12:00:03.000Z",
  });
  assert.deepEqual(recovered.usageSettlements[0], {
    milestone: "M1",
    originalTerminalAt: "2026-08-24T12:00:02.000Z",
    signalItemId: null,
    signalCompletedAt: "2026-08-24T12:00:03.000Z",
    signalRecordOrdinal: null,
    usageSettledAt: null,
    usageRecordOrdinal: null,
    usageAvailable: false,
    settlementKind: "closed-failure-native-usage-unavailable",
  });
  const joined = joinUsageToMilestones({
    channel: {
      source: "synthetic",
      turns: [{ id: "prior", completedAt: records[0].timestamp, usage: counts(10, 0) }],
    },
    boundaries: boundaryValue,
    usageSettlements: recovered.usageSettlements,
  });
  assert.deepEqual(joined.milestones.M1.authoring.tokens, nullCounts());
  assert.equal(joined.capAdjudicationEligible, false);
  assert.match(joined.unavailableReason, /m1/u);
});

test("retained real Codex parent and subagent deltas checksum and aggregate independently", async () => {
  const parent = parseJsonLines(
    await fixtureText("real-codex-tree-parent.jsonl"),
    "retained Codex parent fixture",
  );
  const subagent = parseJsonLines(
    await fixtureText("real-codex-tree-subagent.jsonl"),
    "retained Codex subagent fixture",
  );
  const tree = adaptCodexSessionTree([
    {
      sourceId: "builder",
      nativeSessionId: "01a0245d-2323-7890-a982-00ab78bad604",
      records: parent,
    },
    {
      sourceId: "builder-descendant-01a024a3",
      nativeSessionId: "01a024a3-90b2-7503-bbc7-b034b0522e98",
      records: subagent,
    },
  ]);
  assert.equal(tree.turns.length, 6);
  assert.equal(
    tree.turns.filter((turn) => turn.sourceId === "builder-descendant-01a024a3").length,
    3,
  );
  assert.equal(tree.turns.reduce((sum, turn) => sum + turn.usage.input, 0), 60_722);
  assert.equal(tree.turns.reduce((sum, turn) => sum + turn.usage.output, 0), 2_099);
});

test("retained real Claude descendant tree is hash-bound and fully aggregated", async () => {
  const manifestPath = fileURLToPath(new URL("real-claude-tree-manifest.json", FIXTURES));
  const input = await loadMeteringManifest(manifestPath);
  assert.equal(input.channel.turns.length, 14);
  const descendantTurns = input.channel.turns.filter(
    (turn) => turn.sourceId === "builder-descendant-af165d69f7468e749",
  );
  assert.equal(descendantTurns.length, 12);
  assert.equal(descendantTurns.reduce((sum, turn) => sum + turn.usage.output, 0), 21_496);
  const result = joinUsageToMilestones(input);
  assert.equal(result.totals.output, 21_997);
  assert.equal(result.meteringProvenance.sessions.length, 2);
  assert.equal(result.meteringProvenance.receipts[0].runId, "retained-claude-m1-receipt");
  assertSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://snapback.dev/benchmarks/test/metering-provenance.schema.json",
    $ref: `${extensionSchema.$id}#/properties/meteringProvenance`,
  }, result.meteringProvenance, [extensionSchema]);

  const { stdout } = await execFileAsync(process.execPath, [
    meterPath,
    "--manifest",
    manifestPath,
  ]);
  const cliResult = JSON.parse(stdout);
  assert.equal(cliResult.totals.output, 21_997);
  assert.equal(cliResult.meteringProvenance.sessions[1].role, "builder-descendant");
});

test("lane manifest rejects source-hash and receipt-identity mismatches", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "snapback-metering-manifest-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactNames = [
    "real-claude-tree-parent.jsonl",
    "real-claude-tree-descendant.jsonl",
    "real-claude-tree-boundaries.json",
    "real-claude-tree-receipt.jsonl",
  ];
  for (const name of artifactNames) {
    await copyFile(new URL(name, FIXTURES), join(directory, name));
  }
  const manifest = await fixtureJson("real-claude-tree-manifest.json");

  const badHash = structuredClone(manifest);
  badHash.sessions[0].sha256 = `sha256:${"0".repeat(64)}`;
  const badHashPath = join(directory, "bad-hash.json");
  await writeFile(badHashPath, `${JSON.stringify(badHash)}\n`);
  await assert.rejects(loadMeteringManifest(badHashPath), /digest mismatch/u);

  const badReceipt = structuredClone(manifest);
  badReceipt.receipts[0].runId = "wrong-receipt-run";
  const badReceiptPath = join(directory, "bad-receipt.json");
  await writeFile(badReceiptPath, `${JSON.stringify(badReceipt)}\n`);
  await assert.rejects(loadMeteringManifest(badReceiptPath), /does not belong to runId/u);

  const nonGreenReceiptText = await fixtureText("non-green-receipt.jsonl");
  await writeFile(join(directory, "non-green-receipt.jsonl"), nonGreenReceiptText);
  const nonGreenReceipt = structuredClone(manifest);
  nonGreenReceipt.receipts[0].path = "non-green-receipt.jsonl";
  nonGreenReceipt.receipts[0].sha256 = sha256(nonGreenReceiptText);
  const nonGreenReceiptPath = join(directory, "non-green-receipt-manifest.json");
  await writeFile(nonGreenReceiptPath, `${JSON.stringify(nonGreenReceipt)}\n`);
  await assert.rejects(
    loadMeteringManifest(nonGreenReceiptPath),
    /conflicts with its non-green hash-bound receipt/u,
  );
});

test("meter binds suite-status bytes to receipts at record-write time", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "snapback-suite-binding-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const r2HarnessPath = join(directory, "harness-config.json");
  const r2Harness = {
    schemaVersion: "snapback.r2-harness-config.v1",
    runId: "r2-fixture",
    pins: { instrument: { instrumentPin: "social-messenger@0.3.3-m8" } },
    harnesses: { fixture: { binary: process.execPath } },
    paths: { privateExecutionRoot: directory },
    execution: {
      milestones: ["M1", "M2"],
      loadIsolation: {
        sampleEverySeconds: 60,
        ceilingInclusive: { loadavg1: 10, loadavg5: 10, loadavg15: 10 },
      },
    },
    cells: [{ id: "fixture-cell", harness: "fixture" }],
  };
  await writeFile(r2HarnessPath, `${JSON.stringify(r2Harness)}\n`);
  const loadedControllerConfig = await loadLaneControllerConfig({
    harnessConfigPath: r2HarnessPath,
    cellId: "fixture-cell",
  });
  assert.equal(loadedControllerConfig.config.laneRunId, "r2-fixture/fixture-cell");
  assert.equal(loadedControllerConfig.config.loadIntervalMs, 60_000);
  r2Harness.pins.instrument.instrumentPin = "social-messenger@0.3.2-m8";
  await writeFile(r2HarnessPath, `${JSON.stringify(r2Harness)}\n`);
  await assert.rejects(
    loadLaneControllerConfig({
      harnessConfigPath: r2HarnessPath,
      cellId: "fixture-cell",
    }),
    /must pin social-messenger@0\.3\.3-m8/u,
  );

  for (const name of ["boundaries.json", "first-product-edit.json"]) {
    await copyFile(new URL(name, FIXTURES), join(directory, name));
  }

  const statuses = {};
  const receiptArtifacts = [];
  for (const milestone of ["M1", "M2"]) {
    const segment = milestone.toLowerCase();
    const suitePath = `${segment}-suite.json`;
    const suiteText = `${JSON.stringify({ milestone, pass: true })}\n`;
    await writeFile(join(directory, suitePath), suiteText);
    statuses[segment] = { pass: true, receipt: suitePath };

    const receiptName = `receipts-${segment}.jsonl`;
    const records = parseJsonLines(await fixtureText(receiptName));
    const summary = records.find((record) => record.type === "segment-summary");
    summary.version = "0.3.3-m8";
    summary.timings[0].settlementWaitMs = 0;
    summary.suite = {
      pass: true,
      receipt: suitePath,
      receiptSha256: sha256(suiteText),
    };
    const receiptText = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
    await writeFile(join(directory, receiptName), receiptText);
    receiptArtifacts.push({
      sourceId: `${segment}-choreography`,
      runId: summary.runId,
      milestone,
      path: receiptName,
      sha256: sha256(receiptText),
    });
  }
  const suiteStatusText = `${JSON.stringify(statuses)}\n`;
  await writeFile(join(directory, "suite-status.json"), suiteStatusText);

  const observationsPath = join(directory, "driver-observations.jsonl");
  let observationAt = Date.parse("2026-08-21T10:00:40.000Z");
  const laneController = new R2LaneController({
    laneRunId: "fixture-lane-run",
    observationPath: observationsPath,
    loadCeilings: { loadavg1: 10, loadavg5: 10, loadavg15: 10 },
    loadIntervalMs: 60_000,
    loadSample: () => [1, 2, 3],
    now: () => {
      const at = new Date(observationAt).toISOString();
      observationAt += 1000;
      return at;
    },
  });
  await laneController.initialize();
  for (const milestone of ["M1", "M2"]) {
    if (milestone === "M2") observationAt = Date.parse("2026-08-21T10:01:40.000Z");
    await laneController.runMilestone(milestone, async (controls) => {
      if (milestone === "M1") {
        await controls.restart(async () => "restarted");
        await controls.apiRequest({
          provider: "fixture",
          operation: "stream-turn",
          requestId: "m1-request",
          retryOf: null,
        }, async () => "ok");
      }
      await controls.suiteAssertionWait({
        assertion: `${milestone.toLowerCase()}-suite-fixture`,
        attempt: 1,
      }, async () => ({ pass: true }));
      await laneController.writer.assertionWait(milestone, {
        owner: "choreography",
        assertion: `${milestone.toLowerCase()}-fixture`,
        attempt: 1,
        durationMs: 5,
        pass: true,
      });
      await laneController.writer.claim(milestone, "browserAssertionWait", {
        owner: "choreography",
      });
    }, {
      restartReseedClaimed: true,
      apiInterruptionsClaimed: true,
      suiteAssertionWaitClaimed: true,
    });
  }

  const manifest = await fixtureJson("unavailable-manifest.json");
  manifest.receipts = receiptArtifacts;
  manifest.observations = [];
  manifest.suiteStatus = {
    path: "suite-status.json",
    sha256: sha256(suiteStatusText),
  };
  const manifestPath = join(directory, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);

  const joined = await laneController.writeRecordPatch({
    manifestPath,
    outPath: join(directory, "metering.json"),
  });
  const loaded = await loadMeteringManifest(manifestPath);
  assert.equal(loaded.suiteStatusLinkage.milestones.length, 2);
  assert.equal(
    loaded.suiteStatusLinkage.milestones[0].receipt.sha256,
    sha256(`${JSON.stringify({ milestone: "M1", pass: true })}\n`),
  );
  assert.equal(joined.suiteStatusLinkage.milestones[0].pass, true);
  assert.equal(joined.instrumentVersion, "social-messenger@0.3.3-m8");
  assert.equal(joined.milestones.M1.hostLoad.claimed, true);
  assert.equal(joined.milestones.M1.restartReseed.restarts, 1);
  assert.equal(joined.milestones.M1.browserAssertionWait.choreography.attempts, 1);
  assert.equal(joined.milestones.M1.browserAssertionWait.suite.attempts, 1);
  assert.equal(joined.milestones.M1.semanticActions.claimed, false);
  assert.equal(joined.efficiencyScorecardEligibility.correctionActionTargetEligible, false);

  await writeFile(join(directory, "m1-suite.json"), "{\"tampered\":true}\n");
  await assert.rejects(
    loadMeteringManifest(manifestPath),
    /receipt changed after choreography refusal-check time/u,
  );
});

test("lane observation harness samples load and records lifecycle and API retries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lane-observation-harness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "driver-observations.jsonl");
  let tick = 0;
  const writer = new ObservationWriter({
    path,
    laneRunId: "observed-lane",
    now: () => new Date(Date.parse("2026-08-21T12:00:00.000Z") + tick++ * 10).toISOString(),
  });
  await writer.initialize();
  const harness = new LaneObservationHarness({
    writer,
    loadCeilings: { loadavg1: 10, loadavg5: 10, loadavg15: 10 },
    loadIntervalMs: 2,
    loadSample: () => [11, 2, 3],
  });
  await harness.startMilestone("M1", {
    restartReseedClaimed: true,
    apiInterruptionsClaimed: true,
    suiteAssertionWaitClaimed: true,
  });
  await assert.rejects(writer.semanticAction("M1", {
    actionId: "invalid-retry",
    actionClass: "retry",
    disposition: "correction",
    episodeId: "invalid-episode",
    retriedClass: null,
    binaryExcavation: false,
  }), /retriedClass must name the failed class/u);
  await assert.rejects(writer.recoveryEpisode("M1", {
    episodeId: "invalid-episode",
    carrier: "other",
    attribution: "snapback-defect",
    subAttribution: null,
    outcome: "recovered",
    recoveredAt: "2026-08-21T12:00:01.000Z",
    actionCount: 1,
  }), /subAttribution is required/u);
  await assert.rejects(writer.recoveryEpisode("M1", {
    episodeId: "too-short-episode",
    carrier: "other",
    attribution: "snapback-defect",
    subAttribution: "defect",
    outcome: "recovered",
    recoveredAt: "2026-08-21T12:00:01.000Z",
    actionCount: 1,
  }), /integer >= 2/u);
  await assert.rejects(writer.record("M1", "lifecycle", {
    operation: "restart",
    destructive: false,
    invented: true,
  }), /unknown field/u);
  await harness.restart("M1");
  await harness.reseed("M1", { destructive: true });
  await assert.rejects(
    harness.apiRequest("M1", {
      provider: "fixture",
      operation: "stream-turn",
      requestId: "request-1",
      retryOf: null,
    }, async () => { throw new Error("stream interrupted"); }),
    /stream interrupted/u,
  );
  assert.equal(await harness.apiRequest("M1", {
    provider: "fixture",
    operation: "stream-turn",
    requestId: "request-2",
    retryOf: "request-1",
  }, async () => "recovered"), "recovered");
  await harness.suiteAssertionWait("M1", {
    assertion: "suite-settlement",
    attempt: 1,
  }, async () => {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2));
    return { pass: true };
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 8));
  await harness.finishMilestone("M1");

  const events = parseObservationJsonLines(await readFile(path, "utf8"));
  const projection = projectMilestoneObservability({
    events,
    evidence: [await retainedArtifact(root, "driver-observations.jsonl")],
    milestone: "M1",
  });
  assert.equal(projection.hostLoad.claimed, true);
  assert.ok(projection.hostLoad.sampleCount >= 2);
  assert.equal(projection.hostLoad.contamination, true);
  assert.deepEqual(projection.restartReseed, {
    claimed: true,
    evidence: [await retainedArtifact(root, "driver-observations.jsonl")],
    restarts: 1,
    reseeds: 1,
    destructiveReseeds: 1,
  });
  assert.equal(projection.apiInterruptions.interrupted, true);
  assert.equal(projection.apiInterruptions.windows[0].failedRequests, 1);
  assert.ok(projection.apiInterruptions.windows[0].recoveredAt);
  assert.equal(projection.semanticActions.claimed, false);
  assert.equal(projection.failureToRecoveryEpisodes.claimed, false);
  assert.equal(projection.browserAssertionWait.suite.claimed, true);
  assert.equal(projection.browserAssertionWait.suite.attempts, 1);
  assert.ok(projection.browserAssertionWait.suite.waitMillis > 0);
  assert.equal(projection.browserAssertionWait.choreography.claimed, false);

  const productionPath = join(root, "production-controller.jsonl");
  const controller = new R2LaneController({
    laneRunId: "production-lane",
    observationPath: productionPath,
    loadCeilings: { loadavg1: 10, loadavg5: 10, loadavg15: 10 },
    loadIntervalMs: 2,
    loadSample: () => [1, 2, 3],
  });
  await controller.initialize();
  await controller.runMilestone("M2", async (controls) => {
    await controls.restart(async () => "restarted");
    await controls.reseed({ destructive: false }, async () => "reseeded");
    await controls.apiRequest({
      provider: "fixture",
      operation: "stream-turn",
      requestId: "production-request",
      retryOf: null,
    }, async () => "ok");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 4));
    await controls.suiteAssertionWait({
      assertion: "production-suite-settlement",
      attempt: 1,
    }, async () => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2));
      return { pass: true };
    });
  }, {
    restartReseedClaimed: true,
    apiInterruptionsClaimed: true,
    suiteAssertionWaitClaimed: true,
  });
  const productionEvents = parseObservationJsonLines(await readFile(productionPath, "utf8"));
  const productionProjection = projectMilestoneObservability({
    events: productionEvents,
    evidence: [await retainedArtifact(root, "production-controller.jsonl")],
    milestone: "M2",
  });
  assert.ok(productionProjection.hostLoad.sampleCount >= 2);
  assert.equal(productionProjection.restartReseed.restarts, 1);
  assert.equal(productionProjection.restartReseed.reseeds, 1);
  assert.equal(productionProjection.apiInterruptions.interrupted, false);
  assert.equal(productionProjection.browserAssertionWait.suite.attempts, 1);
});

test("Claude message identity de-duplicates globally across declared sources", () => {
  const record = {
    timestamp: "2026-08-21T14:00:00.000Z",
    message: {
      id: "globally-shared",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  };
  const tree = adaptClaudeSessionTree([
    { sourceId: "builder", records: [record] },
    { sourceId: "descendant", records: [record] },
  ]);
  assert.equal(tree.turns.length, 1);
  assert.equal(tree.deduplicatedRecords, 1);
});

test("unavailable mode emits honest null totals and phases for every cap family", async () => {
  for (const family of [
    "claude-frontier",
    "gpt-frontier",
    "mid-tier",
    "kimi-advisory",
    "grok-advisory",
  ]) {
    const result = joinUsageToMilestones({
      channel: adaptUnavailableFamily(family, "retained-session-stream-missing"),
      boundaries: normalizeBoundaryMap(await fixtureJson("boundaries.json")),
      firstProductEdit: await fixtureJson("first-product-edit.json"),
    });
    assert.equal(result.available, false);
    assert.equal(result.capAdjudicationEligible, false);
    assert.equal(result.source, null);
    assert.equal(result.unavailableReason, "retained-session-stream-missing");
    assert.deepEqual(result.totals, nullCounts());
    assert.deepEqual(result.milestones.M1.authoring.tokens, nullCounts());
    assert.deepEqual(result.firstProductEdit.orientationTokens, nullCounts());
  }
  assert.throws(
    () => adaptUnavailableFamily("gpt-frontier", "free form reason"),
    /stable lowercase kebab-case/u,
  );

  const manifestInput = await loadMeteringManifest(fileURLToPath(
    new URL("unavailable-manifest.json", FIXTURES),
  ));
  const manifestResult = joinUsageToMilestones(manifestInput);
  assert.equal(manifestResult.source, null);
  assert.equal(manifestResult.capAdjudicationEligible, false);
  assert.deepEqual(manifestResult.totals, nullCounts());
  assert.equal(manifestResult.meteringProvenance.sessions.length, 0);
});

test("watchdog requires a controller and a wall-clock origin", () => {
  assert.throws(() => new TokenCapWatchdog(), /enforcementController/u);
  const watchdog = new TokenCapWatchdog({ enforcementController: immediateController() });
  assert.throws(() => watchdog.arm({
    capFamily: "gpt-frontier",
    milestone: "M1",
    tokenCap: 100,
  }), /watchdog startedAt/u);
});

test("watchdog enforces termination before any next turn and retains overshoot", async () => {
  let acknowledge;
  const terminationRequested = new Promise((resolve) => {
    acknowledge = resolve;
  });
  let executedTurns = 0;
  const watchdog = new TokenCapWatchdog({
    enforcementController: {
      id: "deferred-process-controller",
      terminate: () => terminationRequested,
    },
  });
  watchdog.arm({
    capFamily: "gpt-frontier",
    milestone: "M2",
    tokenCap: 100,
    startedAt: "2026-08-21T12:00:00.000Z",
  });
  const modelTurn = (id, completedAt, usage) => async () => {
    executedTurns += 1;
    return { id, completedAt, usage };
  };
  await watchdog.runTurn(modelTurn("turn-1", "2026-08-21T12:00:05.000Z", counts(40, 10, 1000, 500, 4)));
  const { trip } = await watchdog.runTurn(
    modelTurn("turn-2", "2026-08-21T12:00:12.000Z", counts(55, 5, 9000, 7000, 2)),
  );
  assert.equal(trip.actualTokens, 110);
  assert.equal(trip.charging.chargedWallSeconds, 12);
  assert.equal(trip.enforcementController, "deferred-process-controller");

  const forbiddenTurn = watchdog.runTurn(
    modelTurn("turn-3", "2026-08-21T12:00:13.000Z", counts(100, 100)),
  );
  await Promise.resolve();
  assert.equal(executedTurns, 2, "the next model turn must remain gated while termination is pending");
  acknowledge({
    acknowledged: true,
    acknowledgedAt: "2026-08-21T12:00:12.100Z",
    evidence: "process-exit:fixture-42",
  });
  await assert.rejects(forbiddenTurn, (error) => (
    error instanceof TokenCapEnforcedError
    && error.code === "SOCIAL_MESSENGER_TOKEN_CAP_ENFORCED"
  ));
  assert.equal(executedTurns, 2, "no model turn may execute after the trip");

  watchdog.observe({
    id: "already-in-flight-after-trip",
    completedAt: "2026-08-21T12:00:12.050Z",
    usage: counts(20, 5),
  }, { inFlight: true });
  assert.equal(watchdog.state.actualTokens, 135);
  assert.equal(watchdog.state.overshoot.tokens, 25);
  assert.deepEqual(watchdog.state.overshoot.turns, [{
    id: "already-in-flight-after-trip",
    completedAt: "2026-08-21T12:00:12.050Z",
    tokens: 25,
  }]);
  assert.throws(() => watchdog.observe({
    id: "not-in-flight-after-trip",
    completedAt: "2026-08-21T12:00:12.060Z",
    usage: counts(1, 1),
  }), /was not attested in flight/u);
  const reconciliation = watchdog.reconcileMilestone({
    retainedTokens: 135,
    terminalAt: "2026-08-21T12:00:12.100Z",
  });
  assert.equal(reconciliation.matched, true);
});

test("watchdog turn identities remain cumulative across milestone arms", () => {
  const watchdog = new TokenCapWatchdog({ enforcementController: immediateController() });
  const first = {
    id: "lane-global-turn-1",
    completedAt: "2026-08-21T15:00:05.000Z",
    usage: counts(40, 10),
  };
  watchdog.arm({
    capFamily: "gpt-frontier",
    milestone: "M1",
    tokenCap: 1000,
    startedAt: "2026-08-21T15:00:00.000Z",
  });
  watchdog.observe(first);
  assert.equal(watchdog.state.actualTokens, 50);
  watchdog.reconcileMilestone({
    retainedTokens: 50,
    terminalAt: "2026-08-21T15:00:10.000Z",
  });
  watchdog.disarm();
  watchdog.arm({
    capFamily: "gpt-frontier",
    milestone: "M2",
    tokenCap: 1000,
    startedAt: "2026-08-21T15:01:00.000Z",
  });
  watchdog.observe(first);
  assert.equal(watchdog.state.actualTokens, 0, "rereading the cumulative log cannot recharge M1");
  watchdog.observe({
    id: "lane-global-turn-2",
    completedAt: "2026-08-21T15:01:05.000Z",
    usage: counts(20, 5),
  });
  assert.equal(watchdog.state.actualTokens, 25);
});

test("watchdog rejects late prior-milestone IDs and fails closed on retained-tree divergence", async () => {
  const watchdog = new TokenCapWatchdog({ enforcementController: immediateController() });
  watchdog.arm({
    capFamily: "gpt-frontier",
    milestone: "M2",
    tokenCap: 100,
    startedAt: "2026-08-21T15:01:00.000Z",
    maxClockSkewMs: 100,
  });
  assert.throws(() => watchdog.observe({
    id: "late-m1-descendant",
    sourceId: "builder-descendant",
    completedAt: "2026-08-21T15:00:59.899Z",
    usage: counts(40, 10),
  }), /predates M2's armed boundary/u);

  watchdog.observe({
    id: "builder-m2",
    sourceId: "builder",
    completedAt: "2026-08-21T15:01:05.000Z",
    usage: counts(40, 10),
  });
  assert.throws(() => watchdog.reconcileMilestone({
    retainedTokens: 110,
    terminalAt: "2026-08-21T15:01:10.000Z",
  }), (error) => (
    error instanceof TokenMeteringReconciliationError
    && error.code === "SOCIAL_MESSENGER_TOKEN_METERING_DIVERGED"
    && error.trip?.source === "retained-tree-reconciliation"
  ));
  assert.equal(watchdog.state.tripped, true);
  assert.equal(watchdog.state.reconciliation.deltaTokens, 60);
  await watchdog.waitForTermination();
});

test("reasoning tokens must remain an output subset while the cap stays input plus output", () => {
  assert.throws(
    () => assertTokenCounts(counts(10, 5, 0, 0, 50)),
    /reasoning must be a subset/u,
  );
  assert.equal(capTokenCount(counts(10, 5, 1000, 500, 4)), 15);
});

function milestoneRecord({ metered, sequence }) {
  const tokenUsage = metered ? counts(10, 2, 20, 0, 1) : nullCounts();
  return {
    status: "green",
    authoring: {
      wallSeconds: 12,
      tokens: tokenUsage,
      firstGreenAt: `2026-08-21T16:0${sequence}:00.000Z`,
      suitePassAt: `2026-08-21T16:0${sequence}:00.000Z`,
      choreoPassAt: `2026-08-21T16:0${sequence}:00.000Z`,
      terminalAt: `2026-08-21T16:0${sequence}:00.000Z`,
      terminalSequence: sequence,
      terminalReason: "green",
    },
    caps: {
      wallCapSeconds: 120,
      tokenCap: metered ? 1000 : null,
    },
    charging: {
      chargedWallSeconds: 12,
      chargedTokens: metered ? 12 : null,
      flags: [],
    },
  };
}

function composedRecord({ capFamily, source, metered }) {
  const basePhase = metered ? 1 : null;
  return {
    schemaVersion: 1,
    lane: "snapback",
    laneVariant: "skill",
    brief: "social-messenger",
    harness: { name: "fixture", model: "fixture", effort: null },
    timestamps: {
      startedAt: "2026-08-21T16:00:00.000Z",
      finishedAt: "2026-08-21T16:03:00.000Z",
    },
    firstGreenProofAt: "2026-08-21T16:01:00.000Z",
    wallClock: {
      totalSeconds: 180,
      phases: { orientation: 1, authoring: 177, verification: 1, diagnosis: 1 },
    },
    tokens: {
      input: metered ? 30 : null,
      output: metered ? 6 : null,
      source,
      phases: {
        orientation: basePhase,
        authoring: metered ? 33 : null,
        verification: basePhase,
        diagnosis: basePhase,
      },
    },
    toolUses: null,
    correctionLoops: [],
    handAuthoredLoc: { lines: 1, files: 1 },
    diary: "benchmarks/records/fixture.md",
    socialMessenger: {
      extensionVersion: 2,
      instrumentVersion: "social-messenger@0.3.2-m8",
      orientation: {
        schemaVersion: "benchmark-orientation.v1",
        laneKind: "snapback-web-clique",
        instrument: {
          pin: "social-messenger@fixture",
          manifest: {
            path: "instrument.manifest.json",
            sha256: "0".repeat(64),
          },
          versions: { schema: "fixture", ui: "fixture", choreography: "fixture" },
        },
        selectedSkills: ["snapback-authoring"],
        artifacts: [{
          id: "lane-agents",
          kind: "lane-packet",
          path: "AGENTS.md",
          bytes: 1,
          sha256: "1".repeat(64),
          deduplicated: false,
        }],
        uniqueBytes: 1,
        deliveredBytes: 1,
        preflightWarnings: [],
      },
      runScope: "reduced",
      capFamily,
      deploymentPosture: "local-dev-server",
      milestones: {
        M1: milestoneRecord({ metered, sequence: 1 }),
        M2: milestoneRecord({ metered, sequence: 2 }),
        M3: milestoneRecord({ metered, sequence: 3 }),
      },
      termination: { terminatedEarly: false, reason: null, afterMilestone: null },
      compaction: { policy: "fixture", events: [] },
      firstProductEdit: {
        at: null,
        orientationBytes: null,
        orientationTokens: metered ? counts(1, 0, 0, 0, 0) : nullCounts(),
        selectedSkills: [],
      },
      meteringProvenance: {
        manifestVersion: "social-messenger-metering-manifest.v1",
        laneRunId: "fixture-lane",
        driver: {
          id: "fixture-driver",
          stampedAt: "2026-08-21T16:03:01.000Z",
          startedAt: "2026-08-21T16:00:00.000Z",
        },
        manifestSha256: `sha256:${"0".repeat(64)}`,
        unavailableReason: metered ? null : "retained-session-stream-missing",
        clockCorrelation: {
          method: "rfc3339-with-bounded-skew",
          maxSkewMillis: 100,
          evidence: "fixture driver measured a 100ms cross-process skew ceiling",
        },
        sessions: metered ? [{
          sourceId: "builder",
          parentSourceId: null,
          role: "builder",
          nativeSessionId: "fixture-native-session",
          nativeAgentId: null,
          path: "fixture.jsonl",
          sha256: `sha256:${"1".repeat(64)}`,
        }] : [],
        receipts: [],
        boundaries: {
          path: "boundaries.json",
          sha256: `sha256:${"2".repeat(64)}`,
        },
        firstProductEdit: null,
      },
      coverageManifest: { path: "fixture", validated: true },
      assertionManifest: { path: "fixture" },
      clocks: {
        grading: {
          sessions: [{ wallSeconds: 1, tokens: nullCounts() }],
        },
      },
      grading: {
        graderReportPath: "fixture",
        graderFamily: "fixture",
        sameFamilyGraded: false,
        usableGradingRecord: true,
      },
    },
  };
}

function composedErrors(record, artifactRoot = null) {
  return validateSocialMessengerRunRecord(composedSchema, record, {
    schemas: [baseSchema, extensionSchema],
    artifactRoot,
  });
}

test("current R2 compatibility provenance rejects deletion and fabrication", async () => {
  const root = fileURLToPath(new URL(
    "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-explicit/",
    ROOT,
  ));
  const record = JSON.parse(await readFile(join(root, "record.json"), "utf8"));
  assert.deepEqual(composedErrors(record, root), []);
  assert.deepEqual(record.socialMessenger.firstProductEdit.selectedSkills, []);

  for (const mutate of [
    (candidate) => { delete candidate.socialMessenger.meteringProvenance.adapter; },
    (candidate) => { delete candidate.socialMessenger.meteringProvenance.driver.compatibilityEvents; },
    (candidate) => { delete candidate.socialMessenger.meteringProvenance.sessions[0].nativeCliVersion; },
  ]) {
    const candidate = structuredClone(record);
    mutate(candidate);
    assert.notDeepEqual(composedErrors(candidate, root), [], "omitted current-R2 provenance must fail");
  }

  const fabricatedAdapter = structuredClone(record);
  fabricatedAdapter.socialMessenger.meteringProvenance.adapter.compatibilityEvents = [];
  assert.match(
    composedErrors(fabricatedAdapter, root).join("\n"),
    /adapter.*native adapter replay/u,
  );

  const fabricatedNativeVersion = structuredClone(record);
  fabricatedNativeVersion.socialMessenger.meteringProvenance.sessions[0].nativeCliVersion = "0.150.0";
  assert.match(
    composedErrors(fabricatedNativeVersion, root).join("\n"),
    /nativeCliVersion/u,
  );

  const fabricatedDriver = structuredClone(record);
  fabricatedDriver.socialMessenger.meteringProvenance.driver.compatibilityEvents[0]
    .usageSettlements[0].usageRecordOrdinal = 1230;
  assert.match(
    composedErrors(fabricatedDriver, root).join("\n"),
    /driver.*native boundary replay/u,
  );

  const fabricatedHandoff = structuredClone(record);
  fabricatedHandoff.socialMessenger.meteringProvenance.driver.compatibilityEvents[0]
    .observationHandoffExclusions[0].sequence = 210;
  assert.match(
    composedErrors(fabricatedHandoff, root).join("\n"),
    /driver.*native boundary replay/u,
  );

  const disguisedDriver = structuredClone(record);
  disguisedDriver.socialMessenger.meteringProvenance.driver.id = "fixture-driver";
  assert.notDeepEqual(
    composedErrors(disguisedDriver, root),
    [],
    "a current R2 record cannot evade provenance replay by renaming its driver",
  );
});

test("recovered signal handoff cannot be replaced by an arbitrary overlapping process event", async () => {
  const sourceRoot = fileURLToPath(new URL(
    "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-explicit/",
    ROOT,
  ));
  const temp = await mkdtemp(join(tmpdir(), "r2-handoff-mutation-"));
  await cp(sourceRoot, temp, { recursive: true });
  try {
    const eventPath = join(temp, "events/lane-controller-observations.jsonl");
    const events = parseObservationJsonLines(await readFile(eventPath, "utf8"), eventPath);
    events.find((event) => event.sequence === 209).actionId = "arbitrary-product-process";
    const eventText = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
    await writeFile(eventPath, eventText);
    const manifestPath = join(temp, "metering-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const descriptor = manifest.observations.find(
      (item) => item.sourceId.endsWith("lane-controller"),
    );
    descriptor.sha256 = sha256(eventText);
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, manifestText);
    const record = JSON.parse(await readFile(join(temp, "record.json"), "utf8"));
    record.socialMessenger.meteringProvenance.manifest.sha256 = sha256(manifestText);
    record.socialMessenger.meteringProvenance.manifestSha256 = sha256(manifestText);
    record.socialMessenger.meteringProvenance.observations.find(
      (item) => item.sourceId.endsWith("lane-controller"),
    ).sha256 = descriptor.sha256;
    assert.match(
      composedErrors(record, temp).join("\n"),
      /exact versioned native\/observation handoff registration/u,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("current R2 complete replay rejects coordinated quantitative fabrication", async () => {
  const root = fileURLToPath(new URL(
    "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-explicit/",
    ROOT,
  ));
  const record = JSON.parse(await readFile(join(root, "record.json"), "utf8"));
  const mutations = [
    ["milestone tokens", (value) => { value.socialMessenger.milestones.M1.authoring.tokens.input += 1; }],
    ["total tokens", (value) => { value.tokens.input += 1; }],
    ["token phases", (value) => { value.tokens.phases.authoring += 1; }],
    ["orientation prefix", (value) => { value.socialMessenger.firstProductEdit.orientationTokens.output += 1; }],
    ["charging", (value) => { value.socialMessenger.milestones.M2.charging.chargedTokens += 1; }],
    ["caps", (value) => { value.socialMessenger.milestones.M2.caps.wallCapSeconds += 1; }],
    ["eligibility", (value) => { value.socialMessenger.efficiencyScorecardEligibility.eligible = true; }],
    ["joined provenance", (value) => { value.socialMessenger.meteringProvenance.driver.startedAt = "2026-08-24T09:05:54.827Z"; }],
  ];
  for (const [label, mutate] of mutations) {
    const candidate = structuredClone(record);
    mutate(candidate);
    assert.match(
      composedErrors(candidate, root).join("\n"),
      /complete hash-bound native metering replay|native boundary replay/u,
      label,
    );
  }
});

test("current R2 validates the complete immutable commandless FileChange set", async (context) => {
  const sourceRoot = fileURLToPath(new URL(
    "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-explicit/",
    ROOT,
  ));
  const mutations = [
    ["source ID", () => {}, true],
    ["deletion", (events) => { events.splice(1, 1); }],
    ["fabrication", (events) => { events.push({ ...events[0], sequence: 99_999, actionId: "fabricated" }); }],
    ["action identity", (events) => { events[0].actionId = "fabricated"; }],
    ["action class", (events) => { events[0].actionClass = "edit"; }],
    ["milestone", (events) => { events[0].milestone = "M2"; }],
    ["sequence", (events) => { events[0].sequence += 1; }],
    ["timestamp", (events) => { events[0].at = "2026-08-24T09:12:15.377Z"; }],
  ];
  for (const [label, mutate, mutateSourceId = false] of mutations) {
    await context.test(label, async () => {
      const temp = await mkdtemp(join(tmpdir(), "r2-file-change-mutation-"));
      await cp(sourceRoot, temp, { recursive: true });
      try {
        const eventPath = join(temp, "events/codex-file-change-observations.jsonl");
        const events = parseObservationJsonLines(await readFile(eventPath, "utf8"), eventPath);
        mutate(events);
        const eventText = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
        await writeFile(eventPath, eventText);
        const manifestPath = join(temp, "metering-manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        const descriptor = manifest.observations.find(
          (item) => item.sourceId === "codex-file-change-observations",
        );
        if (mutateSourceId) descriptor.sourceId = "fabricated-file-change-source";
        descriptor.sha256 = sha256(eventText);
        const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(manifestPath, manifestText);
        const record = JSON.parse(await readFile(join(temp, "record.json"), "utf8"));
        record.socialMessenger.meteringProvenance.manifest.sha256 = sha256(manifestText);
        record.socialMessenger.meteringProvenance.manifestSha256 = sha256(manifestText);
        const source = record.socialMessenger.meteringProvenance.observations.find(
          (item) => item.sourceId === "codex-file-change-observations",
        );
        source.sha256 = descriptor.sha256;
        if (mutateSourceId) source.sourceId = descriptor.sourceId;
        assert.match(
          composedErrors(record, temp).join("\n"),
          /commandless FileChange|complete hash-bound native metering replay/u,
        );
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    });
  }
});

test("direct campaign controller command refuses before any prepare or native launch without admission", async () => {
  const repositoryRoot = fileURLToPath(ROOT);
  await assert.rejects(
    execFileAsync(process.execPath, [
      "benchmarks/tools/social-messenger/metering/lane-controller.mjs",
      "--harness-config",
      "benchmarks/runs/2026-08-23-r2-published-0125/harness-config.json",
      "--cell",
      "sol-clique-familiar",
      "--driver",
      "benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs",
    ], { cwd: repositoryRoot }),
    (error) => {
      assert.match(error.stderr, /R2_ADMISSION_REQUIRED/u);
      return true;
    },
  );
});

test("admission refuses an unrecorded private cell instead of permitting a rerun", async () => {
  const temp = await mkdtemp(join(tmpdir(), "r2-admission-pristine-"));
  try {
    const committedRoot = join(temp, "run");
    await Promise.all([
      mkdir(join(committedRoot, "cells/cell-1"), { recursive: true }),
      mkdir(join(committedRoot, "cells/cell-2"), { recursive: true }),
    ]);
    await writeFile(join(committedRoot, "cells/cell-1/cell.json"), JSON.stringify({
      status: "recovered-finalized",
      record: { path: "record.json" },
      metering: { path: "metering.json" },
    }));
    await writeFile(join(committedRoot, "cells/cell-1/record.json"), "{}\n");
    await writeFile(join(committedRoot, "cells/cell-1/metering.json"), "{}\n");
    await writeFile(join(committedRoot, "cells/cell-2/cell.json"), JSON.stringify({ status: "not-started" }));
    const harnessConfig = {
      cellOrder: ["cell-1", "cell-2"],
      paths: { committedRunRoot: "run", privateExecutionRoot: join(temp, "private") },
    };
    assert.throws(() => inspectCommittedSeriality({
      harnessConfig,
      cellId: "cell-2",
      repositoryRoot: temp,
      privateExists: (path) => path.endsWith("cell-2"),
      gitRead: (args) => {
        if (args[0] === "rev-parse") return "fixture-head";
        return readFileSync(join(temp, args[1].split(":").slice(1).join(":")));
      },
    }), /EXISTING_UNRECORDED_EVIDENCE/u);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("per-cell admission succeeds with an injected three-minute clock and rejects stale spacing", async () => {
  const temp = await mkdtemp(join(tmpdir(), "r2-admission-"));
  try {
    const sourceConfig = JSON.parse(await readFile(
      new URL("benchmarks/runs/2026-08-23-r2-published-0125/harness-config.json", ROOT),
      "utf8",
    ));
    const cell = sourceConfig.cells[1];
    cell.admissionArtifact = "admission.json";
    cell.controllerCommand = ["node", "fixture-controller", "--admission", join(temp, "admission.json")];
    sourceConfig.pins.instrument.manifestPath = "benchmarks/instrument.manifest.json";
    sourceConfig.paths.instrumentRoot = fileURLToPath(new URL("benchmarks/", ROOT));
    const instrumentBytes = await readFile(new URL("benchmarks/instrument.manifest.json", ROOT));
    sourceConfig.pins.instrument.manifestSha256 = sha256(instrumentBytes).replace(/^sha256:/u, "");
    const configPath = join(temp, "harness-config.json");
    await writeFile(configPath, `${JSON.stringify(sourceConfig, null, 2)}\n`);
    let clock = Date.parse("2026-08-24T12:00:00.000Z");
    const reservationPath = join(temp, "reservation.json");
    await writeFile(reservationPath, `${JSON.stringify({
      version: "snapback.r2-host-reservation.v1",
      runId: sourceConfig.runId,
      cellId: cell.id,
      hostname: hostname(),
      exclusive: true,
      reservedBy: "metering-test",
      reservedAt: new Date(clock).toISOString(),
      expiresAt: new Date(clock + 600_000).toISOString(),
    }, null, 2)}\n`);
    const seriality = {
      gitHead: "fixture-head",
      committedPrefix: [sourceConfig.cellOrder[0]],
      requestedIndex: 1,
      laterPristine: sourceConfig.cellOrder.slice(2),
      privateCellState: "absent",
    };
    const admissionPath = join(temp, "admission.json");
    const injected = {
      inspectSeriality: () => seriality,
      activePriorProcesses: () => [],
      portIsUnbound: async () => true,
      harnessEvidence: (key, harness) => ({
        key,
        binary: harness.binary,
        observedVersion: harness.observedVersion,
        version: { ok: true, argv: ["--version"] },
        auth: { ok: true, argv: ["fixture-auth"] },
      }),
      now: () => clock,
      loadavg: () => [1, 2, 3],
      sleep: async (millis) => { clock += millis; },
    };
    let samplesBeforeInstrument = 0;
    await assert.rejects(createAdmissionArtifact({
      harnessConfigPath: configPath,
      cellId: cell.id,
      reservationPath,
      admissionPath,
      dependencies: {
        ...injected,
        loadavg: () => { samplesBeforeInstrument += 1; return [1, 2, 3]; },
        resolveInstrument: () => { throw new Error("stale materialized snapshot"); },
      },
    }), /R2_ADMISSION_INSTRUMENT/u);
    assert.equal(samplesBeforeInstrument, 0, "instrument refusal must precede load sampling");
    const artifact = await createAdmissionArtifact({
      harnessConfigPath: configPath,
      cellId: cell.id,
      reservationPath,
      admissionPath,
      dependencies: injected,
    });
    assert.equal(artifact.loadIsolation.samples.length, 3);
    assert.equal(artifact.instrument.source.sha256, artifact.instrument.materialized.sha256);
    assert.equal(
      Date.parse(artifact.loadIsolation.samples[2].sampledAt)
        - Date.parse(artifact.loadIsolation.samples[0].sampledAt),
      120_000,
    );
    const stale = structuredClone(artifact);
    stale.loadIsolation.samples[1].sampledAt = new Date(
      Date.parse(stale.loadIsolation.samples[0].sampledAt) + 59_999,
    ).toISOString();
    stale.identity.sha256 = admissionIdentity(stale);
    assert.throws(() => verifyAdmissionArtifact({
      artifact: stale,
      harnessConfig: sourceConfig,
      harnessConfigPath: configPath,
      cellId: cell.id,
      admissionPath,
      nowMs: Date.parse(stale.issuedAt),
      campaignState: seriality,
    }), /once per minute/u);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("historical dry-run validation binds immutable Git commit and tree bytes", async () => {
  const recovery = JSON.parse(await readFile(
    new URL("benchmarks/runs/2026-08-23-r2-published-0125/recovery-resume.v3.json", ROOT),
    "utf8",
  ));
  const evidence = fileURLToPath(new URL(
    "benchmarks/runs/2026-08-23-r2-published-0125/dry-run-evidence/success/",
    ROOT,
  ));
  const result = await validateDryRunEvidence(evidence, {
    historicalValidatorBinding: recovery.historicalDryRunValidator,
  });
  assert.equal(result.validationMode, "immutable-git-object-validator-source-binding");
  await assert.rejects(
    validateDryRunEvidence(evidence, {
      historicalValidatorBinding: {
        ...recovery.historicalDryRunValidator,
        sourceCommit: "0acfad7ae32357cf331b0f539c545f503163ce78",
      },
    }),
    /source object digest disagrees|commit\/tree binding disagrees/u,
  );
  const incompleteBinding = structuredClone(recovery.historicalDryRunValidator);
  delete incompleteBinding.sources.semantic;
  await assert.rejects(
    validateDryRunEvidence(evidence, { historicalValidatorBinding: incompleteBinding }),
    /source inventory disagrees/u,
  );
});

async function retainedArtifact(root, path) {
  return { path, sha256: sha256(await readFile(join(root, path))) };
}

async function writeObservationFixture(root, { allClaimed = true } = {}) {
  const path = join(root, "observations.jsonl");
  let observationAt = Date.parse("2026-08-21T16:00:00.000Z");
  const writer = new ObservationWriter({
    path,
    laneRunId: "fixture-lane",
    now: () => {
      const at = new Date(observationAt).toISOString();
      observationAt += 1000;
      return at;
    },
  });
  await writer.initialize();
  for (const milestone of ["M1", "M2", "M3"]) {
    observationAt = Date.parse({
      M1: "2026-08-21T16:00:00.000Z",
      M2: "2026-08-21T16:01:05.000Z",
      M3: "2026-08-21T16:02:05.000Z",
    }[milestone]);
    for (const block of OBSERVABILITY_BLOCKS) {
      if (block === "browserAssertionWait") {
        await writer.claim(milestone, block, { owner: "suite" });
        await writer.claim(milestone, block, { owner: "choreography" });
        continue;
      }
      if (!allClaimed && ["semanticActions", "failureToRecoveryEpisodes"].includes(block)) {
        await writer.nonClaim(milestone, block, `${block}-not-emitted-by-fixture-harness`);
      } else {
        await writer.claim(milestone, block);
      }
    }
    if (!allClaimed) {
      for (const block of ["restartReseed", "browserAssertionWait", "apiInterruptions"]) {
        // Claimed zero is meaningful only because the fixture driver emitted
        // the corresponding complete-coverage claim above.
        assert.ok(block);
      }
    }
    await writer.record(milestone, "host-load-sample", {
      loadavg1: 1,
      loadavg5: 1.5,
      loadavg15: 2,
      ceiling1: 10,
      ceiling5: 10,
      ceiling15: 10,
    });
  }
  observationAt = Date.parse("2026-08-21T16:00:20.000Z");
  if (allClaimed) {
    await writer.record("M1", "semantic-action", {
      actionId: "m1-action-1",
      actionClass: "source-inspection",
      disposition: "correction",
      episodeId: "m1-episode-1",
      retriedClass: null,
      binaryExcavation: true,
    });
    await writer.record("M1", "semantic-action", {
      actionId: "m1-action-2",
      actionClass: "retry",
      disposition: "correction",
      episodeId: "m1-episode-1",
      retriedClass: "source-inspection",
      binaryExcavation: false,
    });
    await writer.record("M1", "recovery-episode", {
      episodeId: "m1-episode-1",
      carrier: "other",
      attribution: "snapback-defect",
      subAttribution: "knowledge-gap",
      outcome: "recovered",
      recoveredAt: "2026-08-21T16:00:59.000Z",
      actionCount: 2,
    });
    observationAt = Date.parse("2026-08-21T16:01:20.000Z");
    await writer.semanticAction("M2", {
      actionId: "m2-single-correction",
      actionClass: "edit",
      disposition: "correction",
      episodeId: null,
      retriedClass: null,
      binaryExcavation: false,
    });
    observationAt = Date.parse("2026-08-21T16:02:20.000Z");
    await writer.semanticAction("M3", {
      actionId: "m3-progress",
      actionClass: "suite",
      disposition: "progress",
      episodeId: null,
      retriedClass: null,
      binaryExcavation: false,
    });
  }
  observationAt = Date.parse("2026-08-21T16:00:40.000Z");
  await writer.restart("M1");
  await writer.reseed("M1", { destructive: false });
  await writer.assertionWait("M1", {
    owner: "suite",
    assertion: "suite-fixture",
    attempt: 1,
    durationMs: 10,
    pass: true,
  });
  observationAt = Date.parse("2026-08-21T16:01:40.000Z");
  await writer.assertionWait("M2", {
    owner: "suite",
    assertion: "suite-fixture-m2",
    attempt: 1,
    durationMs: 10,
    pass: true,
  });
  observationAt = Date.parse("2026-08-21T16:02:40.000Z");
  await writer.assertionWait("M3", {
    owner: "suite",
    assertion: "suite-fixture-m3",
    attempt: 1,
    durationMs: 10,
    pass: true,
  });
  observationAt = Date.parse("2026-08-21T16:00:45.000Z");
  await writer.assertionWait("M1", {
    owner: "choreography",
    assertion: "choreo-fixture",
    attempt: 1,
    durationMs: 20,
    pass: true,
  });
  observationAt = Date.parse("2026-08-21T16:01:45.000Z");
  await writer.assertionWait("M2", {
    owner: "choreography",
    assertion: "choreo-fixture-m2",
    attempt: 1,
    durationMs: 20,
    pass: true,
  });
  observationAt = Date.parse("2026-08-21T16:02:45.000Z");
  await writer.assertionWait("M3", {
    owner: "choreography",
    assertion: "choreo-fixture-m3",
    attempt: 1,
    durationMs: 20,
    pass: true,
  });
  observationAt = Date.parse("2026-08-21T16:00:50.000Z");
  await writer.apiRequest("M1", {
    provider: "fixture-provider",
    operation: "stream-turn",
    requestId: "request-1",
    outcome: "error",
    retryOf: null,
  });
  await writer.apiRequest("M1", {
    provider: "fixture-provider",
    operation: "stream-turn",
    requestId: "request-2",
    outcome: "success",
    retryOf: "request-1",
  });
  return { path, artifact: await retainedArtifact(root, "observations.jsonl") };
}

async function writeSuiteFixture(root) {
  const milestones = [];
  const provenance = [];
  const statuses = {};
  for (const [index, milestone] of ["M1", "M2", "M3"].entries()) {
    const receiptPath = `${milestone.toLowerCase()}-suite.json`;
    await writeFile(join(root, receiptPath), `${JSON.stringify({ milestone, pass: true })}\n`);
    const receiptArtifact = await retainedArtifact(root, receiptPath);
    statuses[milestone.toLowerCase()] = { pass: true, receipt: receiptPath };
    milestones.push({
      milestone,
      pass: true,
      receipt: receiptArtifact,
    });
    const choreographyPath = `${milestone.toLowerCase()}-choreography.jsonl`;
    const runId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const choreographyText = `${JSON.stringify({
      version: "0.3.3-m8",
      runId,
      recordedAt: `2026-08-21T16:0${index + 1}:00.000Z`,
      type: "segment-summary",
      segment: milestone.toLowerCase(),
      assertion: "__segment__",
      implemented: true,
      required: true,
      status: "passed",
      pass: true,
      timings: [{
        attempt: 1,
        pass: true,
        startedAt: null,
        durationMs: 1,
        settlementWaitMs: 1,
        metrics: {},
      }],
      bestOf: 1,
      details: {
        selection: "segment aggregate",
        selectedAttempt: 1,
        reason: null,
      },
      assertions: {
        total: 1,
        required: 1,
        implemented: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        notImplemented: 0,
        requiredUnimplemented: 0,
      },
      suite: {
        pass: true,
        receipt: receiptPath,
        receiptSha256: receiptArtifact.sha256,
      },
      choreography: {
        browserPass: true,
        requiredExternal: [],
        externalPass: true,
        supplementalExternal: [],
        pass: true,
      },
      green: true,
      nonGreenCause: null,
    })}\n`;
    await writeFile(join(root, choreographyPath), choreographyText);
    provenance.push({
      sourceId: `${milestone.toLowerCase()}-choreography`,
      runId,
      milestone,
      path: choreographyPath,
      sha256: sha256(choreographyText),
    });
  }
  await writeFile(join(root, "suite-status.json"), `${JSON.stringify(statuses)}\n`);
  return {
    input: await retainedArtifact(root, "suite-status.json"),
    milestones,
    provenance,
  };
}

async function addD06Observability(record, root, { allClaimed = true } = {}) {
  const observations = await writeObservationFixture(root, { allClaimed });
  const events = parseObservationJsonLines(await readFile(observations.path, "utf8"));
  const evidence = [observations.artifact];
  record.socialMessenger.orientation.instrument.pin = "social-messenger@0.3.3-m8";
  record.socialMessenger.orientation.instrument.versions.choreography = "0.3.3-m8";
  record.socialMessenger.instrumentVersion = "social-messenger@0.3.3-m8";
  record.socialMessenger.observabilityProtocol = OBSERVATION_VERSION;
  record.socialMessenger.meteringProvenance.observations = [{
    sourceId: "fixture-observations",
    ...observations.artifact,
  }];
  for (const milestone of ["M1", "M2", "M3"]) {
    Object.assign(
      record.socialMessenger.milestones[milestone],
      projectMilestoneObservability({ events, evidence, milestone }),
    );
  }
  record.socialMessenger.efficiencyScorecardEligibility = scorecardEligibility({
    milestones: record.socialMessenger.milestones,
    phaseUsageAvailable: true,
  });
  const suiteFixture = await writeSuiteFixture(root);
  record.socialMessenger.suiteStatusLinkage = {
    input: suiteFixture.input,
    milestones: suiteFixture.milestones,
  };
  record.socialMessenger.meteringProvenance.receipts = suiteFixture.provenance;
  return record;
}

test("D0.6 observability is produced from real sidecars and tampering fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "d06-observability-"));
  const record = await addD06Observability(composedRecord({
      capFamily: "gpt-frontier",
      source: "codex-rollout-token-count",
      metered: true,
    }), root);
  assert.equal(record.socialMessenger.extensionVersion, 2);
  assert.deepEqual(composedErrors(record, root), []);

  const badActionTotal = structuredClone(record);
  badActionTotal.socialMessenger.milestones.M1.semanticActions.total = 3;
  assert.match(
    composedErrors(badActionTotal, root).join("\n"),
    /semantic-action total must equal|does not equal the projection/u,
  );

  const badEpisodeTotal = structuredClone(record);
  badEpisodeTotal.socialMessenger.milestones.M1.failureToRecoveryEpisodes
    .byOutcome.recovered = 0;
  assert.match(
    composedErrors(badEpisodeTotal, root).join("\n"),
    /episode total must equal recovered \+ unresolved|does not equal the projection/u,
  );

  const badContamination = structuredClone(record);
  badContamination.socialMessenger.milestones.M1.hostLoad.contamination = true;
  assert.match(
    composedErrors(badContamination, root).join("\n"),
    /host-load contamination must match retained breaches|does not equal the projection/u,
  );

  const missingSuiteLink = structuredClone(record);
  missingSuiteLink.socialMessenger.suiteStatusLinkage.milestones.pop();
  assert.match(
    composedErrors(missingSuiteLink, root).join("\n"),
    /attempted M3 lacks hash-linked suite status/u,
  );

  const absentSuiteLinkage = structuredClone(record);
  delete absentSuiteLinkage.socialMessenger.suiteStatusLinkage;
  assert.match(
    composedErrors(absentSuiteLinkage, root).join("\n"),
    /current instrument requires hash-bound suite-status custody/u,
  );

  const nullGreenReceipt = structuredClone(record);
  nullGreenReceipt.socialMessenger.suiteStatusLinkage.milestones[0].receipt = null;
  assert.match(
    composedErrors(nullGreenReceipt, root).join("\n"),
    /pass:true requires|required artifact|exactly one allowed schema/u,
  );

  const absentBlock = structuredClone(record);
  delete absentBlock.socialMessenger.milestones.M2.semanticActions;
  assert.match(
    composedErrors(absentBlock, root).join("\n"),
    /requires an explicit claimed or non-claimed block/u,
  );

  const missingEvidence = structuredClone(record);
  missingEvidence.socialMessenger.meteringProvenance.observations[0].path = "missing.jsonl";
  assert.match(
    composedErrors(missingEvidence, root).join("\n"),
    /cannot read retained artifact/u,
  );

  const absentObservationSet = structuredClone(record);
  delete absentObservationSet.socialMessenger.meteringProvenance.observations;
  assert.match(
    composedErrors(absentObservationSet, root).join("\n"),
    /must declare its complete observation artifact set/u,
  );

  const fabricatedDigest = structuredClone(record);
  fabricatedDigest.socialMessenger.meteringProvenance.observations[0].sha256 =
    `sha256:${"0".repeat(64)}`;
  assert.match(
    composedErrors(fabricatedDigest, root).join("\n"),
    /digest mismatch/u,
    "a syntactically valid fabricated observation digest must fail",
  );

  const choreographyReceiptPath = join(root, "m1-choreography.jsonl");
  const choreographyReceiptText = await readFile(choreographyReceiptPath, "utf8");
  await writeFile(choreographyReceiptPath, `${choreographyReceiptText} `);
  assert.match(
    composedErrors(record, root).join("\n"),
    /digest mismatch/u,
    "changing refusal-time choreography evidence must invalidate the record",
  );
  await writeFile(choreographyReceiptPath, choreographyReceiptText);

  const fabricatedReceipt = `${JSON.stringify({
    version: "0.3.3-m8",
    runId: "00000000-0000-4000-8000-000000000001",
    recordedAt: "2026-08-21T16:01:00.000Z",
    type: "segment-summary",
    segment: "m1",
    suite: { pass: true },
    choreography: { pass: true },
    green: true,
  })}\n`;
  await writeFile(choreographyReceiptPath, fabricatedReceipt);
  const fabricatedBytes = structuredClone(record);
  fabricatedBytes.socialMessenger.meteringProvenance.receipts[0].sha256 =
    sha256(fabricatedReceipt);
  assert.match(
    composedErrors(fabricatedBytes, root).join("\n"),
    /does not satisfy receipts\.schema\.json/u,
    "fabricated choreography bytes with their recomputed digest must fail receipt-schema validation",
  );
  await writeFile(choreographyReceiptPath, choreographyReceiptText);

  const suiteReceiptPath = join(root, "m1-suite.json");
  const suiteReceiptText = await readFile(suiteReceiptPath, "utf8");
  await writeFile(suiteReceiptPath, "{\"tampered\":true}\n");
  assert.match(
    composedErrors(record, root).join("\n"),
    /digest mismatch/u,
    "changing a retained suite receipt after record creation must invalidate the record",
  );
  await writeFile(suiteReceiptPath, suiteReceiptText);

  const observationText = await readFile(join(root, "observations.jsonl"), "utf8");
  await writeFile(join(root, "observations.jsonl"), `${observationText} `);
  assert.match(
    composedErrors(record, root).join("\n"),
    /digest mismatch/u,
    "changing retained bytes after record creation must invalidate the record",
  );
  await writeFile(join(root, "observations.jsonl"), observationText);

  const downgradedOrientation = structuredClone(record);
  downgradedOrientation.socialMessenger.orientation.instrument.pin =
    "social-messenger@0.3.2-m8";
  downgradedOrientation.socialMessenger.orientation.instrument.versions.choreography =
    "0.3.2-m8";
  assert.match(
    composedErrors(downgradedOrientation, root).join("\n"),
    /expected constant "social-messenger@0\.3\.3-m8"|expected constant "0\.3\.3-m8"/u,
  );

  const absentOrientation = structuredClone(record);
  delete absentOrientation.socialMessenger.orientation;
  assert.match(
    composedErrors(absentOrientation, root).join("\n"),
    /orientation.*required field is missing/u,
  );

  const absentInstrumentVersion = structuredClone(record);
  delete absentInstrumentVersion.socialMessenger.instrumentVersion;
  assert.match(
    composedErrors(absentInstrumentVersion, root).join("\n"),
    /instrumentVersion.*required field is missing/u,
  );

  const explicitInstrumentDowngrade = structuredClone(record);
  explicitInstrumentDowngrade.socialMessenger.instrumentVersion =
    "social-messenger@0.3.2-m8";
  assert.match(
    validateSocialMessengerRecordSemantics(
      explicitInstrumentDowngrade,
      { artifactRoot: root },
    ).join("\n"),
    /current observability\/orientation markers require social-messenger@0\.3\.3-m8/u,
    "semantic validation must reject explicit legacy-version substitution on an otherwise-current record",
  );
  assert.match(
    composedErrors(explicitInstrumentDowngrade, root).join("\n"),
    /expected constant "social-messenger@0\.3\.3-m8"/u,
    "the composed schema must make current protocol/orientation markers imply the current instrument version",
  );

  const coordinatedDowngrade = structuredClone(record);
  delete coordinatedDowngrade.socialMessenger.instrumentVersion;
  delete coordinatedDowngrade.socialMessenger.observabilityProtocol;
  coordinatedDowngrade.socialMessenger.orientation.instrument.pin =
    "social-messenger@0.3.2-m8";
  coordinatedDowngrade.socialMessenger.orientation.instrument.versions.choreography =
    "0.3.2-m8";
  assert.match(
    composedErrors(coordinatedDowngrade, root).join("\n"),
    /instrumentVersion.*required field is missing/u,
    "coordinated marker deletion/downgrade cannot select legacy validation",
  );

  const preChoreographyAbort = structuredClone(record);
  const abortedM3 = preChoreographyAbort.socialMessenger.milestones.M3;
  abortedM3.status = "aborted";
  abortedM3.nonGreenCause = "instrument";
  abortedM3.authoring.firstGreenAt = null;
  abortedM3.authoring.choreoPassAt = null;
  abortedM3.authoring.terminalReason = "abort";
  abortedM3.charging.chargedWallSeconds = abortedM3.caps.wallCapSeconds;
  abortedM3.charging.flags = ["aborted"];
  preChoreographyAbort.socialMessenger.meteringProvenance.receipts =
    preChoreographyAbort.socialMessenger.meteringProvenance.receipts.filter(
      (receipt) => receipt.milestone !== "M3",
    );
  assert.deepEqual(
    composedErrors(preChoreographyAbort, root),
    [],
    "an abort before choreography starts must remain a valid all-attempts record",
  );

  const oldRecord = composedRecord({
    capFamily: "gpt-frontier",
    source: "codex-rollout-token-count",
    metered: true,
  });
  oldRecord.socialMessenger.orientation.instrument.versions = {
    choreography: "fixture",
  };
  assert.deepEqual(composedErrors(oldRecord), []);
  await rm(root, { recursive: true, force: true });
});

test("semantic and episode non-claims make the correction-action target ineligible", async () => {
  const root = await mkdtemp(join(tmpdir(), "d06-nonclaim-"));
  const record = await addD06Observability(composedRecord({
    capFamily: "gpt-frontier",
    source: "codex-rollout-token-count",
    metered: true,
  }), root, { allClaimed: false });
  assert.equal(record.socialMessenger.milestones.M1.semanticActions.claimed, false);
  assert.equal(record.socialMessenger.milestones.M1.failureToRecoveryEpisodes.claimed, false);
  assert.equal(
    record.socialMessenger.efficiencyScorecardEligibility.correctionActionTargetEligible,
    false,
  );
  assert.deepEqual(composedErrors(record, root), []);

  const falseEligibility = structuredClone(record);
  falseEligibility.socialMessenger.efficiencyScorecardEligibility = {
    eligible: true,
    correctionActionTargetEligible: true,
    ineligibilityReasons: [],
  };
  assert.match(
    composedErrors(falseEligibility, root).join("\n"),
    /eligibility must equal the validator-recomputed/u,
  );
  await rm(root, { recursive: true, force: true });
});

test("composed schema restricts approved sources and null cap posture", () => {
  const gpt = composedRecord({
    capFamily: "gpt-frontier",
    source: "codex-rollout-token-count",
    metered: true,
  });
  assert.deepEqual(composedErrors(gpt), []);

  const unavailableGpt = composedRecord({
    capFamily: "gpt-frontier",
    source: null,
    metered: false,
  });
  assert.deepEqual(composedErrors(unavailableGpt), []);

  const grok = composedRecord({
    capFamily: "grok-advisory",
    source: null,
    metered: false,
  });
  assert.deepEqual(composedErrors(grok), []);

  const arbitrarySource = structuredClone(gpt);
  arbitrarySource.tokens.source = "provider-usage-estimate";
  assert.notDeepEqual(composedErrors(arbitrarySource), []);

  const wrongFamilySource = structuredClone(gpt);
  wrongFamilySource.socialMessenger.capFamily = "claude-frontier";
  assert.notDeepEqual(composedErrors(wrongFamilySource), []);

  const advisoryNumbers = structuredClone(grok);
  advisoryNumbers.tokens.input = 10;
  advisoryNumbers.tokens.output = 2;
  advisoryNumbers.socialMessenger.milestones.M1.authoring.tokens = counts(10, 2);
  advisoryNumbers.socialMessenger.milestones.M1.caps.tokenCap = 100;
  advisoryNumbers.socialMessenger.milestones.M1.charging.chargedTokens = 100;
  advisoryNumbers.socialMessenger.milestones.M1.charging.flags = ["capped-tokens"];
  assert.notDeepEqual(composedErrors(advisoryNumbers), []);

  const unavailableCap = structuredClone(unavailableGpt);
  unavailableCap.socialMessenger.milestones.M2.caps.tokenCap = 100;
  unavailableCap.socialMessenger.milestones.M2.charging.chargedTokens = 100;
  unavailableCap.socialMessenger.milestones.M2.charging.flags = ["capped-tokens"];
  assert.notDeepEqual(composedErrors(unavailableCap), []);

  const nativeNulls = structuredClone(gpt);
  nativeNulls.tokens.input = null;
  nativeNulls.tokens.output = null;
  for (const milestone of Object.values(nativeNulls.socialMessenger.milestones)) {
    milestone.authoring.tokens = nullCounts();
    milestone.charging.chargedTokens = null;
  }
  assert.notDeepEqual(composedErrors(nativeNulls), []);

  const advisoryOrientation = structuredClone(grok);
  advisoryOrientation.socialMessenger.firstProductEdit.orientationTokens = counts(1, 1);
  assert.notDeepEqual(composedErrors(advisoryOrientation), []);

  const missingReason = structuredClone(unavailableGpt);
  delete missingReason.socialMessenger.meteringProvenance.unavailableReason;
  assert.notDeepEqual(composedErrors(missingReason), []);

  const dishonestTokenCap = structuredClone(gpt);
  dishonestTokenCap.socialMessenger.milestones.M1.status = "capability-failure";
  dishonestTokenCap.socialMessenger.milestones.M1.authoring.firstGreenAt = null;
  dishonestTokenCap.socialMessenger.milestones.M1.authoring.terminalReason = "token-cap";
  dishonestTokenCap.socialMessenger.milestones.M1.charging.chargedTokens = 1;
  dishonestTokenCap.socialMessenger.milestones.M1.charging.flags = [];
  assert.notDeepEqual(composedErrors(dishonestTokenCap), []);

  const wrongTokenCapEquality = structuredClone(dishonestTokenCap);
  wrongTokenCapEquality.socialMessenger.milestones.M1.charging.flags = ["capped-tokens"];
  assert.match(
    composedErrors(wrongTokenCapEquality).join("\n"),
    /token-cap charges the token cap/u,
  );
  const validTokenCap = structuredClone(wrongTokenCapEquality);
  validTokenCap.socialMessenger.milestones.M1.charging.chargedTokens = 1000;
  assert.deepEqual(composedErrors(validTokenCap), []);

  const dishonestWallCap = structuredClone(gpt);
  dishonestWallCap.socialMessenger.milestones.M1.status = "capability-failure";
  dishonestWallCap.socialMessenger.milestones.M1.authoring.firstGreenAt = null;
  dishonestWallCap.socialMessenger.milestones.M1.authoring.terminalReason = "wall-cap";
  dishonestWallCap.socialMessenger.milestones.M1.charging.flags = [];
  assert.notDeepEqual(composedErrors(dishonestWallCap), []);

  const wrongWallCapEquality = structuredClone(dishonestWallCap);
  wrongWallCapEquality.socialMessenger.milestones.M1.charging.flags = ["capped-wall"];
  assert.match(
    composedErrors(wrongWallCapEquality).join("\n"),
    /wall-cap charges the wall cap/u,
  );

  const dishonestAbort = structuredClone(gpt);
  dishonestAbort.socialMessenger.milestones.M1.status = "aborted";
  dishonestAbort.socialMessenger.milestones.M1.authoring.firstGreenAt = null;
  dishonestAbort.socialMessenger.milestones.M1.authoring.terminalReason = "abort";
  dishonestAbort.socialMessenger.milestones.M1.charging.flags = [];
  assert.notDeepEqual(composedErrors(dishonestAbort), []);

  const wrongAbortEquality = structuredClone(dishonestAbort);
  wrongAbortEquality.socialMessenger.milestones.M1.charging.flags = ["aborted"];
  assert.match(
    composedErrors(wrongAbortEquality).join("\n"),
    /abort charges the wall cap/u,
  );

  assert.equal(validateMachineRecord({
    root: fileURLToPath(ROOT),
    schema: baseSchema,
    file: "synthetic-social-messenger.json",
    record: gpt,
  }), gpt);
  assert.throws(() => validateMachineRecord({
    root: fileURLToPath(ROOT),
    schema: baseSchema,
    file: "synthetic-social-messenger-dishonest.json",
    record: dishonestTokenCap,
  }), (error) => error?.reason === "SCHEMA_CONFORMANCE");
});
