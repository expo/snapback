#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { joinUsageToMilestones } from "./joiner.mjs";
import { loadMeteringManifest } from "./manifest.mjs";
import { composeRunRecord } from "./record-composer.mjs";
import {
  inspectCommittedSeriality,
  loadPolicyForCell,
  probeLaunchQuiet,
  verifyAdmissionArtifact,
} from "./r2-cell-admission.mjs";
import {
  claimExclusiveHostLock,
  releaseExclusiveHostLock,
} from "./r2-host-lock.mjs";
import {
  CURRENT_INSTRUMENT_PIN,
  LaneObservationHarness,
  ObservationWriter,
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

    const meteringInput = await loadMeteringManifest(absoluteManifest);
    const patch = joinUsageToMilestones(meteringInput);
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
  const cellRoot = join(privateRoot, "cells", cell.id);
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

async function writeCampaignAttemptStart({ config, configDirectory, artifact, admissionPath }) {
  await mkdir(configDirectory);
  const groupId = processGroupId(process.pid);
  const attempt = {
    version: "snapback.r2-private-cell-attempt.v1",
    runId: config.harnessConfig.runId,
    cellId: config.cell.id,
    attemptCount: 1,
    campaignCellRerun: false,
    admission: {
      path: resolve(admissionPath),
      sha256: artifact.identity.sha256,
    },
    exclusiveHostLockOwnerSha256: artifact.exclusiveHostLock.owner.sha256,
    startedAt: new Date().toISOString(),
  };
  const ownership = {
    version: "snapback.r2-process-ownership.v1",
    runId: config.harnessConfig.runId,
    cellId: config.cell.id,
    controllerPid: process.pid,
    controllerParentPid: process.ppid,
    processGroupId: groupId,
    processGroupIsolated: groupId === process.pid,
    nativeHarnessPid: null,
    childPids: [],
    startedAt: attempt.startedAt,
  };
  await Promise.all([
    writeFile(join(configDirectory, "attempt.json"), `${JSON.stringify(attempt, null, 2)}\n`, { flag: "wx" }),
    writeFile(join(configDirectory, "process-ownership.json"), `${JSON.stringify(ownership, null, 2)}\n`, { flag: "wx" }),
  ]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.driverPath) throw new Error(usage());
  const { config, configDirectory } = await loadLaneControllerConfig(options);
  if (!Array.isArray(config.milestones) || config.milestones.length === 0) {
    throw new TypeError("lane controller config milestones must be non-empty");
  }

  let admissionGuard = null;
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
      };
      let campaignState = await inspectCommittedSeriality({
        harnessConfig: config.harnessConfig,
        cellId: config.cell.id,
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
      const claim = claimExclusiveHostLock({
        lock: artifact.exclusiveHostLock,
        harnessConfig: config.harnessConfig,
        cellId: config.cell.id,
        artifactSha256: artifact.identity.sha256,
        execution: actualExecution,
      });
      admissionGuard = { artifact, claim };

      // This is the launch-time TOCTOU boundary: after the load window and
      // after the controller owns the atomic lock, re-probe process/port state,
      // seriality, command bytes, and instrument bytes immediately before the
      // first private cell write and production-driver import.
      await probeLaunchQuiet({
        harnessConfig: config.harnessConfig,
        seriality: campaignState,
      });
      campaignState = await inspectCommittedSeriality({
        harnessConfig: config.harnessConfig,
        cellId: config.cell.id,
      });
      verifyAdmissionArtifact({
        artifact,
        harnessConfig: config.harnessConfig,
        harnessConfigPath: resolve(options.harnessConfigPath),
        cellId: config.cell.id,
        admissionPath,
        campaignState,
        actualExecution,
        requireControllerClaim: claim,
      });
      await writeCampaignAttemptStart({ config, configDirectory, artifact, admissionPath });
    } else if (options.admissionPath) {
      throw new Error("--admission is only valid with --harness-config");
    }

    const driver = await import(pathToFileURL(resolve(options.driverPath)).href);
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
    try {
      if (typeof driver.prepare === "function") {
        await driver.prepare({ config, configDirectory });
      }
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
      try {
        if (typeof driver.finalize === "function") {
          await driver.finalize({ config, configDirectory, error: cellError });
        }
      } catch (error) {
        finalizationError = error;
      }
      try {
        const driverSources = typeof driver.observationSources === "function"
          ? await driver.observationSources({ config, configDirectory })
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
    process.stderr.write(`social-messenger lane controller: ${error.message}\n`);
    process.exitCode = 2;
  });
}

export const LANE_CONTROLLER_PATH = fileURLToPath(import.meta.url);
