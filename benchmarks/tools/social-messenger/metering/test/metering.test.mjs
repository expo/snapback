import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
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
} from "../adapters/codex-session.mjs";
import { adaptUnavailableFamily } from "../adapters/unavailable.mjs";
import {
  mergeBoundaryMaps,
  normalizeBoundaryMap,
  readReceiptBoundaryFiles,
} from "../boundaries.mjs";
import { joinUsageToMilestones } from "../joiner.mjs";
import { parseJsonLines } from "../jsonl.mjs";
import { loadMeteringManifest } from "../manifest.mjs";
import { assertTokenCounts, capTokenCount } from "../counts.mjs";
import {
  TokenCapEnforcedError,
  TokenMeteringReconciliationError,
  TokenCapWatchdog,
} from "../watchdog.mjs";
import { validateJsonSchema } from "../../../lib/json-schema.mjs";
import { validateMachineRecord } from "../../../lib/record-loader.mjs";
import { validateSocialMessengerRunRecord } from "../../record-validator.mjs";

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
  }
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
  }), /completes after the final M1 terminal boundary/u);
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

function composedErrors(record) {
  return validateSocialMessengerRunRecord(composedSchema, record, {
    schemas: [baseSchema, extensionSchema],
  });
}

function hashedArtifact(path, digit = "a") {
  return { path, sha256: `sha256:${digit.repeat(64)}` };
}

function addD06Observability(record) {
  record.socialMessenger.suiteStatusLinkage = {
    input: hashedArtifact("suite-status.json", "3"),
    milestones: ["M1", "M2", "M3"].map((milestone) => ({
      milestone,
      pass: true,
      receipt: hashedArtifact(`acceptance/${milestone.toLowerCase()}.json`, "4"),
    })),
  };
  record.socialMessenger.milestones.M1.semanticActions = {
    evidence: hashedArtifact("events/semantic-actions.jsonl"),
    total: 2,
    byClass: {
      "guide-lookup": 0,
      "source-inspection": 0,
      edit: 1,
      generate: 0,
      process: 0,
      reseed: 0,
      suite: 1,
      choreography: 0,
      retry: 0,
    },
    byDisposition: { progress: 1, correction: 1 },
    binaryExcavation: 0,
  };
  record.socialMessenger.milestones.M1.failureToRecoveryEpisodes = {
    evidence: hashedArtifact("events/failure-to-recovery.jsonl", "b"),
    total: 1,
    byCarrier: {
      "snapback-refusal": 0,
      "compiler-codegen-diagnostic": 0,
      "bare-not-found": 0,
      "silent-discovery-miss": 0,
      other: 1,
    },
    byAttribution: {
      "snapback-defect": 0,
      "agent-error": 1,
      environment: 0,
      ambiguous: 0,
    },
    byOutcome: { recovered: 1, unresolved: 0 },
  };
  record.socialMessenger.milestones.M1.restartReseed = {
    evidence: hashedArtifact("events/process-lifecycle.jsonl", "c"),
    restarts: 1,
    reseeds: 1,
    destructiveReseeds: 0,
  };
  record.socialMessenger.milestones.M1.browserAssertionWait = {
    evidence: hashedArtifact("events/assertion-waits.jsonl", "d"),
    suite: { attempts: 1, waitMillis: 10 },
    choreography: { attempts: 2, waitMillis: 20 },
  };
  record.socialMessenger.milestones.M1.hostLoad = {
    evidence: hashedArtifact("load-samples.jsonl", "e"),
    startedAt: "2026-08-21T16:00:00.000Z",
    endedAt: "2026-08-21T16:01:00.000Z",
    sampleCount: 2,
    contamination: false,
    breaches: [],
  };
  record.socialMessenger.milestones.M1.apiInterruptions = {
    evidence: hashedArtifact("api-interruptions.jsonl", "f"),
    interrupted: false,
    windows: [],
  };
  return record;
}

test("D0.6 observability stays additive, hash-linked, and semantically closed", () => {
  const record = addD06Observability(composedRecord({
    capFamily: "gpt-frontier",
    source: "codex-rollout-token-count",
    metered: true,
  }));
  assert.equal(record.socialMessenger.extensionVersion, 2);
  assert.deepEqual(composedErrors(record), []);

  const badActionTotal = structuredClone(record);
  badActionTotal.socialMessenger.milestones.M1.semanticActions.total = 3;
  assert.match(
    composedErrors(badActionTotal).join("\n"),
    /semantic-action total must equal/u,
  );

  const badEpisodeTotal = structuredClone(record);
  badEpisodeTotal.socialMessenger.milestones.M1.failureToRecoveryEpisodes
    .byOutcome.recovered = 0;
  assert.match(
    composedErrors(badEpisodeTotal).join("\n"),
    /episode total must equal recovered \+ unresolved/u,
  );

  const badContamination = structuredClone(record);
  badContamination.socialMessenger.milestones.M1.hostLoad.contamination = true;
  assert.match(
    composedErrors(badContamination).join("\n"),
    /host-load contamination must match retained breaches/u,
  );

  const missingSuiteLink = structuredClone(record);
  missingSuiteLink.socialMessenger.suiteStatusLinkage.milestones.pop();
  assert.match(
    composedErrors(missingSuiteLink).join("\n"),
    /attempted M3 lacks hash-linked suite status/u,
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
