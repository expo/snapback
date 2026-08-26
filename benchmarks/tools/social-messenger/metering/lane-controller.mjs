#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { joinUsageToMilestones } from "./joiner.mjs";
import { resolveConfigJourney } from "./journey-contract.mjs";
import { loadMeteringManifest } from "./manifest.mjs";
import {
  formatFinalizationFailure,
  withFinalizationStage,
} from "./finalization-diagnostics.mjs";
import { composeRunRecord } from "./record-composer.mjs";
import {
  inspectCommittedSeriality,
  inspectNonConsumingAdmissionSmoke,
  liveSourceClosure,
  loadPolicyForCell,
  probeLaunchQuiet,
  resolveSourceIdentity,
  verifyAdmissionArtifact,
} from "./r2-cell-admission.mjs";
import { assertR2ExecutionEnvironment } from "./r2-execution-environment.mjs";
import {
  ensurePrivateCellTransactionParent,
  inspectPrivateCellPath,
} from "./r2-private-paths.mjs";
import {
  claimExclusiveHostLock,
  releaseExclusiveHostLock,
} from "./r2-host-lock.mjs";
import {
  CURRENT_INSTRUMENT_PIN,
  LaneObservationHarness,
  OBSERVATION_VERSION,
  ObservationWriter,
  projectMilestoneObservability,
  scorecardEligibility,
} from "./observations.mjs";
import { validateSocialMessengerRunRecord } from "../record-validator.mjs";

