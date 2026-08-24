import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import {
  CURRENT_INSTRUMENT_PIN,
  ObservationWriter,
} from "../../tools/social-messenger/metering/observations.mjs";

const DRIVER_ID = "social-messenger-r2-two-minute-noop.v1";
const states = new Map();

function digest(value, { prefix = true } = {}) {
  const valueDigest = createHash("sha256").update(value).digest("hex");
  return prefix ? `sha256:${valueDigest}` : valueDigest;
}

function nullCounts() {
  return { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null };
}

function logical(root, path) {
  return relative(root, path).split(sep).join("/");
}

async function descriptor(root, path) {
  const bytes = await readFile(path);
  return { path: logical(root, path), sha256: digest(bytes) };
}

function recordBase({ config, manifestText }) {
  const orientationText = "R2 two-minute no-op dry-run; no model or campaign cell is launched.\n";
  const orientationBytes = Buffer.byteLength(orientationText);
  const manifest = JSON.parse(manifestText);
  return {
    schemaVersion: 1,
    lane: "snapback",
    laneVariant: "skill",
    brief: "social-messenger",
    harness: { name: "r2-dry-run-stub", model: "none", effort: null },
    timestamps: { startedAt: "1970-01-01T00:00:00.000Z", finishedAt: "1970-01-01T00:00:00.000Z" },
    firstGreenProofAt: null,
    wallClock: { totalSeconds: 0, phases: { orientation: 0, authoring: 0, verification: 0, diagnosis: 0 } },
    tokens: { input: null, output: null, source: null, phases: { orientation: null, authoring: null, verification: null, diagnosis: null } },
    toolUses: 0,
    correctionLoops: [],
    handAuthoredLoc: { lines: 0, files: 0 },
    diary: "dry-run-diary.md",
    notes: "Two-minute no-op exercises controller lifecycle only; not a benchmark result.",
    socialMessenger: {
      extensionVersion: 2,
      instrumentVersion: CURRENT_INSTRUMENT_PIN,
      orientation: {
        schemaVersion: "benchmark-orientation.v1",
        laneKind: "snapback-web-clique",
        instrument: {
          pin: CURRENT_INSTRUMENT_PIN,
          manifest: { path: "instrument.manifest.json", sha256: digest(manifestText, { prefix: false }) },
          versions: manifest.versions,
        },
        selectedSkills: [],
        artifacts: [{
          id: "dry-run-orientation",
          kind: "orientation",
          path: "dry-run-orientation.txt",
          bytes: orientationBytes,
          sha256: digest(orientationText, { prefix: false }),
          deduplicated: false,
        }],
        uniqueBytes: orientationBytes,
        deliveredBytes: orientationBytes,
        preflightWarnings: [],
      },
      runScope: "reduced",
      capFamily: "grok-advisory",
      deploymentPosture: "local-dev-server",
      milestones: Object.fromEntries(config.milestones.map((milestone) => [
        milestone,
        {
          caps: {
            wallCapSeconds: Math.max(300, config.cell.dryRunDurationSeconds + 60),
            tokenCap: null,
          },
        },
      ])),
      termination: { terminatedEarly: false, reason: null, afterMilestone: null },
      compaction: { policy: "dry-run-none", events: [] },
      firstProductEdit: { at: null, orientationBytes: null, orientationTokens: nullCounts(), selectedSkills: [] },
      meteringProvenance: {},
      coverageManifest: { path: "dry-run-coverage.json", sha256: null, validated: true },
      assertionManifest: {
        path: manifest.artifacts.assertions.path,
        version: manifest.versions.schema,
        sha256: manifest.artifacts.assertions.sha256,
      },
      clocks: { grading: { sessions: [{ wallSeconds: 0, tokens: nullCounts() }] } },
      grading: { graderReportPath: null, graderFamily: null, sameFamilyGraded: false, usableGradingRecord: false },
    },
  };
}

