import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { joinUsageToMilestones } from "../joiner.mjs";
import {
  bindFullJourneyAccounting,
  bindFullJourneyAccountingValues,
  loadMeteringManifest,
} from "../manifest.mjs";
import {
  recoverCodexFileChanges,
  recoverCodexSignalSettlements,
} from "../codex-native-evidence.mjs";
import {
  R2LaneController,
  composeRunRecord,
  runNonConsumingSmoke,
} from "../lane-controller.mjs";
import {
  R2_PROVISIONING_CONTENT_VERSION,
  R2_PROVISIONING_MANIFEST_VERSION,
  allCampaignPorts,
  currentHostIdentity,
  createAdmissionArtifact,
  inspectNonConsumingAdmissionSmoke,
  measureProvisionedSourceTree,
  probeLaunchQuiet,
  resolveSourceIdentity,
} from "../r2-cell-admission.mjs";
import { finalizeExisting } from "../r2-finalize-existing.mjs";
import {
  preflight as preflightR2CellDriver,
  runMilestone as runR2CellMilestone,
  r2CellDriverTestHooks,
  resolveCellJourney,
} from "../r2-cell-driver.mjs";
import {
  SCALE_REPLAY_FIXTURE_AUTHORITY,
  SCALE_REPLAY_RECEIPT_VERSION,
} from "../scale-replay-evidence.mjs";
import {
  CURRENT_INSTRUMENT_PIN,
  CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION,
} from "../observations.mjs";
import { validateSocialMessengerRunRecord } from "../../record-validator.mjs";
import { validateFinalizedCellSlot } from "../r2-finalized-cell.mjs";
import { validateJsonSchema } from "../../../lib/json-schema.mjs";

const ROOT = new URL("../../../../../", import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);

function tokenCounts(input, output) {
  return { input, output, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

function nullCounts() {
  return { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null };
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function gitObjectDigest(type, bytes, algorithm = "sha1") {
  return createHash(algorithm)
    .update(Buffer.from(`${type} ${bytes.byteLength}\0`))
    .update(bytes)
    .digest("hex");
}

function fullJourneyConfig() {
  return {
    milestones: ["M1", "M2", "M3", "M4", "M5", "M6", "M8", "M7"],
    cell: { harness: "codex-sol", m7Ports: [48_600, 48_659] },
    harnessConfig: {
      execution: {
        sessionShape: {
          continuous: ["M1", "M2", "M3", "M4", "M5", "M6", "M8"],
          fresh: ["M7"],
          m7FreshSessionRequired: true,
          m7BackendState: "fresh-starter-only-pre-replay",
        },
      },
    },
  };
}

function scaleReplayReceipt({
  actionLogSha256 = SCALE_REPLAY_FIXTURE_AUTHORITY.actionLogSha256,
  settledPrefix = SCALE_REPLAY_FIXTURE_AUTHORITY.actionCount,
  failedActions = 0,
  pass = true,
} = {}) {
  return {
    version: SCALE_REPLAY_RECEIPT_VERSION,
    pass,
    actionLog: {
      sha256: actionLogSha256,
      actionCount: SCALE_REPLAY_FIXTURE_AUTHORITY.actionCount,
    },
    checkpoints: SCALE_REPLAY_FIXTURE_AUTHORITY.checkpoints.filter(
      (checkpoint) => checkpoint.settledPrefix <= settledPrefix,
    ),
    settledPrefix,
    failedActions,
  };
}

function codexTokenRecord(
  ordinal,
  timestamp,
  input,
  output,
  lastInput = input,
  lastOutput = output,
) {
  return {
    ordinal,
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: output,
          reasoning_output_tokens: 0,
          total_tokens: input + output,
        },
        last_token_usage: {
          input_tokens: lastInput,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: lastOutput,
          reasoning_output_tokens: 0,
          total_tokens: lastInput + lastOutput,
        },
      },
    },
  };
}

test("full journey composes continuous D0.6 blocks and a separately clocked fresh M7", () => {
  const journey = resolveCellJourney(fullJourneyConfig());
  assert.equal(journey.runScope, "full");
  assert.deepEqual(journey.continuous, ["M1", "M2", "M3", "M4", "M5", "M6", "M8"]);
  assert.deepEqual(journey.fresh, ["M7"]);

  const executionOrder = ["M1", "M2", "M3", "M4", "M5", "M6", "M8", "M7"];
  const origin = Date.parse("2026-08-25T12:00:00.000Z");
  const boundaries = Object.fromEntries(executionOrder.map((milestone, index) => {
    const terminalAt = new Date(origin + ((index + 1) * 1_000)).toISOString();
    return [milestone, {
      status: "green",
      firstGreenAt: terminalAt,
      suitePassAt: terminalAt,
      choreoPassAt: terminalAt,
      terminalAt,
      terminalSequence: index + 1,
      terminalReason: "green",
    }];
  }));
  boundaries.M7.firstGreenAt = "2026-08-25T12:00:35.000Z";
  boundaries.M7.suitePassAt = boundaries.M7.firstGreenAt;
  boundaries.M7.choreoPassAt = boundaries.M7.firstGreenAt;
  boundaries.M7.terminalAt = boundaries.M7.firstGreenAt;
  const turns = executionOrder.map((milestone, index) => ({
    id: `${milestone}-native-turn`,
    sourceId: milestone === "M7" ? "fresh-m7" : "builder",
    completedAt: boundaries[milestone].terminalAt,
    usage: tokenCounts(10, 1),
  }));
  const patch = joinUsageToMilestones({
    channel: {
      source: "codex-rollout-token-count",
      turns,
      unavailableReason: null,
    },
    boundaries,
    firstProductEdit: {
      at: new Date(origin).toISOString(),
      orientationBytes: 0,
      selectedSkills: [],
    },
    wallClockOrigin: new Date(origin).toISOString(),
    milestoneWallStarts: { M7: "2026-08-25T12:00:30.000Z" },
    provenance: {
      laneRunId: "full-journey-fixture",
      driver: {
        id: "social-messenger-full-journey-native-cli-driver.v1",
        startedAt: new Date(origin).toISOString(),
        stampedAt: boundaries.M7.terminalAt,
      },
    },
    separateTokenPhases: { replay: tokenCounts(20, 2) },
  });
  const base = {
    socialMessenger: {
      runScope: "full",
      milestones: Object.fromEntries(executionOrder.map((milestone) => [milestone, {
        caps: { wallCapSeconds: 3_600, tokenCap: 100_000 },
      }])),
      clocks: {
        grading: { sessions: [{ wallSeconds: 0, tokens: nullCounts() }] },
        replay: { attempted: true, wallSeconds: 20, capSeconds: 60, capFractionUsed: 1 / 3, capExhausted: false, probeWallSecondsExcluded: 0 },
        m7Session: { wallSeconds: null, tokens: nullCounts() },
      },
    },
  };
  const record = composeRunRecord({ base, patch, expectedMilestones: executionOrder });
  for (const milestone of executionOrder) {
    assert.deepEqual(record.socialMessenger.milestones[milestone].authoring.tokens, tokenCounts(10, 1));
  }
  assert.equal(record.socialMessenger.milestones.M8.authoring.wallSeconds, 1);
  assert.equal(record.socialMessenger.milestones.M7.authoring.wallSeconds, 5);
  assert.deepEqual(record.socialMessenger.clocks.m7Session, {
    wallSeconds: 5,
    tokens: tokenCounts(10, 1),
  });
  assert.deepEqual(record.socialMessenger.clocks.replay.tokens, tokenCounts(20, 2));
  assert.deepEqual(record.wallClock, {
    totalSeconds: 32,
    phases: {
      orientation: 0,
      authoring: 7,
      replay: 20,
      m7Session: 5,
      verification: 0,
      diagnosis: 0,
    },
  });
  assert.deepEqual(record.tokens, {
    input: 100,
    output: 10,
    source: "codex-rollout-token-count",
    phases: {
      orientation: 0,
      authoring: 77,
      replay: 22,
      m7Session: 11,
      verification: 0,
      diagnosis: 0,
    },
  });
  assert.equal(
    Object.values(record.wallClock.phases).reduce((sum, value) => sum + value, 0),
    record.wallClock.totalSeconds,
  );
  assert.equal(
    Object.values(record.tokens.phases).reduce((sum, value) => sum + value, 0),
    record.tokens.input + record.tokens.output,
  );
  assert.equal(record.socialMessenger.runScope, "full");
});

