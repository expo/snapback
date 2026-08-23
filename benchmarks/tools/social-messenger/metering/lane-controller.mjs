#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { joinUsageToMilestones } from "./joiner.mjs";
import { loadMeteringManifest } from "./manifest.mjs";
import {
  CURRENT_INSTRUMENT_PIN,
  LaneObservationHarness,
  ObservationWriter,
} from "./observations.mjs";

const MILESTONE = /^M[1-8]$/u;

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
}

function usage() {
  return `Usage:
  node lane-controller.mjs --config <lane-controller.json> --driver <driver.mjs>
  node lane-controller.mjs --harness-config <harness-config.json> --cell <cell-id> --driver <driver.mjs>

The config declares laneRunId, observationPath, loadCeilings, milestones,
manifestPath, recordPatchPath, and optional observationSources. The driver
exports runMilestone({ milestone, controls, config }) and places only the
actual suite settlement wait inside controls.suiteAssertionWait(). In R2 mode,
the controller reads the frozen harness config directly, refuses any instrument
pin other than ${CURRENT_INSTRUMENT_PIN}, and writes under the cell's private
execution root.`;
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
  const privateRoot = resolve(requiredString(
    harnessConfig.paths?.privateExecutionRoot,
    "harness paths.privateExecutionRoot",
  ));
  const cellRoot = join(privateRoot, "cells", cell.id);
  const loadIsolation = harnessConfig.execution?.loadIsolation;
  const sampleEverySeconds = loadIsolation?.sampleEverySeconds;
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
      observationSources: [],
      harnessConfig,
      cell,
    },
  };
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
  for (const milestone of config.milestones) {
    await controller.runMilestone(
      milestone,
      (controls) => driver.runMilestone({ milestone, controls, config }),
    );
  }
  const driverSources = typeof driver.observationSources === "function"
    ? await driver.observationSources({ config })
    : [];
  const patch = await controller.writeRecordPatch({
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
  process.stdout.write(`${JSON.stringify({
    ok: true,
    laneRunId: config.laneRunId,
    milestones: patch.executionOrder,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`social-messenger lane controller: ${error.message}\n`);
    process.exitCode = 2;
  });
}

export const LANE_CONTROLLER_PATH = fileURLToPath(import.meta.url);