const MILESTONE = /^M[1-8]$/u;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function inside(root, path) {
  const logical = relative(resolve(root), resolve(path));
  return logical === ""
    || (logical !== ".." && !logical.startsWith(`..${sep}`) && !isAbsolute(logical));
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requiredOperation(operation, label) {
  if (typeof operation !== "function") {
    throw new TypeError(`${label} requires the operation it observes`);
  }
  return operation;
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function observationDescriptor(manifestDirectory, source) {
  const sourceId = requiredString(source.sourceId, "observation sourceId");
  const absolute = resolve(source.path);
  if (!inside(manifestDirectory, absolute)) {
    throw new Error(`observation source ${sourceId} must stay beside the lane manifest`);
  }
  if ((await lstat(absolute)).isSymbolicLink()) {
    throw new Error(`observation source ${sourceId} cannot be a symbolic link`);
  }
  const canonical = await realpath(absolute);
  if (!inside(await realpath(manifestDirectory), canonical)) {
    throw new Error(`observation source ${sourceId} escapes after canonical resolution`);
  }
  if (!(await stat(canonical)).isFile()) {
    throw new Error(`observation source ${sourceId} must be a file`);
  }
  const contents = await readFile(canonical);
  return {
    sourceId,
    path: relative(manifestDirectory, absolute).split(sep).join("/"),
    sha256: digest(contents),
  };
}

export { composeRunRecord } from "./record-composer.mjs";

// @ref LLP 0295#d06--efficiency-instrument-and-target-registration — the
// production lane owner starts sampling at each attempted milestone, records
// lifecycle/API/suite-settlement events beside the operations, and injects
// those retained streams into the hash-verifying record writer.
export class R2LaneController {
  constructor({
    laneRunId,
    instrumentPin = CURRENT_INSTRUMENT_PIN,
    observationPath,
    loadCeilings,
    loadIntervalMs = 60_000,
    loadSample,
    now,
  }) {
    if (instrumentPin !== CURRENT_INSTRUMENT_PIN) {
      throw new Error(
        `R2 lane controller requires ${CURRENT_INSTRUMENT_PIN}; received ${instrumentPin}`,
      );
    }
    this.laneRunId = requiredString(laneRunId, "laneRunId");
    this.observationPath = resolve(requiredString(observationPath, "observationPath"));
    this.writer = new ObservationWriter({
      path: this.observationPath,
      laneRunId: this.laneRunId,
      ...(now ? { now } : {}),
    });
    this.observations = new LaneObservationHarness({
      writer: this.writer,
      loadCeilings,
      loadIntervalMs,
      ...(loadSample ? { loadSample } : {}),
    });
    this.initialized = false;
    this.activeMilestones = new Set();
  }

  async initialize() {
    if (this.initialized) throw new Error("R2 lane controller is already initialized");
    await this.writer.initialize();
    this.initialized = true;
  }

  async runMilestone(milestone, operation, claimOptions = {}) {
    if (!this.initialized) throw new Error("R2 lane controller must be initialized");
    if (!MILESTONE.test(milestone)) throw new TypeError("milestone must name M1 through M8");
    requiredOperation(operation, "runMilestone");
    await this.observations.startMilestone(milestone, claimOptions);
    this.activeMilestones.add(milestone);
    try {
      return await operation(this.controls(milestone));
    } finally {
      this.activeMilestones.delete(milestone);
      await this.observations.finishMilestone(milestone);
    }
  }

  controls(milestone) {
    return Object.freeze({
      restart: (operation) => this.restart(milestone, operation),
      reseed: (options, operation) => this.reseed(milestone, options, operation),
      apiRequest: (fields, operation) => (
        this.observations.apiRequest(milestone, fields, operation)
      ),
      suiteAssertionWait: (fields, waitForSettlement) => (
        this.observations.suiteAssertionWait(milestone, fields, waitForSettlement)
      ),
      suiteAssertionObservation: (fields) => (
        this.observations.suiteAssertionObservation(milestone, fields)
      ),
      semanticAction: (event) => this.observations.semanticAction(milestone, event),
      recoveryEpisode: (event) => this.observations.recoveryEpisode(milestone, event),
    });
  }

  async restart(milestone, operation) {
    requiredOperation(operation, "restart");
    await this.observations.restart(milestone);
    return operation();
  }

  async reseed(milestone, options, operation) {
    requiredOperation(operation, "reseed");
    await this.observations.reseed(milestone, options);
    return operation();
  }

  async writeRecordPatch({
    manifestPath,
    outPath,
    additionalObservationSources = [],
  }) {
    if (!this.initialized) throw new Error("R2 lane controller must be initialized");
    if (this.activeMilestones.size > 0) {
      throw new Error("cannot write the record while a milestone sampler is active");
    }
    const absoluteManifest = resolve(requiredString(manifestPath, "manifestPath"));
    const manifestDirectory = dirname(absoluteManifest);
    const manifest = JSON.parse(await readFile(absoluteManifest, "utf8"));
    if (manifest.laneRunId !== this.laneRunId) {
      throw new Error("metering manifest laneRunId does not match the controller");
    }
    const controllerSource = {
      sourceId: `${this.laneRunId}-lane-controller`,
      path: this.observationPath,
    };
    const retainedSources = (manifest.observations ?? []).map((source) => ({
      sourceId: source.sourceId,
      path: resolve(manifestDirectory, source.path),
    }));
    const sources = [
      ...retainedSources,
      ...additionalObservationSources,
      controllerSource,
    ];
    manifest.observations = [];
    const bySourceId = new Map(sources.map((source) => [source.sourceId, source]));
    for (const source of bySourceId.values()) {
      manifest.observations.push(await observationDescriptor(manifestDirectory, source));
    }
    await writeFile(absoluteManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const meteringInput = await withFinalizationStage(
      "metering-manifest-load",
      () => loadMeteringManifest(absoluteManifest),
    );
    const patch = await withFinalizationStage(
      "milestone-usage-join",
      () => joinUsageToMilestones(meteringInput),
    );
    await writeFile(resolve(requiredString(outPath, "outPath")), `${JSON.stringify(patch, null, 2)}\n`);
    return patch;
  }

  async writeCompleteRecord({
    patch,
    recordBasePath,
    recordPath,
    expectedMilestones,
    baseSchemaPath,
    extensionSchemaPath,
    composedSchemaPath,
  }) {
    const absoluteBase = resolve(requiredString(recordBasePath, "recordBasePath"));
    const absoluteRecord = resolve(requiredString(recordPath, "recordPath"));
    const base = JSON.parse(await readFile(absoluteBase, "utf8"));
    const record = composeRunRecord({ base, patch, expectedMilestones });
    const [baseSchema, extensionSchema, composedSchema] = await Promise.all([
      readFile(resolve(requiredString(baseSchemaPath, "baseSchemaPath")), "utf8"),
      readFile(resolve(requiredString(extensionSchemaPath, "extensionSchemaPath")), "utf8"),
      readFile(resolve(requiredString(composedSchemaPath, "composedSchemaPath")), "utf8"),
    ]).then((values) => values.map((value) => JSON.parse(value)));
    const errors = validateSocialMessengerRunRecord(composedSchema, record, {
      schemas: [baseSchema, extensionSchema],
      artifactRoot: dirname(absoluteRecord),
    });
    if (errors.length > 0) {
      throw new Error(`complete record does not validate:\n  ${errors.join("\n  ")}`);
    }
    await writeFile(absoluteRecord, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return record;
  }
}

function usage() {
  return `Usage:
  node lane-controller.mjs --config <lane-controller.json> --driver <driver.mjs>
  node lane-controller.mjs --harness-config <harness-config.json> --cell <cell-id> --driver <driver.mjs> --admission <admission.json>
  node lane-controller.mjs --smoke --harness-config <harness-config.json> --cell <cell-id> --driver <driver.mjs> [--provisioning-manifest <external-path>]

The config declares laneRunId, observationPath, loadCeilings, milestones,
manifestPath, recordPatchPath, recordBasePath, recordPath, and optional
observationSources. The driver exports runMilestone({ milestone, controls,
config }) and may export prepare(), claimOptions(), finalize(), and
observationSources(). Only actual suite settlement waits belong in
controls.suiteAssertionWait(). In R2 mode, the controller reads the frozen
harness config directly, refuses any instrument pin other than
${CURRENT_INSTRUMENT_PIN}, and writes both metering.json and a validated
record.json under the cell's private execution root, including on a thrown
cell attempt.`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--config") options.configPath = value();
    else if (arg === "--harness-config") options.harnessConfigPath = value();
    else if (arg === "--cell") options.cellId = value();
    else if (arg === "--driver") options.driverPath = value();
    else if (arg === "--admission") options.admissionPath = value();
    else if (arg === "--provisioning-manifest") options.provisioningManifestPath = value();
    else if (arg === "--smoke") options.smoke = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function configPath(directory, value, label) {
  return resolve(directory, requiredString(value, label));
}

export async function loadLaneControllerConfig({ configPath: path, harnessConfigPath, cellId }) {
  if (Boolean(path) === Boolean(harnessConfigPath)) {
    throw new Error("choose exactly one of --config or --harness-config");
  }
  if (path) {
    if (cellId) throw new Error("--cell is only valid with --harness-config");
    const absoluteConfig = resolve(path);
    const configDirectory = dirname(absoluteConfig);
    const config = JSON.parse(await readFile(absoluteConfig, "utf8"));
    return { config, configDirectory };
  }

  requiredString(cellId, "--cell");
  const absoluteConfig = resolve(harnessConfigPath);
  const planDirectory = dirname(absoluteConfig);
  const harnessConfig = JSON.parse(await readFile(absoluteConfig, "utf8"));
  if (harnessConfig.schemaVersion !== "snapback.r2-harness-config.v1") {
    throw new Error("--harness-config must be a snapback.r2-harness-config.v1 document");
  }
  const instrumentPin = harnessConfig.pins?.instrument?.instrumentPin;
  if (instrumentPin !== CURRENT_INSTRUMENT_PIN) {
    throw new Error(
      `R2 harness config must pin ${CURRENT_INSTRUMENT_PIN}; received ${instrumentPin ?? "none"}`,
    );
  }
  const cell = harnessConfig.cells?.find((candidate) => candidate.id === cellId);
  if (!cell) throw new Error(`R2 harness config does not declare cell ${cellId}`);
  const harness = harnessConfig.harnesses?.[cell.harness];
  if (!harness) throw new Error(`R2 harness config does not declare harness ${cell.harness}`);
  const privateRoot = resolve(requiredString(
    harnessConfig.paths?.privateExecutionRoot,
    "harness paths.privateExecutionRoot",
  ));
  const cellRoot = inspectPrivateCellPath({ harnessConfig, cellId: cell.id }).cellRoot;
  const loadIsolation = loadPolicyForCell(harnessConfig, cell);
  const sampleEverySeconds = loadIsolation.sampleEverySeconds;
  if (typeof sampleEverySeconds !== "number" || sampleEverySeconds <= 0) {
    throw new TypeError("harness execution.loadIsolation.sampleEverySeconds must be positive");
  }
  return {
    configDirectory: cellRoot,
    config: {
      laneRunId: `${requiredString(harnessConfig.runId, "harness runId")}/${cell.id}`,
      instrumentPin,
      observationPath: "events/lane-controller-observations.jsonl",
      loadCeilings: loadIsolation.ceilingInclusive,
      loadIntervalMs: sampleEverySeconds * 1_000,
      milestones: harnessConfig.execution?.milestones,
      manifestPath: "metering-manifest.json",
      recordPatchPath: "metering.json",
      recordBasePath: "record-base.json",
      recordPath: "record.json",
      observationSources: [],
      baseSchemaPath: join(REPOSITORY_ROOT, "benchmarks/schema/run-record.schema.json"),
      extensionSchemaPath: join(
        REPOSITORY_ROOT,
        "benchmarks/schema/social-messenger/run-record-extension.schema.json",
      ),
      composedSchemaPath: join(
        REPOSITORY_ROOT,
        "benchmarks/schema/social-messenger/run-record.schema.json",
      ),
      repositoryRoot: REPOSITORY_ROOT,
      planDirectory,
      harnessConfig,
      harness,
      cell,
      allowedMachine: harnessConfig.machines[cell.allowedHostId],
    },
  };
}

function processGroupId(pid) {
  return Number(execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim());
}

export async function writeCampaignAttemptStart({
  config,
  configDirectory,
  artifact,
  admissionPath,
  claim,
  now = () => new Date(),
}) {
  const admissionBytes = await readFile(resolve(admissionPath));
  const groupId = processGroupId(process.pid);
  const kernelStartedAt = execFileSync(
    "ps",
    ["-o", "lstart=", "-p", String(process.pid)],
    { encoding: "utf8" },
  ).trim();
  const startedAt = now().toISOString();
  const ownership = {
    version: "snapback.r2-process-ownership.v2",
    runId: config.harnessConfig.runId,
    cellId: config.cell.id,
    controllerPid: process.pid,
    controllerParentPid: process.ppid,
    controllerKernelStartedAt: kernelStartedAt,
    controllerExecPath: artifact.execution.node.path,
    processGroupId: groupId,
    processGroupIsolated: groupId === process.pid,
    nativeHarnessPid: null,
    childPids: [],
    startedAt,
    admissionIdentitySha256: artifact.identity.sha256,
  };
  const ownershipBytes = Buffer.from(`${JSON.stringify(ownership, null, 2)}\n`);
  const claimBytes = Buffer.from(`${JSON.stringify(claim.declaration, null, 2)}\n`);
  const ownerBytes = Buffer.from(`${JSON.stringify(artifact.exclusiveHostLock.owner.declaration, null, 2)}\n`);
  const attempt = {
    version: "snapback.r2-private-cell-attempt.v2",
    runId: config.harnessConfig.runId,
    cellId: config.cell.id,
    attemptCount: 1,
    campaignCellRerun: false,
    state: "one-attempt-started",
    admission: {
      path: "provenance/admission.json",
      originalPath: resolve(admissionPath),
      sha256: digest(admissionBytes),
      identitySha256: artifact.identity.sha256,
    },
    harnessConfig: artifact.harnessConfig,
    registeredCell: artifact.registeredCell,
    execution: artifact.execution,
    instrument: artifact.instrument,
    host: artifact.host,
    exclusiveHostLock: {
      version: artifact.exclusiveHostLock.version,
      token: artifact.exclusiveHostLock.token,
      owner: { path: "provenance/host-lock-owner.json", sha256: digest(ownerBytes) },
      controllerClaim: { path: "provenance/controller-claim.json", sha256: digest(claimBytes) },
    },
    processOwnershipStart: { path: "process-ownership.start.json", sha256: digest(ownershipBytes) },
    timestamps: {
      admissionIssuedAt: artifact.issuedAt,
      controllerClaimedAt: claim.declaration.claimedAt,
      attemptStartedAt: startedAt,
    },
  };
  const privatePath = ensurePrivateCellTransactionParent({
    harnessConfig: config.harnessConfig,
    cellId: config.cell.id,
    configDirectory,
  });
  const transactionRoot = await mkdtemp(join(privatePath.cellsRoot, `.${basename(configDirectory)}.attempt-`));
  try {
    await mkdir(join(transactionRoot, "provenance"));
    await Promise.all([
      writeFile(join(transactionRoot, "provenance/admission.json"), admissionBytes, { flag: "wx" }),
      writeFile(join(transactionRoot, "provenance/host-lock-owner.json"), ownerBytes, { flag: "wx" }),
      writeFile(join(transactionRoot, "provenance/controller-claim.json"), claimBytes, { flag: "wx" }),
      writeFile(join(transactionRoot, "process-ownership.json"), ownershipBytes, { flag: "wx" }),
      writeFile(join(transactionRoot, "process-ownership.start.json"), ownershipBytes, { flag: "wx" }),
      writeFile(join(transactionRoot, "attempt.json"), `${JSON.stringify(attempt, null, 2)}\n`, { flag: "wx" }),
    ]);
    await rename(transactionRoot, configDirectory);
  } finally {
    await rm(transactionRoot, { recursive: true, force: true });
  }
  return attempt;
}

export async function writeAttemptFailure(configDirectory, error, phase) {
  const ownership = JSON.parse(await readFile(join(configDirectory, "process-ownership.json"), "utf8"));
  const failure = {
    version: "snapback.r2-private-cell-attempt-failure.v1",
    phase,
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    failedAt: new Date().toISOString(),
    modelOrProductLaunchStarted: Number.isInteger(ownership.nativeHarnessPid),
  };
  await writeFile(join(configDirectory, "attempt-failure.json"), `${JSON.stringify(failure, null, 2)}\n`, { flag: "wx" });
}

export async function importAndPreflightR2Driver({
  driverPath,
  config,
  configDirectory,
  importModule = (path) => import(pathToFileURL(path).href),
  onPhase = () => {},
}) {
  onPhase("driver-import");
  const driver = await importModule(resolve(driverPath));
  if (typeof driver.runMilestone !== "function" || typeof driver.preflight !== "function") {
    throw new TypeError("R2 lane controller driver must export preflight and runMilestone");
  }
  onPhase("driver-preflight");
  const preflight = await driver.preflight({ config, configDirectory });
  return { driver, preflight };
}

export async function completeAdmittedDriverPreflight({
  config,
  configDirectory,
  artifact,
  harnessConfigPath,
  admissionPath,
  actualExecution,
  claim,
  driverPath,
  onPhase = () => {},
  dependencies = {},
}) {
  const inspectSeriality = dependencies.inspectSeriality ?? inspectCommittedSeriality;
  const verifyAdmission = dependencies.verifyAdmission ?? verifyAdmissionArtifact;
  const verifySourceClosure = dependencies.liveSourceClosure ?? liveSourceClosure;
  const quietProbe = dependencies.probeLaunchQuiet ?? probeLaunchQuiet;
  const importDriver = dependencies.importDriver ?? importAndPreflightR2Driver;
  const sourceIdentity = dependencies.sourceIdentity ?? (
    dependencies.inspectSeriality === undefined
      ? resolveSourceIdentity({
          repositoryRoot: config.repositoryRoot,
          provisioningManifestPath: artifact.sourceProvisioning?.manifest?.path ?? null,
        })
      : null
  );
  const sourceOptions = sourceIdentity === null ? {} : { gitRead: sourceIdentity.gitRead };
  let campaignState = await inspectSeriality({
    harnessConfig: config.harnessConfig,
    cellId: config.cell.id,
    repositoryRoot: config.repositoryRoot,
    ...sourceOptions,
  });
  await quietProbe({ harnessConfig: config.harnessConfig, seriality: campaignState });
  verifyAdmission({
    artifact,
    harnessConfig: config.harnessConfig,
    harnessConfigPath: resolve(harnessConfigPath),
    cellId: config.cell.id,
    admissionPath,
    campaignState,
    actualExecution,
    requireControllerClaim: claim,
  });
  verifySourceClosure({ harnessConfig: config.harnessConfig, repositoryRoot: config.repositoryRoot });
  const loaded = await importDriver({
    driverPath,
    config,
    configDirectory,
    onPhase,
  });

  campaignState = await inspectSeriality({
    harnessConfig: config.harnessConfig,
    cellId: config.cell.id,
    repositoryRoot: config.repositoryRoot,
    ...sourceOptions,
  });
  verifyAdmission({
    artifact,
    harnessConfig: config.harnessConfig,
    harnessConfigPath: resolve(harnessConfigPath),
    cellId: config.cell.id,
    admissionPath,
    campaignState,
    actualExecution,
    requireControllerClaim: claim,
  });
  verifySourceClosure({ harnessConfig: config.harnessConfig, repositoryRoot: config.repositoryRoot });
  await quietProbe({ harnessConfig: config.harnessConfig, seriality: campaignState });
  return { ...loaded, campaignState };
}

function nullCounts() {
  return { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null };
}

export async function runNonConsumingSmoke({
  harnessConfigPath,
  cellId,
  driverPath,
  provisioningManifestPath = null,
  dependencies = {},
}) {
  const readiness = await (dependencies.inspectAdmissionSmoke ?? inspectNonConsumingAdmissionSmoke)({
    harnessConfigPath,
    cellId,
    provisioningManifestPath,
    dependencies: dependencies.admission ?? dependencies,
  });
  const { config } = await loadLaneControllerConfig({ harnessConfigPath, cellId });
  const scratch = await mkdtemp(join(tmpdir(), "snapback-r2-smoke-"));
  try {
    const controller = new R2LaneController({
      laneRunId: `${config.laneRunId}/non-consuming-smoke`,
      instrumentPin: config.instrumentPin,
      observationPath: join(scratch, "controller-observations.jsonl"),
      loadCeilings: config.loadCeilings,
      loadIntervalMs: config.loadIntervalMs,
    });
    await controller.initialize();
    const loaded = await (dependencies.importDriver ?? importAndPreflightR2Driver)({
      driverPath,
      config,
      configDirectory: scratch,
    });
    const base = loaded.preflight.recordBase;
    const milestone = config.milestones[0];
    const startedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    const patch = {
      instrumentVersion: CURRENT_INSTRUMENT_PIN,
      typingObservationBoundaryVersion: base.socialMessenger.typingObservationBoundaryVersion,
      observabilityProtocol: OBSERVATION_VERSION,
      source: null,
      totals: nullCounts(),
      executionOrder: [milestone],
      milestones: {
        [milestone]: {
          status: "aborted",
          authoring: {
            tokens: nullCounts(),
            firstGreenAt: null,
            suitePassAt: null,
            choreoPassAt: null,
            terminalAt: startedAt,
            terminalSequence: 1,
            terminalReason: "abort",
          },
          ...projectMilestoneObservability({ events: [], evidence: [], milestone }),
        },
      },
      firstProductEdit: base.socialMessenger.firstProductEdit,
      efficiencyScorecardEligibility: scorecardEligibility({
        milestones: {},
        phaseUsageAvailable: false,
        orientationEvidenceAvailable: false,
      }),
      meteringProvenance: {
        manifestVersion: "social-messenger-metering-manifest.v1",
        laneRunId: `${config.laneRunId}/non-consuming-smoke`,
        driver: {
          id: "social-messenger-non-consuming-smoke.v1",
          startedAt,
          stampedAt: startedAt,
          compatibilityEvents: [],
        },
        unavailableReason: "non-consuming-smoke-does-not-launch-a-native-session",
        sessions: [],
      },
    };
    const composed = composeRunRecord({ base, patch, expectedMilestones: config.milestones });
    return {
      version: "snapback.r2-controller-non-consuming-smoke.v1",
      status: "non-scored",
      scored: false,
      attemptConsumed: false,
      productionLockAcquired: false,
      runId: config.harnessConfig.runId,
      cellId: config.cell.id,
      admission: readiness,
      controller: { initialized: true, nativeSessionLaunched: false },
      recordComposition: {
        composed: true,
        publishable: false,
        reason: "synthetic-abort-shape-for-non-consuming-smoke-only",
        instrumentPin: composed.socialMessenger.instrumentVersion,
        runScope: composed.socialMessenger.runScope,
        milestones: Object.keys(composed.socialMessenger.milestones),
        sha256: digest(Buffer.from(JSON.stringify(composed))),
      },
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.harnessConfigPath) assertR2ExecutionEnvironment();
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.driverPath) throw new Error(usage());
  if (options.smoke) {
    if (!options.harnessConfigPath || !options.cellId || options.admissionPath) {
      throw new Error("--smoke requires --harness-config, --cell, and --driver, and forbids --admission");
    }
    const smoke = await runNonConsumingSmoke(options);
    process.stdout.write(`${JSON.stringify(smoke)}\n`);
    return;
  }
  if (options.provisioningManifestPath) {
    throw new Error("--provisioning-manifest is only valid with --smoke; scored controllers use the manifest bound into admission");
  }
  const { config, configDirectory } = await loadLaneControllerConfig(options);
  if (!Array.isArray(config.milestones) || config.milestones.length === 0) {
    throw new TypeError("lane controller config milestones must be non-empty");
  }

  let admissionGuard = null;
  let attemptStarted = false;
  let attemptPhase = "pre-attempt";
  let driver = null;
  let driverPreflight = null;
  let result = null;
  let runError = null;
  try {
    if (options.harnessConfigPath) {
      if (!options.admissionPath) {
        throw new Error("R2_ADMISSION_REQUIRED: direct campaign launch requires a fresh per-cell admission artifact");
      }
      const admissionPath = resolve(options.admissionPath);
      const artifact = JSON.parse(await readFile(admissionPath, "utf8"));
      const actualExecution = {
        execPath: process.execPath,
        cwd: process.cwd(),
        controllerPath: fileURLToPath(import.meta.url),
        driverPath: resolve(options.driverPath),
        argv: process.argv.slice(1),
        environment: assertR2ExecutionEnvironment({ harnessConfig: config.harnessConfig }),
      };
      const sourceIdentity = resolveSourceIdentity({
        repositoryRoot: config.repositoryRoot,
        provisioningManifestPath: artifact.sourceProvisioning?.manifest?.path ?? null,
      });
      let campaignState = await inspectCommittedSeriality({
        harnessConfig: config.harnessConfig,
        cellId: config.cell.id,
        repositoryRoot: config.repositoryRoot,
        gitRead: sourceIdentity.gitRead,
      });
      verifyAdmissionArtifact({
        artifact,
        harnessConfig: config.harnessConfig,
        harnessConfigPath: resolve(options.harnessConfigPath),
        cellId: config.cell.id,
        admissionPath,
        campaignState,
        actualExecution,
      });
      resolveConfigJourney(config);
      const claim = claimExclusiveHostLock({
        lock: artifact.exclusiveHostLock,
        harnessConfig: config.harnessConfig,
        cellId: config.cell.id,
        artifactSha256: artifact.identity.sha256,
        execution: actualExecution,
      });
      admissionGuard = { artifact, claim };

      ({ driver, preflight: driverPreflight, campaignState } = await completeAdmittedDriverPreflight({
        artifact,
        harnessConfigPath: options.harnessConfigPath,
        admissionPath,
        actualExecution,
        claim,
        driverPath: options.driverPath,
        config,
        configDirectory,
        dependencies: { sourceIdentity },
        onPhase: (phase) => { attemptPhase = phase; },
      }));
      attemptPhase = "attempt-capsule";
      await writeCampaignAttemptStart({ config, configDirectory, artifact, admissionPath, claim });
      attemptStarted = true;
      attemptPhase = "controller-initialize";
    } else if (options.admissionPath) {
      throw new Error("--admission is only valid with --harness-config");
    }

    if (driver === null) driver = await import(pathToFileURL(resolve(options.driverPath)).href);
    if (typeof driver.runMilestone !== "function") {
      throw new TypeError("lane controller driver must export runMilestone");
    }
    const controller = new R2LaneController({
      laneRunId: config.laneRunId,
      instrumentPin: config.instrumentPin,
      observationPath: configPath(configDirectory, config.observationPath, "observationPath"),
      loadCeilings: config.loadCeilings,
      loadIntervalMs: config.loadIntervalMs ?? 60_000,
    });
    await controller.initialize();
    let cellError = null;
    let finalizationError = null;
    let patch = null;
    let record = null;
    let prepared = false;
    try {
      if (typeof driver.prepare === "function") {
        attemptPhase = "driver-prepare";
        await driver.prepare({ config, configDirectory, preflight: driverPreflight });
      }
      prepared = true;
      attemptPhase = "model-product-execution";
      for (const milestone of config.milestones) {
        const claimOptions = typeof driver.claimOptions === "function"
          ? await driver.claimOptions({ milestone, config, configDirectory })
          : {};
        await controller.runMilestone(
          milestone,
          (controls) => driver.runMilestone({
            milestone,
            controls,
            config,
            configDirectory,
          }),
          claimOptions,
        );
      }
    } catch (error) {
      cellError = error;
    } finally {
      if (prepared) {
        try {
          if (typeof driver.finalize === "function") {
            attemptPhase = "driver-finalize";
            await withFinalizationStage(
              "driver-finalize",
              () => driver.finalize({ config, configDirectory, error: cellError }),
            );
          }
        } catch (error) {
          finalizationError = error;
        }
        try {
          attemptPhase = "record-finalization";
          const driverSources = typeof driver.observationSources === "function"
            ? await withFinalizationStage(
                "observation-source-discovery",
                () => driver.observationSources({ config, configDirectory }),
              )
            : [];
          patch = await controller.writeRecordPatch({
            manifestPath: configPath(configDirectory, config.manifestPath, "manifestPath"),
            outPath: configPath(configDirectory, config.recordPatchPath, "recordPatchPath"),
            additionalObservationSources: [
              ...(config.observationSources ?? []),
              ...driverSources,
            ].map((source) => ({
              sourceId: source.sourceId,
              path: configPath(configDirectory, source.path, "observation source path"),
            })),
          });
          record = await controller.writeCompleteRecord({
            patch,
            recordBasePath: configPath(configDirectory, config.recordBasePath, "recordBasePath"),
            recordPath: configPath(configDirectory, config.recordPath, "recordPath"),
            expectedMilestones: config.milestones,
            baseSchemaPath: config.baseSchemaPath,
            extensionSchemaPath: config.extensionSchemaPath,
            composedSchemaPath: config.composedSchemaPath,
          });
        } catch (error) {
          finalizationError = finalizationError === null
            ? error
            : new AggregateError([finalizationError, error], "cell finalization failed");
        }
      }
    }
    if (cellError !== null || finalizationError !== null) {
      const errors = [cellError, finalizationError].filter((error) => error !== null);
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "cell execution and record finalization failed");
    }
    result = {
      ok: true,
      laneRunId: config.laneRunId,
      milestones: patch.executionOrder,
      record: config.recordPath,
      scorecardEligible: record.socialMessenger.efficiencyScorecardEligibility.eligible,
    };
  } catch (error) {
    if (attemptStarted) {
      try {
        await writeAttemptFailure(configDirectory, error, attemptPhase);
      } catch (failureReceiptError) {
        error = new AggregateError(
          [error, failureReceiptError],
          "controller failed and could not retain its deterministic attempt-failure receipt",
        );
      }
    }
    runError = error;
  } finally {
    if (admissionGuard !== null) {
      try {
        releaseExclusiveHostLock({
          lock: admissionGuard.artifact.exclusiveHostLock,
          claim: admissionGuard.claim,
          outcome: runError === null ? "record-finalized" : "controller-or-finalization-failed",
        });
      } catch (releaseError) {
        runError = runError === null
          ? releaseError
          : new AggregateError([runError, releaseError], "controller failed and exclusive lock release failed");
      }
    }
  }
  if (runError !== null) throw runError;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`social-messenger lane controller finalization failure:\n${formatFinalizationFailure(error)}\n`);
    process.exitCode = 2;
  });
}

export const LANE_CONTROLLER_PATH = fileURLToPath(import.meta.url);
