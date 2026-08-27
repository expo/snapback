#!/usr/bin/env node

// Historical one-off finalizer retained to reproduce the closed R2 artifact
// and its then-current fail-closed disposition. New live and finalization
// accounting uses adapters/codex-session.mjs v4, where an unchanged cumulative
// token_count is a non-charging recap; this script must not rewrite R2 history.

import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateSocialMessengerRunRecord } from "../record-validator.mjs";
import { adaptCodexSessionTree, CODEX_ADAPTER_VERSION } from "./adapters/codex-session.mjs";
import { boundariesFromReceiptRecords } from "./boundaries.mjs";
import { formatFinalizationFailure } from "./finalization-diagnostics.mjs";
import { joinUsageToMilestones } from "./joiner.mjs";
import { parseJsonLines } from "./jsonl.mjs";
import { loadMeteringManifest } from "./manifest.mjs";
import { composeRunRecord } from "./record-composer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, "../../../..");
const DEFAULT_SOURCE = "/Users/ccheever/bench-matrix-20260823-r2/cells/sol-clique-familiar";
const DEFAULT_NATIVE = "/Users/ccheever/.codex/sessions/2026/08/24/rollout-2026-08-24T11-39-09-01a03511-bb6c-7733-a250-e10c9b6dd878.jsonl";
const DEFAULT_TARGET = join(
  REPOSITORY_ROOT,
  "benchmarks/runs/2026-08-23-r2-published-0125/cells/sol-clique-familiar",
);
const CELL_ID = "sol-clique-familiar";
const LANE_RUN_ID = `2026-08-23-r2-published-0125/${CELL_ID}`;
const NATIVE_SESSION_ID = "01a03511-bb6c-7733-a250-e10c9b6dd878";
const NATIVE_SHA256 = "sha256:1b9962de0a5e47bd313f0686fb60d44459e0f21fce3a8dcfc62363c7e5402047";
const UNAVAILABLE_REASON = "retained-session-token-event-corrupt";
const FINALIZER_VERSION = "snapback.r2-retained-familiar-finalizer.v1";