export async function prepare({ config, configDirectory }) {
  const root = resolve(configDirectory);
  await mkdir(join(root, "events"), { recursive: true });
  await mkdir(join(root, "receipts"), { recursive: true });
  const manifestPath = join(config.repositoryRoot, "benchmarks/instrument.manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  if (manifest.instrumentPin !== CURRENT_INSTRUMENT_PIN) {
    throw new Error(`dry-run requires ${CURRENT_INSTRUMENT_PIN}`);
  }
  await writeFile(join(root, "instrument.manifest.json"), manifestText);
  await writeFile(
    join(root, "dry-run-orientation.txt"),
    "R2 two-minute no-op dry-run; no model or campaign cell is launched.\n",
  );
  await writeFile(join(root, "dry-run-coverage.json"), "{\"validated\":true}\n");
  await writeFile(join(root, "record-base.json"), `${JSON.stringify(recordBase({ config, manifestText }), null, 2)}\n`);
  const choreographyPath = join(root, "events", "dry-run-choreography-observations.jsonl");
  const choreography = new ObservationWriter({ path: choreographyPath, laneRunId: config.laneRunId });
  await choreography.initialize();
  states.set(config.laneRunId, {
    root,
    config,
    startedAt: new Date().toISOString(),
    currentMilestone: null,
    terminalAt: new Map(),
    error: null,
    choreography,
    choreographyPath,
  });
}

export function claimOptions() {
  return {
    semanticActionsClaimed: true,
    recoveryEpisodesClaimed: true,
    restartReseedClaimed: true,
    suiteAssertionWaitClaimed: true,
    apiInterruptionsClaimed: true,
  };
}

export async function runMilestone({ milestone, controls, config }) {
  const state = states.get(config.laneRunId);
  state.currentMilestone = milestone;
  await controls.semanticAction({
    actionId: `dry-run-noop-${milestone.toLowerCase()}`,
    actionClass: "process",
    disposition: "progress",
    episodeId: null,
    retriedClass: null,
    binaryExcavation: false,
  });
  await controls.restart(async () => {});
  await controls.reseed({ destructive: false }, async () => {});
  await controls.apiRequest({
    provider: "dry-run-stub",
    operation: "two-minute-noop",
    requestId: `dry-run-request-${milestone.toLowerCase()}`,
    retryOf: null,
  }, () => new Promise((resolveWait) => {
    const index = config.milestones.indexOf(milestone);
    const totalMillis = config.cell.dryRunDurationSeconds * 1_000;
    const baseMillis = Math.floor(totalMillis / config.milestones.length);
    const durationMillis = index === config.milestones.length - 1
      ? totalMillis - baseMillis * index
      : baseMillis;
    setTimeout(resolveWait, durationMillis);
  }));
  if (config.cell.failBeforeChoreography === true && milestone === "M1") {
    throw new Error("requested dry-run pre-choreography failure");
  }
  await controls.suiteAssertionWait({
    assertion: `dry-run-suite-${milestone.toLowerCase()}`,
    attempt: 1,
  }, async () => {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    return { pass: true };
  });
  await state.choreography.claim(milestone, "browserAssertionWait", { owner: "choreography" });
  await state.choreography.assertionWait(milestone, {
    owner: "choreography",
    assertion: `dry-run-choreography-${milestone.toLowerCase()}`,
    attempt: 1,
    durationMs: 10,
    pass: true,
  });
  state.terminalAt.set(milestone, new Date().toISOString());
}

