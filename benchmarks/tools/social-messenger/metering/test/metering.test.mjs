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
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  adaptClaudeSession,
  adaptClaudeSessionTree,
} from "../adapters/claude-session.mjs";
import {
  adaptCodexSession,
  adaptCodexSessionTree,
  CODEX_ADAPTER_VERSION,
} from "../adapters/codex-session.mjs";
import { adaptUnavailableFamily } from "../adapters/unavailable.mjs";
import {
  mergeBoundaryMaps,
  normalizeBoundaryMap,
  readReceiptBoundaryFiles,
} from "../boundaries.mjs";
import { joinUsageToMilestones } from "../joiner.mjs";
import { composeRunRecord } from "../record-composer.mjs";
import { recoverCodexSignalSettlements } from "../codex-native-evidence.mjs";
import {
  FINALIZATION_RAW_EXCERPT_LIMIT,
  formatFinalizationFailure,
  withFinalizationStage,
} from "../finalization-diagnostics.mjs";
import { parseJsonLines } from "../jsonl.mjs";
import {
  loadObservationCompatibility,
  loadMeteringManifest,
} from "../manifest.mjs";
import {
  completeAdmittedDriverPreflight,
  importAndPreflightR2Driver,
  runWithCellWallCap,
  loadLaneControllerConfig,
  R2LaneController,
  writeAttemptFailure,
  writeCampaignAttemptStart,
} from "../lane-controller.mjs";
import {
  admissionIdentity,
  allCampaignPorts,
  assertConductorStoppingRule,
  configuredExecutionBinding,
  createAdmissionArtifact,
  inspectAdmissionDiskFloor,
  inspectCommittedSeriality,
  liveSourceClosure,
  measureSourceClosure,
  probeLaunchQuiet,
  registeredCellExpectations,
  validateConductorReviewReceipt,
  verifyAdmissionArtifact,
} from "../r2-cell-admission.mjs";
import { finalizeExisting } from "../r2-finalize-existing.mjs";
import {
  finalize as finalizeProductionDriver,
  r2CellDriverTestHooks,
  reconcileSuiteStatuses,
  runMilestone as runProductionDriverMilestone,
} from "../r2-cell-driver.mjs";
import { validateFinalizedCellSlot } from "../r2-finalized-cell.mjs";
import {
  acquireExclusiveHostLock,
  claimExclusiveHostLock,
  poisonExclusiveHostLock,
  releaseExclusiveHostLock,
} from "../r2-host-lock.mjs";
import { createCellMutationGuard } from "../mutation-guard.mjs";
import {
  assertR2ExecutionEnvironment,
  scrubR2NodeLoaderEnvironment,
} from "../r2-execution-environment.mjs";
import { materializeInstrumentSnapshot } from "../../../materialize-instrument.mjs";
import {
  OBSERVABILITY_BLOCKS,
  OBSERVATION_VERSION,
  CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION,
  ObservationWriter,
  LaneObservationHarness,
  CURRENT_INSTRUMENT_PIN,
  isAfterTerminalHarnessTelemetry,
  isAfterTerminalHarnessTelemetryType,
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
const ROOT_PATH = fileURLToPath(ROOT);
const RETAINED_R2_CONFIG = new URL(
  "benchmarks/runs/2026-08-23-r2-published-0125/harness-config.json",
  ROOT,
);
const meterPath = fileURLToPath(new URL("../meter.mjs", import.meta.url));
const extensionSchema = JSON.parse(await readFile(
  new URL("benchmarks/schema/social-messenger/run-record-extension.schema.json", ROOT),
  "utf8",
));

test("cell wall cap terminates before returning a named fail-closed timeout", async () => {
  let terminated = null;
  await assert.rejects(runWithCellWallCap({
    cellWallCapSeconds: 14_400,
    operation: () => new Promise(() => {}),
    terminate: async (reason) => {
      terminated = reason;
      return { acknowledged: true };
    },
    setTimer: (callback) => { queueMicrotask(callback); return 1; },
    clearTimer: () => {},
    setGraceTimer: (callback) => { queueMicrotask(callback); return 2; },
    clearGraceTimer: () => {},
  }), (error) => (
    error.code === "R3_CELL_WALL_CAP_TIMEOUT"
    && error.processTerminationAcknowledged === true
    && error.operationSettledWithinGrace === false
  ));
  assert.deepEqual(terminated, {
    code: "R3_CELL_WALL_CAP_TIMEOUT",
    cellWallCapSeconds: 14_400,
  });
});

test("cell wall timeout aborts custody and refuses a resumed launch transition", async () => {
  let releaseOperation;
  const paused = new Promise((resolvePaused) => { releaseOperation = resolvePaused; });
  let launched = false;
  let terminationObservedAbort = false;
  await assert.rejects(runWithCellWallCap({
    cellWallCapSeconds: 14_400,
    abortGraceSeconds: 1,
    operation: async ({ signal, transition }) => {
      transition("preflight-complete");
      await paused;
      assert.equal(signal.aborted, true);
      transition("native-launch");
      launched = true;
    },
    terminate: async (reason) => {
      terminationObservedAbort = true;
      releaseOperation();
      return { acknowledged: true, reason };
    },
    setTimer: (callback) => { queueMicrotask(callback); return 1; },
    clearTimer: () => {},
  }), (error) => (
    error.code === "R3_CELL_WALL_CAP_TIMEOUT"
    && error.processTerminationAcknowledged === true
    && error.operationSettledWithinGrace === true
  ));
  assert.equal(terminationObservedAbort, true);
  assert.equal(launched, false, "the resumed operation must never cross the launch transition");
});

test("late wall-cap settlement poisons custody and refuses every zombie mutation path", async (t) => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r3-wall-custody-")));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await mkdir(join(temp, "private"));
  const harnessConfig = {
    runId: "wall-custody-fixture",
    paths: { privateExecutionRoot: join(temp, "private") },
    execution: { exclusiveHostLock: { path: join(temp, "private", "locks", "host.lock") } },
  };
  const lock = acquireExclusiveHostLock({
    harnessConfig,
    cellId: "cell-1",
    purpose: "admission",
    reservedBy: "wall-custody-test",
  });
  const claim = claimExclusiveHostLock({
    lock,
    harnessConfig,
    cellId: "cell-1",
    artifactSha256: `sha256:${"1".repeat(64)}`,
    execution: { controller: "fixture" },
  });
  const mutationGuard = createCellMutationGuard();
  const controller = new R2LaneController({
    laneRunId: "wall-custody-fixture/cell-1",
    observationPath: join(temp, "private", "observations.jsonl"),
    loadCeilings: { loadavg1: 10, loadavg5: 10, loadavg15: 10 },
    mutationGuard,
  });
  await controller.initialize();
  const controls = controller.controls("M1");
  r2CellDriverTestHooks.installMutationGuard(temp, mutationGuard);

  let permitLateSettlement;
  const late = new Promise((resolveLate) => { permitLateSettlement = resolveLate; });
  let resolveLateDone;
  const lateDone = new Promise((resolveDone) => { resolveLateDone = resolveDone; });
  const refused = [];
  let apiCallbackExecuted = false;
  let suiteCallbackExecuted = false;
  await assert.rejects(runWithCellWallCap({
    cellWallCapSeconds: 1,
    abortGraceSeconds: 1,
    mutationGuard,
    operation: async () => {
      await late;
      const mutations = [
        () => controller.restart("M1", async () => {}),
        () => controller.reseed("M1", {}, async () => {}),
        () => controls.apiRequest({
          provider: "fixture-provider",
          operation: "zombie-api-request",
          requestId: "zombie-api-request-1",
          retryOf: null,
        }, async () => { apiCallbackExecuted = true; }),
        () => controls.suiteAssertionWait({
          assertion: "zombie-suite-settlement",
          attempt: 1,
        }, async () => {
          suiteCallbackExecuted = true;
          return { pass: true };
        }),
        () => controller.writer.record("M1", "lifecycle", { operation: "restart", destructive: false }),
        () => controller.writeRecordPatch({}),
        () => controller.writeCompleteRecord({}),
        () => r2CellDriverTestHooks.guardedWriteFile(join(temp, "zombie-write"), "forbidden"),
      ];
      for (const mutation of mutations) {
        try { await mutation(); } catch (error) { refused.push(error.code); }
      }
      resolveLateDone();
    },
    terminate: async () => ({ acknowledged: true }),
    poisonCustody: async (reason) => poisonExclusiveHostLock({ lock, claim, reason }),
    setTimer: (callback) => { queueMicrotask(callback); return 1; },
    clearTimer: () => {},
    setGraceTimer: (callback) => { queueMicrotask(callback); return 2; },
    clearGraceTimer: () => {},
  }), (error) => (
    error.code === "R3_CELL_WALL_CAP_TIMEOUT"
    && error.operationSettledWithinGrace === false
    && error.custodyDiagnostic === "R3_CELL_WALL_CAP_CUSTODY_POISONED"
    && error.custodyPoisoned === true
  ));
  permitLateSettlement();
  await lateDone;
  assert.deepEqual(refused, Array(8).fill("R3_CELL_WALL_CAP_CUSTODY_POISONED"));
  assert.equal(apiCallbackExecuted, false, "a poisoned API control must not execute its callback");
  assert.equal(
    suiteCallbackExecuted,
    false,
    "a poisoned suite-settlement control must not execute its callback",
  );
  assert.equal((await stat(join(lock.path, "poison.json"))).isFile(), true);
  await assert.rejects(stat(join(temp, "zombie-write")), { code: "ENOENT" });
  assert.throws(() => releaseExclusiveHostLock({ lock, claim, outcome: "must-not-release" }),
    /R3_CELL_WALL_CAP_CUSTODY_POISONED/u);
  assert.throws(() => acquireExclusiveHostLock({
    harnessConfig,
    cellId: "cell-2",
    purpose: "admission",
    reservedBy: "must-not-recover",
    recoverStale: true,
    processAlive: () => false,
    mayRecoverOwner: () => true,
  }), /R3_CELL_WALL_CAP_CUSTODY_POISONED.*held for manual recovery/u);
});