const REGISTERED_SOURCES = Object.freeze({
  "admission-samples.jsonl": "sha256:fc5031dfcd9ed3a68d3ed6240a07608cf81b20ec732ccf9f2eb15d230f6eeb6e",
  "events/cell-milestones.jsonl": "sha256:dbdacd5349bd6aed3bcd881a1aeaaa32f00e4e185ffe9d4276c7c3b575d5c0f3",
  "events/harness.stdout.jsonl": "sha256:b7d0a1450c99fd4c3e6461502ddb3f71e40be1ed4c63883bd126c9bec03600ee",
  "events/harness.stderr.log": "sha256:d66458ec8b2fa5eb4d106db1d2703f6af5647234a8124c4cb7d080155cc01aed",
  "events/lane-controller-observations.jsonl": "sha256:1f83b7d80352bc3c9174637fdf467fb3c20e52671811c4c1627dbf7b9c6eb13a",
  "gates/M1": "sha256:bc1b10bcc0025676ae84b8e7b9c1822a05a8b5a399997d60eee648bdcfea58e5",
  "gates/M2": "sha256:3f4b3abb3c9b810da00f1d277e129009da3288ea5904b7200868b54551c9628f",
  "gates/M3": "sha256:b0c5984f060294b4b128f832f08504c71332e104f4ce59bf43d19a4736db0ab1",
  "record-base.json": "sha256:8f5fdcd794599fd3434fe9ee96b6e952ccfb70b63d6b716d287af94d4dcc3aae",
  "suite-status.json": "sha256:1397953294c863eb93959dc9e0eb04e9e82762b599fb7f09668da5a719beb453",
  "diary.md": "sha256:301407682fd69e897ccce440a69893596e96e1d6954d966bbf1f1d3de06ff6f7",
  "essay.md": "sha256:b3c36414390ab87fc1b437a330fff1aee1dcde04cc82e91e60969ae034e23eb1",
  "final-report.md": "sha256:ff1f3e019c96eeee8cc3afba288a893a74eb4c4bdfa91e575c09a046a58151fc",
  "run-log.md": "sha256:e7515cf64b7c5cef06facd1a5dbf8088de522e1394ec6dec93c3a09b9ff7eed6",
  "rendered-prompt.md": "sha256:94c6f19216d439b057273bfd2aefbc56931d040fe074ebdac17a84e3fbdc92c3",
  "instrument.manifest.json": "sha256:a3ff59a5e9d4b351953d35be68652dd7a4a1a298b4593a3fcc4754263ca14841",
  "receipts/m1-choreography.jsonl": "sha256:b0f9b84fee748d6b1719b4adc96516cb3d1c8d64f456c2771ce8ec39a130ead2",
  "receipts/m1-choreography.jsonl.observations.jsonl": "sha256:ef9359fa343d735ba5941aad75f72aeaf15eb5d461a29e174bad75f97bff8881",
  "receipts/m1-seed.jsonl": "sha256:30a2535292964fa133c1103697472e7ab023a27e963808b44c617d5a5743beae",
  "receipts/m1-suite.json": "sha256:8647ff7614d402a6e1e8e5e20e20a497c2615d55529c5edc0f66c6bc953c55c9",
  "receipts/m1-suite.observations.jsonl": "sha256:0986adecb525efbca59bc5b9a6f156b7949f643b564ca056303be2de72c0cefd",
  "receipts/m2-choreography.jsonl": "sha256:36a84d5b4a167cbd19214d0e3ebf43f655efa18fc43175acd33e1829dfe9b894",
  "receipts/m2-choreography.jsonl.observations.jsonl": "sha256:6b0d2f13c930dda0162599692451e64803775e631778044098b8250d15313d77",
  "receipts/m2-seed.jsonl": "sha256:33effa69278e64763e0b81e927a57b616829061442591e5925c6cfc460d15757",
  "receipts/m2-suite.json": "sha256:1da481c9dd7c4ae037f8da3571f5a8d354a503e3fc4a873380aa30e01febaec3",
  "receipts/m2-suite.observations.jsonl": "sha256:48300095975b559533bd3cfeed5e673abbdb81ec86f4f81cc0ed040804598a73",
  "receipts/m3-choreography.jsonl": "sha256:85975cfeec40e585ca3c2cee4806ef88a669342c999a866aad8a0ad3dc0912ee",
  "receipts/m3-choreography.jsonl.observations.jsonl": "sha256:7cbf3c4ebaa79cb1ce766992e464aa24540416bd96fcff64812a6adb9f512816",
  "receipts/m3-seed.jsonl": "sha256:1099db7f65a637308e70308ee7f6a3a82cae2544963c80247e921f3fa20e40e0",
  "receipts/m3-suite.json": "sha256:39803465ae39e5772120f007a8a21b37937d6a82e49692d523901a24bf8d609c",
  "receipts/m3-suite.observations.jsonl": "sha256:6c5411504a359be2ccbd3151ea41b854430ee82b84f19c1c3006f16675ce12c3",
});

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function regularBytes(path, label) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !(await stat(path)).isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return readFile(path);
}

async function registeredBytes(sourceRoot, path, expectedSha256) {
  const bytes = await regularBytes(join(sourceRoot, path), `registered source ${path}`);
  const actual = sha256(bytes);
  if (actual !== expectedSha256) {
    throw new Error(`registered source ${path} digest mismatch: expected ${expectedSha256}, received ${actual}`);
  }
  return bytes;
}

async function writeExactOrAbsent(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  try {
    const existing = await regularBytes(path, path);
    if (!existing.equals(bytes)) throw new Error(`${path} already exists with different bytes`);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, path);
}

function parseOptions(argv) {
  const options = { sourceRoot: DEFAULT_SOURCE, nativePath: DEFAULT_NATIVE, targetRoot: DEFAULT_TARGET };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!["--source", "--native", "--target"].includes(value)) throw new Error(`unknown option ${value}`);
    if (argv[index + 1] === undefined) throw new Error(`${value} requires a path`);
    const key = value === "--source" ? "sourceRoot" : value === "--native" ? "nativePath" : "targetRoot";
    options[key] = resolve(argv[index + 1]);
    index += 1;
  }
  return options;
}

async function receiptDescriptor(sourceRoot, milestone) {
  const path = `receipts/${milestone.toLowerCase()}-choreography.jsonl`;
  const records = parseJsonLines((await registeredBytes(sourceRoot, path, REGISTERED_SOURCES[path])).toString("utf8"), path);
  const summary = records.find((record) => record.type === "segment-summary");
  if (summary?.green !== true || summary.segment?.toUpperCase() !== milestone) {
    throw new Error(`${path} has no exact green ${milestone} segment-summary`);
  }
  return {
    descriptor: { sourceId: `${milestone.toLowerCase()}-choreography`, runId: summary.runId, milestone, path, sha256: REGISTERED_SOURCES[path] },
    boundary: boundariesFromReceiptRecords(records, path)[milestone],
  };
}