async function writeArtifacts(state, error) {
  const { root, config } = state;
  if (error && state.currentMilestone && !state.terminalAt.has(state.currentMilestone)) {
    state.terminalAt.set(state.currentMilestone, new Date().toISOString());
  }
  const attempted = [...state.terminalAt.entries()];
  if (attempted.length === 0) throw new Error("dry-run produced no attempted milestone");
  const statuses = {};
  const receipts = [];
  const boundaries = {};
  for (const [index, [milestone, terminalAt]] of attempted.entries()) {
    const failed = Boolean(error && milestone === state.currentMilestone);
    const segment = milestone.toLowerCase();
    const suiteReceiptPath = join(root, "receipts", `${segment}-suite.json`);
    await writeFile(suiteReceiptPath, `${JSON.stringify({ milestone, pass: !failed })}\n`);
    statuses[segment] = { pass: !failed, receipt: `receipts/${segment}-suite.json` };
    const receiptPath = join(root, "receipts", `${segment}-choreography.jsonl`);
    const runId = randomUUID();
    if (!failed) {
      const suiteReceipt = await descriptor(root, suiteReceiptPath);
      await writeFile(receiptPath, `${JSON.stringify({
        version: "0.3.3-m8",
        runId,
        recordedAt: terminalAt,
        type: "segment-summary",
        segment,
        assertion: "__segment__",
        implemented: true,
        required: true,
        status: "passed",
        pass: true,
        timings: [{
          attempt: 1,
          pass: true,
          startedAt: null,
          durationMs: 10,
          settlementWaitMs: 10,
          metrics: {},
        }],
        bestOf: 1,
        details: { selection: "segment aggregate", selectedAttempt: 1, reason: null },
        assertions: { total: 1, required: 1, implemented: 1, passed: 1, failed: 0, skipped: 0, notImplemented: 0, requiredUnimplemented: 0 },
        suite: { pass: true, receipt: `receipts/${segment}-suite.json`, receiptSha256: suiteReceipt.sha256 },
        choreography: { browserPass: true, requiredExternal: [], externalPass: true, supplementalExternal: [], pass: true },
        green: true,
        nonGreenCause: null,
      })}\n`);
      receipts.push({
        sourceId: `${segment}-dry-run-choreography`,
        runId,
        milestone,
        ...(await descriptor(root, receiptPath)),
      });
    }
    boundaries[milestone] = {
      status: failed ? "aborted" : "green",
      firstGreenAt: failed ? null : terminalAt,
      suitePassAt: failed ? null : terminalAt,
      choreoPassAt: failed ? null : terminalAt,
      terminalAt,
      terminalSequence: index + 1,
      terminalReason: failed ? "abort" : "green",
    };
  }
  const suiteStatusPath = join(root, "suite-status.json");
  await writeFile(suiteStatusPath, `${JSON.stringify(statuses, null, 2)}\n`);
  const boundariesPath = join(root, "terminal-boundaries.json");
  await writeFile(boundariesPath, `${JSON.stringify({
    laneRunId: config.laneRunId,
    driverId: DRIVER_ID,
    milestones: boundaries,
  }, null, 2)}\n`);
  const manifest = {
    manifestVersion: "social-messenger-metering-manifest.v1",
    laneRunId: config.laneRunId,
    capFamily: "grok-advisory",
    adapter: "unavailable",
    unavailableReason: "dry-run-stub-has-no-model-usage",
    sessions: [],
    receipts,
    observations: [],
    suiteStatus: await descriptor(root, suiteStatusPath),
    boundaries: await descriptor(root, boundariesPath),
    firstProductEdit: null,
    driver: { id: DRIVER_ID, startedAt: state.startedAt, stampedAt: new Date().toISOString() },
    clockCorrelation: {
      method: "rfc3339-with-bounded-skew",
      maxSkewMillis: 5_000,
      evidence: "dry-run controller and stub use one process host clock with a 5s final-sample allowance",
    },
  };
  await writeFile(join(root, "metering-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function finalize({ config, error }) {
  const state = states.get(config.laneRunId);
  state.error = error;
  await writeArtifacts(state, error);
}

export function observationSources({ config }) {
  const state = states.get(config.laneRunId);
  return [{
    sourceId: "dry-run-choreography-observations",
    path: logical(state.root, state.choreographyPath),
  }];
}