test("disk-floor measurement uses statfs available blocks and names refusal", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r3-disk-floor-")));
  try {
    const harnessConfig = {
      paths: { privateExecutionRoot: temp },
      execution: { diskPolicy: {
        privateRootFreeSpaceFloorGiB: 20,
        refusalDiagnostic: "R3_ADMISSION_DISK_FLOOR",
      } },
    };
    const passing = inspectAdmissionDiskFloor({
      harnessConfig,
      statfs: () => ({ bsize: 4096n, bavail: 6_000_000n }),
      now: () => Date.parse("2026-08-26T20:00:00.000Z"),
    });
    assert.equal(passing.passed, true);
    assert.equal(passing.floorBytes, String(20n * 1024n * 1024n * 1024n));
    assert.throws(() => inspectAdmissionDiskFloor({
      harnessConfig,
      statfs: () => ({ bsize: 4096n, bavail: 1n }),
    }), /R3_ADMISSION_DISK_FLOOR/u);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("R3 admission stopping rule trips on two same-leg root causes and resets on success", () => {
  const harnessConfig = {
    runId: "review-test",
    cellOrder: ["a-1", "b-1", "a-2", "b-2", "a-3", "a-4"],
    cells: [
      { id: "a-1", leg: "A" }, { id: "b-1", leg: "B" },
      { id: "a-2", leg: "A" }, { id: "b-2", leg: "B" },
      { id: "a-3", leg: "A" }, { id: "a-4", leg: "A" },
    ],
    execution: { conductorStoppingRule: {
      consecutiveFailures: 2,
      scope: "same-leg",
      sameRootCauseField: "rootCauseClass",
      action: "pause-wave-for-orchestrator-review",
      diagnostic: "R3_CONDUCTOR_REVIEW_REQUIRED",
      reviewReceipt: {
        version: "snapback.r3-conductor-review-ack.v1",
        directory: "reviews",
        filePattern: "pause-<n>.ack.json",
        diagnostic: "R3_CONDUCTOR_REVIEW_RECEIPT_INVALID",
      },
    } },
  };
  const failure = (cellId, rootCauseClass) => ({
    cellId,
    kind: "driver-failure-report",
    outcome: "failure",
    rootCauseClass,
  });
  assert.throws(() => assertConductorStoppingRule({
    harnessConfig,
    cellId: "a-3",
    seriality: { landedDispositions: [
      failure("a-1", "native-usage-settlement-timeout"),
      failure("b-1", "unrelated-leg"),
      failure("a-2", "native-usage-settlement-timeout"),
      failure("b-2", "unrelated-leg"),
    ] },
  }), (error) => (
    error.code === "R3_CONDUCTOR_REVIEW_REQUIRED"
    && error.rootCauseClass === "native-usage-settlement-timeout"
    && error.attemptConsumed === false
  ));

  const reset = assertConductorStoppingRule({
    harnessConfig,
    cellId: "a-4",
    seriality: { landedDispositions: [
      failure("a-1", "native-usage-settlement-timeout"),
      failure("a-2", "native-usage-settlement-timeout"),
      { cellId: "a-3", kind: "validated-record", outcome: "success", rootCauseClass: null },
    ] },
  });
  assert.deepEqual(reset.immediatelyPreceding, [
    { cellId: "a-2", outcome: "failure", rootCauseClass: "native-usage-settlement-timeout" },
    { cellId: "a-3", outcome: "success", rootCauseClass: null },
  ]);

  const hashedFailure = (cellId, digit) => ({
    ...failure(cellId, "native-usage-settlement-timeout"),
    sha256: `sha256:${digit.repeat(64)}`,
  });
  const landed = [hashedFailure("a-1", "1"), hashedFailure("a-2", "2")];
  const receipt = validateConductorReviewReceipt({
    filename: "pause-1.ack.json",
    harnessConfig,
    receipt: {
      version: "snapback.r3-conductor-review-ack.v1",
      pause: 1,
      runId: "review-test",
      admitCellId: "a-3",
      failureDispositions: landed.map(({ cellId, sha256 }) => ({ cellId, sha256 })),
      orchestratorRationale: "The two failures were reviewed and this exact next cell may proceed.",
    },
  });
  const admitted = assertConductorStoppingRule({
    harnessConfig,
    cellId: "a-3",
    seriality: { landedDispositions: landed, reviewReceipts: [receipt] },
  });
  assert.equal(admitted.reviewed, true);
  assert.equal(admitted.reviewReceipt, "pause-1.ack.json");

  const wrongHash = structuredClone(receipt);
  wrongHash.failureDispositions[1].sha256 = `sha256:${"3".repeat(64)}`;
  assert.throws(() => assertConductorStoppingRule({
    harnessConfig,
    cellId: "a-3",
    seriality: { landedDispositions: landed, reviewReceipts: [wrongHash] },
  }), (error) => (
    error.code === "R3_CONDUCTOR_REVIEW_REQUIRED"
    && error.reviewReceiptMismatch === true
    && error.attemptConsumed === false
  ));
});

async function currentR2HarnessFixture() {
  const config = JSON.parse(await readFile(RETAINED_R2_CONFIG, "utf8"));
  const manifestBytes = await readFile(new URL("benchmarks/instrument.manifest.json", ROOT));
  const manifest = JSON.parse(manifestBytes);
  config.execution.sourceClosure = measureSourceClosure({ repositoryRoot: ROOT_PATH });
  Object.assign(config.pins.instrument, {
    instrumentPin: manifest.instrumentPin,
    manifestSha256: sha256(manifestBytes).replace(/^sha256:/u, ""),
    schemaVersion: manifest.versions.schema,
    uiVersion: manifest.versions.ui,
    choreographyVersion: manifest.versions.choreography,
  });
  Object.assign(config.pins.instrument.d06MeteringOverlay, {
    laneControllerSha256: sha256(await readFile(new URL(
      "benchmarks/tools/social-messenger/metering/lane-controller.mjs",
      ROOT,
    ))).replace(/^sha256:/u, ""),
    productionDriverSha256: sha256(await readFile(new URL(
      "benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs",
      ROOT,
    ))).replace(/^sha256:/u, ""),
  });
  return config;
}

async function migrateCurrentR2CellFixture(root) {
  const instrumentBytes = await readFile(new URL("benchmarks/instrument.manifest.json", ROOT));
  const instrument = JSON.parse(instrumentBytes);
  await writeFile(join(root, "instrument.manifest.json"), instrumentBytes);
  const choreographyPackage = JSON.parse(await readFile(new URL(
    "benchmarks/tools/social-messenger/choreography/package.json",
    ROOT,
  ), "utf8"));

  const basePath = join(root, "record-base.json");
  const base = JSON.parse(await readFile(basePath, "utf8"));
  const setup = {
    schemaVersion: "social-messenger.setup-identity.v1",
    instrumentPin: instrument.instrumentPin,
    backend: { kind: "snapback", version: base.harness.environment.snapback },
    runtime: {
      qualifiedBinary: { claimed: false, reason: "retained fixture does not carry a qualified binary" },
      wrapper: { claimed: false, reason: "retained fixture does not carry a runtime wrapper" },
    },
    packageClosure: {
      mode: "workspace",
      prepack: "not-applicable",
      artifacts: [{
        name: "social-messenger-migrated-retained-cell",
        version: instrument.versions.choreography,
        sha256: null,
      }],
    },
    toolchain: {
      node: { path: process.execPath, version: process.version },
      bun: "not-invoked-by-retained-fixture",
      npm: "not-invoked-by-retained-fixture",
      playwright: choreographyPackage.dependencies.playwright,
      browser: "chromium",
    },
    host: { id: "migrated-retained-cell", platform: process.platform, arch: process.arch },
  };
  const setupPath = join(root, "setup-identity.json");
  const setupBytes = Buffer.from(`${JSON.stringify(setup, null, 2)}\n`);
  await writeFile(setupPath, setupBytes);
  const setupIdentity = { path: setupPath, sha256: sha256(setupBytes) };

  base.harness.environment.instrument = instrument.instrumentPin;
  base.socialMessenger.instrumentVersion = instrument.instrumentPin;
  base.socialMessenger.orientation.instrument.pin = instrument.instrumentPin;
  base.socialMessenger.orientation.instrument.manifest.sha256 = sha256(instrumentBytes)
    .replace(/^sha256:/u, "");
  Object.assign(base.socialMessenger.orientation.instrument.versions, instrument.versions);
  base.socialMessenger.typingObservationBoundaryVersion =
    CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION;
  base.socialMessenger.setup = setup;
  await writeFile(basePath, `${JSON.stringify(base, null, 2)}\n`);

  const coveragePath = join(root, "coverage-manifest.json");
  const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
  coverage.instrument = instrument.instrumentPin;
  await writeFile(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`);

  const manifestPath = join(root, "metering-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const receipt of manifest.receipts) {
    const receiptPath = join(root, receipt.path);
    const records = parseJsonLines(await readFile(receiptPath, "utf8"));
    for (const record of records) {
      record.version = instrument.versions.choreography;
      delete record.typingObservationBoundaryVersion;
      if (record.details) delete record.details.typingObservationBoundaryVersion;
      if (record.assertion === "typing-indicator-within-2s-expires-within-5s") {
        record.typingObservationBoundaryVersion = CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION;
        record.details.typingObservationBoundaryVersion = CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION;
      } else if (record.segment === "m3" && record.type === "segment-summary") {
        record.typingObservationBoundaryVersion = CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION;
      }
      if (record.type === "segment-summary") {
        record.setupIdentity = setupIdentity;
        record.setup = setup;
      }
    }
    const bytes = Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    await writeFile(receiptPath, bytes);
    receipt.sha256 = sha256(bytes);
  }
  manifest.recordBase = { path: "record-base.json", sha256: sha256(await readFile(basePath)) };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function migrateCurrentFinalizedCellFixture(root) {
  await migrateCurrentR2CellFixture(root);
  const manifestPath = join(root, "metering-manifest.json");
  const metering = joinUsageToMilestones(await loadMeteringManifest(manifestPath));
  const recordBase = JSON.parse(await readFile(join(root, "record-base.json"), "utf8"));
  const record = composeRunRecord({
    base: recordBase,
    patch: metering,
    expectedMilestones: ["M1", "M2", "M3"],
  });
  const meteringBytes = Buffer.from(`${JSON.stringify(metering, null, 2)}\n`);
  const recordBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  await Promise.all([
    writeFile(join(root, "metering.json"), meteringBytes),
    writeFile(join(root, "record.json"), recordBytes),
  ]);
  const slotPath = join(root, "cell.json");
  const slot = JSON.parse(await readFile(slotPath, "utf8"));
  slot.record.sha256 = sha256(recordBytes);
  slot.metering.sha256 = sha256(meteringBytes);
  slot.originalInstrument.sha256 = sha256(await readFile(join(root, "instrument.manifest.json")));
  await writeFile(slotPath, `${JSON.stringify(slot, null, 2)}\n`);
}

test("finalization diagnostics retain stage, ordinal, event type, cause, and bounded raw payload", async () => {
  const rawPayload = JSON.stringify({
    ordinal: 73,
    timestamp: "2026-08-24T12:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: { input_tokens: "invalid" } },
      oversized: "x".repeat(2_000),
    },
  });
  const [event] = parseJsonLines(`${rawPayload}\n`, "retained-real-stream.jsonl");
  let error = null;
  try {
    await withFinalizationStage(
      "metering-manifest-load",
      async () => adaptCodexSessionTree([{
        sourceId: "builder",
        nativeSessionId: "session-1",
        records: [event],
      }]),
    );
  } catch (caught) {
    error = caught;
  }
  assert.notEqual(error, null);
  const rendered = formatFinalizationFailure(error);
  assert.match(rendered, /stage=metering-manifest-load\/codex-token-count-normalize/u);
  assert.match(rendered, /source="retained-real-stream\.jsonl"/u);
  assert.match(rendered, /streamLine=1/u);
  assert.match(rendered, /eventOrdinal=73/u);
  assert.match(rendered, /eventType="event_msg\/token_count"/u);
  assert.match(rendered, /cause="Codex token_count record 1\.total_token_usage\.input_tokens must be a non-negative integer"/u);
  assert.match(rendered, /<truncated/u);
  assert.ok(rendered.length < rawPayload.length);
  assert.equal(FINALIZATION_RAW_EXCERPT_LIMIT, 512);
});
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

async function snapshotTree(root) {
  const snapshot = {};
  async function visit(directory) {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const logical = relative(root, path).split("/").join("/");
      if (entry.isDirectory()) {
        snapshot[`${logical}/`] = "directory";
        await visit(path);
      } else if (entry.isFile()) {
        snapshot[logical] = sha256(await readFile(path));
      } else {
        snapshot[logical] = "non-regular";
      }
    }
  }
  await visit(root);
  return snapshot;
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

test("retained post-terminal harness telemetry is source- and finalization-bound", async () => {
  const telemetry = await fixtureJson(
    "real-grok-coterie-familiar-after-boundary-telemetry.json",
  );
  const semantic = await fixtureJson(
    "real-opus-coterie-familiar-after-boundary-semantic.json",
  );
  assert.equal(isAfterTerminalHarnessTelemetryType("host-load-sample"), true);
  assert.equal(isAfterTerminalHarnessTelemetryType("block-claim"), true);
  assert.equal(isAfterTerminalHarnessTelemetryType("semantic-action"), false);
  assert.equal(isAfterTerminalHarnessTelemetryType("future-unregistered-type"), false);

  const laneRunId = telemetry.event.laneRunId;
  const laneControllerSourceId = `${laneRunId}-lane-controller`;
  const driverFinalizedAt = "2026-08-25T05:11:18.000Z";
  const provenance = {
    laneRunId,
    driver: { stampedAt: driverFinalizedAt },
  };
  assert.equal(isAfterTerminalHarnessTelemetry({
    event: {
      ...telemetry.event,
      evidenceSourceId: laneControllerSourceId,
    },
    laneControllerSourceId,
    driverFinalizedAt,
  }), true);

  const result = joinUsageToMilestones({
    channel: {
      source: "advisory-family-no-approved-native-per-turn-adapter",
      unavailableReason: "advisory-family-no-approved-native-per-turn-adapter",
      turns: null,
    },
    boundaries: { M1: telemetry.boundary },
    observations: {
      events: [telemetry.claim, telemetry.event].map((event) => ({
        ...event,
        evidenceSourceId: laneControllerSourceId,
        evidencePath: telemetry.source.path,
        evidenceLine: event.sequence,
      })),
      evidence: [{
        sourceId: laneControllerSourceId,
        path: telemetry.source.path,
        sha256: telemetry.source.sha256,
      }],
    },
    provenance,
  });
  assert.equal(result.milestones.M1.hostLoad.sampleCount, 1);

  assert.throws(() => joinUsageToMilestones({
    channel: {
      source: "claude-code-session-usage",
      unavailableReason: null,
      turns: [],
    },
    boundaries: { M1: semantic.boundary },
    observations: {
      events: [{
        ...semantic.event,
        evidenceSourceId: "retained-opus-coterie-familiar-controller",
        evidencePath: semantic.source.path,
        evidenceLine: semantic.source.sequence,
      }],
      evidence: [],
    },
    provenance: {
      laneRunId: semantic.event.laneRunId,
      driver: { stampedAt: "2026-08-25T06:00:00.000Z" },
    },
  }), /M1 observation semantic-action is after its terminal boundary/u);

  for (const event of [
    {
      ...telemetry.event,
      type: "api-request",
      provider: "grok-46",
      operation: "native-harness-turn",
      requestId: "late-api",
      outcome: "success",
      retryOf: null,
    },
    {
      ...telemetry.event,
      type: "lifecycle",
      action: "restart",
      destructive: false,
    },
    { ...telemetry.event, type: "future-unregistered-type" },
  ]) {
    assert.throws(() => joinUsageToMilestones({
      channel: {
        source: "advisory-family-no-approved-native-per-turn-adapter",
        unavailableReason: "advisory-family-no-approved-native-per-turn-adapter",
        turns: null,
      },
      boundaries: { M1: telemetry.boundary },
      observations: {
        events: [{ ...event, evidenceSourceId: laneControllerSourceId }],
        evidence: [],
      },
      provenance,
    }), new RegExp(`M1 observation ${event.type} is after its terminal boundary`, "u"));
  }

  for (const event of [
    { ...telemetry.event, evidenceSourceId: "wrong-source" },
    {
      ...telemetry.event,
      at: "2026-08-25T05:11:19.000Z",
      evidenceSourceId: laneControllerSourceId,
    },
  ]) {
    assert.throws(() => joinUsageToMilestones({
      channel: {
        source: "advisory-family-no-approved-native-per-turn-adapter",
        unavailableReason: "advisory-family-no-approved-native-per-turn-adapter",
        turns: null,
      },
      boundaries: { M1: telemetry.boundary },
      observations: { events: [event], evidence: [] },
      provenance,
    }), /M1 observation host-load-sample is after its terminal boundary/u);
  }
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

test("exact retained Codex ordinal 710 is a non-charging cumulative recap", async () => {
  const fixture = await fixtureText("real-codex-0149-zero-delta.jsonl");
  const lines = fixture.trimEnd().split("\n");
  assert.equal(
    sha256(lines.at(-1)),
    "sha256:144d9413f662621e63bdd63f622b0da791d31c30ef63befe53b2f604a7489254",
    "the native recap line must retain the exact retained bytes",
  );
  const records = parseJsonLines(fixture, "retained Codex 0.149 zero-delta fixture");
  const channel = adaptCodexSessionTree([{
    sourceId: "builder",
    nativeSessionId: "01a03304-e4e2-71d0-892e-bf0440eac5b2",
    records,
  }]);
  // R2 ordinals 710 and 839 plus R3 ordinal 387 independently carry this
  // native recap shape; ordinal 710's next real event resumes consistently.
  assert.equal(channel.turns.length, 111);
  assert.equal(channel.turns.at(-1).nativeRecordOrdinal, 706);
  assert.equal(channel.turns.some((turn) => turn.nativeRecordOrdinal === 710), false);
  assert.deepEqual(channel.turns.reduce((total, turn) => ({
    input: total.input + turn.usage.input,
    output: total.output + turn.usage.output,
    cacheRead: total.cacheRead + turn.usage.cacheRead,
    cacheWrite: total.cacheWrite + turn.usage.cacheWrite,
    reasoning: total.reasoning + turn.usage.reasoning,
  }), counts(0, 0)), counts(321_961, 64_301, 15_223_040, 0, 20_864));
  assert.equal(CODEX_ADAPTER_VERSION, "codex-rollout-jsonl.v4");
});

test("exact retained R3 compaction recap is accepted without a charged turn", async () => {
  const fixture = await fixtureText("real-codex-r3-compaction-recap.jsonl");
  assert.equal(
    sha256(fixture),
    "sha256:65af00200ce3e9657250f3b83a28948e12e3d77b57f7e9c0e71a71bbffaaac70",
  );
  const lines = fixture.trimEnd().split("\n");
  const recapLine = lines.find((line) => JSON.parse(line).ordinal === 387);
  assert.equal(
    sha256(recapLine),
    "sha256:21c1c05b7e06af61408e4744708fa661f2d9eac2688b049dbfb9c38dd31cadd5",
    "R3 rollout line 388 must remain byte-exact",
  );
  const records = parseJsonLines(fixture, "retained R3 compaction recap fixture");
  assert.deepEqual(records.filter((record) => record.ordinal >= 384).map((record) => [
    record.ordinal,
    record.type,
    record.payload?.type ?? record.payload?.item?.type ?? null,
  ]), [
    [384, "compacted", null],
    [385, "world_state", null],
    [386, "turn_context", null],
    [387, "event_msg", "token_count"],
    [388, "event_msg", "item_completed"],
  ]);
  const channel = adaptCodexSession(records);
  assert.equal(channel.turns.at(-1).nativeRecordOrdinal, 383);
  assert.equal(channel.turns.some((turn) => turn.nativeRecordOrdinal === 387), false);
  assert.deepEqual(channel.turns.reduce((total, turn) => ({
    input: total.input + turn.usage.input,
    output: total.output + turn.usage.output,
    cacheRead: total.cacheRead + turn.usage.cacheRead,
    cacheWrite: total.cacheWrite + turn.usage.cacheWrite,
    reasoning: total.reasoning + turn.usage.reasoning,
  }), counts(0, 0)), counts(276_812, 31_161, 7_683_072, 0, 10_984));
});

test("real retained R3 advancing usage still refuses a contradictory checksum", async () => {
  const fixture = await fixtureText("real-codex-r3-contradictory-token-count.jsonl");
  assert.equal(
    sha256(fixture),
    "sha256:4b3e8be90b1797dde7a60466c8cac37badaa4980a102f595fc0030e5001babc9",
  );
  const records = parseJsonLines(fixture, "R3 contradictory checksum fixture");
  let failure = null;
  try {
    adaptCodexSession(records);
  } catch (error) {
    failure = error;
  }
  const diagnostic = formatFinalizationFailure(failure);
  assert.match(diagnostic, /stage=codex-token-count-delta-join/u);
  assert.match(diagnostic, /eventOrdinal=23/u);
  assert.match(diagnostic, /received 16303 and 16304/u);
});

test("only a registered compaction marker permits a checksummed cumulative reset", () => {
  const usage = (input, cached, output, reasoning) => ({
    input_tokens: input,
    cached_input_tokens: cached,
    cache_write_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: input + output,
  });
  const records = [{
    ordinal: 0,
    timestamp: "2026-08-26T20:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: usage(100, 20, 10, 2), last_token_usage: usage(100, 20, 10, 2) },
    },
  }, {
    ordinal: 1,
    timestamp: "2026-08-26T20:00:01.000Z",
    type: "compacted",
    payload: { window_number: 1 },
  }, {
    ordinal: 2,
    timestamp: "2026-08-26T20:00:02.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: usage(15, 5, 3, 1), last_token_usage: usage(15, 5, 3, 1) },
    },
  }];
  const channel = adaptCodexSession(records);
  assert.deepEqual(channel.turns.map((turn) => turn.usage), [
    counts(80, 10, 20, 0, 2),
    counts(10, 3, 5, 0, 1),
  ]);
  assert.throws(
    () => adaptCodexSession(records.filter((record) => record.type !== "compacted")),
    /token counter input moved backwards/u,
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

test("retained R2 Codex ordering remains exact while historical disposition stands", async () => {
  const cellRoot = new URL(
    "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-explicit/",
    ROOT,
  );
  const manifestText = await readFile(new URL("metering-manifest.json", cellRoot), "utf8");
  const manifest = JSON.parse(manifestText);
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
  assert.equal(manifest.adapter, "unavailable");
  assert.equal(manifest.unavailableReason, "retained-session-token-event-corrupt");
  const channel = adaptCodexSessionTree([{
    sourceId: "builder",
    nativeSessionId: "01a03304-e4e2-71d0-892e-bf0440eac5b2",
    records,
  }]);
  assert.equal(channel.turns.some((turn) => turn.nativeRecordOrdinal === 710), false);
  const resumed = channel.turns.find((turn) => turn.nativeRecordOrdinal === 719);
  assert.notEqual(resumed, undefined);
  assert.equal(resumed.usage.input + resumed.usage.cacheRead + resumed.usage.output, 21_923);
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
  const directory = await realpath(await mkdtemp(join(tmpdir(), "snapback-metering-manifest-")));
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

test("exact retained Opus shorthand lane identity canonicalizes to its full lane", async () => {
  const fixture = await fixtureText("real-opus-shorthand-lane-observation.jsonl");
  assert.equal(
    sha256(fixture.trimEnd()),
    "sha256:7c5b666682bf340461c84e34767763dba1baf55165c83c5ecbd46be23a4784d3",
  );
  const laneRunId = "2026-08-23-r2-published-0125/opus-clique-explicit";
  const [event] = parseObservationJsonLines(fixture, "retained Opus M1 suite", {
    laneRunId,
  });
  assert.equal(event.laneRunId, laneRunId);
  const [unrelated] = parseObservationJsonLines(fixture, "retained Opus M1 suite", {
    laneRunId: "2026-08-23-r2-published-0125/sol-clique-explicit",
  });
  assert.equal(unrelated.laneRunId, "opus-clique-explicit");
});

test("exact retained Familiar failures stay named, transition-bound, and fail-closed", async () => {
  const native = await fixtureText("real-codex-familiar-compaction-recap.jsonl");
  assert.equal(
    sha256(native.trimEnd()),
    "sha256:3d2a694a775989b52854f50e99f6e6caa2251714b206a4b5cf5287ae0a11210f",
  );
  const [tokenEvent] = parseJsonLines(native, "retained Familiar rollout excerpt");
  assert.equal(tokenEvent.ordinal, 839);
  assert.equal(tokenEvent.payload.info.last_token_usage.total_tokens, 14_133);

  const transition = await fixtureText("real-familiar-transition-observation.jsonl");
  assert.equal(
    sha256(transition.trimEnd()),
    "sha256:df18cf7baf2bd8cba89e10549c32d548b7c823bd04ecc77f6cebe8ec131e4c5c",
  );
  const [transitionEvent] = parseObservationJsonLines(transition, "retained Familiar transition");
  assert.equal(transitionEvent.sequence, 195);
  assert.ok(
    Date.parse(transitionEvent.at) < Date.parse("2026-08-24T19:06:10.236Z"),
    "the native observation transition precedes the later gate-file write by 1ms",
  );

  const orphanText = await fixtureText("real-familiar-orphaned-correction.jsonl");
  assert.equal(
    sha256(orphanText.trimEnd()),
    "sha256:70c7c4eb8fdba926d8776e6b77a9d1405e8e51facef7e0cccaea155d81ff25ea",
  );
  const [orphan] = parseObservationJsonLines(orphanText, "retained Familiar controller");
  orphan.evidenceSourceId = `${orphan.laneRunId}-lane-controller`;
  const base = {
    version: OBSERVATION_VERSION,
    laneRunId: orphan.laneRunId,
    milestone: "M3",
    at: orphan.at,
    type: "block-claim",
    owner: null,
  };
  const events = [
    { ...base, sequence: 1, block: "semanticActions", claimed: true, reason: null },
    { ...base, sequence: 2, block: "failureToRecoveryEpisodes", claimed: true, reason: null },
    { ...base, sequence: 3, block: "restartReseed", claimed: false, reason: "lane-lifecycle-events-unavailable" },
    { ...base, sequence: 4, block: "hostLoad", claimed: false, reason: "host-load-sampling-unavailable" },
    { ...base, sequence: 5, block: "apiInterruptions", claimed: false, reason: "api-request-events-unavailable" },
    { ...base, sequence: 6, block: "browserAssertionWait", owner: "suite", claimed: false, reason: "complete-suite-and-choreography-waits-unavailable" },
    { ...base, sequence: 7, block: "browserAssertionWait", owner: "choreography", claimed: false, reason: "complete-suite-and-choreography-waits-unavailable" },
    orphan,
  ];
  let failure = null;
  try {
    projectMilestoneObservability({ events, evidence: [{ path: "exact", sha256: sha256(orphanText) }], milestone: "M3" });
  } catch (error) {
    failure = error;
  }
  assert.match(formatFinalizationFailure(failure), /stage=observation-action-episode-join/u);
  assert.match(formatFinalizationFailure(failure), /eventType="semantic-action"/u);
  assert.match(formatFinalizationFailure(failure), /native-m3-205/u);

  const rule = {
    ruleId: "retained-orphaned-recovery-episode-nonclaim.v1",
    observationSourceId: orphan.evidenceSourceId,
    milestone: orphan.milestone,
    sequence: orphan.sequence,
    at: orphan.at,
    type: orphan.type,
    actionId: orphan.actionId,
    episodeId: orphan.episodeId,
  };
  const joinExceptions = loadObservationCompatibility(
    { observationCompatibility: [rule] },
    { events },
  );
  const projected = projectMilestoneObservability({
    events,
    evidence: [{ path: "exact", sha256: sha256(orphanText) }],
    milestone: "M3",
    joinExceptions,
  });
  assert.deepEqual(projected.failureToRecoveryEpisodes, {
    claimed: false,
    reason: "retained-recovery-episode-stream-incomplete",
  });
  assert.equal(projected.semanticActions.total, 1);
});

test("meter binds suite-status bytes to receipts at record-write time", async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "snapback-suite-binding-")));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const r2HarnessPath = join(directory, "harness-config.json");
  const r2Harness = {
    schemaVersion: "snapback.r2-harness-config.v1",
    runId: "r2-fixture",
    pins: { instrument: { instrumentPin: "social-messenger@0.3.7-m8" } },
    harnesses: { fixture: { binary: process.execPath } },
    machines: { "fixture-host": { id: "fixture-host", node: { version: process.version } } },
    paths: { privateExecutionRoot: directory },
    execution: {
      milestones: ["M1", "M2"],
      loadIsolation: {
        policies: {
          "fixture-policy": {
            policyId: "fixture-policy",
            allowedHostId: "fixture-host",
            sampleEverySeconds: 60,
            ceilingInclusive: { loadavg1: 10, loadavg5: 10, loadavg15: 10 },
          },
        },
      },
    },
    cells: [{
      id: "fixture-cell",
      harness: "fixture",
      allowedHostId: "fixture-host",
      loadCeilingId: "fixture-policy",
    }],
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
    /must pin social-messenger@0\.3\.7-m8/u,
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
    for (const record of records) {
      record.version = "0.3.7-m8";
      for (const timing of record.timings) timing.settlementWaitMs = 0;
    }
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
  assert.equal(joined.instrumentVersion, "social-messenger@0.3.7-m8");
  assert.equal(
    joined.typingObservationBoundaryVersion,
    CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION,
  );
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

test("real Grok suite rollover re-verifies unchanged identity and rejects a verdict flip", async (t) => {
  for (const fixtureName of [
    "real-grok-clique-explicit-suite-finalization.json",
    "real-grok-clique-familiar-suite-finalization.json",
  ]) {
    const fixture = await fixtureJson(fixtureName);
    const root = await realpath(await mkdtemp(join(tmpdir(), "grok-suite-finalization-")));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(dirname(join(root, fixture.suiteReceipt.path)), { recursive: true });
    await writeFile(join(root, fixture.suiteStatus.path), fixture.suiteStatus.text);
    await writeFile(join(root, fixture.suiteReceipt.path), fixture.suiteReceipt.text);
    assert.equal(sha256(fixture.suiteStatus.text), fixture.suiteStatus.sha256);
    assert.equal(sha256(fixture.suiteReceipt.text), fixture.suiteReceipt.sha256);

    // Re-touching identical bytes changes file custody time, not verdict identity.
    await writeFile(join(root, fixture.suiteReceipt.path), fixture.suiteReceipt.text);
    const input = JSON.parse(fixture.suiteStatus.text);
    const options = {
      root,
      markers: [{ milestone: "M1", status: "green" }],
      receipts: [{ milestone: "M1", summary: fixture.choreographySummary }],
      statuses: input,
    };
    const reconciled = await reconcileSuiteStatuses(options);
    assert.deepEqual(reconciled.m1, {
      pass: true,
      receipt: fixture.suiteReceipt.path,
    });

    const flipped = JSON.parse(fixture.suiteReceipt.text);
    if (typeof flipped.pass === "boolean") flipped.pass = false;
    else flipped.results[0].pass = false;
    await writeFile(
      join(root, fixture.suiteReceipt.path),
      `${JSON.stringify(flipped, null, 2)}\n`,
    );
    await assert.rejects(
      reconcileSuiteStatuses(options),
      /verdict changed after choreography refusal-check: refusal-time=true retained-receipt=false/u,
      `${fixture.sourceCell} must fail closed when the retained verdict flips`,
    );
  }
});

test("lane observation harness samples load and records lifecycle and API retries", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lane-observation-harness-")));
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

function codexSignalRecord(ordinal, milestone, timestamp) {
  return {
    ordinal,
    timestamp,
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        id: `${milestone.toLowerCase()}-signal`,
        type: "CommandExecution",
        status: "completed",
        exit_code: 0,
        command: ["node", "/fixture/r2-cell-signal.mjs", "--milestone", milestone],
      },
    },
  };
}

function codexTokenRecord(ordinal, timestamp, cumulativeInput, lastInput) {
  const usage = (input) => ({
    input_tokens: input,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: input,
  });
  return {
    ordinal,
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: usage(cumulativeInput),
        last_token_usage: usage(lastInput),
      },
    },
  };
}

function codexWatchdogState(records) {
  let index = 0;
  const state = {
    config: {
      cell: { harness: "codex-sol" },
      harnessConfig: { execution: { perMilestoneWallSafetyLimitSeconds: 1 } },
    },
    currentSession: { sourceId: "builder", nativeSessionId: "codex-builder" },
    tokenWatchdog: null,
    tokenWatchdogSessionSourceId: null,
    settledUsage: { turnIds: new Set(), usageRecordOrdinal: null },
    tokenWatchdogHistory: [],
    usageFailure: null,
    child: null,
    now: () => Date.parse("2026-08-26T12:02:00.000Z"),
    settlementSleep: async () => {},
    readLiveCodexRecords: async () => records[Math.min(index++, records.length - 1)],
  };
  r2CellDriverTestHooks.ensureSessionTokenWatchdog(state);
  return state;
}

function claudeMarkerTurn({ milestone, timestamp, usage = null, id = `claude-${milestone}` }) {
  return {
    type: "assistant",
    timestamp,
    message: {
      id,
      role: "assistant",
      content: [{
        type: "tool_use",
        name: "Bash",
        input: { command: `node /instrument/r2-cell-signal.mjs --milestone ${milestone} --status green` },
      }],
      ...(usage === null ? {} : { usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      } }),
    },
  };
}

function claudeWatchdogState(recordPolls) {
  let index = 0;
  const state = {
    config: {
      cell: { harness: "claude-opus5" },
      harnessConfig: { execution: { perMilestoneWallSafetyLimitSeconds: 1 } },
    },
    currentSession: { sourceId: "builder", nativeSessionId: "claude-builder" },
    tokenWatchdog: null,
    tokenWatchdogSessionSourceId: null,
    settledUsage: { turnIds: new Set(), usageRecordOrdinal: null },
    tokenWatchdogHistory: [],
    usageFailure: null,
    child: null,
    now: () => Date.parse("2026-08-26T12:00:03.000Z"),
    settlementSleep: async () => {},
    readLiveClaudeRecords: async () => recordPolls[Math.min(index++, recordPolls.length - 1)],
  };
  r2CellDriverTestHooks.ensureSessionTokenWatchdog(state);
  return state;
}

test("Claude marker-then-usage settles only the marker-writing assistant turn", async () => {
  const markerOnly = claudeMarkerTurn({ milestone: "M2", timestamp: "2026-08-26T12:00:00.000Z" });
  const withUsage = claudeMarkerTurn({
    milestone: "M2",
    timestamp: "2026-08-26T12:00:02.000Z",
    usage: { input: 10, output: 5 },
  });
  const state = claudeWatchdogState([[markerOnly], [withUsage]]);
  let waits = 0;
  state.settlementSleep = async () => { waits += 1; };
  state.tokenWatchdog.arm({
    capFamily: "claude-frontier",
    milestone: "M2",
    tokenCap: 100,
    startedAt: "2026-08-26T11:59:59.000Z",
    maxClockSkewMs: 0,
  });
  await r2CellDriverTestHooks.finishTokenWatchdog(state, {
    milestone: "M2", status: "green", recordedAt: "2026-08-26T12:00:01.000Z",
  });
  assert.equal(waits, 1);
  assert.equal(state.tokenWatchdogHistory[0].milestone, "M2");
  assert.equal(state.tokenWatchdogHistory[0].reconciliation.retainedActualTokens, 15);
});

test("Claude milestone settlement includes a distinct assistant turn preceding its marker turn", async () => {
  const precedingTurn = {
    type: "assistant",
    timestamp: "2026-08-26T12:00:00.000Z",
    message: {
      id: "claude-before-m2-marker",
      role: "assistant",
      content: [{ type: "text", text: "Preparing the retained M2 evidence." }],
      usage: {
        input_tokens: 7,
        output_tokens: 3,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  };
  const markerTurn = claudeMarkerTurn({
    milestone: "M2",
    id: "claude-writes-m2-marker",
    timestamp: "2026-08-26T12:00:02.000Z",
    usage: { input: 10, output: 5 },
  });
  const state = claudeWatchdogState([[precedingTurn, markerTurn]]);
  state.tokenWatchdog.arm({
    capFamily: "claude-frontier",
    milestone: "M2",
    tokenCap: 100,
    startedAt: "2026-08-26T11:59:59.000Z",
    maxClockSkewMs: 0,
  });
  await r2CellDriverTestHooks.finishTokenWatchdog(state, {
    milestone: "M2", status: "green", recordedAt: "2026-08-26T12:00:01.000Z",
  });
  assert.equal(state.tokenWatchdogHistory[0].reconciliation.retainedActualTokens, 25);
  assert.deepEqual([...state.settledUsage.turnIds].sort(), [
    "claude-message:claude-before-m2-marker",
    "claude-message:claude-writes-m2-marker",
  ]);
});

test("Claude usage-then-marker settles the already-observed marker-writing assistant turn", async () => {
  const withUsage = claudeMarkerTurn({
    milestone: "M3",
    timestamp: "2026-08-26T12:00:00.000Z",
    usage: { input: 8, output: 4 },
  });
  const state = claudeWatchdogState([[withUsage]]);
  state.tokenWatchdog.arm({
    capFamily: "claude-frontier",
    milestone: "M3",
    tokenCap: 100,
    startedAt: "2026-08-26T11:59:59.000Z",
    maxClockSkewMs: 0,
  });
  await r2CellDriverTestHooks.finishTokenWatchdog(state, {
    milestone: "M3", status: "green", recordedAt: "2026-08-26T12:00:01.000Z",
  });
  assert.equal(state.tokenWatchdogHistory[0].milestone, "M3");
  assert.equal(state.tokenWatchdogHistory[0].reconciliation.retainedActualTokens, 12);
});

test("ordinary Claude milestone settlement timeout fails closed against the current milestone", async () => {
  const markerOnly = claudeMarkerTurn({ milestone: "M2", timestamp: "2026-08-26T12:00:00.000Z" });
  const state = claudeWatchdogState([[markerOnly]]);
  let clock = Date.parse("2026-08-26T12:00:01.000Z");
  state.now = () => clock;
  state.settlementSleep = async () => { clock += 1_001; };
  state.currentMilestone = "M2";
  state.tokenWatchdog.arm({
    capFamily: "claude-frontier",
    milestone: "M2",
    tokenCap: 100,
    startedAt: "2026-08-26T11:59:59.000Z",
    maxClockSkewMs: 0,
  });
  await assert.rejects(r2CellDriverTestHooks.finishTokenWatchdog(state, {
    milestone: "M2", status: "green", recordedAt: "2026-08-26T12:00:00.500Z",
  }), (error) => (
    error.code === "R2_DRIVER_USAGE_SETTLEMENT_TIMEOUT"
    && error.rootCauseClass === "native-usage-settlement-timeout"
    && error.milestone === "M2"
    && state.currentMilestone === "M2"
    && state.tokenWatchdog.state.milestone === "M2"
  ));
});

test("native usage settlement timeout stays distinct in the production-finalized record", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r3-native-settlement-finalized-")));
  const laneRunId = "fixture-run/native-settlement-finalized";
  const nativeSessionId = "claude-native-settlement-finalized";
  const startedAt = "2026-08-26T12:00:00.000Z";
  const terminalAt = "2026-08-26T12:00:04.000Z";
  const config = {
    laneRunId,
    cell: { harness: "claude-opus5" },
    harness: {},
    milestones: ["M1", "M2", "M3"],
  };
  const base = composedRecord({
    capFamily: "claude-frontier",
    source: "claude-code-session-usage",
    metered: true,
  });
  base.harness.environment = { instrument: CURRENT_INSTRUMENT_PIN };
  base.socialMessenger.instrumentVersion = CURRENT_INSTRUMENT_PIN;
  base.socialMessenger.typingObservationBoundaryVersion =
    CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION;
  base.socialMessenger.orientation.instrument.pin = CURRENT_INSTRUMENT_PIN;
  base.socialMessenger.orientation.instrument.versions.choreography = "0.3.7-m8";
  const nativePath = join(temp, "events", "harness.stdout.jsonl");
  const markerTurn = claudeMarkerTurn({
    milestone: "M1",
    id: "claude-m1-unsettled-marker",
    timestamp: "2026-08-26T12:00:02.000Z",
  });
  const nativeRecords = [{
    type: "system",
    subtype: "init",
    timestamp: startedAt,
    session_id: nativeSessionId,
  }, {
    type: "assistant",
    timestamp: "2026-08-26T12:00:01.000Z",
    message: {
      id: "claude-before-unsettled-marker",
      role: "assistant",
      content: [{ type: "text", text: "Preparing M1." }],
      usage: {
        input_tokens: 7,
        output_tokens: 3,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }, markerTurn];
  const state = {
    config,
    root: temp,
    journey: {
      driverId: "social-messenger-r2-native-cli-driver.v1",
      runScope: "reduced",
      continuous: ["M1", "M2", "M3"],
    },
    startedAt,
    currentMilestone: "M1",
    currentSession: { sourceId: "builder", nativeSessionId },
    sessionRuns: [{
      sourceId: "builder",
      parentSourceId: null,
      role: "builder",
      startedAt,
      nativeSessionId,
      stdoutPath: nativePath,
    }],
    child: null,
    closed: null,
    streamWriteQueue: Promise.resolve(),
    observationQueue: Promise.resolve(),
    controls: null,
    pendingNativeTools: new Map(),
    pendingEpisodes: new Map(),
    actionSequence: 0,
    episodeSequence: 0,
    correctionLoops: [],
    suiteStatusPath: null,
    observationSources: [],
    failureDisposition: null,
    m7Handoff: null,
    scaleReplay: null,
    scaleReplayFailure: null,
    terminalMarkers: [],
  };
  try {
    await Promise.all([
      mkdir(join(temp, "events"), { recursive: true }),
      mkdir(join(temp, "schema", "social-messenger"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(nativePath, `${nativeRecords.map((record) => JSON.stringify(record)).join("\n")}\n`),
      writeFile(join(temp, "record-base.json"), `${JSON.stringify(base, null, 2)}\n`),
      writeFile(join(temp, "schema", "social-messenger", "assertions.json"), "{}\n"),
      writeFile(join(temp, "process-ownership.json"), `${JSON.stringify({ nativeHarnessPid: 424_242 })}\n`),
      writeFile(join(temp, "events", "cell-milestones.jsonl"), `${JSON.stringify({
        milestone: "M1",
        status: "green",
        terminalReason: "green",
        recordedAt: "2026-08-26T12:00:02.000Z",
      })}\n`),
      writeFile(join(temp, "events", "lane-controller-observations.jsonl"), `${JSON.stringify({
        laneRunId,
        milestone: "M1",
        at: terminalAt,
      })}\n`),
    ]);
    r2CellDriverTestHooks.installState(laneRunId, state);
    const settlementError = new Error("native usage did not settle");
    settlementError.code = "R2_DRIVER_USAGE_SETTLEMENT_TIMEOUT";
    settlementError.rootCauseClass = "native-usage-settlement-timeout";
    await finalizeProductionDriver({ config, error: settlementError });

    const boundaryArtifact = JSON.parse(await readFile(join(temp, "terminal-boundaries.json"), "utf8"));
    const metering = joinUsageToMilestones(
      await loadMeteringManifest(join(temp, "metering-manifest.json")),
    );
    const finalizedRecord = composeRunRecord({
      base: JSON.parse(await readFile(join(temp, "record-base.json"), "utf8")),
      patch: metering,
      expectedMilestones: config.milestones,
    });
    assert.deepEqual({
      failureDisposition: state.failureDisposition,
      boundaryTerminalReason: boundaryArtifact.milestones.M1.terminalReason,
      joinedTerminalReason: metering.milestones.M1.authoring.terminalReason,
      finalizedStatus: finalizedRecord.socialMessenger.milestones.M1.status,
      finalizedTerminalReason:
        finalizedRecord.socialMessenger.milestones.M1.authoring.terminalReason,
      finalizedTerminationReason: finalizedRecord.socialMessenger.termination.reason,
      finalizedCharging: finalizedRecord.socialMessenger.milestones.M1.charging,
    }, {
      failureDisposition: "native-usage-settlement-timeout",
      boundaryTerminalReason: "native-usage-settlement-timeout",
      joinedTerminalReason: "native-usage-settlement-timeout",
      finalizedStatus: "capability-failure",
      finalizedTerminalReason: "native-usage-settlement-timeout",
      finalizedTerminationReason: "native-usage-settlement-timeout",
      finalizedCharging: {
        chargedWallSeconds: 120,
        chargedTokens: 10,
        flags: ["capped-wall"],
      },
    });
    assertExtensionDefinition(
      "milestoneRecord",
      finalizedRecord.socialMessenger.milestones.M1,
    );
    assertSchema(composedSchema, finalizedRecord, [baseSchema, extensionSchema]);
  } finally {
    r2CellDriverTestHooks.removeState(laneRunId);
    await rm(temp, { recursive: true, force: true });
  }
});

test("Codex cumulative polling keeps one session watchdog across two milestones", async () => {
  const m1 = [
    codexSignalRecord(0, "M1", "2026-08-26T12:00:02.000Z"),
    codexTokenRecord(1, "2026-08-26T12:00:03.000Z", 80, 80),
  ];
  const m2BeforeUsage = [
    ...m1,
    codexSignalRecord(2, "M2", "2026-08-26T12:01:02.000Z"),
  ];
  const cumulativeM2 = [
    ...m2BeforeUsage,
    codexTokenRecord(3, "2026-08-26T12:01:03.000Z", 100, 20),
  ];
  const state = codexWatchdogState([m1, m2BeforeUsage, cumulativeM2]);
  state.tokenWatchdog.arm({
    capFamily: "gpt-frontier",
    milestone: "M1",
    tokenCap: 1_000,
    startedAt: "2026-08-26T12:00:00.000Z",
    maxClockSkewMs: 5_000,
  });
  await r2CellDriverTestHooks.finishTokenWatchdog(state, {
    milestone: "M1",
    status: "green",
    recordedAt: "2026-08-26T12:00:01.000Z",
  });
  const sameWatchdog = state.tokenWatchdog;
  state.tokenWatchdog.arm({
    capFamily: "gpt-frontier",
    milestone: "M2",
    // A fresh watchdog would recharge M1's 80 tokens and trip this cap.
    tokenCap: 50,
    startedAt: "2026-08-26T12:01:00.000Z",
    maxClockSkewMs: 5_000,
  });
  await r2CellDriverTestHooks.finishTokenWatchdog(state, {
    milestone: "M2",
    status: "green",
    recordedAt: "2026-08-26T12:01:01.000Z",
  });
  assert.equal(state.tokenWatchdog, sameWatchdog);
  assert.deepEqual(state.tokenWatchdogHistory.map((item) => ({
    milestone: item.milestone,
    liveActualTokens: item.reconciliation.liveActualTokens,
    retainedActualTokens: item.reconciliation.retainedActualTokens,
  })), [
    { milestone: "M1", liveActualTokens: 80, retainedActualTokens: 80 },
    { milestone: "M2", liveActualTokens: 20, retainedActualTokens: 20 },
  ]);
});

test("live Codex milestone integrity ignores an aggregate-only compaction recap", async () => {
  const recap = codexTokenRecord(5, "2026-08-26T12:00:05.000Z", 80, 0);
  recap.payload.info.last_token_usage.total_tokens = 14_007;
  const records = [
    codexSignalRecord(0, "M1", "2026-08-26T12:00:02.000Z"),
    codexTokenRecord(1, "2026-08-26T12:00:03.000Z", 80, 80),
    { ordinal: 2, timestamp: "2026-08-26T12:00:04.000Z", type: "compacted", payload: { window_number: 1 } },
    { ordinal: 3, timestamp: "2026-08-26T12:00:04.100Z", type: "world_state" },
    { ordinal: 4, timestamp: "2026-08-26T12:00:04.200Z", type: "turn_context" },
    recap,
  ];
  const state = codexWatchdogState([records]);
  state.tokenWatchdog.arm({
    capFamily: "gpt-frontier",
    milestone: "M1",
    tokenCap: 1_000,
    startedAt: "2026-08-26T12:00:00.000Z",
  });
  await r2CellDriverTestHooks.finishTokenWatchdog(state, {
    milestone: "M1",
    status: "green",
    recordedAt: "2026-08-26T12:00:01.000Z",
  });
  assert.deepEqual(state.tokenWatchdogHistory.map((item) => ({
    liveActualTokens: item.reconciliation.liveActualTokens,
    retainedActualTokens: item.reconciliation.retainedActualTokens,
  })), [{ liveActualTokens: 80, retainedActualTokens: 80 }]);
  assert.equal(state.usageFailure, null);
});

test("post-marker Codex usage is settled, charged to that milestone, and enforced", async () => {
  const m1 = [
    codexSignalRecord(0, "M1", "2026-08-26T12:00:02.000Z"),
    codexTokenRecord(1, "2026-08-26T12:00:03.000Z", 80, 80),
  ];
  const markerVisibleBeforeUsage = [
    ...m1,
    codexSignalRecord(2, "M2", "2026-08-26T12:01:02.000Z"),
  ];
  const lateUsage = [
    ...markerVisibleBeforeUsage,
    codexTokenRecord(3, "2026-08-26T12:01:03.000Z", 100, 20),
  ];
  const state = codexWatchdogState([m1, markerVisibleBeforeUsage, lateUsage]);
  let settlementWaits = 0;
  state.settlementSleep = async () => { settlementWaits += 1; };
  state.tokenWatchdog.arm({
    capFamily: "gpt-frontier",
    milestone: "M1",
    tokenCap: 1_000,
    startedAt: "2026-08-26T12:00:00.000Z",
  });
  await r2CellDriverTestHooks.finishTokenWatchdog(state, {
    milestone: "M1",
    status: "green",
    recordedAt: "2026-08-26T12:00:01.000Z",
  });
  state.tokenWatchdog.arm({
    capFamily: "gpt-frontier",
    milestone: "M2",
    tokenCap: 15,
    startedAt: "2026-08-26T12:01:00.000Z",
  });
  await assert.rejects(r2CellDriverTestHooks.finishTokenWatchdog(state, {
    milestone: "M2",
    status: "green",
    recordedAt: "2026-08-26T12:01:01.000Z",
  }), (error) => (
    error instanceof TokenCapEnforcedError
    && error.trip.milestone === "M2"
    && error.trip.actualTokens === 20
    && error.trip.observedAt === "2026-08-26T12:01:03.000Z"
  ));
  assert.equal(settlementWaits, 1, "the marker must not settle before its later usage event");
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

test("retained 0.3.3 R2 provenance remains valid under its own implicit-v1 pin", async () => {
  const root = fileURLToPath(new URL(
    "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-explicit/",
    ROOT,
  ));
  const record = JSON.parse(await readFile(join(root, "record.json"), "utf8"));
  assert.equal(record.socialMessenger.instrumentVersion, "social-messenger@0.3.3-m8");
  assert.equal(record.socialMessenger.typingObservationBoundaryVersion, undefined);
  delete record.socialMessenger.setup;
  assert.deepEqual(composedErrors(record, root), []);
  const mistyped = structuredClone(record);
  mistyped.socialMessenger.typingObservationBoundaryVersion = "v2";
  assert.notDeepEqual(composedErrors(mistyped, root), []);
  assert.deepEqual(record.socialMessenger.firstProductEdit.selectedSkills, []);

  for (const mutate of [
    (candidate) => { delete candidate.socialMessenger.meteringProvenance.adapter; },
    (candidate) => { delete candidate.socialMessenger.meteringProvenance.unavailableReason; },
    (candidate) => { candidate.socialMessenger.meteringProvenance.adapter.id = "codex-rollout"; },
    (candidate) => { candidate.tokens.input = 1; },
    (candidate) => { candidate.socialMessenger.milestones.M1.authoring.tokens.output = 1; },
  ]) {
    const candidate = structuredClone(record);
    mutate(candidate);
    assert.notDeepEqual(
      composedErrors(candidate, root),
      [],
      "unavailable retained evidence cannot acquire fabricated measurements",
    );
  }

  const disguisedDriver = structuredClone(record);
  disguisedDriver.socialMessenger.meteringProvenance.driver.id = "fixture-driver";
  assert.notDeepEqual(
    composedErrors(disguisedDriver, root),
    [],
    "a current R2 record cannot evade provenance replay by renaming its driver",
  );
});

test("retained 0.3.3 R2 complete evidence rejects coordinated quantitative fabrication", async () => {
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
    ["eligibility", (value) => { value.socialMessenger.efficiencyScorecardEligibility.eligible = true; }],
  ];
  for (const [label, mutate] of mutations) {
    const candidate = structuredClone(record);
    mutate(candidate);
    assert.match(
      composedErrors(candidate, root).join("\n"),
      /complete hash-bound native metering replay|native boundary replay|expected constant null|eligibility must equal/u,
      label,
    );
  }
});

test("migrated current R2 complete replay rejects coordinated quantitative fabrication", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-current-complete-replay-")));
  const root = join(temp, "cell");
  try {
    await cp(fileURLToPath(new URL(
      "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-explicit/",
      ROOT,
    )), root, { recursive: true });
    await migrateCurrentFinalizedCellFixture(root);
    const base = JSON.parse(await readFile(join(root, "record-base.json"), "utf8"));
    assert.equal(
      base.socialMessenger.typingObservationBoundaryVersion,
      CURRENT_TYPING_OBSERVATION_BOUNDARY_VERSION,
      "the migrated base retains the boundary stamped by the production driver",
    );
    assert.equal(base.socialMessenger.setup.instrumentPin, "social-messenger@0.3.7-m8");

    const manifest = JSON.parse(await readFile(join(root, "metering-manifest.json"), "utf8"));
    const boundaryCarriers = [];
    const detailBoundaryCarriers = [];
    for (const receipt of manifest.receipts) {
      const records = parseJsonLines(await readFile(join(root, receipt.path), "utf8"));
      for (const receiptRecord of records) {
        if (receiptRecord.typingObservationBoundaryVersion !== undefined) {
          boundaryCarriers.push(`${receiptRecord.segment}:${receiptRecord.assertion}`);
        }
        if (receiptRecord.details?.typingObservationBoundaryVersion !== undefined) {
          detailBoundaryCarriers.push(`${receiptRecord.segment}:${receiptRecord.assertion}`);
        }
        if (receiptRecord.type === "segment-summary") {
          assert.deepEqual(receiptRecord.setup, base.socialMessenger.setup);
          assert.equal(receiptRecord.setupIdentity.path, join(root, "setup-identity.json"));
          assert.equal(
            receiptRecord.setupIdentity.sha256,
            sha256(await readFile(join(root, "setup-identity.json"))),
          );
        } else {
          assert.equal(receiptRecord.setupIdentity, undefined);
          assert.equal(receiptRecord.setup, undefined);
        }
      }
    }
    assert.deepEqual(boundaryCarriers, [
      "m3:typing-indicator-within-2s-expires-within-5s",
      "m3:__segment__",
    ]);
    assert.deepEqual(detailBoundaryCarriers, [
      "m3:typing-indicator-within-2s-expires-within-5s",
    ]);

    const record = JSON.parse(await readFile(join(root, "record.json"), "utf8"));
    assert.deepEqual(composedErrors(record, root), []);
    const mutations = [
      ["milestone tokens", (value) => { value.socialMessenger.milestones.M1.authoring.tokens.input += 1; }],
      ["total tokens", (value) => { value.tokens.input += 1; }],
      ["token phases", (value) => { value.tokens.phases.authoring += 1; }],
      ["orientation prefix", (value) => { value.socialMessenger.firstProductEdit.orientationTokens.output += 1; }],
      ["charging", (value) => { value.socialMessenger.milestones.M2.charging.chargedTokens += 1; }],
      ["caps", (value) => { value.socialMessenger.milestones.M2.caps.wallCapSeconds += 1; }],
      ["eligibility", (value) => { value.socialMessenger.efficiencyScorecardEligibility.eligible = true; }],
      ["joined provenance", (value) => {
        value.socialMessenger.meteringProvenance.driver.startedAt =
          "2026-08-24T09:05:54.827Z";
      }],
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
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("direct campaign controller command refuses before any prepare or native launch without admission", async () => {
  const repositoryRoot = fileURLToPath(ROOT);
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-direct-controller-")));
  const configPath = join(temp, "harness-config.json");
  try {
    const config = await currentR2HarnessFixture();
    config.paths.privateExecutionRoot = join(temp, "private");
    config.execution.exclusiveHostLock.path = join(temp, "private", "locks", "host.lock");
    await mkdir(config.paths.privateExecutionRoot);
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await assert.rejects(
      execFileAsync(process.execPath, [
        "benchmarks/tools/social-messenger/metering/lane-controller.mjs",
        "--harness-config", configPath,
        "--cell", "sol-clique-familiar",
        "--driver", "benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs",
      ], { cwd: repositoryRoot }),
      (error) => {
        assert.match(error.stderr, /R2_ADMISSION_REQUIRED/u);
        return true;
      },
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("production driver import and preflight failures precede the attempt/private-cell boundary", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-pre-attempt-import-")));
  const configDirectory = join(temp, "never-created-cell");
  try {
    const configPath = join(temp, "harness-config.json");
    const config = await currentR2HarnessFixture();
    config.paths.privateExecutionRoot = join(temp, "private");
    config.execution.exclusiveHostLock.path = join(temp, "private", "locks", "host.lock");
    config.cells.find((cell) => cell.id === "sol-clique-explicit").promptFile = fileURLToPath(new URL(
      "benchmarks/runs/2026-08-23-r2-published-0125/prompts/clique-explicit.md",
      ROOT,
    ));
    await mkdir(config.paths.privateExecutionRoot);
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const loaded = await loadLaneControllerConfig({
      harnessConfigPath: configPath,
      cellId: "sol-clique-explicit",
    });
    const production = await importAndPreflightR2Driver({
      driverPath: fileURLToPath(new URL(
        "benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs",
        ROOT,
      )),
      config: loaded.config,
      configDirectory,
    });
    assert.equal(production.preflight.root, configDirectory);
    await assert.rejects(stat(configDirectory), { code: "ENOENT" });

    await assert.rejects(importAndPreflightR2Driver({
      driverPath: "/production-shaped/import-failure.mjs",
      config: loaded.config,
      configDirectory,
      importModule: async () => { throw new Error("fixture-import-failure"); },
    }), /fixture-import-failure/u);
    await assert.rejects(stat(configDirectory), { code: "ENOENT" });

    await assert.rejects(importAndPreflightR2Driver({
      driverPath: "/production-shaped/preflight-failure.mjs",
      config: loaded.config,
      configDirectory,
      importModule: async () => ({
        runMilestone: async () => {},
        preflight: async () => { throw new Error("fixture-preflight-failure"); },
      }),
    }), /fixture-preflight-failure/u);
    await assert.rejects(stat(configDirectory), { code: "ENOENT" });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("production driver classifies source-inspection retries and surfaces queued refusal at its milestone", async () => {
  const semanticActions = [];
  const recoveryEpisodes = [];
  const nativeState = {
    config: { cell: { harness: "claude-opus5" } },
    controls: {
      semanticAction: async (event) => { semanticActions.push(event); },
      recoveryEpisode: async (event) => { recoveryEpisodes.push(event); },
      reseed: async (_options, operation) => operation(),
      restart: async (operation) => operation(),
      apiRequest: async (_fields, operation) => operation(),
    },
    currentMilestone: "M1",
    observationQueue: Promise.resolve(),
    actionSequence: 0,
    episodeSequence: 0,
    apiSequence: 0,
    lastFailedApiRequest: null,
    pendingEpisodes: new Map(),
    pendingNativeTools: new Map(),
    seenNativeActions: new Set(),
    correctionLoops: [],
  };
  const command = "cat node_modules/@expo/snapback-react/index.mjs";
  r2CellDriverTestHooks.handleNativeRecord(nativeState, {
    id: "source-inspection-failure",
    command,
    exit_code: 1,
  });
  await nativeState.observationQueue;
  r2CellDriverTestHooks.handleNativeRecord(nativeState, {
    id: "source-inspection-retry",
    command,
    exit_code: 0,
  });
  await nativeState.observationQueue;
  assert.equal(semanticActions[0].actionClass, "source-inspection");
  assert.equal(semanticActions[0].binaryExcavation, true);
  assert.equal(semanticActions[1].actionClass, "retry");
  assert.equal(semanticActions[1].retriedClass, "source-inspection");
  assert.equal(semanticActions[1].binaryExcavation, false);
  assert.equal(recoveryEpisodes[0].episodeId, semanticActions[1].episodeId);

  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-driver-observation-refusal-")));
  const laneRunId = "fixture-run/driver-observation-refusal";
  const controls = {
    semanticAction: async () => {
      throw new TypeError("semantic-action.binaryExcavation requires source-inspection");
    },
    recoveryEpisode: async () => {},
    reseed: async (_options, operation) => operation(),
    restart: async (operation) => operation(),
    apiRequest: async (_fields, operation) => operation(),
  };
  const state = {
    ...nativeState,
    config: { laneRunId, cell: { harness: "claude-opus5" }, milestones: ["M1", "M2", "M3"] },
    root: temp,
    currentSession: { sourceId: "builder" },
    child: {},
    controls,
    currentMilestone: "M2",
    observationQueue: Promise.resolve(),
    observationFailure: null,
    pendingEpisodes: new Map(),
    pendingNativeTools: new Map(),
    seenNativeActions: new Set(),
    observationSources: [],
    tokenWatchdog: null,
    tokenWatchdogSessionSourceId: null,
    settledUsage: { turnIds: new Set(), usageRecordOrdinal: null },
    usageFailure: null,
  };
  try {
    await Promise.all([
      mkdir(join(temp, "gates"), { recursive: true }),
      mkdir(join(temp, "events"), { recursive: true }),
    ]);
    await writeFile(join(temp, "events", "cell-milestones.jsonl"), `${JSON.stringify({
      milestone: "M2",
      status: "aborted",
      terminalReason: "abort",
      recordedAt: "2026-08-25T12:00:00.000Z",
    })}\n`);
    r2CellDriverTestHooks.installState(laneRunId, state);
    r2CellDriverTestHooks.handleNativeRecord(state, {
      id: "queued-schema-refusal",
      command,
      exit_code: 0,
    });
    await assert.rejects(
      runProductionDriverMilestone({
        milestone: "M2",
        controls,
        config: state.config,
      }),
      (error) => {
        assert.match(error.message, /M2 observation stream failed: semantic-action\.binaryExcavation requires source-inspection/u);
        assert.match(error.cause.message, /binaryExcavation requires source-inspection/u);
        return true;
      },
    );
  } finally {
    r2CellDriverTestHooks.removeState(laneRunId);
    await rm(temp, { recursive: true, force: true });
  }
});

test("production driver enforces a registered Claude native-stream token cap", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r3-driver-token-cap-")));
  const laneRunId = "fixture-run/native-token-cap";
  const state = {
    config: {
      laneRunId,
      cell: { id: "opus-fixture", harness: "claude-opus5", leg: "B" },
      milestones: ["M1"],
      harnessConfig: { execution: { tokenCapsByLeg: {
        B: { capFamily: "claude-frontier", perMilestone: { M1: 5 } },
      } } },
    },
    root: temp,
    journey: { runScope: "reduced" },
    currentSession: { sourceId: "builder" },
    child: {},
    exit: new Promise(() => {}),
    controls: null,
    currentMilestone: null,
    observationQueue: Promise.resolve(),
    streamWriteQueue: Promise.resolve(),
    actionSequence: 0,
    episodeSequence: 0,
    apiSequence: 0,
    lastFailedApiRequest: null,
    pendingEpisodes: new Map(),
    pendingNativeTools: new Map(),
    seenNativeActions: new Set(),
    correctionLoops: [],
    observationSources: [],
    failureDisposition: null,
    tokenWatchdog: null,
    usageFailure: null,
  };
  const controls = {
    semanticAction: async () => {},
    recoveryEpisode: async () => {},
    reseed: async (_options, operation) => operation(),
    restart: async (operation) => operation(),
    apiRequest: async (_fields, operation) => operation(),
  };
  try {
    await mkdir(join(temp, "gates"), { recursive: true });
    r2CellDriverTestHooks.installState(laneRunId, state);
    const run = runProductionDriverMilestone({ milestone: "M1", controls, config: state.config });
    setTimeout(() => r2CellDriverTestHooks.handleNativeRecord(state, {
      timestamp: new Date().toISOString(),
      message: {
        id: "native-over-cap",
        usage: { input_tokens: 4, output_tokens: 2 },
      },
    }), 10);
    await assert.rejects(run, (error) => (
      error.code === "SOCIAL_MESSENGER_TOKEN_CAP_ENFORCED"
      && error.trip.charging.chargedTokens === 5
    ));
    assert.equal(state.failureDisposition, "token-cap");
  } finally {
    r2CellDriverTestHooks.removeState(laneRunId);
    await rm(temp, { recursive: true, force: true });
  }
});

test("controller re-probes actual process and port quiet after driver preflight and before attempt creation", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-second-quiet-probe-")));
  const configDirectory = join(temp, "private", "cells", "cell-1");
  await mkdir(join(temp, "private"));
  const config = {
    repositoryRoot: temp,
    harnessConfig: {
      runId: "fixture-r2",
      paths: { privateExecutionRoot: join(temp, "private") },
    },
    cell: { id: "cell-1" },
  };
  const seriality = {
    gitHead: "fixture-head",
    committedPrefix: [],
    requestedIndex: 0,
    laterPristine: [],
    privateCellState: "absent",
  };
  let contaminated = false;
  let probes = 0;
  const dependencies = {
    inspectSeriality: async () => seriality,
    verifyAdmission: () => {},
    liveSourceClosure: () => {},
    importDriver: async () => {
      contaminated = true;
      return { driver: { runMilestone: async () => {} }, preflight: { ok: true } };
    },
    probeLaunchQuiet: async () => {
      probes += 1;
      if (contaminated) throw new Error("R2_ADMISSION_PORTS: preflight-bound registered port");
      return { ok: true };
    },
  };
  try {
    await assert.rejects(completeAdmittedDriverPreflight({
      config,
      configDirectory,
      artifact: {},
      harnessConfigPath: join(temp, "harness-config.json"),
      admissionPath: join(temp, "admission.json"),
      actualExecution: {},
      claim: {},
      driverPath: join(temp, "driver.mjs"),
      dependencies,
    }), /preflight-bound registered port/u);
    assert.equal(probes, 2);
    await assert.rejects(stat(configDirectory), { code: "ENOENT" });

    contaminated = false;
    probes = 0;
    const retry = await completeAdmittedDriverPreflight({
      config,
      configDirectory,
      artifact: {},
      harnessConfigPath: join(temp, "harness-config.json"),
      admissionPath: join(temp, "admission.json"),
      actualExecution: {},
      claim: {},
      driverPath: join(temp, "driver.mjs"),
      dependencies: {
        ...dependencies,
        importDriver: async () => ({
          driver: { runMilestone: async () => {} },
          preflight: { ok: true },
        }),
      },
    });
    assert.equal(retry.preflight.ok, true);
    assert.equal(probes, 2);
    await assert.rejects(stat(configDirectory), { code: "ENOENT" });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("R2 controller rejects inherited Node loaders before state and accepts the scrubbed posture", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-node-loader-environment-")));
  const privateRoot = join(temp, "private");
  const configPath = join(temp, "harness-config.json");
  const preloadPath = join(temp, "preload.mjs");
  const markerPath = join(temp, "preload-ran.txt");
  const config = await currentR2HarnessFixture();
  config.paths.privateExecutionRoot = privateRoot;
  config.execution.exclusiveHostLock.path = join(privateRoot, "locks", "host.lock");
  await mkdir(privateRoot);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(preloadPath, [
    'import { appendFileSync } from "node:fs";',
    'appendFileSync(process.env.R2_PRELOAD_MARKER, "loaded\\n");',
    "",
  ].join("\n"));
  const argv = [
    "benchmarks/tools/social-messenger/metering/lane-controller.mjs",
    "--harness-config", configPath,
    "--cell", "sol-clique-familiar",
    "--driver", "benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs",
  ];
  const cleanEnvironment = scrubR2NodeLoaderEnvironment(process.env);
  try {
    await assert.rejects(execFileAsync(process.execPath, argv, {
      cwd: ROOT_PATH,
      env: {
        ...cleanEnvironment,
        NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}`,
        R2_PRELOAD_MARKER: markerPath,
      },
    }), (error) => {
      assert.match(error.stderr, /R2_EXECUTION_ENVIRONMENT/u);
      return true;
    });
    assert.equal(await readFile(markerPath, "utf8"), "loaded\n");
    await assert.rejects(stat(join(privateRoot, "cells")), { code: "ENOENT" });

    await assert.rejects(execFileAsync(process.execPath, argv, {
      cwd: ROOT_PATH,
      env: cleanEnvironment,
    }), (error) => {
      assert.match(error.stderr, /R2_ADMISSION_REQUIRED/u);
      assert.doesNotMatch(error.stderr, /R2_EXECUTION_ENVIRONMENT/u);
      return true;
    });
    await assert.rejects(stat(join(privateRoot, "cells")), { code: "ENOENT" });
    assert.throws(
      () => assertR2ExecutionEnvironment({ harnessConfig: config, environment: { NODE_PATH: "/tmp/foreign" } }),
      /R2_EXECUTION_ENVIRONMENT/u,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("admission refuses a non-pristine target slot instead of permitting a rerun", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-admission-pristine-")));
  try {
    const committedRoot = join(temp, "run");
    await Promise.all([
      mkdir(join(committedRoot, "cells/cell-2"), { recursive: true }),
      mkdir(join(temp, "private")),
    ]);
    await writeFile(join(committedRoot, "cells/cell-2/cell.json"), JSON.stringify({
      schemaVersion: "snapback.r2-cell-slot.v1",
      cellId: "cell-2",
      status: "not-started",
  }));

    const harnessConfig = {
      cellOrder: ["cell-2"],
      paths: { committedRunRoot: "run", privateExecutionRoot: join(temp, "private") },
    };
    await assert.rejects(inspectCommittedSeriality({
      harnessConfig,
      cellId: "cell-2",
      repositoryRoot: temp,
      privateExists: (path) => path.endsWith("cell-2"),
      gitRead: (args) => {
        if (args[0] === "rev-parse") return "fixture-head";
        return readFileSync(join(temp, args[1].split(":").slice(1).join(":")));
      },
    }), /R2_ADMISSION_PRISTINE: target slot cell-2 is not pristine/u);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

async function makeFinalizedPrefixFixture() {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-finalized-prefix-")));
  const cellId = "sol-clique-explicit";
  const cellRoot = join(temp, "run", "cells", cellId);
  await Promise.all([
    cp(fileURLToPath(new URL(
      `benchmarks/runs/2026-08-23-r2-published-0125/cells/${cellId}/`,
      ROOT,
    )), cellRoot, { recursive: true }),
    cp(fileURLToPath(new URL("benchmarks/schema/", ROOT)), join(temp, "benchmarks", "schema"), {
      recursive: true,
    }),
    mkdir(join(temp, "run", "cells", "next-cell"), { recursive: true }),
    mkdir(join(temp, "private")),
  ]);
  await writeFile(join(temp, "run", "cells", "next-cell", "cell.json"), `${JSON.stringify({
    schemaVersion: "snapback.r2-cell-slot.v1",
    cellId: "next-cell",
    status: "not-started",
  }, null, 2)}\n`);
  await migrateCurrentFinalizedCellFixture(cellRoot);
  const harnessConfig = {
    cellOrder: [cellId, "next-cell"],
    paths: { committedRunRoot: "run", privateExecutionRoot: join(temp, "private") },
    execution: { milestones: ["M1", "M2", "M3"] },
  };
  const gitRead = (args) => {
    if (args[0] === "rev-parse") return "fixture-head";
    return readFileSync(join(temp, args[1].split(":").slice(1).join(":")));
  };
  return { temp, cellId, cellRoot, harnessConfig, gitRead };
}

test("admission accepts a validator-clean recorded disposition after its pristine target", async () => {
  const fixture = await makeFinalizedPrefixFixture();
  try {
    fixture.harnessConfig.cellOrder = ["next-cell", fixture.cellId];
    const state = await inspectCommittedSeriality({
      harnessConfig: fixture.harnessConfig,
      cellId: "next-cell",
      repositoryRoot: fixture.temp,
      gitRead: fixture.gitRead,
    });
    assert.deepEqual(state.committedPrefix, [fixture.cellId]);
    assert.deepEqual(state.landedDispositions, [{
      cellId: fixture.cellId,
      kind: "validated-record",
      path: `cells/${fixture.cellId}/record.json`,
      sha256: sha256(await readFile(join(fixture.cellRoot, "record.json"))),
      outcome: "success",
      rootCauseClass: null,
    }]);
  } finally {
    await rm(fixture.temp, { recursive: true, force: true });
  }
});

test("admission requires a landed disposition for every attempted non-target slot", async (context) => {
  const makeFixture = async () => {
    const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-attempt-disposition-")));
    await Promise.all([
      mkdir(join(temp, "run", "cells", "attempted"), { recursive: true }),
      mkdir(join(temp, "run", "cells", "target"), { recursive: true }),
      mkdir(join(temp, "private", "cells", "attempted"), { recursive: true }),
    ]);
    for (const id of ["attempted", "target"]) {
      await writeFile(join(temp, "run", "cells", id, "cell.json"), `${JSON.stringify({
        schemaVersion: "snapback.r2-cell-slot.v1",
        cellId: id,
        status: "not-started",
      }, null, 2)}\n`);
    }
    const harnessConfig = {
      cellOrder: ["attempted", "target"],
      cells: [{ id: "attempted" }, { id: "target" }],
      paths: { committedRunRoot: "run", privateExecutionRoot: join(temp, "private") },
    };
    const committed = new Map();
    const commit = (logical) => {
      committed.set(logical, readFileSync(join(temp, logical)));
    };
    const gitRead = (args) => {
      if (args[0] === "rev-parse") return "fixture-head";
      const logical = args[1].split(":").slice(1).join(":");
      if (!committed.has(logical)) throw new Error(`not committed: ${logical}`);
      return committed.get(logical);
    };
    const installDisposition = async ({
      reportExists = true,
      reportCommitted = true,
      reportHash = null,
      identity = true,
    } = {}) => {
      const reportPath = "BLOCKED-attempted-driver-failure.md";
      const report = "# Driver failure for `attempted`\n\nDisposition: consumed; do not rerun.\n";
      const artifactPath = "admissions/attempted.json";
      const artifact = "{\"cellId\":\"attempted\"}\n";
      await mkdir(join(temp, "run", "admissions"), { recursive: true });
      await writeFile(join(temp, "run", artifactPath), artifact);
      commit(`run/${artifactPath}`);
      if (reportExists) {
        await writeFile(join(temp, "run", reportPath), report);
        if (reportCommitted) commit(`run/${reportPath}`);
      }
      harnessConfig.cells[0].disposition = {
        kind: "driver-failure-report",
        path: reportPath,
        sha256: reportHash ?? sha256(report),
      };
      if (identity) {
        const identityReport = `${JSON.stringify({
          version: "snapback.r2-failure-dispositions.v1",
          dispositions: [{
            cellId: "attempted",
            report: { path: reportPath, sha256: sha256(report) },
            disposedArtifact: {
              kind: "admission",
              path: artifactPath,
              sha256: sha256(artifact),
            },
          }],
        }, null, 2)}\n`;
        await writeFile(join(temp, "run", "failure-dispositions.json"), identityReport);
        commit("run/failure-dispositions.json");
      }
      return reportPath;
    };
    return { temp, harnessConfig, gitRead, installDisposition };
  };

  await context.test("attempted but dispositionless", async () => {
    const fixture = await makeFixture();
    try {
      await assert.rejects(inspectCommittedSeriality({
        harnessConfig: fixture.harnessConfig,
        cellId: "target",
        repositoryRoot: fixture.temp,
        gitRead: fixture.gitRead,
      }), /R2_ADMISSION_PRISTINE: slot attempted is genuinely not pristine/u);
    } finally {
      await rm(fixture.temp, { recursive: true, force: true });
    }
  });

  await context.test("committed structurally bound driver-failure report", async () => {
    const fixture = await makeFixture();
    try {
      const reportPath = await fixture.installDisposition();
      const state = await inspectCommittedSeriality({
        harnessConfig: fixture.harnessConfig,
        cellId: "target",
        repositoryRoot: fixture.temp,
        gitRead: fixture.gitRead,
      });
      assert.deepEqual(state.committedPrefix, ["attempted"]);
      assert.equal(state.landedDispositions[0].path, reportPath);
    } finally {
      await rm(fixture.temp, { recursive: true, force: true });
    }
  });

  for (const [name, options, diagnostic] of [
    ["missing report", { reportExists: false }, /R2_ADMISSION_DISPOSITION_MISSING/u],
    ["report hash mismatch", { reportHash: `sha256:${"0".repeat(64)}` }, /R2_ADMISSION_DISPOSITION_HASH_MISMATCH/u],
    ["uncommitted report bytes", { reportCommitted: false }, /R2_ADMISSION_DISPOSITION_UNCOMMITTED/u],
    ["mere cell mention without structural identity", { identity: false }, /R2_ADMISSION_DISPOSITION_WEAK_IDENTITY/u],
  ]) {
    await context.test(name, async () => {
      const fixture = await makeFixture();
      try {
        await fixture.installDisposition(options);
        await assert.rejects(inspectCommittedSeriality({
          harnessConfig: fixture.harnessConfig,
          cellId: "target",
          repositoryRoot: fixture.temp,
          gitRead: fixture.gitRead,
        }), diagnostic);
      } finally {
        await rm(fixture.temp, { recursive: true, force: true });
      }
    });
  }
});

test("admission validates every finalized disposition and rejects stray target artifacts", async (context) => {
  await context.test("coordinated committed quantitative fabrication", async () => {
    const fixture = await makeFinalizedPrefixFixture();
    try {
      const recordPath = join(fixture.cellRoot, "record.json");
      const record = JSON.parse(await readFile(recordPath, "utf8"));
      record.tokens.input += 1;
      const recordBytes = `${JSON.stringify(record, null, 2)}\n`;
      await writeFile(recordPath, recordBytes);
      const slotPath = join(fixture.cellRoot, "cell.json");
      const slot = JSON.parse(await readFile(slotPath, "utf8"));
      slot.record.sha256 = sha256(recordBytes);
      await writeFile(slotPath, `${JSON.stringify(slot, null, 2)}\n`);
      await assert.rejects(inspectCommittedSeriality({
        harnessConfig: fixture.harnessConfig,
        cellId: "next-cell",
        repositoryRoot: fixture.temp,
        gitRead: fixture.gitRead,
      }), /semantic replay|composition replay|native metering replay/u);
    } finally {
      await rm(fixture.temp, { recursive: true, force: true });
    }
  });

  await context.test("second attempt", async () => {
    const fixture = await makeFinalizedPrefixFixture();
    try {
      const slotPath = join(fixture.cellRoot, "cell.json");
      const slot = JSON.parse(await readFile(slotPath, "utf8"));
      slot.attemptCount = 2;
      await writeFile(slotPath, `${JSON.stringify(slot, null, 2)}\n`);
      await assert.rejects(inspectCommittedSeriality({
        harnessConfig: fixture.harnessConfig,
        cellId: "next-cell",
        repositoryRoot: fixture.temp,
        gitRead: fixture.gitRead,
      }), /single-attempt/u);
    } finally {
      await rm(fixture.temp, { recursive: true, force: true });
    }
  });

  await context.test("explicit rerun marker", async () => {
    const fixture = await makeFinalizedPrefixFixture();
    try {
      const slotPath = join(fixture.cellRoot, "cell.json");
      const slot = JSON.parse(await readFile(slotPath, "utf8"));
      slot.campaignCellRerun = true;
      await writeFile(slotPath, `${JSON.stringify(slot, null, 2)}\n`);
      await assert.rejects(inspectCommittedSeriality({
        harnessConfig: fixture.harnessConfig,
        cellId: "next-cell",
        repositoryRoot: fixture.temp,
        gitRead: fixture.gitRead,
      }), /single-attempt/u);
    } finally {
      await rm(fixture.temp, { recursive: true, force: true });
    }
  });

  for (const artifact of ["record.json", "metering.json"]) {
    await context.test(`stray tail ${artifact}`, async () => {
      const fixture = await makeFinalizedPrefixFixture();
      try {
        await writeFile(join(fixture.temp, "run", "cells", "next-cell", artifact), "{}\n");
        await assert.rejects(inspectCommittedSeriality({
          harnessConfig: fixture.harnessConfig,
          cellId: "next-cell",
          repositoryRoot: fixture.temp,
          gitRead: fixture.gitRead,
        }), /target slot next-cell is not pristine/u);
      } finally {
        await rm(fixture.temp, { recursive: true, force: true });
      }
    });
  }
});

test("launch quiet re-probe catches delayed campaign process and port appearance", async () => {
  const harnessConfig = {
    runId: "fixture-run",
    paths: { privateExecutionRoot: "/tmp/r2-probe-fixture" },
    cells: [
      { id: "one", ports: [4100, 4101] },
      { id: "two", ports: [4101, 4102] },
    ],
    cellOrder: ["one", "two"],
  };
  const seriality = { committedPrefix: ["one"] };
  let processProbeCount = 0;
  const delayedProcess = () => ({
    recorded: { pids: [], isolatedProcessGroups: [] },
    active: processProbeCount++ === 0 ? [] : [{ pid: 77, ppid: 1, pgid: 77, reasons: ["campaign-path"] }],
  });
  const portProbe = async () => true;
  const first = await probeLaunchQuiet({ harnessConfig, seriality, processProbe: delayedProcess, portProbe });
  assert.deepEqual(first.ports.values, [4100, 4101, 4102]);
  await assert.rejects(
    probeLaunchQuiet({ harnessConfig, seriality, processProbe: delayedProcess, portProbe }),
    /campaign process evidence remains active/u,
  );

  let portPass = 0;
  const quietProcess = () => ({ recorded: { pids: [], isolatedProcessGroups: [] }, active: [] });
  const delayedPort = async (port) => {
    portPass += 1;
    return !(portPass > 3 && port === 4101);
  };
  await probeLaunchQuiet({ harnessConfig, seriality, processProbe: quietProcess, portProbe: delayedPort });
  await assert.rejects(
    probeLaunchQuiet({ harnessConfig, seriality, processProbe: quietProcess, portProbe: delayedPort }),
    /registered ports are bound/u,
  );
});

test("stale host-lock recovery is explicit and scoped without authorizing a rerun", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-stale-lock-")));
  try {
    await mkdir(join(temp, "private"));
    const harnessConfig = {
      runId: "fixture-run",
      paths: { privateExecutionRoot: join(temp, "private") },
      execution: {
        exclusiveHostLock: {
          path: join(temp, "private", "locks", "host.lock"),
        },
      },
    };
    acquireExclusiveHostLock({
      harnessConfig,
      cellId: "cell-1",
      purpose: "admission",
      reservedBy: "crashed-owner",
      nowMs: 0,
      pid: 999_999,
      awaitingControllerUntil: 1,
    });
    assert.throws(() => acquireExclusiveHostLock({
      harnessConfig,
      cellId: "cell-2",
      purpose: "admission",
      reservedBy: "unsafe-recovery",
      nowMs: 10_000,
      recoverStale: true,
      processAlive: () => false,
      mayRecoverOwner: () => false,
    }), /cannot authorize this owner\/cell transition/u);
    const recovered = acquireExclusiveHostLock({
      harnessConfig,
      cellId: "cell-2",
      purpose: "admission",
      reservedBy: "explicit-safe-recovery",
      nowMs: 10_000,
      recoverStale: true,
      processAlive: () => false,
      mayRecoverOwner: (owner) => owner.cellId === "cell-1",
    });
    releaseExclusiveHostLock({ lock: recovered, outcome: "stale-recovery-test", nowMs: 11_000 });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("stale recovery cannot overwrite a controller claim acquired after its inspected snapshot", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-stale-lock-cas-")));
  try {
    await mkdir(join(temp, "private"));
    const harnessConfig = {
      runId: "fixture-run",
      paths: { privateExecutionRoot: join(temp, "private") },
      execution: { exclusiveHostLock: { path: join(temp, "private", "locks", "host.lock") } },
    };
    const ownerA = acquireExclusiveHostLock({
      harnessConfig,
      cellId: "cell-a",
      purpose: "admission",
      reservedBy: "paused-a",
      nowMs: 0,
      pid: 999_999,
      awaitingControllerUntil: 1,
      token: "a".repeat(64),
    });
    let controllerClaim;
    assert.throws(() => acquireExclusiveHostLock({
      harnessConfig,
      cellId: "cell-b",
      purpose: "admission",
      reservedBy: "contender-b",
      nowMs: 10_000,
      recoverStale: true,
      processAlive: () => false,
      mayRecoverOwner: (owner) => owner.token === ownerA.token,
      beforeRecoveryCompare: () => {
        controllerClaim = claimExclusiveHostLock({
          lock: ownerA,
          harnessConfig,
          cellId: "cell-a",
          artifactSha256: `sha256:${"1".repeat(64)}`,
          execution: { exact: "controller-a" },
        });
      },
    }), /LOCK_CAS/u);
    const retainedOwner = JSON.parse(await readFile(join(ownerA.path, "owner.json"), "utf8"));
    const retainedClaim = JSON.parse(await readFile(join(ownerA.path, "controller-claim.json"), "utf8"));
    assert.equal(retainedOwner.token, ownerA.token);
    assert.equal(retainedClaim.token, ownerA.token);
    assert.throws(() => acquireExclusiveHostLock({
      harnessConfig,
      cellId: "cell-b",
      purpose: "admission",
      reservedBy: "second-contender-b",
      nowMs: 11_000,
      recoverStale: true,
      processAlive: (pid) => pid === process.pid,
      mayRecoverOwner: () => true,
    }), /still live/u);
    releaseExclusiveHostLock({
      lock: ownerA,
      claim: controllerClaim,
      outcome: "controller-a-remained-owner",
      nowMs: 12_000,
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("per-cell admission binds exact execution, probes after sampling, and owns one exclusive lock", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-admission-")));
  try {
    await mkdir(join(temp, "private"));
    const materializedRoot = join(temp, "instrument");
    materializeInstrumentSnapshot({
      sourceRoot: fileURLToPath(new URL("benchmarks/", ROOT)),
      outPath: materializedRoot,
    });
    const sourceConfig = await currentR2HarnessFixture();
    const cell = sourceConfig.cells[1];
    const configPath = join(temp, "harness-config.json");
    const admissionPath = join(temp, "admission.json");
    cell.admissionArtifact = "admission.json";
    cell.controllerCommand = [
      process.execPath,
      sourceConfig.controller.entrypoint,
      "--harness-config",
      configPath,
      "--cell",
      cell.id,
      "--driver",
      sourceConfig.controller.driver,
      "--admission",
      admissionPath,
    ];
    sourceConfig.controller.commandTemplate = cell.controllerCommand.map((value) => (
      value === cell.id ? "{cellId}" : value
    ));
    sourceConfig.pins.instrument.manifestPath = "benchmarks/instrument.manifest.json";
    sourceConfig.paths.instrumentRoot = materializedRoot;
    sourceConfig.paths.privateExecutionRoot = join(temp, "private");
    sourceConfig.execution.diskPolicy = {
      privateRootFreeSpaceFloorGiB: 20,
      refusalDiagnostic: "R3_ADMISSION_DISK_FLOOR",
    };
    sourceConfig.execution.exclusiveHostLock.path = join(temp, "private", "locks", "host.lock");
    const instrumentBytes = await readFile(new URL("benchmarks/instrument.manifest.json", ROOT));
    sourceConfig.pins.instrument.manifestSha256 = sha256(instrumentBytes).replace(/^sha256:/u, "");
    const execution = configuredExecutionBinding({ harnessConfig: sourceConfig, cell });
    sourceConfig.pins.instrument.d06MeteringOverlay.laneControllerSha256 = execution.controller.sha256.replace(/^sha256:/u, "");
    sourceConfig.pins.instrument.d06MeteringOverlay.productionDriverSha256 = execution.driver.sha256.replace(/^sha256:/u, "");
    sourceConfig.machines[cell.allowedHostId].node = {
      path: execution.node.path,
      version: process.version,
      sha256: execution.node.sha256,
      bytes: execution.node.bytes,
    };
    await writeFile(configPath, `${JSON.stringify(sourceConfig, null, 2)}\n`);
    let clock = Date.parse("2026-08-24T12:00:00.000Z");
    const seriality = {
      gitHead: "fixture-head",
      committedPrefix: [sourceConfig.cellOrder[0]],
      requestedIndex: 1,
      laterPristine: sourceConfig.cellOrder.slice(2),
      privateCellState: "absent",
    };
    let samplesObserved = 0;
    let quietProbes = 0;
    const injected = {
      inspectSeriality: () => seriality,
      assertCommittedConfig: () => {},
      currentHostIdentity: () => {
        const host = sourceConfig.machines[cell.allowedHostId];
        return {
          hostname: host.hostname,
          platform: host.platform,
          release: host.release,
          arch: host.arch,
          hardwareModel: host.hardwareModel,
          chip: host.chip,
          physicalCpuCount: host.physicalCpuCount,
          logicalCpuCount: host.logicalCpuCount,
          memoryBytes: host.memoryBytes,
        };
      },
      processProbe: () => {
        quietProbes += 1;
        assert.equal(samplesObserved, 3, "process probing must occur after all three load samples");
        return { recorded: { pids: [], isolatedProcessGroups: [] }, active: [] };
      },
      portIsUnbound: async () => true,
      harnessEvidence: (key, harness) => ({
        key,
        binary: harness.binary,
        observedVersion: harness.observedVersion,
        version: { ok: true, argv: ["--version"] },
        auth: { ok: true, argv: ["fixture-auth"] },
      }),
      now: () => clock,
      loadavg: () => { samplesObserved += 1; return [1, 2, 3]; },
      sleep: async (millis) => { clock += millis; },
      statfs: () => ({ bsize: 4096n, bavail: 6_000_000n }),
    };
    let lowDiskLockCalls = 0;
    await assert.rejects(createAdmissionArtifact({
      harnessConfigPath: configPath,
      cellId: cell.id,
      reservedBy: "metering-test-low-disk",
      admissionPath,
      dependencies: {
        ...injected,
        statfs: () => ({ bsize: 4096n, bavail: 1n }),
        acquireExclusiveHostLock: () => { lowDiskLockCalls += 1; return null; },
      },
    }), /R3_ADMISSION_DISK_FLOOR/u);
    assert.equal(lowDiskLockCalls, 0, "disk refusal must precede exclusive lock acquisition");
    let issuanceDiskChecks = 0;
    let lateDiskSamples = 0;
    await assert.rejects(createAdmissionArtifact({
      harnessConfigPath: configPath,
      cellId: cell.id,
      reservedBy: "metering-test-late-low-disk",
      admissionPath,
      dependencies: {
        ...injected,
        loadavg: () => { lateDiskSamples += 1; return [1, 2, 3]; },
        processProbe: () => {
          assert.equal(lateDiskSamples, 3, "fresh disk refusal must follow all load samples");
          return { recorded: { pids: [], isolatedProcessGroups: [] }, active: [] };
        },
        statfs: () => {
          issuanceDiskChecks += 1;
          return issuanceDiskChecks === 1
            ? { bsize: 4096n, bavail: 6_000_000n }
            : { bsize: 4096n, bavail: 1n };
        },
      },
    }), /R3_ADMISSION_DISK_FLOOR/u);
    assert.equal(issuanceDiskChecks, 2, "disk must be measured before lock and again at issuance");
    await assert.rejects(stat(admissionPath), { code: "ENOENT" });
    let samplesBeforeInstrument = 0;
    await assert.rejects(createAdmissionArtifact({
      harnessConfigPath: configPath,
      cellId: cell.id,
      reservedBy: "metering-test",
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
      reservedBy: "metering-test",
      admissionPath,
      dependencies: injected,
    });
    assert.equal(artifact.loadIsolation.samples.length, 3);
    assert.equal(quietProbes, 1);
    assert.equal(artifact.instrument.source.sha256, artifact.instrument.materialized.sha256);
    assert.equal(
      Date.parse(artifact.loadIsolation.samples[2].sampledAt)
        - Date.parse(artifact.loadIsolation.samples[0].sampledAt),
      120_000,
    );
    const actualExecution = {
      execPath: artifact.execution.node.path,
      cwd: artifact.execution.cwd,
      controllerPath: artifact.execution.controller.path,
      driverPath: artifact.execution.driver.path,
      argv: artifact.execution.argv,
      environment: artifact.execution.environment,
    };
    for (const [label, mutate] of [
      ["Node", (value) => { value.execPath = artifact.execution.controller.path; }],
      ["controller", (value) => { value.controllerPath = artifact.execution.driver.path; }],
      ["driver", (value) => { value.driverPath = artifact.execution.controller.path; }],
      ["argv value", (value) => { value.argv = value.argv.with(4, "wrong-cell"); }],
      ["argv order", (value) => { value.argv = [...value.argv.slice(0, 2).reverse(), ...value.argv.slice(2)]; }],
    ]) {
      const changed = structuredClone(actualExecution);
      mutate(changed);
      assert.throws(() => verifyAdmissionArtifact({
        artifact,
        harnessConfig: sourceConfig,
        harnessConfigPath: configPath,
        cellId: cell.id,
        admissionPath,
        nowMs: Date.parse(artifact.issuedAt),
        campaignState: seriality,
        actualExecution: changed,
        observedHostIdentity: artifact.host.observed,
      }), /R2_ADMISSION_COMMAND/u, label);
    }
    for (const [label, mutate] of [
      ["Node bytes", (value) => { value.node.sha256 = `sha256:${"1".repeat(64)}`; }],
      ["controller bytes", (value) => { value.controller.sha256 = `sha256:${"2".repeat(64)}`; }],
      ["driver bytes", (value) => { value.driver.sha256 = `sha256:${"3".repeat(64)}`; }],
    ]) {
      const changed = structuredClone(artifact.execution);
      mutate(changed);
      assert.throws(() => verifyAdmissionArtifact({
        artifact,
        harnessConfig: sourceConfig,
        harnessConfigPath: configPath,
        cellId: cell.id,
        admissionPath,
        nowMs: Date.parse(artifact.issuedAt),
        campaignState: seriality,
        observedHostIdentity: artifact.host.observed,
        executionBinding: () => changed,
      }), /admitted Node\/controller\/argv\/driver bytes changed/u, label);
    }
    const materializedManifestPath = join(materializedRoot, "instrument.manifest.json");
    const materializedManifestBytes = await readFile(materializedManifestPath);
    await execFileAsync("chmod", ["u+w", materializedManifestPath]);
    await writeFile(materializedManifestPath, Buffer.concat([materializedManifestBytes, Buffer.from("\n")]));
    assert.throws(() => verifyAdmissionArtifact({
      artifact,
      harnessConfig: sourceConfig,
      harnessConfigPath: configPath,
      cellId: cell.id,
      admissionPath,
      nowMs: Date.parse(artifact.issuedAt),
      campaignState: seriality,
      observedHostIdentity: artifact.host.observed,
    }), /R2_ADMISSION_INSTRUMENT/u);
    await writeFile(materializedManifestPath, materializedManifestBytes);
    await execFileAsync("chmod", ["a-w", materializedManifestPath]);
    assert.throws(() => verifyAdmissionArtifact({
      artifact,
      harnessConfig: sourceConfig,
      harnessConfigPath: configPath,
      cellId: cell.id,
      admissionPath,
      nowMs: Date.parse(artifact.issuedAt),
      campaignState: seriality,
      observedHostIdentity: { ...artifact.host.observed, hardwareModel: "Mac16,99" },
    }), /R2_ADMISSION_HOST/u);
    await assert.rejects(createAdmissionArtifact({
      harnessConfigPath: configPath,
      cellId: cell.id,
      reservedBy: "competing-admission",
      admissionPath,
      dependencies: injected,
    }), /R2_ADMISSION_LOCK_HELD/u);
    const claim = claimExclusiveHostLock({
      lock: artifact.exclusiveHostLock,
      harnessConfig: sourceConfig,
      cellId: cell.id,
      artifactSha256: artifact.identity.sha256,
      execution: actualExecution,
    });
    assert.throws(() => claimExclusiveHostLock({
      lock: artifact.exclusiveHostLock,
      harnessConfig: sourceConfig,
      cellId: cell.id,
      artifactSha256: artifact.identity.sha256,
      execution: actualExecution,
    }), /already claimed/u);
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
      observedHostIdentity: artifact.host.observed,
    }), /once per minute/u);
    releaseExclusiveHostLock({
      lock: artifact.exclusiveHostLock,
      claim,
      outcome: "metering-test-complete",
      nowMs: clock,
    });
    clock += 31_000;
    samplesObserved = 0;
    quietProbes = 0;
    const replacement = await createAdmissionArtifact({
      harnessConfigPath: configPath,
      cellId: cell.id,
      reservedBy: "fresh-controller-after-pre-attempt-failure",
      admissionPath,
      dependencies: injected,
    });
    assert.notEqual(replacement.identity.sha256, artifact.identity.sha256);
    assert.deepEqual(
      await readFile(join(dirname(admissionPath), "history", cell.id, `${artifact.identity.sha256.slice(7)}.json`)),
      Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`),
    );
    releaseExclusiveHostLock({
      lock: replacement.exclusiveHostLock,
      outcome: "fresh-controller-remains-permitted",
      nowMs: clock,
    });
  } finally {
    await execFileAsync("chmod", ["-R", "u+w", temp]).catch(() => {});
    await rm(temp, { recursive: true, force: true });
  }
});

test("executing source closure refuses dirty imported dependency and schema bytes with clean entrypoints", async () => {
  const paths = [
    "benchmarks/schema/run-record.schema.json",
    "benchmarks/schema/social-messenger/run-record-extension.schema.json",
    "benchmarks/schema/social-messenger/run-record.schema.json",
    "benchmarks/tools/lane-setup.mjs",
    "benchmarks/tools/social-messenger/choreography/receipts.schema.json",
    "benchmarks/tools/social-messenger/record-validator.mjs",
    "benchmarks/tools/lib/json-schema.mjs",
  ];
  for (const mutationPath of [
    "benchmarks/tools/social-messenger/metering/counts.mjs",
    "benchmarks/schema/social-messenger/run-record.schema.json",
  ]) {
    const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-source-closure-mutation-")));
    try {
      await cp(
        join(ROOT_PATH, "benchmarks/tools/social-messenger/metering"),
        join(temp, "benchmarks/tools/social-messenger/metering"),
        { recursive: true },
      );
      for (const path of paths) {
        await mkdir(dirname(join(temp, path)), { recursive: true });
        await copyFile(join(ROOT_PATH, path), join(temp, path));
      }
      const config = JSON.parse(await readFile(new URL(
        "benchmarks/runs/2026-08-23-r2-published-0125/harness-config.json",
        ROOT,
      ), "utf8"));
      config.execution.sourceClosure = measureSourceClosure({ repositoryRoot: temp });
      liveSourceClosure({ harnessConfig: config, repositoryRoot: temp });
      await writeFile(join(temp, mutationPath), Buffer.concat([
        await readFile(join(temp, mutationPath)),
        Buffer.from("\n// direct dirty dependency mutation\n"),
      ]));
      assert.throws(
        () => liveSourceClosure({ harnessConfig: config, repositoryRoot: temp }),
        /SOURCE_CLOSURE/u,
        mutationPath,
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
});

async function makeFinalizeExistingFixture({
  targetOutsideRepository = false,
  dispositionPrefix = false,
} = {}) {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-finalize-existing-")));
  const registeredRunRoot = await mkdtemp(join(ROOT_PATH, "benchmarks/runs/.r2-finalize-existing-"));
  const publicationRunRoot = targetOutsideRepository ? join(temp, "escaped-run") : registeredRunRoot;
  const cellId = "opus-clique-explicit";
  const privateCell = join(temp, "private", "cells", cellId);
  const targetCell = join(publicationRunRoot, "cells", cellId);
  const configPath = join(registeredRunRoot, "harness-config.json");
  const admissionPath = join(registeredRunRoot, "admissions", `${cellId}.json`);
  const sourceConfig = await currentR2HarnessFixture();
  const sourceCell = structuredClone(sourceConfig.cells.find((cell) => cell.id === cellId));
  delete sourceCell.disposition;
  const dispositionCell = dispositionPrefix
      ? {
        id: "consumed-cell",
        ports: [49_900, 49_919],
        disposition: {
          kind: "driver-failure-report",
          path: "BLOCKED-consumed-cell-driver-failure.md",
          sha256: sha256("# Consumed fixture cell\n"),
        },
      }
    : null;
  sourceConfig.cells = dispositionCell === null ? [sourceCell] : [dispositionCell, sourceCell];
  sourceConfig.cellOrder = sourceConfig.cells.map((cell) => cell.id);
  sourceConfig.paths.committedRunRoot = targetOutsideRepository
    ? publicationRunRoot
    : relative(ROOT_PATH, registeredRunRoot);
  sourceConfig.paths.privateExecutionRoot = join(temp, "private");
  sourceConfig.paths.instrumentRoot = join(temp, "instrument");
  sourceConfig.execution.exclusiveHostLock.path = join(temp, "private", "locks", "host.lock");
  sourceCell.admissionArtifact = `admissions/${cellId}.json`;
  const logicalConfigPath = relative(ROOT_PATH, configPath);
  const logicalAdmissionPath = relative(ROOT_PATH, admissionPath);
  sourceCell.controllerCommand = [
    sourceConfig.machines[sourceCell.allowedHostId].node.path,
    sourceConfig.controller.entrypoint,
    "--harness-config",
    logicalConfigPath,
    "--cell",
    cellId,
    "--driver",
    sourceConfig.controller.driver,
    "--admission",
    logicalAdmissionPath,
  ];
  sourceConfig.controller.commandTemplate = sourceCell.controllerCommand.map((value) => (
    value === cellId ? "{cellId}" : value
  ));
  const instrumentBytes = await readFile(new URL("benchmarks/instrument.manifest.json", ROOT));
  sourceConfig.pins.instrument.manifestSha256 = sha256(instrumentBytes).replace(/^sha256:/u, "");
  materializeInstrumentSnapshot({
    sourceRoot: fileURLToPath(new URL("benchmarks/", ROOT)),
    outPath: sourceConfig.paths.instrumentRoot,
  });
  await Promise.all([
    mkdir(dirname(admissionPath), { recursive: true }),
    mkdir(targetCell, { recursive: true }),
    mkdir(join(temp, "private")),
  ]);
  let landedDisposition;
  if (dispositionCell !== null) {
    const report = "# Consumed fixture cell\n";
    const disposedArtifact = "{\"cellId\":\"consumed-cell\"}\n";
    const disposedPath = "admissions/consumed-cell.json";
    landedDisposition = {
      cellId: dispositionCell.id,
      kind: dispositionCell.disposition.kind,
      path: dispositionCell.disposition.path,
      sha256: dispositionCell.disposition.sha256,
      outcome: "failure",
      rootCauseClass: null,
    };
    await Promise.all([
      mkdir(join(publicationRunRoot, "cells", dispositionCell.id), { recursive: true }),
      writeFile(join(publicationRunRoot, dispositionCell.disposition.path), report),
      writeFile(join(publicationRunRoot, disposedPath), disposedArtifact),
    ]);
    await writeFile(
      join(publicationRunRoot, "cells", dispositionCell.id, "cell.json"),
      `${JSON.stringify({
        schemaVersion: "snapback.r2-cell-slot.v1",
        cellId: dispositionCell.id,
        status: "not-started",
      }, null, 2)}\n`,
    );
    await writeFile(
      join(publicationRunRoot, "failure-dispositions.json"),
      `${JSON.stringify({
        version: "snapback.r2-failure-dispositions.v1",
        dispositions: [{
          cellId: dispositionCell.id,
          report: {
            path: dispositionCell.disposition.path,
            sha256: dispositionCell.disposition.sha256,
          },
          disposedArtifact: {
            kind: "admission",
            path: disposedPath,
            sha256: sha256(disposedArtifact),
          },
        }],
      }, null, 2)}\n`,
    );
  }
  const configBytes = Buffer.from(`${JSON.stringify(sourceConfig, null, 2)}\n`);
  await writeFile(configPath, configBytes);
  const execution = configuredExecutionBinding({
    harnessConfig: sourceConfig,
    cell: sourceCell,
    repositoryRoot: ROOT_PATH,
  });
  const hostMachine = sourceConfig.machines[sourceCell.allowedHostId];
  const observedHost = {
    hostname: hostMachine.hostname,
    platform: hostMachine.platform,
    release: hostMachine.release,
    arch: hostMachine.arch,
    hardwareModel: hostMachine.hardwareModel,
    chip: hostMachine.chip,
    physicalCpuCount: hostMachine.physicalCpuCount,
    logicalCpuCount: hostMachine.logicalCpuCount,
    memoryBytes: hostMachine.memoryBytes,
  };
  const issuedAt = "2026-08-24T09:05:53.500Z";
  const owner = {
    version: "snapback.r2-exclusive-host-lock.v1",
    runId: sourceConfig.runId,
    cellId,
    purpose: "admission",
    token: "a".repeat(64),
    hostname: observedHost.hostname,
    reservedBy: "production-shaped-finalize-fixture",
    pid: process.pid,
    createdAt: "2026-08-24T09:02:00.000Z",
    awaitingControllerUntil: "2026-08-24T09:06:23.500Z",
  };
  const ownerBytes = Buffer.from(`${JSON.stringify(owner, null, 2)}\n`);
  const seriality = {
    gitHead: "fixture-head",
    committedPrefix: landedDisposition === undefined ? [] : [landedDisposition.cellId],
    requestedIndex: landedDisposition === undefined ? 0 : 1,
    laterPristine: [],
    ...(landedDisposition === undefined ? {} : { landedDispositions: [landedDisposition] }),
    privateCellState: "absent",
  };
  const artifact = {
    version: "snapback.r2-cell-admission.v2",
    runId: sourceConfig.runId,
    cellId,
    issuedAt,
    expiresAt: "2026-08-24T09:06:23.500Z",
    controllerCommand: sourceCell.controllerCommand,
    harnessConfig: { path: resolve(configPath), sha256: sha256(configBytes) },
    registeredCell: registeredCellExpectations(sourceConfig, sourceCell),
    execution,
    instrument: {
      instrumentPin: sourceConfig.pins.instrument.instrumentPin,
      source: {
        path: fileURLToPath(new URL("benchmarks/instrument.manifest.json", ROOT)),
        sha256: sha256(instrumentBytes),
      },
      materialized: {
        root: resolve(sourceConfig.paths.instrumentRoot),
        manifestPath: resolve(sourceConfig.paths.instrumentRoot, "instrument.manifest.json"),
        sha256: sha256(instrumentBytes),
      },
    },
    host: { allowedHostId: sourceCell.allowedHostId, observed: observedHost },
    loadIsolation: {
      policyId: sourceCell.loadCeilingId,
      samples: [
        { ordinal: 1, sampledAt: "2026-08-24T09:03:53.500Z", loadavg1: 1, loadavg5: 1, loadavg15: 1 },
        { ordinal: 2, sampledAt: "2026-08-24T09:04:53.500Z", loadavg1: 1, loadavg5: 1, loadavg15: 1 },
        { ordinal: 3, sampledAt: "2026-08-24T09:05:53.500Z", loadavg1: 1, loadavg5: 1, loadavg15: 1 },
      ],
    },
    priorProcessClosure: { checkedAt: issuedAt, closed: true, active: [] },
    ports: {
      checkedAt: issuedAt,
      unbound: true,
      values: allCampaignPorts(sourceConfig),
    },
    harness: {
      key: sourceCell.harness,
      binary: sourceConfig.harnesses[sourceCell.harness].binary,
      observedVersion: sourceConfig.harnesses[sourceCell.harness].observedVersion,
      version: { ok: true, argv: ["--version"] },
      auth: { ok: true, argv: ["fixture-auth"] },
    },
    exclusiveHostLock: {
      version: owner.version,
      path: sourceConfig.execution.exclusiveHostLock.path,
      token: owner.token,
      owner: {
        path: join(sourceConfig.execution.exclusiveHostLock.path, "owner.json"),
        sha256: sha256(ownerBytes),
        declaration: owner,
      },
    },
    seriality,
  };
  artifact.identity = {
    algorithm: "sha256-canonical-json-without-identity",
    sha256: admissionIdentity(artifact),
  };
  const admissionBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(admissionPath, admissionBytes);
  const actualExecution = {
    execPath: execution.node.path,
    cwd: execution.cwd,
    controllerPath: execution.controller.path,
    driverPath: execution.driver.path,
    argv: execution.argv,
    environment: execution.environment,
  };
  const claim = {
    declaration: {
      version: "snapback.r2-exclusive-host-lock-claim.v1",
      runId: sourceConfig.runId,
      cellId,
      token: owner.token,
      artifactSha256: artifact.identity.sha256,
      pid: process.pid,
      parentPid: process.ppid,
      claimedAt: "2026-08-24T09:05:53.600Z",
      execution: actualExecution,
    },
  };
  await writeCampaignAttemptStart({
    config: { harnessConfig: sourceConfig, cell: sourceCell },
    configDirectory: privateCell,
    artifact,
    admissionPath,
    claim,
    now: () => new Date("2026-08-24T09:05:53.700Z"),
  });
  await cp(fileURLToPath(new URL(
    `benchmarks/runs/2026-08-23-r2-published-0125/cells/${cellId}/`,
    ROOT,
  )), privateCell, { recursive: true, force: false });
  await Promise.all([
    cp(fileURLToPath(new URL(
      "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-explicit/schema/",
      ROOT,
    )), join(privateCell, "schema"), { recursive: true, force: false }),
    copyFile(fileURLToPath(new URL(
      "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-explicit/coverage-manifest.json",
      ROOT,
    )), join(privateCell, "coverage-manifest.json")),
  ]);
  await migrateCurrentR2CellFixture(privateCell);
  const retainedManifest = JSON.parse(await readFile(join(privateCell, "metering-manifest.json"), "utf8"));
  retainedManifest.recordBase = {
    path: "record-base.json",
    sha256: sha256(await readFile(join(privateCell, "record-base.json"))),
  };
  await writeFile(
    join(privateCell, "metering-manifest.json"),
    `${JSON.stringify(retainedManifest, null, 2)}\n`,
  );
  const ownershipPath = join(privateCell, "process-ownership.json");
  const ownership = JSON.parse(await readFile(ownershipPath, "utf8"));
  ownership.nativeHarnessPid = 424_242;
  ownership.nativeHarnessStartedAt = new Date(
    Date.parse(retainedManifest.driver.startedAt) + 1,
  ).toISOString();
  ownership.nativeHarness = {
    pid: ownership.nativeHarnessPid,
    harnessKey: sourceCell.harness,
    adapter: retainedManifest.adapter,
    sessions: retainedManifest.sessions.map((candidate) => ({
      sourceId: candidate.sourceId,
      parentSourceId: candidate.parentSourceId,
      role: candidate.role,
      nativeSessionId: candidate.nativeSessionId,
      nativeAgentId: candidate.nativeAgentId ?? null,
    })),
    driverStartedAt: retainedManifest.driver.startedAt,
    driverStampedAt: retainedManifest.driver.stampedAt,
  };
  ownership.updatedAt = retainedManifest.driver.stampedAt;
  await writeFile(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`);
  await Promise.all([
    rm(join(privateCell, "record.json")),
    rm(join(privateCell, "metering.json")),
    rm(join(privateCell, "cell.json")),
  ]);
  const pristineSlot = Buffer.from(`${JSON.stringify({
    schemaVersion: "snapback.r2-cell-slot.v1",
    cellId,
    status: "not-started",
  }, null, 2)}\n`);
  await writeFile(join(targetCell, "cell.json"), pristineSlot);
  const dependencies = {
    repositoryRoot: ROOT_PATH,
    assertCommittedConfig: () => {},
    inspectSeriality: async () => ({ ...seriality, privateCellState: "retained-for-finalization" }),
    gitRead: (args) => {
      if (args[0] === "rev-parse") return "fixture-head";
      return readFileSync(resolve(ROOT_PATH, args[1].split(":").slice(1).join(":")));
    },
    probeLaunchQuiet: async () => ({ ok: true }),
    currentHostIdentity: () => observedHost,
  };
  return {
    temp,
    registeredRunRoot,
    publicationRunRoot,
    cellId,
    privateCell,
    targetCell,
    configPath,
    harnessConfig: sourceConfig,
    artifact,
    pristineSlot,
    dependencies,
    async resetTarget() {
      await rm(targetCell, { recursive: true, force: true });
      await mkdir(targetCell, { recursive: true });
      await writeFile(join(targetCell, "cell.json"), pristineSlot);
    },
    async cleanup() {
      await execFileAsync("chmod", ["-R", "u+w", temp]).catch(() => {});
      await rm(temp, { recursive: true, force: true });
      await rm(registeredRunRoot, { recursive: true, force: true });
    },
  };
}

test("finalize-existing refuses a retained manifest relabeled to another supported driver", async () => {
  const fixture = await makeFinalizeExistingFixture();
  try {
    const manifestPath = join(fixture.privateCell, "metering-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.driver.id, "social-messenger-r2-native-cli-driver.v1");
    manifest.driver.id = "social-messenger-full-journey-native-cli-driver.v1";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(finalizeExisting({
      harnessConfigPath: fixture.configPath,
      cellId: fixture.cellId,
      publish: false,
      reservedBy: "relabeled-driver-refusal-test",
      dependencies: fixture.dependencies,
    }), /retained raw manifest.*registered attempt/u);
  } finally {
    await fixture.cleanup();
  }
});

test("finalize-existing publishes the complete provenance graph and resumes every exact copy/slot interruption", async () => {
  const fixture = await makeFinalizeExistingFixture();
  try {
    const baseOptions = {
      harnessConfigPath: fixture.configPath,
      cellId: fixture.cellId,
      reservedBy: "synthetic-post-run-join-failure-test",
      dependencies: fixture.dependencies,
    };
    await writeAttemptFailure(
      fixture.privateCell,
      new Error("production-shaped-post-model-record-finalization-failure"),
      "record-finalization",
    );
    const manifestOnly = await finalizeExisting({ ...baseOptions, publish: false });
    assert.equal(manifestOnly.published, false);
    const expectedRecord = await readFile(join(fixture.privateCell, "record.json"));
    const expectedMetering = await readFile(join(fixture.privateCell, "metering.json"));
    const publication = JSON.parse(await readFile(join(fixture.privateCell, "publication-manifest.json"), "utf8"));
    assert.ok(publication.files.some((file) => file.path === "rendered-prompt.md"));
    assert.ok(publication.files.some((file) => file.path === "schema/social-messenger/assertions.json"));
    assert.ok(publication.files.some((file) => file.path === "coverage-manifest.json"));
    assert.ok(publication.files.some((file) => file.path === "provenance/admission.json"));
    assert.ok(publication.files.some((file) => file.path === "attempt-failure.json"));
    const failure = JSON.parse(await readFile(join(fixture.privateCell, "attempt-failure.json"), "utf8"));
    assert.equal(failure.modelOrProductLaunchStarted, true);
    const steps = [
      ...publication.files.map((file) => `copy:${file.path}`),
      "copy:publication-manifest.json",
      "copy:publication-transaction.json",
      "slot:finalize-next",
      "slot:finalized-last",
    ];
    for (const step of steps) {
      await fixture.resetTarget();
      await assert.rejects(finalizeExisting({
        ...baseOptions,
        publish: true,
        dependencies: {
          ...fixture.dependencies,
          afterPublicationStep: (completed) => {
            if (completed === step) throw new Error(`fault:${step}`);
          },
        },
      }), /fault:/u);
      const resumed = await finalizeExisting({ ...baseOptions, publish: true });
      assert.equal(resumed.published, true);
      await validateFinalizedCellSlot({
        slotPath: join(fixture.targetCell, "cell.json"),
        cellId: fixture.cellId,
        repositoryRoot: ROOT_PATH,
        expectedMilestones: ["M1", "M2", "M3"],
        requireCommitted: false,
      });
    }
    const publishedCoveragePath = join(fixture.targetCell, "coverage-manifest.json");
    const publishedCoverageBytes = await readFile(publishedCoveragePath);
    await writeFile(publishedCoveragePath, Buffer.concat([
      publishedCoverageBytes,
      Buffer.from("\n"),
    ]));
    await assert.rejects(validateFinalizedCellSlot({
      slotPath: join(fixture.targetCell, "cell.json"),
      cellId: fixture.cellId,
      repositoryRoot: ROOT_PATH,
      expectedMilestones: ["M1", "M2", "M3"],
      requireCommitted: false,
    }), /coverage|digest|hash-linked|validation-required evidence graph/u);
    await writeFile(publishedCoveragePath, publishedCoverageBytes);
    await validateFinalizedCellSlot({
      slotPath: join(fixture.targetCell, "cell.json"),
      cellId: fixture.cellId,
      repositoryRoot: ROOT_PATH,
      expectedMilestones: ["M1", "M2", "M3"],
      requireCommitted: false,
    });
    assert.deepEqual(await readFile(join(fixture.privateCell, "metering.json")), expectedMetering);
    assert.deepEqual(await readFile(join(fixture.privateCell, "record.json")), expectedRecord);
  } finally {
    await fixture.cleanup();
  }
});

test("finalize-existing exercises real seriality inspection through a committed disposition", async () => {
  const fixture = await makeFinalizeExistingFixture({ dispositionPrefix: true });
  try {
    await writeAttemptFailure(
      fixture.privateCell,
      new Error("production-shaped-disposition-prefix-finalization"),
      "record-finalization",
    );
    const dependencies = { ...fixture.dependencies };
    delete dependencies.inspectSeriality;
    const result = await finalizeExisting({
      harnessConfigPath: fixture.configPath,
      cellId: fixture.cellId,
      publish: false,
      reservedBy: "real-seriality-disposition-path-test",
      dependencies,
    });
    assert.equal(result.published, false);
    assert.equal(result.ok, true);
  } finally {
    await fixture.cleanup();
  }
});

test("a post-attempt pre-model prepare failure is honestly receipted but cannot launder prior native evidence", async () => {
  const fixture = await makeFinalizeExistingFixture();
  try {
    const ownershipPath = join(fixture.privateCell, "process-ownership.json");
    const ownership = JSON.parse(await readFile(ownershipPath, "utf8"));
    ownership.nativeHarnessPid = null;
    delete ownership.nativeHarnessStartedAt;
    delete ownership.nativeHarness;
    delete ownership.updatedAt;
    await writeFile(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`);
    await writeAttemptFailure(
      fixture.privateCell,
      new Error("production-shaped-driver-prepare-failure"),
      "driver-prepare",
    );
    const failure = JSON.parse(await readFile(join(fixture.privateCell, "attempt-failure.json"), "utf8"));
    assert.equal(failure.modelOrProductLaunchStarted, false);
    await assert.rejects(finalizeExisting({
      harnessConfigPath: fixture.configPath,
      cellId: fixture.cellId,
      publish: true,
      reservedBy: "pre-model-prepare-failure-finalization-test",
      dependencies: fixture.dependencies,
    }), /session\/process identity/u);
    assert.equal((await readFile(join(fixture.targetCell, "cell.json"), "utf8")).includes('"status": "not-started"'), true);
  } finally {
    await fixture.cleanup();
  }
});

test("publication preflights a divergent later copy before creating any earlier target byte", async () => {
  const fixture = await makeFinalizeExistingFixture();
  try {
    const options = {
      harnessConfigPath: fixture.configPath,
      cellId: fixture.cellId,
      publish: false,
      reservedBy: "divergent-later-preflight-test",
      dependencies: fixture.dependencies,
    };
    await finalizeExisting(options);
    const publication = JSON.parse(await readFile(join(fixture.privateCell, "publication-manifest.json"), "utf8"));
    const earlier = publication.files[0].path;
    const later = publication.files.at(-1).path;
    await mkdir(dirname(join(fixture.targetCell, later)), { recursive: true });
    await writeFile(join(fixture.targetCell, later), "foreign-divergent-partial\n");
    await assert.rejects(finalizeExisting({ ...options, publish: true }), /target artifact differs/u);
    await assert.rejects(stat(join(fixture.targetCell, earlier)), { code: "ENOENT" });
  } finally {
    await fixture.cleanup();
  }
});

test("finalize-existing refuses missing prompt/assertion/coverage evidence and escaped or symlinked publication targets", async (context) => {
  for (const path of [
    "rendered-prompt.md",
    "schema/social-messenger/assertions.json",
    "coverage-manifest.json",
  ]) {
    await context.test(`missing ${path}`, async () => {
      const fixture = await makeFinalizeExistingFixture();
      try {
        await rm(join(fixture.privateCell, path));
        await assert.rejects(finalizeExisting({
          harnessConfigPath: fixture.configPath,
          cellId: fixture.cellId,
          publish: true,
          reservedBy: "missing-validation-evidence-test",
          dependencies: fixture.dependencies,
        }), /ENOENT|evidence|artifact/u);
      } finally {
        await fixture.cleanup();
      }
    });
  }

  await context.test("altered coverage-manifest.json", async () => {
    const fixture = await makeFinalizeExistingFixture();
    try {
      const path = join(fixture.privateCell, "coverage-manifest.json");
      const coverage = JSON.parse(await readFile(path, "utf8"));
      coverage.milestones.m1 = coverage.milestones.m1.slice(1);
      await writeFile(path, `${JSON.stringify(coverage, null, 2)}\n`);
      await assert.rejects(finalizeExisting({
        harnessConfigPath: fixture.configPath,
        cellId: fixture.cellId,
        publish: true,
        reservedBy: "altered-coverage-evidence-test",
        dependencies: fixture.dependencies,
      }), /R2_COVERAGE_MANIFEST|coverage/u);
      assert.equal(
        (await readFile(join(fixture.targetCell, "cell.json"), "utf8")).includes('"status": "not-started"'),
        true,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  await context.test("registered run-root escape", async () => {
    const fixture = await makeFinalizeExistingFixture({ targetOutsideRepository: true });
    try {
      await assert.rejects(finalizeExisting({
        harnessConfigPath: fixture.configPath,
        cellId: fixture.cellId,
        publish: true,
        reservedBy: "target-escape-test",
        dependencies: fixture.dependencies,
      }), /run root escapes/u);
    } finally {
      await fixture.cleanup();
    }
  });

  await context.test("symlinked registered cell target", async () => {
    const fixture = await makeFinalizeExistingFixture();
    try {
      const redirected = join(fixture.temp, "redirected-cell");
      await mkdir(redirected);
      await rm(fixture.targetCell, { recursive: true, force: true });
      await symlink(redirected, fixture.targetCell);
      await assert.rejects(finalizeExisting({
        harnessConfigPath: fixture.configPath,
        cellId: fixture.cellId,
        publish: true,
        reservedBy: "target-symlink-test",
        dependencies: fixture.dependencies,
      }), /canonically contained|symbolic/u);
    } finally {
      await fixture.cleanup();
    }
  });
});

test("finalize-existing rejects relabeled unavailable counts and forged attempt provenance", async (context) => {
  const cases = [
    ["attempt registration", async (fixture) => {
      const path = join(fixture.privateCell, "attempt.json");
      const value = JSON.parse(await readFile(path, "utf8"));
      value.registeredCell.model = "forged-model";
      await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
    }],
    ["admission bytes", async (fixture) => {
      await writeFile(fixture.artifact.admissionPath ?? join(
        fixture.registeredRunRoot,
        "admissions",
        `${fixture.cellId}.json`,
      ), "{}\n");
    }],
    ["forged host graph", async (fixture) => {
      const retainedPath = join(fixture.privateCell, "provenance/admission.json");
      const admission = JSON.parse(await readFile(retainedPath, "utf8"));
      admission.host.observed.hardwareModel = "forged-host";
      admission.identity.sha256 = admissionIdentity(admission);
      const bytes = Buffer.from(`${JSON.stringify(admission, null, 2)}\n`);
      const originalPath = join(fixture.registeredRunRoot, "admissions", `${fixture.cellId}.json`);
      await writeFile(retainedPath, bytes);
      await writeFile(originalPath, bytes);
      const attemptPath = join(fixture.privateCell, "attempt.json");
      const attempt = JSON.parse(await readFile(attemptPath, "utf8"));
      attempt.admission.sha256 = sha256(bytes);
      attempt.admission.identitySha256 = admission.identity.sha256;
      attempt.host = admission.host;
      await writeFile(attemptPath, `${JSON.stringify(attempt, null, 2)}\n`);
    }],
    ["harness config bytes", async (fixture) => {
      const config = JSON.parse(await readFile(fixture.configPath, "utf8"));
      config.cells[0].model = "forged-config-model";
      await writeFile(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);
    }],
    ["manifest identity", async (fixture) => {
      const path = join(fixture.privateCell, "metering-manifest.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      manifest.laneRunId = `${fixture.harnessConfig.runId}/forged-cell`;
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    }],
    ["unavailable relabeled as gpt-frontier", async (fixture) => {
      const path = join(fixture.privateCell, "metering-manifest.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      manifest.adapter = "unavailable";
      manifest.capFamily = "gpt-frontier";
      manifest.sessions = [];
      manifest.unavailableReason = "forged-no-model-path";
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    }],
  ];
  for (const [label, mutate] of cases) {
    await context.test(label, async () => {
      const fixture = await makeFinalizeExistingFixture();
      try {
        await mutate(fixture);
        await assert.rejects(finalizeExisting({
          harnessConfigPath: fixture.configPath,
          cellId: fixture.cellId,
          publish: true,
          reservedBy: "forged-provenance-test",
          dependencies: fixture.dependencies,
        }));
      } finally {
        await fixture.cleanup();
      }
    });
  }
});

test("finalize-existing validates the raw retained manifest before any private derived write", async () => {
  const fixture = await makeFinalizeExistingFixture();
  try {
    const manifestPath = join(fixture.privateCell, "metering-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.laneRunId = `${fixture.harnessConfig.runId}/forged-cell`;
    manifest.observations = manifest.observations.slice(1);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const privateRoot = join(fixture.temp, "private");
    const before = await snapshotTree(privateRoot);
    await assert.rejects(finalizeExisting({
      harnessConfigPath: fixture.configPath,
      cellId: fixture.cellId,
      publish: true,
      reservedBy: "raw-manifest-zero-write-test",
      dependencies: fixture.dependencies,
    }), /raw manifest|registered attempt/u);
    assert.deepEqual(await snapshotTree(privateRoot), before);
    await assert.rejects(stat(join(fixture.privateCell, "recovery/metering-manifest.before-finalize.json")), {
      code: "ENOENT",
    });
    await assert.rejects(stat(join(fixture.privateCell, "cell.json.finalize-next")), { code: "ENOENT" });
  } finally {
    await fixture.cleanup();
  }
});

test("private attempt, lock, and finalizer paths reject symlink ancestors without outside writes", async (context) => {
  for (const pathKind of ["private-root", "cells-parent", "cell"]) {
    await context.test(`attempt ${pathKind}`, async () => {
      const temp = await realpath(await mkdtemp(join(tmpdir(), `r2-private-${pathKind}-`)));
      const outside = join(temp, "outside");
      const privateRoot = join(temp, "private");
      await mkdir(outside);
      if (pathKind === "private-root") {
        await symlink(outside, privateRoot);
      } else {
        await mkdir(privateRoot);
        if (pathKind === "cells-parent") {
          await symlink(outside, join(privateRoot, "cells"));
        } else {
          await mkdir(join(privateRoot, "cells"));
          await symlink(outside, join(privateRoot, "cells", "cell-1"));
        }
      }
      const admissionPath = join(temp, "admission.json");
      await writeFile(admissionPath, "{}\n");
      const config = {
        harnessConfig: {
          runId: "fixture-r2",
          paths: { privateExecutionRoot: privateRoot },
        },
        cell: { id: "cell-1" },
      };
      const artifact = {
        issuedAt: "2026-08-24T12:00:00.000Z",
        identity: { sha256: `sha256:${"a".repeat(64)}` },
        execution: { node: { path: process.execPath } },
        harnessConfig: {},
        registeredCell: {},
        instrument: {},
        host: {},
        exclusiveHostLock: {
          version: "snapback.r2-exclusive-host-lock.v1",
          token: "fixture-token",
          owner: { declaration: { owner: "fixture" } },
        },
      };
      const claim = { declaration: { claimedAt: "2026-08-24T12:00:00.100Z" } };
      try {
        const before = await snapshotTree(outside);
        await assert.rejects(writeCampaignAttemptStart({
          config,
          configDirectory: join(privateRoot, "cells", "cell-1"),
          artifact,
          admissionPath,
          claim,
        }), /R2_PRIVATE_PATH/u);
        assert.deepEqual(await snapshotTree(outside), before);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    });
  }

  for (const pathKind of ["lock-parent", "lock-path"]) {
    await context.test(pathKind, async () => {
      const temp = await realpath(await mkdtemp(join(tmpdir(), `r2-private-${pathKind}-`)));
      const privateRoot = join(temp, "private");
      const outside = join(temp, "outside");
      const lockParent = join(privateRoot, "locks");
      const lockPath = join(lockParent, "host.lock");
      await Promise.all([mkdir(privateRoot), mkdir(outside)]);
      if (pathKind === "lock-parent") {
        await symlink(outside, lockParent);
      } else {
        await mkdir(lockParent);
        await symlink(outside, lockPath);
      }
      const harnessConfig = {
        runId: "fixture-r2",
        paths: { privateExecutionRoot: privateRoot },
        execution: { exclusiveHostLock: { path: lockPath } },
      };
      try {
        const before = await snapshotTree(outside);
        assert.throws(() => acquireExclusiveHostLock({
          harnessConfig,
          cellId: "cell-1",
          purpose: "admission",
          reservedBy: "symlink-negative",
        }), /R2_PRIVATE_PATH/u);
        assert.deepEqual(await snapshotTree(outside), before);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    });
  }

  await context.test("finalizer retained-cell ancestor", async () => {
    const fixture = await makeFinalizeExistingFixture();
    try {
      const cellsRoot = dirname(fixture.privateCell);
      const escapedCells = join(fixture.temp, "escaped-private-cells");
      await rm(escapedCells, { recursive: true, force: true });
      await rename(cellsRoot, escapedCells);
      await symlink(escapedCells, cellsRoot);
      const before = await snapshotTree(escapedCells);
      await assert.rejects(finalizeExisting({
        harnessConfigPath: fixture.configPath,
        cellId: fixture.cellId,
        publish: true,
        reservedBy: "retained-parent-symlink-negative",
        dependencies: fixture.dependencies,
      }), /R2_PRIVATE_PATH/u);
      assert.deepEqual(await snapshotTree(escapedCells), before);
    } finally {
      await fixture.cleanup();
    }
  });
});

test("instrument materialization succeeds once, is immutable, and refuses overwrite", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "r2-instrument-materialize-")));
  const outPath = join(temp, "instrument-resume");
  try {
    const result = materializeInstrumentSnapshot({
      sourceRoot: fileURLToPath(new URL("benchmarks/", ROOT)),
      outPath,
    });
    assert.equal(result.ok, true);
    assert.equal(
      result.manifestSha256,
      sha256(await readFile(new URL("benchmarks/instrument.manifest.json", ROOT))).replace(/^sha256:/u, ""),
    );
    assert.equal((await stat(join(outPath, "instrument.manifest.json"))).mode & 0o222, 0);
    const retainedManifest = await readFile(join(outPath, "instrument.manifest.json"));
    assert.throws(() => materializeInstrumentSnapshot({
      sourceRoot: fileURLToPath(new URL("benchmarks/", ROOT)),
      outPath,
    }), /refuses|REFUSAL|new path/u);
    assert.deepEqual(await readFile(join(outPath, "instrument.manifest.json")), retainedManifest);
  } finally {
    if (await readFile(join(outPath, "instrument.manifest.json")).catch(() => null)) {
      await execFileAsync("chmod", ["-R", "u+w", outPath]);
    }
    await rm(temp, { recursive: true, force: true });
  }
});

test("historical dry-run validation binds immutable Git commit and tree bytes", async () => {
  const recovery = JSON.parse(await readFile(
    new URL("benchmarks/runs/2026-08-23-r2-published-0125/recovery-resume.v4.json", ROOT),
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
      version: "0.3.7-m8",
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
      ...(milestone === "M3" ? { typingObservationBoundaryVersion: "v2" } : {}),
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
  record.socialMessenger.orientation.instrument.pin = "social-messenger@0.3.7-m8";
  record.socialMessenger.orientation.instrument.versions.choreography = "0.3.7-m8";
  record.socialMessenger.instrumentVersion = "social-messenger@0.3.7-m8";
  record.socialMessenger.typingObservationBoundaryVersion = "v2";
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
  const root = await realpath(await mkdtemp(join(tmpdir(), "d06-observability-")));
  const record = await addD06Observability(composedRecord({
      capFamily: "gpt-frontier",
      source: "codex-rollout-token-count",
      metered: true,
    }), root);
  assert.equal(record.socialMessenger.extensionVersion, 2);
  const missingTypingBoundary = structuredClone(record);
  delete missingTypingBoundary.socialMessenger.typingObservationBoundaryVersion;
  assert.match(
    composedErrors(missingTypingBoundary, root).join("\n"),
    /typingObservationBoundaryVersion.*required field is missing/u,
  );
  const mismatchedTypingBoundary = structuredClone(record);
  mismatchedTypingBoundary.socialMessenger.typingObservationBoundaryVersion = "v1";
  assert.match(
    composedErrors(mismatchedTypingBoundary, root).join("\n"),
    /typingObservationBoundaryVersion/u,
  );
  const retainedPreBump = structuredClone(record.socialMessenger);
  retainedPreBump.instrumentVersion = "social-messenger@0.3.3-m8";
  retainedPreBump.orientation.instrument.pin = "social-messenger@0.3.3-m8";
  retainedPreBump.orientation.instrument.versions.choreography = "0.3.3-m8";
  delete retainedPreBump.typingObservationBoundaryVersion;
  assert.deepEqual(validateJsonSchema(extensionSchema, retainedPreBump), []);
  retainedPreBump.typingObservationBoundaryVersion = "v2";
  assert.notDeepEqual(validateJsonSchema(extensionSchema, retainedPreBump), []);
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
    version: "0.3.7-m8",
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
    /expected constant "social-messenger@0\.3\.7-m8"|expected constant "0\.3\.7-m8"/u,
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
    /current observability\/orientation markers require social-messenger@0\.3\.7-m8/u,
    "semantic validation must reject explicit legacy-version substitution on an otherwise-current record",
  );
  assert.match(
    composedErrors(explicitInstrumentDowngrade, root).join("\n"),
    /expected constant "social-messenger@0\.3\.7-m8"/u,
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
  assert.deepEqual(validateSocialMessengerRecordSemantics({
    socialMessenger: {
      instrumentVersion: "social-messenger@0.3.4-m8",
      observabilityProtocol: OBSERVATION_VERSION,
      milestones: {},
    },
  }), [], "retained 0.3.4 observation records remain governed by their historical pin");
  await rm(root, { recursive: true, force: true });
});

test("semantic and episode non-claims make the correction-action target ineligible", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "d06-nonclaim-")));
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