async function assertExpectedNativeFailure(nativePath) {
  const bytes = await regularBytes(nativePath, "retained native rollout");
  if (sha256(bytes) !== NATIVE_SHA256) throw new Error("retained native rollout digest mismatch");
  const records = parseJsonLines(bytes.toString("utf8"), nativePath);
  const meta = records.find((record) => record.type === "session_meta")?.payload;
  if (meta?.id !== NATIVE_SESSION_ID || meta.cli_version !== "0.149.0") {
    throw new Error("retained native rollout identity mismatch");
  }
  let failure = null;
  try {
    adaptCodexSessionTree([{ sourceId: "builder", nativeSessionId: NATIVE_SESSION_ID, records }]);
  } catch (error) {
    failure = error;
  }
  const diagnostic = failure === null ? "" : formatFinalizationFailure(failure);
  if (
    !diagnostic.includes("stage=codex-token-count-delta-join")
    || !diagnostic.includes("eventOrdinal=839")
    || !diagnostic.includes("received 0 and 14133")
  ) {
    throw failure ?? new Error("retained native rollout unexpectedly became admissible");
  }
  return { bytes, diagnostic };
}

async function writeSlot(targetRoot, slot) {
  const path = join(targetRoot, "cell.json");
  const existing = JSON.parse((await regularBytes(path, "registered cell slot")).toString("utf8"));
  if (
    existing.schemaVersion !== "snapback.r2-cell-slot.v1"
    || existing.cellId !== CELL_ID
    || existing.status !== "not-started"
  ) {
    const expected = jsonBytes(slot);
    const actual = await regularBytes(path, "finalized cell slot");
    if (!actual.equals(expected)) throw new Error("cell slot is neither pristine nor the exact finalized value");
    return;
  }
  await writeFile(path, jsonBytes(slot));
}