test("production admission refuses unsupported full-journey harnesses before host-lock consumption", async () => {
  for (const harness of ["claude-opus5", "grok-46"]) {
    const root = await realpath(await mkdtemp(join(tmpdir(), `r2-${harness}-preflight-`)));
    try {
      const config = {
        ...fullJourneyConfig(),
        repositoryRoot: ROOT_PATH,
        cell: { ...fullJourneyConfig().cell, harness },
      };
      assert.throws(
        () => resolveCellJourney(config),
        /has no registered composable full-journey accounting contract.*before admission or controller host-lock consumption/u,
      );
      await assert.rejects(
        preflightR2CellDriver({ config, configDirectory: root }),
        /has no registered composable full-journey accounting contract.*before admission or controller host-lock consumption/u,
      );
      await assert.rejects(stat(join(root, "rendered-prompt.md")), { code: "ENOENT" });
      const harnessConfigPath = join(root, "harness-config.json");
      await writeFile(harnessConfigPath, `${JSON.stringify({
        schemaVersion: "snapback.r2-harness-config.v1",
        status: "serial-per-cell-admission",
        execution: {
          serial: true,
          maxConcurrentCells: 1,
          milestones: config.milestones,
          sessionShape: config.harnessConfig.execution.sessionShape,
        },
        cells: [{ id: "unsupported-full", ...config.cell }],
      })}\n`);
      let lockCalls = 0;
      await assert.rejects(createAdmissionArtifact({
        harnessConfigPath,
        cellId: "unsupported-full",
        reservedBy: "test",
        admissionPath: join(root, "admission.json"),
        dependencies: {
          acquireExclusiveHostLock: () => { lockCalls += 1; },
        },
      }), /before admission or controller host-lock consumption/u);
      assert.equal(lockCalls, 0, "production admission must refuse before acquiring the host lock");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("fresh M7 prompt and process state carry handoff-only context", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "r2-fresh-m7-")));
  try {
    await writeFile(join(root, "m7-handoff.md"), "Sealed M7 instructions only.\n");
    const originalSessionId = "continuous-session-id";
    const state = {
      root,
      config: {
        repositoryRoot: ROOT_PATH,
        cell: { harness: "codex-sol", m7Ports: [48_600, 48_659] },
      },
      exit: Promise.resolve({ code: 0, signal: null }),
      closed: Promise.resolve({ code: 0, signal: null }),
      streamWriteQueue: Promise.resolve(),
      currentSession: { nativeSessionId: originalSessionId },
      nativeSessionId: originalSessionId,
      child: { stale: true },
      m7Handoff: null,
      m7HandoffSource: null,
    };
    await r2CellDriverTestHooks.beginFreshM7Session(state);
    assert.equal(state.currentSession.sourceId, "fresh-m7");
    assert.equal(state.currentSession.role, "builder-descendant");
    assert.equal(state.currentSession.parentSourceId, "builder");
    assert.notEqual(state.currentSession.nativeSessionId, originalSessionId);
    assert.equal(state.child, null);
    assert.match(state.currentSession.renderedPrompt, /Sealed M7 instructions only/u);
    assert.doesNotMatch(state.currentSession.renderedPrompt, /continuous-session-id/u);
    assert.equal(state.m7Handoff.contextPolicy, "fresh-native-session-handoff-only.v1");
    assert.equal(state.m7Handoff.backendState, "fresh-starter-only-pre-replay");
    assert.equal((await readFile(join(root, "rendered-m7-prompt.md"), "utf8")), state.currentSession.renderedPrompt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("full-journey manifest binding excludes replay turns before fresh M7 accounting", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "r2-full-accounting-")));
  try {
    const attempts = [{
      attempt: 1,
      continuationOf: null,
      disposition: "completed",
      startedAt: "2026-08-25T12:00:05.000Z",
      finishedAt: "2026-08-25T12:00:15.000Z",
      settledPrefix: SCALE_REPLAY_FIXTURE_AUTHORITY.actionCount,
    }];
    const receiptValue = scaleReplayReceipt();
    const receiptBytes = Buffer.from(`${JSON.stringify(receiptValue)}\n`);
    const scaleValue = {
      version: "snapback.full-journey-scale-replay.v1",
      attempted: true,
      wallSeconds: 9,
      capSeconds: 60,
      capFractionUsed: 0.15,
      capExhausted: false,
      probeWallSecondsExcluded: 1,
      attempts,
      receipt: { path: "scale-replay-receipt.json", sha256: digest(receiptBytes) },
    };
    const scaleBytes = Buffer.from(`${JSON.stringify(scaleValue)}\n`);
    const handoffBytes = Buffer.from("fresh handoff\n");
    const promptBytes = Buffer.from("fresh prompt\n");
    await writeFile(join(root, "scale-replay.json"), scaleBytes);
    await writeFile(join(root, "scale-replay-receipt.json"), receiptBytes);
    await writeFile(join(root, "m7-handoff.md"), handoffBytes);
    await writeFile(join(root, "rendered-m7-prompt.md"), promptBytes);
    const manifest = {
      driver: { id: "social-messenger-full-journey-native-cli-driver.v1" },
      freshSessionHandoff: {
        contextPolicy: "fresh-native-session-handoff-only.v1",
        backendState: "fresh-starter-only-pre-replay",
        source: { path: "m7-handoff.md", sha256: digest(handoffBytes) },
        renderedPrompt: { path: "rendered-m7-prompt.md", sha256: digest(promptBytes) },
      },
      scaleReplay: {
        path: "scale-replay.json",
        sha256: digest(scaleBytes),
        clock: {
          attempted: true,
          wallSeconds: 9,
          capSeconds: 60,
          capFractionUsed: 0.15,
          capExhausted: false,
          probeWallSecondsExcluded: 1,
        },
        attempts,
        receipt: scaleValue.receipt,
      },
    };
    const result = await bindFullJourneyAccounting({
      manifest,
      manifestDirectory: root,
      boundaryValue: {
        milestones: {
          M8: { status: "green", terminalAt: "2026-08-25T12:00:02.000Z" },
          M7: { status: "green", terminalAt: "2026-08-25T12:00:25.000Z" },
        },
      },
      driverCompatibility: {
        usageSettlements: [{
          milestone: "M8",
          usageAvailable: true,
          usageSettledAt: "2026-08-25T12:00:04.000Z",
        }],
      },
      loadedSessions: [
        { sourceId: "builder", startedAt: "2026-08-25T12:00:00.000Z" },
        { sourceId: "fresh-m7", startedAt: "2026-08-25T12:00:20.000Z" },
      ],
      channel: {
        turns: [
          { id: "m8", sourceId: "builder", completedAt: "2026-08-25T12:00:04.000Z", usage: tokenCounts(10, 1) },
          { id: "scale", sourceId: "builder", completedAt: "2026-08-25T12:00:10.000Z", usage: tokenCounts(20, 2) },
          { id: "m7", sourceId: "fresh-m7", completedAt: "2026-08-25T12:00:25.000Z", usage: tokenCounts(30, 3) },
        ],
      },
    });
    assert.deepEqual(result.channel.turns.map((turn) => turn.id), ["m8", "m7"]);
    assert.deepEqual(result.milestoneWallStarts, { M7: "2026-08-25T12:00:20.000Z" });
    assert.deepEqual(result.separateTokenPhases, { replay: tokenCounts(20, 2) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("full-journey replay rejects a self-consistent receipt for the wrong action log", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "r2-forged-replay-")));
  try {
    const attempts = [{
      attempt: 1,
      continuationOf: null,
      disposition: "completed",
      startedAt: "2026-08-25T12:00:05.000Z",
      finishedAt: "2026-08-25T12:00:15.000Z",
      settledPrefix: SCALE_REPLAY_FIXTURE_AUTHORITY.actionCount,
    }];
    const forgedReceipt = scaleReplayReceipt({ actionLogSha256: `sha256:${"0".repeat(64)}` });
    const forgedReceiptBytes = Buffer.from(`${JSON.stringify(forgedReceipt)}\n`);
    const receipt = {
      path: "scale-replay-receipt.json",
      sha256: digest(forgedReceiptBytes),
    };
    const clock = {
      attempted: true,
      wallSeconds: 10,
      capSeconds: 60,
      capFractionUsed: 1 / 6,
      capExhausted: false,
      probeWallSecondsExcluded: 0,
    };
    const scaleValue = {
      version: "snapback.full-journey-scale-replay.v1",
      ...clock,
      attempts,
      receipt,
    };
    const scaleBytes = Buffer.from(`${JSON.stringify(scaleValue)}\n`);
    await writeFile(join(root, "scale-replay.json"), scaleBytes);
    await writeFile(join(root, receipt.path), forgedReceiptBytes);
    await assert.rejects(bindFullJourneyAccounting({
      manifest: {
        driver: { id: "social-messenger-full-journey-native-cli-driver.v1" },
        scaleReplay: {
          path: "scale-replay.json",
          sha256: digest(scaleBytes),
          clock,
          attempts,
          receipt,
        },
      },
      manifestDirectory: root,
      boundaryValue: {
        milestones: { M8: { status: "green", terminalAt: "2026-08-25T12:00:02.000Z" } },
      },
      driverCompatibility: {
        usageSettlements: [{
          milestone: "M8",
          usageAvailable: true,
          usageSettledAt: "2026-08-25T12:00:04.000Z",
        }],
      },
      loadedSessions: [{ sourceId: "builder", startedAt: "2026-08-25T12:00:00.000Z" }],
      channel: { turns: [] },
    }), /does not bind the registered fixture action log/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production full-journey load and join accept an equality-bound Codex settlement", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "r2-full-load-join-")));
  try {
    const laneRunId = "2026-08-25-full-load-join/codex-sol";
    const nativeSessionId = "0198d535-4a80-7000-8000-000000000001";
    const runId = "0198d535-4a80-7000-8000-000000000002";
    const startedAt = "2026-08-25T12:00:00.000Z";
    const terminalAt = "2026-08-25T12:00:02.000Z";
    const settledAt = "2026-08-25T12:00:04.000Z";
    const replayStartedAt = "2026-08-25T12:00:05.000Z";
    const replayFinishedAt = "2026-08-25T12:00:15.000Z";
    const stampedAt = "2026-08-25T12:00:16.000Z";
    const nativeRecords = [{
      ordinal: 0,
      timestamp: startedAt,
      type: "session_meta",
      payload: { id: nativeSessionId, cli_version: "0.100.0-test" },
    }, {
      ordinal: 1,
      timestamp: "2026-08-25T12:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "item_completed",
        item: {
          id: "first-product-edit",
          type: "FileChange",
          status: "completed",
          changes: {
            "/fixture/codex-sol/src/app.ts": {
              type: "add",
              content: "export const fullJourney = true;\n",
            },
          },
        },
      },
    }, {
      ordinal: 2,
      timestamp: terminalAt,
      type: "event_msg",
      payload: {
        type: "item_completed",
        item: {
          id: "m8-signal",
          type: "CommandExecution",
          status: "completed",
          exit_code: 0,
          command: ["node", "/fixture/r2-cell-signal.mjs", "--milestone", "M8"],
        },
      },
    },
    codexTokenRecord(3, settledAt, 10, 1),
    // This later native ordinal deliberately shares the authorized
    // settlement millisecond. Timestamp-only joins used to steal it into M8.
    codexTokenRecord(4, settledAt, 15, 2, 5, 1),
    codexTokenRecord(5, "2026-08-25T12:00:10.000Z", 20, 3, 5, 1),
    {
      ordinal: 6,
      timestamp: stampedAt,
      type: "event_msg",
      payload: { type: "task_complete" },
    }];
    const nativeBytes = Buffer.from(`${nativeRecords.map(JSON.stringify).join("\n")}\n`);
    const boundaryValue = {
      laneRunId,
      driverId: "social-messenger-full-journey-native-cli-driver.v1",
      milestones: {
        M8: {
          status: "green",
          firstGreenAt: terminalAt,
          suitePassAt: terminalAt,
          choreoPassAt: terminalAt,
          terminalAt,
          terminalSequence: 1,
          terminalReason: "green",
        },
      },
    };
    const boundaryBytes = Buffer.from(`${JSON.stringify(boundaryValue)}\n`);
    const recoveredFileChanges = recoverCodexFileChanges({
      records: nativeRecords,
      boundaryValue,
      laneRunId,
      productRoot: "/fixture/codex-sol",
      sourceId: "builder",
      nativeSessionId,
      nativeStreamSha256: digest(nativeBytes),
    });
    const firstProductEditBytes = Buffer.from(
      `${JSON.stringify(recoveredFileChanges.firstProductEdit)}\n`,
    );
    const fileChangeObservationBytes = Buffer.from(
      `${recoveredFileChanges.events.map(JSON.stringify).join("\n")}\n`,
    );
    const observationCoverageBytes = Buffer.from(`${JSON.stringify({
      version: "social-messenger-observation.v1",
      laneRunId,
      milestone: "M8",
      sequence: 1,
      at: startedAt,
      type: "block-claim",
      block: "semanticActions",
      owner: null,
      claimed: true,
      reason: null,
    })}\n`);
    const suiteReceiptBytes = Buffer.from(`${JSON.stringify({ milestone: "M8", pass: true })}\n`);
    const summary = {
      version: "0.3.4-m8",
      runId,
      recordedAt: terminalAt,
      type: "segment-summary",
      segment: "m8",
      assertion: "__segment__",
      implemented: true,
      required: true,
      status: "passed",
      pass: true,
      timings: [{
        attempt: 1,
        pass: true,
        startedAt: "2026-08-25T12:00:01.000Z",
        durationMs: 1_000,
        settlementWaitMs: 0,
        metrics: {},
      }],
      bestOf: 1,
      details: { selection: "single", selectedAttempt: 1, reason: null },
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
        receipt: "m8-suite.json",
        receiptSha256: digest(suiteReceiptBytes),
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
    };
    const summaryBytes = Buffer.from(`${JSON.stringify(summary)}\n`);
    const attempts = [{
      attempt: 1,
      continuationOf: null,
      disposition: "completed",
      startedAt: replayStartedAt,
      finishedAt: replayFinishedAt,
      settledPrefix: SCALE_REPLAY_FIXTURE_AUTHORITY.actionCount,
    }];
    const replayReceiptValue = scaleReplayReceipt();
    const replayReceiptBytes = Buffer.from(`${JSON.stringify(replayReceiptValue)}\n`);
    const replayReceipt = {
      path: "scale-replay-receipt.json",
      sha256: digest(replayReceiptBytes),
    };
    const replayClock = {
      attempted: true,
      wallSeconds: 10,
      capSeconds: 60,
      capFractionUsed: 1 / 6,
      capExhausted: false,
      probeWallSecondsExcluded: 0,
    };
    const replayValue = {
      version: "snapback.full-journey-scale-replay.v1",
      ...replayClock,
      attempts,
      receipt: replayReceipt,
    };
    const replayBytes = Buffer.from(`${JSON.stringify(replayValue)}\n`);
    const registeredConfigPath = fileURLToPath(new URL(
      "benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/harness-config.json",
      ROOT,
    ));
    const registeredConfig = JSON.parse(await readFile(registeredConfigPath, "utf8"));
    const registeredCell = registeredConfig.cells.find(
      (cell) => cell.id === "capstone-clique-explicit-sol-high",
    );
    const driverPreflight = await preflightR2CellDriver({
      config: {
        laneRunId,
        milestones: registeredConfig.execution.milestones,
        repositoryRoot: ROOT_PATH,
        planDirectory: join(ROOT_PATH, "benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone"),
        harnessConfig: registeredConfig,
        cell: registeredCell,
        harness: registeredConfig.harnesses[registeredCell.harness],
        allowedMachine: registeredConfig.machines[registeredCell.allowedHostId],
      },
      configDirectory: root,
    });
    const recordBaseBytes = Buffer.from(`${JSON.stringify(driverPreflight.recordBase, null, 2)}\n`);
    const suiteStatusBytes = Buffer.from(`${JSON.stringify({
      m8: { pass: true, receipt: "m8-suite.json" },
    })}\n`);
    await Promise.all([
      writeFile(join(root, "codex.jsonl"), nativeBytes),
      writeFile(join(root, "terminal-boundaries.json"), boundaryBytes),
      writeFile(join(root, "m8-choreography.jsonl"), summaryBytes),
      writeFile(join(root, "m8-suite.json"), suiteReceiptBytes),
      writeFile(join(root, "scale-replay.json"), replayBytes),
      writeFile(join(root, replayReceipt.path), replayReceiptBytes),
      writeFile(join(root, "record-base.json"), recordBaseBytes),
      writeFile(join(root, "suite-status.json"), suiteStatusBytes),
      writeFile(join(root, "first-product-edit.json"), firstProductEditBytes),
      writeFile(
        join(root, "codex-file-change-observations.jsonl"),
        fileChangeObservationBytes,
      ),
      writeFile(join(root, "observation-coverage.jsonl"), observationCoverageBytes),
    ]);
    const manifest = {
      manifestVersion: "social-messenger-metering-manifest.v1",
      laneRunId,
      capFamily: "gpt-frontier",
      adapter: "codex",
      unavailableReason: null,
      sessions: [{
        sourceId: "builder",
        parentSourceId: null,
        role: "builder",
        startedAt,
        nativeSessionId,
        nativeAgentId: null,
        path: "codex.jsonl",
        sha256: digest(nativeBytes),
      }],
      receipts: [{
        sourceId: "m8-choreography",
        runId,
        milestone: "M8",
        path: "m8-choreography.jsonl",
        sha256: digest(summaryBytes),
      }],
      observations: [{
        sourceId: "codex-file-change-observations",
        path: "codex-file-change-observations.jsonl",
        sha256: digest(fileChangeObservationBytes),
      }, {
        sourceId: "observation-coverage",
        path: "observation-coverage.jsonl",
        sha256: digest(observationCoverageBytes),
      }],
      boundaries: { path: "terminal-boundaries.json", sha256: digest(boundaryBytes) },
      firstProductEdit: {
        path: "first-product-edit.json",
        sha256: digest(firstProductEditBytes),
      },
      suiteStatus: { path: "suite-status.json", sha256: digest(suiteStatusBytes) },
      recordBase: { path: "record-base.json", sha256: digest(recordBaseBytes) },
      clockCorrelation: {
        method: "rfc3339-with-bounded-skew",
        maxSkewMillis: 5_000,
        evidence: "controller and native CLI use the same host clock; 5s covers receipt-to-final-sample handoff",
      },
      driver: {
        id: "social-messenger-full-journey-native-cli-driver.v1",
        startedAt,
        stampedAt,
        instrumentationCommandsObserved: false,
      },
      scaleReplay: {
        path: "scale-replay.json",
        sha256: digest(replayBytes),
        clock: replayClock,
        attempts,
        receipt: replayReceipt,
      },
    };
    const manifestPath = join(root, "metering-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);

    const loaded = await loadMeteringManifest(manifestPath);
    assert.equal(loaded.maxClockSkewMs, 0);
    assert.equal(loaded.usageSettlements[0].usageSettledAt, settledAt);
    assert.equal(loaded.provenance.driver.compatibilityEvents.length, 1);
    assert.equal(loaded.channel.turns[0].nativeRecordOrdinal, 3);
    assert.deepEqual(loaded.separateTokenPhases, { replay: tokenCounts(10, 2) });
    const extension = JSON.parse(await readFile(new URL(
      "benchmarks/schema/social-messenger/run-record-extension.schema.json",
      ROOT,
    ), "utf8"));
    assert.deepEqual(validateJsonSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://snapback.dev/benchmarks/test/full-journey-provenance.schema.json",
      $ref: `${extension.$id}#/properties/meteringProvenance`,
    }, loaded.provenance, { schemas: [extension] }), []);
    const joined = joinUsageToMilestones(loaded);
    assert.deepEqual(joined.milestones.M8.authoring.tokens, tokenCounts(10, 1));
    assert.deepEqual(joined.separateTokenPhases, { replay: tokenCounts(10, 2) });
    const schemaPaths = Object.fromEntries(["base", "extension", "composed"].map((name) => [
      name,
      join(root, `permissive-${name}-schema.json`),
    ]));
    await Promise.all(Object.entries(schemaPaths).map(([name, path]) => writeFile(
      path,
      `${JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: `https://snapback.dev/benchmarks/test/permissive-${name}.schema.json`,
      })}\n`,
    )));
    const authoritativeController = new R2LaneController({
      laneRunId,
      observationPath: join(root, "unused-controller-observations.jsonl"),
      loadCeilings: { loadavg1: 10, loadavg5: 10, loadavg15: 10 },
    });
    const record = await authoritativeController.writeCompleteRecord({
      patch: joined,
      recordBasePath: join(root, "record-base.json"),
      recordPath: join(root, "record.json"),
      expectedMilestones: registeredConfig.execution.milestones,
      baseSchemaPath: schemaPaths.base,
      extensionSchemaPath: schemaPaths.extension,
      composedSchemaPath: schemaPaths.composed,
    });
    assert.equal(record.socialMessenger.runScope, "full");
    assert.equal(record.socialMessenger.milestones.M8.status, "green");
    assert.equal(record.tokens.phases.replay, 12);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M8 closes at its first post-signal usage settlement while replay usage trails", () => {
  const records = [{
    ordinal: 0,
    timestamp: "2026-08-25T12:00:02.000Z",
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        id: "m8-signal",
        type: "CommandExecution",
        status: "completed",
        exit_code: 0,
        command: ["node", "/fixture/r2-cell-signal.mjs", "--milestone", "M8"],
      },
    },
  }, {
    ordinal: 1,
    timestamp: "2026-08-25T12:00:04.000Z",
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: {} } },
  }, {
    ordinal: 2,
    timestamp: "2026-08-25T12:00:10.000Z",
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: {} } },
  }, {
    ordinal: 3,
    timestamp: "2026-08-25T12:00:16.000Z",
    type: "event_msg",
    payload: { type: "task_complete" },
  }];
  const recovered = recoverCodexSignalSettlements({
    records,
    boundaryValue: {
      M8: {
        status: "green",
        terminalAt: "2026-08-25T12:00:02.000Z",
        terminalSequence: 1,
      },
    },
    closingSettlementSelection: "first",
    allowTrailingUsage: true,
  });
  assert.equal(recovered.usageSettlements[0].usageRecordOrdinal, 1);
  assert.equal(recovered.usageSettlements[0].settlementKind, "closing-signal-first-token-count");
});

test("mid-replay failure preserves green M8 and partitions replay as an aborted phase", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "r2-mid-replay-failure-")));
  const laneRunId = "mid-replay-failure/codex-sol";
  const m8TerminalAt = new Date().toISOString();
  let releaseSettlement;
  const settlementReady = new Promise((resolveSettlement) => {
    releaseSettlement = resolveSettlement;
  });
  setTimeout(() => {
    const signalCompletedAt = new Date(Date.now() - 1).toISOString();
    const usageSettledAt = new Date().toISOString();
    releaseSettlement([{
      ordinal: 0,
      timestamp: signalCompletedAt,
      type: "event_msg",
      payload: {
        type: "item_completed",
        item: {
          id: "m8-signal",
          type: "CommandExecution",
          status: "completed",
          exit_code: 0,
          command: ["node", "/fixture/r2-cell-signal.mjs", "--milestone", "M8"],
        },
      },
    }, {
      ordinal: 1,
      timestamp: usageSettledAt,
      type: "event_msg",
      payload: { type: "token_count", info: { total_token_usage: {} } },
    }]);
  }, 20);
  try {
    await mkdir(join(root, "events"));
    await mkdir(join(root, "gates"));
    const marker = {
      milestone: "M8",
      status: "green",
      terminalReason: "green",
      recordedAt: m8TerminalAt,
      suiteStatus: "suite-status.json",
      suiteObservations: "m8-suite-observations.jsonl",
      choreographyObservations: "m8-choreography-observations.jsonl",
    };
    await writeFile(
      join(root, "events/cell-milestones.jsonl"),
      `${JSON.stringify(marker)}\n`,
    );
    await writeFile(join(root, "scale-replay.json"), "{}\n");
    const state = {
      root,
      config: {
        laneRunId,
        cell: { harness: "codex-sol" },
        milestones: fullJourneyConfig().milestones,
        harnessConfig: { execution: { perMilestoneWallSafetyLimitSeconds: 1 } },
      },
      journey: { runScope: "full" },
      currentSession: {
        kind: "continuous",
        sourceId: "builder",
        nativeSessionId: "mid-replay-failure-native-session",
      },
      child: { retained: true },
      exit: new Promise(() => {}),
      controls: null,
      observationQueue: Promise.resolve(),
      observationFailure: null,
      observationSources: [],
      scaleReplay: null,
      scaleReplayFailure: null,
      failureDisposition: null,
      readLiveCodexRecords: async () => settlementReady,
    };
    r2CellDriverTestHooks.installState(laneRunId, state);
    await assert.rejects(runR2CellMilestone({
      milestone: "M8",
      controls: {},
      config: state.config,
    }), /scale replay receipt\.path/u);
    assert.equal(state.failureDisposition, "scale-replay-aborted");
    assert.equal(state.scaleReplayFailure.value.outcome, "aborted");
    assert.equal(
      JSON.parse((await readFile(join(root, "events/cell-milestones.jsonl"), "utf8")).trim()).status,
      "green",
      "the completed M8 marker must not be rewritten by a replay-phase failure",
    );

    const nativeRecords = await settlementReady;
    const recoveredSettlement = recoverCodexSignalSettlements({
      records: nativeRecords,
      boundaryValue: {
        M8: { status: "green", terminalAt: m8TerminalAt, terminalSequence: 1 },
      },
      closingSettlementSelection: "first",
      allowTrailingUsage: true,
      allowOpenWithoutTaskComplete: true,
    }).usageSettlements[0];
    assert.ok(
      Date.parse(state.scaleReplayFailure.value.startedAt)
        >= Date.parse(recoveredSettlement.usageSettledAt),
      "the aborted replay clock must start no earlier than authoritative M8 settlement recovery",
    );
    const settlement = {
      ...recoveredSettlement,
      nativeSourceId: "builder",
    };
    const channel = {
      source: "codex-rollout-token-count",
      unavailableReason: null,
      turns: [{
        id: "m8-authorized",
        sourceId: "builder",
        nativeRecordOrdinal: settlement.usageRecordOrdinal,
        completedAt: settlement.usageSettledAt,
        usage: tokenCounts(10, 1),
      }, {
        id: "replay-failed-turn",
        sourceId: "builder",
        nativeRecordOrdinal: settlement.usageRecordOrdinal + 1,
        completedAt: state.scaleReplayFailure.value.finishedAt,
        usage: tokenCounts(5, 1),
      }],
    };
    const accounting = bindFullJourneyAccountingValues({
      manifest: {
        driver: { id: "social-messenger-full-journey-native-cli-driver.v1" },
        scaleReplayFailure: state.scaleReplayFailure.artifact,
      },
      boundaryValue: {
        milestones: {
          M8: {
            status: "green",
            firstGreenAt: m8TerminalAt,
            suitePassAt: m8TerminalAt,
            choreoPassAt: m8TerminalAt,
            terminalAt: m8TerminalAt,
            terminalSequence: 1,
            terminalReason: "green",
          },
        },
      },
      driverCompatibility: { usageSettlements: [settlement] },
      loadedSessions: [{ sourceId: "builder", startedAt: m8TerminalAt }],
      channel,
      replayFailureValue: state.scaleReplayFailure.value,
    });
    const patch = joinUsageToMilestones({
      channel: accounting.channel,
      boundaries: {
        M8: {
          status: "green",
          firstGreenAt: m8TerminalAt,
          suitePassAt: m8TerminalAt,
          choreoPassAt: m8TerminalAt,
          terminalAt: m8TerminalAt,
          terminalSequence: 1,
          terminalReason: "green",
        },
      },
      firstProductEdit: {
        at: m8TerminalAt,
        orientationBytes: 0,
        selectedSkills: [],
      },
      wallClockOrigin: m8TerminalAt,
      usageSettlements: [settlement],
      separateTokenPhases: accounting.separateTokenPhases,
      separateClockPhases: accounting.separateClockPhases,
      provenance: {
        laneRunId,
        driver: {
          id: "social-messenger-full-journey-native-cli-driver.v1",
          startedAt: m8TerminalAt,
          stampedAt: state.scaleReplayFailure.value.finishedAt,
        },
      },
    });
    const record = composeRunRecord({
      base: {
        socialMessenger: {
          runScope: "full",
          termination: { reason: "scale-replay-aborted" },
          milestones: {
            M8: { caps: { wallCapSeconds: 3_600, tokenCap: 100_000 } },
            M7: { caps: { wallCapSeconds: 3_600, tokenCap: 100_000 } },
          },
          clocks: {
            grading: { sessions: [{ wallSeconds: 0, tokens: nullCounts() }] },
            replay: { attempted: false },
            m7Session: { wallSeconds: null, tokens: nullCounts() },
          },
        },
      },
      patch,
      expectedMilestones: ["M8", "M7"],
    });
    assert.equal(record.socialMessenger.milestones.M8.status, "green");
    assert.equal(record.socialMessenger.milestones.M7.status, "not-run");
    assert.equal(record.socialMessenger.clocks.replay.attempted, true);
    assert.equal(record.socialMessenger.termination.reason, "scale-replay-aborted");
    assert.equal(
      Object.values(record.wallClock.phases).reduce((sum, value) => sum + value, 0),
      record.wallClock.totalSeconds,
    );
    assert.equal(
      Object.values(record.tokens.phases).reduce((sum, value) => sum + value, 0),
      record.tokens.input + record.tokens.output,
    );
    assert.deepEqual(record.socialMessenger.milestones.M8.authoring.tokens, tokenCounts(10, 1));
    assert.equal(record.tokens.phases.replay, 6);
  } finally {
    r2CellDriverTestHooks.removeState(laneRunId);
    await rm(root, { recursive: true, force: true });
  }
});

test("an alive Codex CLI without post-M8 usage settles to the bounded replay-timeout disposition", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "r2-m8-settlement-timeout-")));
  const laneRunId = "m8-settlement-timeout/codex-sol";
  const m8TerminalAt = new Date().toISOString();
  const capSeconds = 0.025;
  const records = [{
    ordinal: 0,
    timestamp: m8TerminalAt,
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        id: "m8-signal",
        type: "CommandExecution",
        status: "completed",
        exit_code: 0,
        command: ["node", "/fixture/r2-cell-signal.mjs", "--milestone", "M8"],
      },
    },
  }];
  try {
    await mkdir(join(root, "events"));
    await mkdir(join(root, "gates"));
    const marker = {
      milestone: "M8",
      status: "green",
      terminalReason: "green",
      recordedAt: m8TerminalAt,
      suiteStatus: "suite-status.json",
      suiteObservations: "m8-suite-observations.jsonl",
      choreographyObservations: "m8-choreography-observations.jsonl",
    };
    await writeFile(
      join(root, "events/cell-milestones.jsonl"),
      `${JSON.stringify(marker)}\n`,
    );
    const state = {
      root,
      config: {
        laneRunId,
        cell: { harness: "codex-sol" },
        milestones: fullJourneyConfig().milestones,
        harnessConfig: { execution: { perMilestoneWallSafetyLimitSeconds: capSeconds } },
      },
      journey: { runScope: "full" },
      currentSession: {
        kind: "continuous",
        sourceId: "builder",
        nativeSessionId: "m8-settlement-timeout-native-session",
      },
      child: { retained: true },
      exit: new Promise(() => {}),
      controls: null,
      observationQueue: Promise.resolve(),
      observationFailure: null,
      observationSources: [],
      scaleReplay: null,
      scaleReplayFailure: null,
      failureDisposition: null,
      readLiveCodexRecords: async () => records,
    };
    r2CellDriverTestHooks.installState(laneRunId, state);
    const before = Date.now();
    await assert.rejects(runR2CellMilestone({
      milestone: "M8",
      controls: {},
      config: state.config,
    }), /R2_DRIVER_M8_SETTLEMENT_TIMEOUT: no post-M8 token_count/u);
    assert.ok(Date.now() - before < 1_000, "the settlement deadline must release finalization promptly");
    assert.equal(state.failureDisposition, "scale-replay-settlement-timeout");
    const failure = JSON.parse(await readFile(join(root, "scale-replay-failure.json"), "utf8"));
    assert.equal(failure.outcome, "settlement-timeout");
    assert.equal(failure.failure.cause, "missing-post-m8-token-count");
    assert.equal(failure.clock.attempted, true);
    assert.equal(failure.clock.capSeconds, capSeconds);
    assert.equal(failure.clock.capExhausted, true);
    assert.equal(
      Date.parse(failure.deadlineAt),
      Date.parse(failure.startedAt) + capSeconds * 1_000,
    );
    assert.equal(
      JSON.parse((await readFile(join(root, "events/cell-milestones.jsonl"), "utf8")).trim()).status,
      "green",
      "the timeout is a replay-phase disposition and must preserve green M8",
    );

    const settlement = {
      ...recoverCodexSignalSettlements({
        records,
        boundaryValue: {
          M8: { status: "green", terminalAt: m8TerminalAt, terminalSequence: 1 },
        },
        streamClosedAt: failure.finishedAt,
        closingSettlementSelection: "first",
        allowTrailingUsage: true,
        allowClosedWithoutTaskComplete: true,
        allowMissingClosingSettlement: true,
      }).usageSettlements[0],
      nativeSourceId: "builder",
    };
    assert.equal(settlement.usageAvailable, false);
    assert.equal(settlement.settlementKind, "closing-signal-settlement-timeout");
    const accounting = bindFullJourneyAccountingValues({
      manifest: {
        driver: { id: "social-messenger-full-journey-native-cli-driver.v1" },
        scaleReplayFailure: {
          ...state.scaleReplayFailure.artifact,
          outcome: "settlement-timeout",
        },
      },
      boundaryValue: {
        milestones: {
          M8: {
            status: "green",
            firstGreenAt: m8TerminalAt,
            suitePassAt: m8TerminalAt,
            choreoPassAt: m8TerminalAt,
            terminalAt: m8TerminalAt,
            terminalSequence: 1,
            terminalReason: "green",
          },
        },
      },
      driverCompatibility: { usageSettlements: [settlement] },
      loadedSessions: [{ sourceId: "builder", startedAt: m8TerminalAt }],
      channel: { source: "codex-rollout-token-count", unavailableReason: null, turns: [] },
      replayFailureValue: failure,
    });
    const patch = joinUsageToMilestones({
      channel: accounting.channel,
      boundaries: {
        M8: {
          status: "green",
          firstGreenAt: m8TerminalAt,
          suitePassAt: m8TerminalAt,
          choreoPassAt: m8TerminalAt,
          terminalAt: m8TerminalAt,
          terminalSequence: 1,
          terminalReason: "green",
        },
      },
      firstProductEdit: { at: m8TerminalAt, orientationBytes: 0, selectedSkills: [] },
      wallClockOrigin: m8TerminalAt,
      usageSettlements: [settlement],
      separateTokenPhases: accounting.separateTokenPhases,
      separateClockPhases: accounting.separateClockPhases,
      provenance: {
        laneRunId,
        driver: {
          id: "social-messenger-full-journey-native-cli-driver.v1",
          startedAt: m8TerminalAt,
          stampedAt: failure.finishedAt,
        },
      },
    });
    const record = composeRunRecord({
      base: {
        socialMessenger: {
          runScope: "full",
          termination: { reason: "scale-replay-settlement-timeout" },
          milestones: {
            M8: { caps: { wallCapSeconds: 3_600, tokenCap: 100_000 } },
            M7: { caps: { wallCapSeconds: 3_600, tokenCap: 100_000 } },
          },
          clocks: {
            grading: { sessions: [{ wallSeconds: 0, tokens: nullCounts() }] },
            replay: { attempted: false },
            m7Session: { wallSeconds: null, tokens: nullCounts() },
          },
        },
      },
      patch,
      expectedMilestones: ["M8", "M7"],
    });
    assert.equal(record.socialMessenger.milestones.M8.status, "green");
    assert.equal(record.socialMessenger.milestones.M7.status, "not-run");
    assert.equal(record.socialMessenger.termination.reason, "scale-replay-settlement-timeout");
    assert.equal(record.socialMessenger.clocks.replay.capExhausted, true);
  } finally {
    r2CellDriverTestHooks.removeState(laneRunId);
    await rm(root, { recursive: true, force: true });
  }
});

test("all retained R2 cells preserve their honestly classified validation state", async () => {
  assert.deepEqual(resolveCellJourney({ milestones: ["M1", "M2", "M3"] }), {
    runScope: "reduced",
    driverId: "social-messenger-r2-native-cli-driver.v1",
    continuous: ["M1", "M2", "M3"],
    fresh: [],
  });
  const schemas = await Promise.all([
    "benchmarks/schema/run-record.schema.json",
    "benchmarks/schema/social-messenger/run-record-extension.schema.json",
    "benchmarks/schema/social-messenger/run-record.schema.json",
  ].map(async (path) => JSON.parse(await readFile(new URL(path, ROOT), "utf8"))));
  const retained = [{
    cellId: "opus-clique-explicit",
    semanticFailure: /meteringProvenance|recordBase|compatibilityEvents|nativeCliVersion/u,
    completeFailure: /not an exact finalized single-attempt cell slot/u,
  }, {
    cellId: "sol-clique-explicit",
    semanticFailure: null,
    completeFailure: /suite-status m1 lacks a 0\.3\.4-m8 refusal-time attestation/u,
  }, {
    cellId: "sol-clique-familiar",
    semanticFailure: /correction action native-m3-205 names missing episode episode-m3-15/u,
    completeFailure: /correction action native-m3-205 names missing episode episode-m3-15/u,
  }];
  for (const expected of retained) {
    const cellRoot = fileURLToPath(new URL(
      `benchmarks/runs/2026-08-23-r2-published-0125/cells/${expected.cellId}/`,
      ROOT,
    ));
    const record = JSON.parse(await readFile(join(cellRoot, "record.json"), "utf8"));
    const semanticErrors = validateSocialMessengerRunRecord(schemas[2], record, {
      schemas: schemas.slice(0, 2),
      artifactRoot: cellRoot,
    });
    if (expected.semanticFailure === null) {
      assert.deepEqual(semanticErrors, [], expected.cellId);
    } else {
      assert.match(semanticErrors.join("; "), expected.semanticFailure, expected.cellId);
    }
    await assert.rejects(validateFinalizedCellSlot({
      slotPath: join(cellRoot, "cell.json"),
      cellId: expected.cellId,
      repositoryRoot: ROOT_PATH,
      expectedMilestones: ["M1", "M2", "M3"],
      requireCommitted: false,
    }), expected.completeFailure, expected.cellId);
  }
});

test("host identity dispatch probes Linux without fabricating unavailable fields", () => {
  let sysctlCalls = 0;
  const linux = currentHostIdentity({
    platform: () => "linux",
    hostname: () => "linux-runner",
    release: () => "6.8.12-test",
    arch: () => "x64",
    cpus: () => [{}, {}, {}, {}],
    totalmem: () => 68_719_476_736,
    sysctlValue: () => { sysctlCalls += 1; throw new Error("must not run"); },
    readTextFile: () => [
      "processor : 0",
      "physical id : 0",
      "core id : 0",
      "model name : Portable CPU",
      "",
      "processor : 1",
      "physical id : 0",
      "core id : 1",
      "model name : Portable CPU",
      "",
    ].join("\n"),
  });
  assert.deepEqual(linux, {
    hostname: "linux-runner",
    platform: "linux",
    release: "6.8.12-test",
    arch: "x64",
    hardwareModel: null,
    chip: "Portable CPU",
    physicalCpuCount: 2,
    logicalCpuCount: 4,
    memoryBytes: 68_719_476_736,
  });
  assert.equal(sysctlCalls, 0);

  const keys = [];
  const darwin = currentHostIdentity({
    platform: () => "darwin",
    hostname: () => "mac-runner",
    release: () => "25.6.0",
    arch: () => "arm64",
    cpus: () => Array(10).fill({}),
    totalmem: () => 34_359_738_368,
    sysctlValue: (key) => {
      keys.push(key);
      return { "hw.model": "MacBookPro18,3", "machdep.cpu.brand_string": "Apple M1 Pro", "hw.physicalcpu": "10" }[key];
    },
  });
  assert.equal(darwin.hardwareModel, "MacBookPro18,3");
  assert.equal(darwin.chip, "Apple M1 Pro");
  assert.equal(darwin.physicalCpuCount, 10);
  assert.deepEqual(keys, ["hw.model", "machdep.cpu.brand_string", "hw.physicalcpu"]);
});

test("gitless provisioning binds exact tree bytes and is shared by finalization", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-provisioning-")));
  const repositoryRoot = join(temp, "source");
  const manifestPath = join(temp, "provisioning.json");
  const configPath = join(repositoryRoot, "harness-config.json");
  try {
    await mkdir(join(repositoryRoot, "nested"), { recursive: true });
    await mkdir(join(repositoryRoot, "vendor", "uninitialized-submodule"), { recursive: true });
    await writeFile(join(repositoryRoot, "nested", "bytes.txt"), "byte-bound source\n");
    await writeFile(configPath, "{}\n");
    const gitlinks = [{
      path: "vendor/uninitialized-submodule",
      oid: "c".repeat(40),
    }];
    const content = measureProvisionedSourceTree({ repositoryRoot, gitlinks });
    const commitBytes = Buffer.from([
      `tree ${content.gitTree.oid}`,
      "author Provisioner <provisioner@example.com> 1787688000 +0000",
      "committer Provisioner <provisioner@example.com> 1787688000 +0000",
      "",
      "gitless deployment fixture",
      "",
    ].join("\n"));
    const commit = gitObjectDigest("commit", commitBytes);
    await writeFile(manifestPath, `${JSON.stringify({
      version: R2_PROVISIONING_MANIFEST_VERSION,
      source: {
        objectFormat: "sha1",
        commit,
        tree: content.gitTree.oid,
        gitlinks,
        commitObject: { encoding: "base64", data: commitBytes.toString("base64") },
      },
      content,
    }, null, 2)}\n`);
    const source = resolveSourceIdentity({ repositoryRoot, provisioningManifestPath: manifestPath });
    assert.equal(source.binding.content.algorithm, R2_PROVISIONING_CONTENT_VERSION);
    assert.equal(source.gitRead(["rev-parse", "HEAD"], repositoryRoot), commit);
    assert.equal(
      source.gitRead(["show", "HEAD:nested/bytes.txt"], repositoryRoot).toString("utf8"),
      "byte-bound source\n",
    );

    const accepted = new Error("accepted-provisioning-reader-reached-finalizer");
    await assert.rejects(finalizeExisting({
      harnessConfigPath: configPath,
      cellId: "fixture-cell",
      provisioningManifestPath: manifestPath,
      dependencies: {
        repositoryRoot,
        assertCommittedConfig: ({ gitRead }) => {
          assert.equal(gitRead(["rev-parse", "HEAD"], repositoryRoot), commit);
          throw accepted;
        },
      },
    }), (error) => error === accepted);
    await assert.rejects(finalizeExisting({
      harnessConfigPath: configPath,
      cellId: "fixture-cell",
      dependencies: {
        repositoryRoot,
        gitRead: () => { throw new Error("git executable absent"); },
      },
    }), /R2_FINALIZE_PROVISIONING_REQUIRED.*--provisioning-manifest/u);

    await writeFile(join(repositoryRoot, "nested", "bytes.txt"), "mutated source\n");
    assert.throws(
      () => resolveSourceIdentity({ repositoryRoot, provisioningManifestPath: manifestPath }),
      /R2_ADMISSION_PROVISIONING_MISMATCH/u,
    );
    assert.throws(
      () => resolveSourceIdentity({
        repositoryRoot,
        gitRead: () => { throw new Error("git executable absent"); },
      }),
      /R2_ADMISSION_PROVISIONING_REQUIRED.*--provisioning-manifest/u,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("campaign quiet probe includes every M7 port block", async () => {
  const harnessConfig = {
    cells: [
      { id: "one", ports: [41_000, 41_001], m7Ports: [42_000, 42_001] },
      { id: "two", ports: [43_000, 43_000], m7Ports: [44_000, 44_001] },
    ],
  };
  const expected = [41_000, 41_001, 42_000, 42_001, 43_000, 44_000, 44_001];
  assert.deepEqual(allCampaignPorts(harnessConfig), expected);
  const probed = [];
  const result = await probeLaunchQuiet({
    harnessConfig,
    seriality: { committedPrefix: [] },
    processProbe: () => ({ recorded: { pids: [], isolatedProcessGroups: [] }, active: [] }),
    portProbe: async (port) => { probed.push(port); return true; },
    now: () => Date.parse("2026-08-25T12:00:00.000Z"),
  });
  assert.deepEqual(probed.sort((left, right) => left - right), expected);
  assert.deepEqual(result.ports.values, expected);
});

test("current-pin smoke starts the controller and composes without lock or attempt consumption", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-non-consuming-smoke-")));
  const repositoryRoot = join(temp, "source");
  const privateRoot = join(temp, "private");
  const configPath = join(temp, "harness-config.json");
  const instrumentPath = join(repositoryRoot, "instrument.json");
  try {
    await mkdir(repositoryRoot);
    await mkdir(privateRoot);
    await writeFile(instrumentPath, '{"instrumentPin":"social-messenger@0.3.4-m8"}\n');
    const host = {
      hostname: "smoke-host",
      platform: "linux",
      release: "6.8.12-smoke",
      arch: "x64",
      hardwareModel: null,
      chip: "Smoke CPU",
      physicalCpuCount: 4,
      logicalCpuCount: 8,
      memoryBytes: 34_359_738_368,
    };
    const harnessConfig = {
      schemaVersion: "snapback.r2-harness-config.v1",
      status: "serial-per-cell-admission",
      runId: "smoke-run",
      cellOrder: ["smoke-cell"],
      pins: {
        instrument: {
          instrumentPin: CURRENT_INSTRUMENT_PIN,
          manifestPath: "instrument.json",
          d06MeteringOverlay: {
            laneControllerSha256: "1".repeat(64),
            productionDriverSha256: "2".repeat(64),
          },
        },
      },
      paths: { privateExecutionRoot: privateRoot, committedRunRoot: join(temp, "committed") },
      execution: {
        serial: true,
        maxConcurrentCells: 1,
        milestones: ["M1", "M2", "M3"],
        loadIsolation: {
          policies: {
            quiet: {
              policyId: "quiet",
              allowedHostId: "linux-smoke",
              sampleEverySeconds: 60,
              ceilingInclusive: { loadavg1: 10, loadavg5: 10, loadavg15: 10 },
            },
          },
        },
      },
      cells: [{
        id: "smoke-cell",
        harness: "codex-sol",
        allowedHostId: "linux-smoke",
        loadCeilingId: "quiet",
        ports: [45_000, 45_001],
      }],
      machines: { "linux-smoke": { id: "linux-smoke", ...host } },
      harnesses: { "codex-sol": { binary: "/fixture/codex", observedVersion: "0.149.0" } },
    };
    await writeFile(configPath, `${JSON.stringify(harnessConfig, null, 2)}\n`);
    let lockCalls = 0;
    const admissionDependencies = {
      repositoryRoot,
      resolveSourceIdentity: () => ({ gitRead: () => Buffer.from("{}\n"), binding: null }),
      assertCommittedConfig: () => {},
      inspectSeriality: async () => ({
        gitHead: "fixture-head",
        committedPrefix: [],
        requestedIndex: 0,
        laterPristine: [],
        landedDispositions: [],
        privateCellState: "absent",
      }),
      configuredExecutionBinding: () => ({
        node: { path: process.execPath, sha256: `sha256:${"3".repeat(64)}`, bytes: 123_456 },
        controller: { sha256: `sha256:${"1".repeat(64)}` },
        driver: { sha256: `sha256:${"2".repeat(64)}` },
        sourceClosure: { version: "fixture" },
      }),
      currentHostIdentity: () => host,
      harnessEvidence: () => ({ version: { ok: true }, auth: { ok: true } }),
      resolveInstrument: () => ({ root: "fixture", manifest: { sha256: "4".repeat(64) } }),
      probeLaunchQuiet: async () => ({
        priorProcessClosure: { closed: true },
        ports: { values: [45_000, 45_001], unbound: true },
      }),
      loadavg: () => [1, 2, 3],
      now: () => Date.parse("2026-08-25T12:00:00.000Z"),
      acquireExclusiveHostLock: () => { lockCalls += 1; throw new Error("production lock forbidden"); },
    };
    const readiness = await inspectNonConsumingAdmissionSmoke({
      harnessConfigPath: configPath,
      cellId: "smoke-cell",
      dependencies: admissionDependencies,
    });
    assert.equal(readiness.execution.node.bytes, 123_456);
    assert.equal(readiness.host.observed.release, "6.8.12-smoke");
    assert.equal(readiness.host.observed.memoryBytes, 34_359_738_368);
    assert.equal(lockCalls, 0);

    const firstProductEdit = {
      at: null,
      orientationBytes: null,
      orientationTokens: nullCounts(),
      selectedSkills: [],
    };
    const smoke = await runNonConsumingSmoke({
      harnessConfigPath: configPath,
      cellId: "smoke-cell",
      driverPath: join(ROOT_PATH, "benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs"),
      dependencies: {
        inspectAdmissionSmoke: async () => readiness,
        importDriver: async () => ({
          driver: {},
          preflight: {
            recordBase: {
              socialMessenger: {
                runScope: "reduced",
                instrumentVersion: CURRENT_INSTRUMENT_PIN,
                typingObservationBoundaryVersion: CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION,
                firstProductEdit,
                milestones: { M1: { caps: { wallCapSeconds: 60, tokenCap: null } } },
                clocks: { grading: { sessions: [{ wallSeconds: 0, tokens: nullCounts() }] } },
              },
            },
          },
        }),
        now: () => new Date("2026-08-25T12:00:00.000Z"),
      },
    });
    assert.equal(smoke.status, "non-scored");
    assert.equal(smoke.scored, false);
    assert.equal(smoke.attemptConsumed, false);
    assert.equal(smoke.productionLockAcquired, false);
    assert.equal(smoke.controller.initialized, true);
    assert.equal(smoke.controller.nativeSessionLaunched, false);
    assert.equal(smoke.recordComposition.instrumentPin, CURRENT_INSTRUMENT_PIN);
    assert.equal(lockCalls, 0);
    await assert.rejects(stat(join(privateRoot, "cells", "smoke-cell")), { code: "ENOENT" });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