async function finalize() {
  const { sourceRoot, nativePath, targetRoot } = parseOptions(process.argv.slice(2));
  const native = await assertExpectedNativeFailure(nativePath);
  for (const [path, expected] of Object.entries(REGISTERED_SOURCES)) {
    await registeredBytes(sourceRoot, path, expected);
  }

  const markers = parseJsonLines(
    (await registeredBytes(sourceRoot, "events/cell-milestones.jsonl", REGISTERED_SOURCES["events/cell-milestones.jsonl"])).toString("utf8"),
    "events/cell-milestones.jsonl",
  );
  const observations = parseJsonLines(
    (await registeredBytes(sourceRoot, "events/lane-controller-observations.jsonl", REGISTERED_SOURCES["events/lane-controller-observations.jsonl"])).toString("utf8"),
    "events/lane-controller-observations.jsonl",
  );
  const receipts = [];
  const boundaries = {};
  for (const [index, milestone] of ["M1", "M2", "M3"].entries()) {
    const receipt = await receiptDescriptor(sourceRoot, milestone);
    const marker = markers.find((candidate) => candidate.milestone === milestone);
    if (marker?.status !== "green" || marker.terminalReason !== "green") {
      throw new Error(`${milestone} lacks its exact retained green marker`);
    }
    // The gate write followed the controller's first next-milestone event by
    // up to 1 ms. The hash-bound observation stream is therefore the exact
    // transition authority; using the later gate stamp would falsely put the
    // first next-milestone event outside its own window.
    const transitionAt = index < 2
      ? observations.find((event) => event.milestone === ["M2", "M3"][index])?.at
      : observations.at(-1)?.at;
    boundaries[milestone] = {
      ...receipt.boundary,
      status: "green",
      terminalAt: transitionAt,
      terminalSequence: index + 1,
      terminalReason: "green",
    };
    receipts.push(receipt.descriptor);
  }
  const boundaryBytes = jsonBytes({
    laneRunId: LANE_RUN_ID,
    driverId: "social-messenger-r2-native-cli-driver.v1",
    milestones: boundaries,
  });
  await writeExactOrAbsent(join(sourceRoot, "terminal-boundaries.json"), boundaryBytes);
  await writeExactOrAbsent(join(sourceRoot, "events/codex-rollout.jsonl"), native.bytes);
  const assertionBytes = await regularBytes(
    join(REPOSITORY_ROOT, "benchmarks/schema/social-messenger/assertions.json"),
    "assertion manifest",
  );
  if (sha256(assertionBytes) !== "sha256:e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04") {
    throw new Error("assertion manifest digest mismatch");
  }
  await writeExactOrAbsent(join(sourceRoot, "schema/social-messenger/assertions.json"), assertionBytes);

  const observationDescriptors = ["M1", "M2", "M3"].flatMap((milestone) => {
    const prefix = milestone.toLowerCase();
    return [
      { sourceId: `${prefix}-suite-observations`, path: `receipts/${prefix}-suite.observations.jsonl` },
      { sourceId: `${prefix}-choreography-observations`, path: `receipts/${prefix}-choreography.jsonl.observations.jsonl` },
    ];
  });
  observationDescriptors.push({
    sourceId: `${LANE_RUN_ID}-lane-controller`,
    path: "events/lane-controller-observations.jsonl",
  });
  for (const descriptor of observationDescriptors) descriptor.sha256 = REGISTERED_SOURCES[descriptor.path];

  const manifest = {
    manifestVersion: "social-messenger-metering-manifest.v1",
    laneRunId: LANE_RUN_ID,
    capFamily: "gpt-frontier",
    adapter: "unavailable",
    unavailableReason: UNAVAILABLE_REASON,
    sessions: [],
    receipts,
    observations: observationDescriptors,
    observationCompatibility: [{
      ruleId: "retained-orphaned-recovery-episode-nonclaim.v1",
      observationSourceId: `${LANE_RUN_ID}-lane-controller`,
      milestone: "M3",
      sequence: 291,
      at: "2026-08-24T19:31:34.471Z",
      type: "semantic-action",
      actionId: "native-m3-205",
      episodeId: "episode-m3-15",
    }],
    suiteStatus: { path: "suite-status.json", sha256: REGISTERED_SOURCES["suite-status.json"] },
    boundaries: { path: "terminal-boundaries.json", sha256: sha256(boundaryBytes) },
    firstProductEdit: null,
    recordBase: { path: "record-base.json", sha256: REGISTERED_SOURCES["record-base.json"] },
    driver: {
      id: "social-messenger-r2-native-cli-driver.v1",
      startedAt: observations[0].at,
      stampedAt: observations.at(-1).at,
    },
    clockCorrelation: {
      method: "rfc3339-with-bounded-skew",
      maxSkewMillis: 0,
      evidence: "deterministic retained-evidence rejoin uses the shared host clock and exact controller transition/final observation stamps",
    },
  };
  const manifestBytes = jsonBytes(manifest);
  await writeExactOrAbsent(join(sourceRoot, "metering-manifest.json"), manifestBytes);
  const metering = joinUsageToMilestones(await loadMeteringManifest(join(sourceRoot, "metering-manifest.json")));
  const meteringBytes = jsonBytes(metering);
  await writeExactOrAbsent(join(sourceRoot, "metering.json"), meteringBytes);
  const base = JSON.parse((await registeredBytes(sourceRoot, "record-base.json", REGISTERED_SOURCES["record-base.json"])).toString("utf8"));
  const record = composeRunRecord({ base, patch: metering, expectedMilestones: ["M1", "M2", "M3"] });
  const [baseSchema, extensionSchema, composedSchema] = await Promise.all([
    "benchmarks/schema/run-record.schema.json",
    "benchmarks/schema/social-messenger/run-record-extension.schema.json",
    "benchmarks/schema/social-messenger/run-record.schema.json",
  ].map(async (path) => JSON.parse(await readFile(join(REPOSITORY_ROOT, path), "utf8"))));
  const recordBytes = jsonBytes(record);
  await writeExactOrAbsent(join(sourceRoot, "record.json"), recordBytes);
  const errors = validateSocialMessengerRunRecord(composedSchema, record, {
    schemas: [baseSchema, extensionSchema],
    artifactRoot: sourceRoot,
  });
  if (errors.length > 0) throw new Error(`composed record validation failed: ${errors.join("; ")}`);

  const provenance = {
    schemaVersion: "snapback.r2-retained-rejoin.v1",
    finalizerVersion: FINALIZER_VERSION,
    cellId: CELL_ID,
    mode: "deterministic-retained-evidence-rejoin",
    rerun: false,
    sourceFailureReport: "../../BLOCKED-sol-clique-familiar-finalization.md",
    meteringDisposition: {
      result: "unavailable-fail-closed",
      adapterVersion: CODEX_ADAPTER_VERSION,
      unavailableReason: UNAVAILABLE_REASON,
      sourceSession: { nativeSessionId: NATIVE_SESSION_ID, path: "events/codex-rollout.jsonl", sha256: NATIVE_SHA256 },
      corruptEvent: {
        ordinal: 839,
        record: 840,
        precedingCumulativeOrdinal: 835,
        rawCumulativeDeltaTotal: 0,
        lastTokenUsageAggregateTotal: 14133,
        error: "Codex token_count record 840 cumulative delta does not equal last_token_usage.total_tokens; received 0 and 14133",
      },
      diagnostic: native.diagnostic,
      rule: "A corrupt native aggregate cannot be silently accepted or estimated; retained product evidence remains valid while usage and scorecard eligibility become unavailable.",
    },
    normalization: {
      reason: "The failed driver retained green markers and controller transition/final observations but no derived boundary file.",
      clockCorrelation: manifest.clockCorrelation.evidence,
      milestones: Object.fromEntries(Object.entries(boundaries).map(([key, value]) => [key, value.terminalAt])),
    },
  };
  const provenanceBytes = jsonBytes(provenance);
  await writeExactOrAbsent(join(sourceRoot, "rejoin-provenance.json"), provenanceBytes);

  const publicationPaths = [
    ...Object.keys(REGISTERED_SOURCES),
    "events/codex-rollout.jsonl",
    "schema/social-messenger/assertions.json",
    "terminal-boundaries.json",
    "metering-manifest.json",
    "metering.json",
    "record.json",
    "rejoin-provenance.json",
  ];
  for (const path of publicationPaths) {
    const bytes = await regularBytes(join(sourceRoot, path), `publication source ${path}`);
    await writeExactOrAbsent(join(targetRoot, path), bytes);
  }
  const validation = {
    schemaVersion: "snapback.r2-cell-validation.v1",
    finalizerVersion: FINALIZER_VERSION,
    campaignCellRerun: false,
    checks: {
      schemaErrors: 0,
      semanticErrors: 0,
      registeredSourceHashesValid: true,
      nativeCorruptionNamedAndFailClosed: true,
      manifestAndSourceHashesValid: true,
      deterministicRecordCompositionValid: true,
    },
    record: { path: "record.json", bytes: recordBytes.length, sha256: sha256(recordBytes) },
    metering: { path: "metering.json", bytes: meteringBytes.length, sha256: sha256(meteringBytes) },
    manifest: { path: "metering-manifest.json", bytes: manifestBytes.length, sha256: sha256(manifestBytes) },
    evidenceFileCount: publicationPaths.length,
  };
  await writeExactOrAbsent(join(targetRoot, "validation.json"), jsonBytes(validation));
  const slot = {
    schemaVersion: "snapback.r2-cell-slot.v1",
    cellId: CELL_ID,
    status: "recovered-finalized",
    attemptCount: 1,
    campaignCellRerun: false,
    recoveryVersion: FINALIZER_VERSION,
    waveConfig: "../../harness-config.json",
    recordOutput: "record.json",
    recordSchema: "../../../../schema/social-messenger/run-record.schema.json",
    checkedValidator: "../../../../tools/social-messenger/record-validator.mjs",
    record: { path: "record.json", sha256: sha256(recordBytes) },
    metering: { path: "metering.json", sha256: sha256(meteringBytes) },
    retainedNativeStream: { path: "events/codex-rollout.jsonl", sha256: NATIVE_SHA256 },
    originalInstrument: { path: "instrument.manifest.json", sha256: REGISTERED_SOURCES["instrument.manifest.json"] },
  };
  await writeSlot(targetRoot, slot);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    finalizerVersion: FINALIZER_VERSION,
    sourceRoot,
    target: relative(REPOSITORY_ROOT, targetRoot),
    meteringAvailable: metering.available,
    unavailableReason: metering.unavailableReason,
    scorecardEligible: metering.efficiencyScorecardEligibility.eligible,
    scorecardIneligibilityReasons: metering.efficiencyScorecardEligibility.ineligibilityReasons,
    recordSha256: sha256(recordBytes),
  }, null, 2)}\n`);
}

finalize().catch((error) => {
  process.stderr.write(`R2 retained Familiar finalization failure:\n${formatFinalizationFailure(error)}\n`);
  process.exitCode = 2;
});
