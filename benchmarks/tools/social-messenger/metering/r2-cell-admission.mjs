#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, hostname, loadavg, platform, release, totalmem } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveInstrumentArtifacts } from "../../lane-setup.mjs";
import { validateFinalizedCellSlot, isFinalizedStatus } from "./r2-finalized-cell.mjs";
import {
  acquireExclusiveHostLock,
  assertExclusiveHostLockHeld,
  releaseExclusiveHostLock,
  verifyExclusiveHostLock,
} from "./r2-host-lock.mjs";
import { assertR2ExecutionEnvironment } from "./r2-execution-environment.mjs";
import { inspectPrivateCellPath } from "./r2-private-paths.mjs";

export const R2_ADMISSION_VERSION = "snapback.r2-cell-admission.v2";
export const R2_SOURCE_CLOSURE_VERSION = "snapback.r2-executing-source-closure.v1";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const METERING_SOURCE_ROOT = "benchmarks/tools/social-messenger/metering";
const REQUIRED_SOURCE_CLOSURE_FILES = Object.freeze([
  "benchmarks/schema/run-record.schema.json",
  "benchmarks/schema/social-messenger/run-record-extension.schema.json",
  "benchmarks/schema/social-messenger/run-record.schema.json",
  "benchmarks/tools/lane-setup.mjs",
  "benchmarks/tools/social-messenger/choreography/receipts.schema.json",
  "benchmarks/tools/social-messenger/record-validator.mjs",
  "benchmarks/tools/lib/json-schema.mjs",
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function bareDigest(bytes) {
  return digest(bytes).replace(/^sha256:/u, "");
}

export function admissionIdentity(artifact) {
  const unsigned = structuredClone(artifact);
  delete unsigned.identity;
  return digest(JSON.stringify(canonical(unsigned)));
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`R2_ADMISSION_INVALID: ${label} must be a non-empty string`);
  }
  return value;
}

function inside(root, path) {
  const logical = relative(resolve(root), resolve(path));
  return logical === ""
    || (logical !== ".." && !logical.startsWith(`..${sep}`) && !isAbsolute(logical));
}

function readRegular(path, label) {
  const absolute = resolve(path);
  if (lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`R2_ADMISSION_INVALID: ${label} cannot be a symbolic link`);
  }
  const canonicalPath = realpathSync(absolute);
  if (!statSync(canonicalPath).isFile()) {
    throw new Error(`R2_ADMISSION_INVALID: ${label} must be a regular file`);
  }
  return readFileSync(canonicalPath);
}

function publishAdmissionArtifact({ admissionPath, artifact, privateCellPath, issuedAtMs }) {
  const path = resolve(admissionPath);
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  let archived = null;
  if (existsSync(path)) {
    const priorBytes = readRegular(path, "prior admission artifact");
    const prior = JSON.parse(priorBytes.toString("utf8"));
    if (
      existsSync(privateCellPath)
      || prior.version !== R2_ADMISSION_VERSION
      || prior.runId !== artifact.runId
      || prior.cellId !== artifact.cellId
      || prior.identity?.sha256 !== admissionIdentity(prior)
      || !Number.isFinite(Date.parse(prior.expiresAt))
      || Date.parse(prior.expiresAt) >= issuedAtMs
    ) {
      throw new Error("R2_ADMISSION_EXISTING_ARTIFACT: prior admission is not an expired unused artifact for this exact cell");
    }
    const historyRoot = resolve(dirname(path), "history", artifact.cellId);
    mkdirSync(historyRoot, { recursive: true });
    archived = resolve(historyRoot, `${prior.identity.sha256.replace(/^sha256:/u, "")}.json`);
    if (existsSync(archived)) {
      if (!readFileSync(archived).equals(priorBytes)) {
        throw new Error("R2_ADMISSION_EXISTING_ARTIFACT: prior admission history digest collides with different bytes");
      }
      throw new Error("R2_ADMISSION_EXISTING_ARTIFACT: exact prior admission was already archived without replacement");
    }
    renameSync(path, archived);
  }
  try {
    writeFileSync(path, bytes, { flag: "wx" });
  } catch (error) {
    if (archived !== null && !existsSync(path) && existsSync(archived)) renameSync(archived, path);
    throw error;
  }
}

function directoryDigest(root, label) {
  const canonicalRoot = realpathSync(resolve(root));
  if (!statSync(canonicalRoot).isDirectory()) {
    throw new Error(`R2_ADMISSION_SOURCE_CLOSURE: ${label} must be a directory`);
  }
  const entries = [];
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => (
      left.name.localeCompare(right.name)
    ))) {
      const absolute = resolve(directory, entry.name);
      const logical = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const status = lstatSync(absolute);
      if (status.isSymbolicLink()) {
        throw new Error(`R2_ADMISSION_SOURCE_CLOSURE: ${label} contains a symbolic link at ${logical}`);
      }
      if (status.isDirectory()) visit(absolute, logical);
      else if (status.isFile()) {
        const bytes = readFileSync(absolute);
        entries.push(`${logical}\0${bytes.byteLength}\0${bareDigest(bytes)}\n`);
      } else {
        throw new Error(`R2_ADMISSION_SOURCE_CLOSURE: ${label} contains an unsupported entry at ${logical}`);
      }
    }
  };
  visit(canonicalRoot);
  return `sha256:${bareDigest(entries.join(""))}`;
}

function declaredSourceClosure(harnessConfig) {
  const closure = harnessConfig.execution?.sourceClosure;
  if (
    closure?.version !== R2_SOURCE_CLOSURE_VERSION
    || closure.meteringRoot?.kind !== "directory"
    || !SHA256.test(closure.meteringRoot?.sha256 ?? "")
    || !Array.isArray(closure.files)
  ) {
    throw new Error("R2_ADMISSION_SOURCE_CLOSURE: harness config lacks the registered executing source closure");
  }
  const paths = closure.files.map((file) => file?.path);
  if (
    JSON.stringify([...paths].sort()) !== JSON.stringify([...REQUIRED_SOURCE_CLOSURE_FILES].sort())
    || closure.files.some((file) => file.kind !== "file" || !SHA256.test(file.sha256 ?? ""))
  ) {
    throw new Error("R2_ADMISSION_SOURCE_CLOSURE: registered external source leaves are incomplete");
  }
  return closure;
}

// This is the executing checkout closure, not the separately materialized
// instrument snapshot. Static imports beneath meteringRoot resolve inside this
// exact directory; the listed leaves close over runtime/schema imports outside
// it. Rechecking this object immediately before driver import and first write
// prevents a clean entrypoint from laundering a dirty dependency.
export function measureSourceClosure({ repositoryRoot = REPOSITORY_ROOT }) {
  const canonicalRepository = realpathSync(resolve(repositoryRoot));
  const rootPath = resolve(canonicalRepository, METERING_SOURCE_ROOT);
  if (!inside(canonicalRepository, rootPath) || lstatSync(rootPath).isSymbolicLink()) {
    throw new Error("R2_ADMISSION_SOURCE_CLOSURE: metering source root escapes or is a symbolic link");
  }
  const meteringRoot = {
    kind: "directory",
    path: relative(canonicalRepository, realpathSync(rootPath)).split(sep).join("/"),
    sha256: directoryDigest(rootPath, "metering source root"),
  };
  const files = REQUIRED_SOURCE_CLOSURE_FILES.map((path) => {
    const absolute = resolve(canonicalRepository, path);
    if (!inside(canonicalRepository, absolute)) {
      throw new Error(`R2_ADMISSION_SOURCE_CLOSURE: source leaf escapes the repository: ${path}`);
    }
    const live = fileDescriptor(absolute, `source closure leaf ${path}`);
    const logical = relative(canonicalRepository, live.path).split(sep).join("/");
    return { kind: "file", path: logical, sha256: live.sha256, bytes: live.bytes };
  });
  return { version: R2_SOURCE_CLOSURE_VERSION, meteringRoot, files };
}

export function liveSourceClosure({ harnessConfig, repositoryRoot = REPOSITORY_ROOT }) {
  const closure = declaredSourceClosure(harnessConfig);
  const live = measureSourceClosure({ repositoryRoot });
  if (
    live.meteringRoot.path !== closure.meteringRoot.path
    || live.meteringRoot.sha256 !== closure.meteringRoot.sha256
  ) {
    throw new Error("R2_ADMISSION_SOURCE_CLOSURE: executing metering directory differs from the registered graph");
  }
  for (const registered of closure.files) {
    const measured = live.files.find((file) => file.path === registered.path);
    if (measured?.sha256 !== registered.sha256) {
      throw new Error(`R2_ADMISSION_SOURCE_CLOSURE: executing source leaf changed: ${registered.path}`);
    }
  }
  return live;
}

function git(args, repositoryRoot) {
  const bytes = execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: args[0] === "show" ? null : "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return Buffer.isBuffer(bytes) ? bytes : bytes.trim();
}

export async function inspectCommittedSeriality({
  harnessConfig,
  cellId,
  repositoryRoot = REPOSITORY_ROOT,
  privateExists = existsSync,
  gitRead = git,
}) {
  const requestedIndex = harnessConfig.cellOrder.indexOf(cellId);
  if (requestedIndex < 0) throw new Error(`R2_ADMISSION_INVALID: unknown cell ${cellId}`);
  inspectPrivateCellPath({ harnessConfig, cellId });
  const committedRoot = resolve(repositoryRoot, harnessConfig.paths.committedRunRoot);
  const privateRoot = resolve(harnessConfig.paths.privateExecutionRoot);
  const committedPrefix = [];
  let firstOpen = null;
  for (const [index, id] of harnessConfig.cellOrder.entries()) {
    const slotPath = resolve(committedRoot, "cells", id, "cell.json");
    const slot = JSON.parse(readRegular(slotPath, `cell slot ${id}`).toString("utf8"));
    const recordPath = resolve(committedRoot, "cells", id, "record.json");
    const meteringPath = resolve(committedRoot, "cells", id, "metering.json");
    if (isFinalizedStatus(slot.status)) {
      if (
        firstOpen !== null
        || !existsSync(recordPath)
        || !existsSync(meteringPath)
      ) {
        throw new Error(`R2_ADMISSION_SERIALITY: finalized cells must form one contiguous recorded prefix (${id})`);
      }
      await validateFinalizedCellSlot({
        slotPath,
        cellId: id,
        repositoryRoot,
        expectedMilestones: harnessConfig.execution?.milestones ?? [],
        gitRead,
      });
      committedPrefix.push(id);
    } else {
      if (firstOpen === null) firstOpen = index;
      if (slot.status !== "not-started" || existsSync(recordPath) || existsSync(meteringPath)) {
        throw new Error(`R2_ADMISSION_PRISTINE: later slot ${id} is not pristine`);
      }
    }
    if (index >= requestedIndex && privateExists(resolve(privateRoot, "cells", id))) {
      throw new Error(
        `R2_ADMISSION_EXISTING_UNRECORDED_EVIDENCE: ${id} already has private evidence; finalize it instead of launching or rerunning`,
      );
    }
  }
  if (firstOpen !== requestedIndex || committedPrefix.length !== requestedIndex) {
    throw new Error(`R2_ADMISSION_SERIALITY: ${cellId} is not the first cell after the committed prefix`);
  }
  return {
    gitHead: gitRead(["rev-parse", "HEAD"], repositoryRoot),
    committedPrefix,
    requestedIndex,
    laterPristine: harnessConfig.cellOrder.slice(requestedIndex + 1),
    privateCellState: "absent",
  };
}

function assertSamples(artifact, policy, issuedAtMs) {
  if (
    policy?.sampleEverySeconds !== 60
    || policy.preStartConsecutivePassingSamples !== 3
    || JSON.stringify(policy.metrics) !== JSON.stringify(["loadavg1", "loadavg5", "loadavg15"])
    || policy.metrics.some((metric) => policy.ceilingInclusive?.[metric] !== 10)
  ) {
    throw new Error("R2_ADMISSION_LOAD: policy must require three once-per-minute loadavg1/5/15 samples at the inclusive 10.00 ceiling");
  }
  const samples = artifact.loadIsolation?.samples;
  if (!Array.isArray(samples) || samples.length !== 3) {
    throw new Error("R2_ADMISSION_LOAD: admission requires exactly three consecutive load samples");
  }
  const intervalMs = policy.sampleEverySeconds * 1_000;
  for (const [index, sample] of samples.entries()) {
    const at = Date.parse(sample.sampledAt);
    if (!Number.isFinite(at) || sample.ordinal !== index + 1) {
      throw new Error("R2_ADMISSION_LOAD: load samples must have ordered timestamps and ordinals");
    }
    if (index > 0) {
      const spacing = at - Date.parse(samples[index - 1].sampledAt);
      if (spacing < intervalMs || spacing > intervalMs + 5_000) {
        throw new Error("R2_ADMISSION_LOAD: consecutive samples must be taken once per minute");
      }
    }
    for (const metric of policy.metrics) {
      if (typeof sample[metric] !== "number" || sample[metric] > policy.ceilingInclusive[metric]) {
        throw new Error(`R2_ADMISSION_LOAD: ${metric} exceeds its inclusive 10.00 ceiling`);
      }
    }
  }
  const lastAt = Date.parse(samples.at(-1).sampledAt);
  if (lastAt > issuedAtMs || issuedAtMs - lastAt > 30_000) {
    throw new Error("R2_ADMISSION_LOAD: final load sample is not fresh at issuance");
  }
}

export function loadPolicyForCell(harnessConfig, cell) {
  const policy = harnessConfig.execution?.loadIsolation?.policies?.[cell.loadCeilingId];
  if (
    !policy
    || policy.policyId !== cell.loadCeilingId
    || policy.allowedHostId !== cell.allowedHostId
  ) {
    throw new Error(`R2_ADMISSION_LOAD: cell ${cell.id} has no exact registered load policy`);
  }
  return policy;
}

function fileDescriptor(path, label) {
  const bytes = readRegular(path, label);
  return { path: realpathSync(resolve(path)), sha256: digest(bytes), bytes: bytes.byteLength };
}

function optionValue(argv, option) {
  const indexes = argv.flatMap((value, index) => value === option ? [index] : []);
  if (indexes.length !== 1 || indexes[0] === argv.length - 1) {
    throw new Error(`R2_ADMISSION_COMMAND: exact command must carry one ${option} value`);
  }
  return argv[indexes[0] + 1];
}

export function configuredExecutionBinding({
  harnessConfig,
  cell,
  repositoryRoot = REPOSITORY_ROOT,
  environment = process.env,
}) {
  const executionEnvironment = assertR2ExecutionEnvironment({ harnessConfig, environment });
  const command = cell.controllerCommand;
  if (!Array.isArray(command) || command.length < 2) {
    throw new Error("R2_ADMISSION_COMMAND: controller command is absent");
  }
  const controllerPath = resolve(repositoryRoot, command[1]);
  const driverArg = optionValue(command, "--driver");
  const driverPath = resolve(repositoryRoot, driverArg);
  const registeredCommand = harnessConfig.controller?.commandTemplate?.map((value) => (
    value.replaceAll("{cellId}", cell.id)
  ));
  if (
    JSON.stringify(command) !== JSON.stringify(registeredCommand)
    || optionValue(command, "--cell") !== cell.id
    || command[1] !== harnessConfig.controller?.entrypoint
    || driverArg !== harnessConfig.controller?.driver
  ) {
    throw new Error("R2_ADMISSION_COMMAND: controller or driver argv path differs from the registered production path");
  }
  const node = fileDescriptor(command[0], "configured Node binary");
  const controller = fileDescriptor(controllerPath, "configured controller");
  const driver = fileDescriptor(driverPath, "configured driver");
  return {
    cwd: realpathSync(repositoryRoot),
    argv: [controller.path, ...command.slice(2)],
    configuredCommand: command,
    node,
    controller: { ...controller, configuredArg: command[1] },
    driver: { ...driver, configuredArg: driverArg },
    environment: executionEnvironment,
    sourceClosure: liveSourceClosure({ harnessConfig, repositoryRoot }),
  };
}

export function assertCommittedConfig({ harnessConfigPath, configBytes, repositoryRoot, gitRead = git }) {
  const absolute = resolve(harnessConfigPath);
  if (!inside(repositoryRoot, absolute)) {
    throw new Error("R2_ADMISSION_IDENTITY: harness config must be inside the committed repository");
  }
  const logical = relative(repositoryRoot, absolute).split(sep).join("/");
  let committed;
  try {
    committed = gitRead(["show", `HEAD:${logical}`], repositoryRoot);
  } catch (error) {
    throw new Error(`R2_ADMISSION_IDENTITY: harness config is absent from committed HEAD: ${error.message}`);
  }
  const committedBytes = Buffer.isBuffer(committed) ? committed : Buffer.from(committed);
  if (!committedBytes.equals(configBytes)) {
    throw new Error("R2_ADMISSION_IDENTITY: harness config bytes differ from committed HEAD");
  }
}

export function registeredCellExpectations(harnessConfig, cell) {
  const harness = harnessConfig.harnesses?.[cell.harness];
  const policy = cell.meteringPolicy;
  const exactPolicy = cell.harness === "codex-sol"
    ? { adapter: "codex", capFamily: "gpt-frontier", nativeCounts: "required" }
    : cell.harness === "claude-opus5"
      ? { adapter: "claude", capFamily: "claude-frontier", nativeCounts: "required" }
      : cell.harness === "grok-46"
        ? { adapter: "unavailable", capFamily: "grok-advisory", nativeCounts: "registered-unavailable" }
        : null;
  if (
    !harness
    || exactPolicy === null
    || policy?.adapter === undefined
    || !new Set(["required", "registered-unavailable"]).has(policy.nativeCounts)
    || policy.adapter !== exactPolicy.adapter
    || policy.capFamily !== exactPolicy.capFamily
    || policy.nativeCounts !== exactPolicy.nativeCounts
    || (policy.nativeCounts === "registered-unavailable"
      && (cell.harness !== "grok-46"
        || policy.adapter !== "unavailable"
        || policy.unavailableReason !== harness.meteringUnavailableReason))
    || (policy.nativeCounts === "required" && policy.adapter === "unavailable")
  ) {
    throw new Error(`R2_ADMISSION_METERING_POLICY: cell ${cell.id} lacks an honest registered adapter/count policy`);
  }
  return {
    runId: harnessConfig.runId,
    cellId: cell.id,
    laneRunId: `${harnessConfig.runId}/${cell.id}`,
    app: cell.app,
    clientStack: cell.clientStack,
    profile: cell.profile,
    promptFile: cell.promptFile,
    harnessKey: cell.harness,
    harnessBinary: harness.binary,
    harnessVersion: harness.observedVersion,
    model: cell.model,
    effort: cell.effort,
    adapter: policy.adapter,
    capFamily: policy.capFamily,
    nativeCounts: policy.nativeCounts,
    unavailableReason: policy.unavailableReason ?? null,
    allowedHostId: cell.allowedHostId,
    loadCeilingId: cell.loadCeilingId,
    controllerCommand: cell.controllerCommand,
  };
}

function assertActualExecution(expected, actual) {
  if (actual === null) return;
  let actualExecPath;
  let actualCwd;
  let actualControllerPath;
  let actualDriverPath;
  try {
    actualExecPath = realpathSync(resolve(actual.execPath));
    actualCwd = realpathSync(resolve(actual.cwd));
    actualControllerPath = realpathSync(resolve(actual.controllerPath));
    actualDriverPath = realpathSync(resolve(actual.driverPath));
  } catch (error) {
    throw new Error(`R2_ADMISSION_COMMAND: actual execution path cannot be resolved: ${error.message}`);
  }
  if (
    actualExecPath !== expected.node.path
    || actualCwd !== expected.cwd
    || actualControllerPath !== expected.controller.path
    || actualDriverPath !== expected.driver.path
    || JSON.stringify(actual.argv) !== JSON.stringify(expected.argv)
    || !sameJson(actual.environment, expected.environment)
  ) {
    throw new Error("R2_ADMISSION_COMMAND: actual Node/controller/argv/driver/environment execution differs from the admitted command");
  }
}

function sysctlValue(key) {
  return execFileSync("sysctl", ["-n", key], { encoding: "utf8" }).trim();
}

export function currentHostIdentity(dependencies = {}) {
  const readSysctl = dependencies.sysctlValue ?? sysctlValue;
  return {
    hostname: (dependencies.hostname ?? hostname)(),
    platform: (dependencies.platform ?? platform)(),
    release: (dependencies.release ?? release)(),
    arch: (dependencies.arch ?? arch)(),
    hardwareModel: readSysctl("hw.model"),
    chip: readSysctl("machdep.cpu.brand_string"),
    physicalCpuCount: Number(readSysctl("hw.physicalcpu")),
    logicalCpuCount: (dependencies.cpus ?? cpus)().length,
    memoryBytes: (dependencies.totalmem ?? totalmem)(),
  };
}

function assertAllowedHost(harnessConfig, cell, observed) {
  const expected = harnessConfig.machines?.[cell.allowedHostId];
  if (!expected || expected.id !== cell.allowedHostId) {
    throw new Error(`R2_ADMISSION_HOST: cell ${cell.id} has no configured allowed host identity`);
  }
  const expectedIdentity = {
    hostname: expected.hostname,
    platform: expected.platform,
    release: expected.release,
    arch: expected.arch,
    hardwareModel: expected.hardwareModel,
    chip: expected.chip,
    physicalCpuCount: expected.physicalCpuCount,
    logicalCpuCount: expected.logicalCpuCount,
    memoryBytes: expected.memoryBytes,
  };
  if (!sameJson(observed, expectedIdentity)) {
    throw new Error(
      `R2_ADMISSION_HOST: current host does not equal configured ${cell.allowedHostId} hardware identity`,
    );
  }
  return { allowedHostId: cell.allowedHostId, observed };
}

export function allCampaignPorts(harnessConfig) {
  const ports = new Set();
  for (const cell of harnessConfig.cells ?? []) {
    for (let port = cell.ports[0]; port <= cell.ports[1]; port += 1) ports.add(port);
  }
  return [...ports].sort((left, right) => left - right);
}

function psSnapshot() {
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8" });
  return output.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u);
    return match === null ? [] : [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      command: match[4],
    }];
  });
}

function recordedProcessEvidence(harnessConfig, committedPrefix, repositoryRoot) {
  const privateRoot = resolve(harnessConfig.paths.privateExecutionRoot);
  const committedRoot = resolve(repositoryRoot, harnessConfig.paths.committedRunRoot);
  const pids = new Set();
  const isolatedProcessGroups = new Set();
  for (const cellId of committedPrefix) {
    const roots = [resolve(privateRoot, "cells", cellId), resolve(committedRoot, "cells", cellId)];
    for (const root of roots) {
      const ownershipPath = resolve(root, "process-ownership.json");
      if (existsSync(ownershipPath)) {
        try {
          const ownership = JSON.parse(
            readRegular(ownershipPath, "process ownership").toString("utf8"),
          );
          for (const value of [ownership.controllerPid, ownership.nativeHarnessPid, ...(ownership.childPids ?? [])]) {
            if (Number.isInteger(value)) pids.add(value);
          }
          if (ownership.processGroupIsolated === true && Number.isInteger(ownership.processGroupId)) {
            isolatedProcessGroups.add(ownership.processGroupId);
          }
        } catch {
          // The path/cell/private-root command scan below remains the safe
          // fallback for retained cells without a structured ownership file.
        }
      }
      const runLogPath = resolve(root, "run-log.md");
      if (existsSync(runLogPath)) {
        const text = readFileSync(runLogPath, "utf8");
        for (const match of text.matchAll(/(?:pid|pids|child-runtime-pid|child-runtime-pids|runtime-pid)=([0-9,]+)/gu)) {
          for (const value of match[1].split(",")) pids.add(Number(value));
        }
      }
    }
  }
  return { pids: [...pids].filter(Number.isInteger), isolatedProcessGroups: [...isolatedProcessGroups] };
}

function ancestorPids(snapshot, pid) {
  const byPid = new Map(snapshot.map((entry) => [entry.pid, entry]));
  const ancestors = new Set([pid]);
  let current = byPid.get(pid);
  while (current && current.ppid > 0 && !ancestors.has(current.ppid)) {
    ancestors.add(current.ppid);
    current = byPid.get(current.ppid);
  }
  return ancestors;
}

export function activeCampaignProcesses({
  harnessConfig,
  committedPrefix,
  repositoryRoot = REPOSITORY_ROOT,
  snapshot = psSnapshot(),
  ignoredPid = process.pid,
}) {
  const ignored = ancestorPids(snapshot, ignoredPid);
  const privateRoot = resolve(harnessConfig.paths.privateExecutionRoot);
  const signatures = [
    privateRoot,
    harnessConfig.runId,
    ...harnessConfig.cellOrder.map((cellId) => resolve(privateRoot, "cells", cellId)),
  ];
  const recorded = recordedProcessEvidence(harnessConfig, committedPrefix, repositoryRoot);
  const recordedPids = new Set(recorded.pids);
  const recordedGroups = new Set(recorded.isolatedProcessGroups);
  const matches = [];
  for (const entry of snapshot) {
    if (ignored.has(entry.pid)) continue;
    const reasons = [];
    if (signatures.some((signature) => entry.command.includes(signature))) reasons.push("campaign-path");
    if (recordedPids.has(entry.pid) || recordedPids.has(entry.ppid)) reasons.push("recorded-process-tree");
    if (recordedGroups.has(entry.pgid)) reasons.push("recorded-isolated-process-group");
    if (reasons.length > 0) matches.push({ pid: entry.pid, ppid: entry.ppid, pgid: entry.pgid, reasons });
  }
  return { recorded, active: matches };
}

// @ref LLP 0295#r2-load-isolated-calibration-rerun — admission is a fresh,
// hash-bound, per-cell transition. The production controller repeats these
// identity/freshness/seriality checks before it creates the private cell root.
export function verifyAdmissionArtifact({
  artifact,
  harnessConfig,
  harnessConfigPath,
  cellId,
  admissionPath,
  nowMs = Date.now(),
  campaignState = null,
  actualExecution = null,
  requireControllerClaim = null,
  observedHostIdentity = currentHostIdentity(),
  repositoryRoot = REPOSITORY_ROOT,
  executionBinding = configuredExecutionBinding,
  resolveInstrument = resolveInstrumentArtifacts,
}) {
  if (
    harnessConfig.status !== "serial-per-cell-admission"
    || harnessConfig.execution?.serial !== true
    || harnessConfig.execution?.maxConcurrentCells !== 1
  ) {
    throw new Error("R2_ADMISSION_SERIALITY: campaign is not in strict per-cell serial admission mode");
  }
  if (artifact?.version !== R2_ADMISSION_VERSION) {
    throw new Error(`R2_ADMISSION_INVALID: version must be ${R2_ADMISSION_VERSION}`);
  }
  if (!SHA256.test(artifact.identity?.sha256 ?? "")
      || artifact.identity.sha256 !== admissionIdentity(artifact)) {
    throw new Error("R2_ADMISSION_IDENTITY: artifact self-digest mismatch");
  }
  if (artifact.runId !== harnessConfig.runId || artifact.cellId !== cellId) {
    throw new Error("R2_ADMISSION_IDENTITY: run/cell identity mismatch");
  }
  const cell = harnessConfig.cells.find((candidate) => candidate.id === cellId);
  if (!cell || JSON.stringify(artifact.controllerCommand) !== JSON.stringify(cell.controllerCommand)) {
    throw new Error("R2_ADMISSION_COMMAND: artifact does not bind the exact controller command");
  }
  const execution = executionBinding({ harnessConfig, cell, repositoryRoot });
  if (!sameJson(artifact.execution, execution)) {
    throw new Error("R2_ADMISSION_COMMAND: admitted Node/controller/argv/driver bytes changed or source closure changed");
  }
  const expectations = registeredCellExpectations(harnessConfig, cell);
  if (!sameJson(artifact.registeredCell, expectations)) {
    throw new Error("R2_ADMISSION_IDENTITY: admitted cell/harness/model/adapter expectations changed");
  }
  const allowedMachine = harnessConfig.machines?.[cell.allowedHostId];
  if (
    allowedMachine?.node?.path !== execution.node.path
    || allowedMachine.node.sha256 !== execution.node.sha256
  ) {
    throw new Error("R2_ADMISSION_COMMAND: admitted Node binary disagrees with the allowed host toolchain");
  }
  assertActualExecution(execution, actualExecution);
  if (
    resolve(execution.cwd, optionValue(cell.controllerCommand, "--harness-config")) !== resolve(harnessConfigPath)
    || resolve(execution.cwd, optionValue(cell.controllerCommand, "--admission")) !== resolve(admissionPath)
  ) {
    throw new Error("R2_ADMISSION_COMMAND: harness-config or admission argv does not name the verified artifact path");
  }
  if (cell.admissionArtifact !== relative(dirname(resolve(harnessConfigPath)), resolve(admissionPath)).split(sep).join("/")) {
    throw new Error("R2_ADMISSION_COMMAND: admission path is not the registered per-cell artifact");
  }
  const configBytes = readRegular(harnessConfigPath, "harness config");
  if (
    artifact.harnessConfig?.path !== resolve(harnessConfigPath)
    || artifact.harnessConfig?.sha256 !== digest(configBytes)
  ) {
    throw new Error("R2_ADMISSION_IDENTITY: harness-config digest mismatch");
  }
  const instrumentPath = resolve(repositoryRoot, harnessConfig.pins.instrument.manifestPath);
  const sourceInstrumentManifest = JSON.parse(readRegular(instrumentPath, "instrument manifest"));
  const registeredMeteringRoot = sourceInstrumentManifest.artifacts?.meteringRoot;
  if (
    registeredMeteringRoot?.kind !== "directory"
    || resolve(dirname(instrumentPath), registeredMeteringRoot.path)
      !== resolve(repositoryRoot, harnessConfig.execution.sourceClosure.meteringRoot.path)
    || `sha256:${registeredMeteringRoot.sha256}` !== harnessConfig.execution.sourceClosure.meteringRoot.sha256
  ) {
    throw new Error("R2_ADMISSION_SOURCE_CLOSURE: instrument manifest and executing metering-root registration disagree");
  }
  let materializedInstrument;
  try {
    materializedInstrument = resolveInstrument({
      instrumentRoot: harnessConfig.paths.instrumentRoot,
      instrumentPin: harnessConfig.pins.instrument.instrumentPin,
    });
  } catch (error) {
    throw new Error(`R2_ADMISSION_INSTRUMENT: materialized snapshot is invalid: ${error.message}`);
  }
  if (
    artifact.instrument?.instrumentPin !== harnessConfig.pins.instrument.instrumentPin
    || artifact.instrument?.source?.path !== instrumentPath
    || artifact.instrument?.source?.sha256 !== digest(readRegular(instrumentPath, "instrument manifest"))
    || artifact.instrument.source.sha256 !== `sha256:${harnessConfig.pins.instrument.manifestSha256}`
    || artifact.instrument?.materialized?.root !== materializedInstrument.root
    || artifact.instrument?.materialized?.manifestPath !== materializedInstrument.manifest.path
    || artifact.instrument?.materialized?.sha256 !== `sha256:${materializedInstrument.manifest.sha256}`
    || artifact.instrument.materialized.sha256 !== artifact.instrument.source.sha256
  ) {
    throw new Error("R2_ADMISSION_INSTRUMENT: exact current instrument pin is not bound");
  }
  const issuedAtMs = Date.parse(artifact.issuedAt);
  if (!Number.isFinite(issuedAtMs) || nowMs < issuedAtMs || nowMs > Date.parse(artifact.expiresAt)) {
    throw new Error("R2_ADMISSION_FRESHNESS: admission artifact is expired or future-dated");
  }
  if (Date.parse(artifact.expiresAt) - issuedAtMs !== 30_000) {
    throw new Error("R2_ADMISSION_FRESHNESS: admission validity must be exactly 30 seconds");
  }
  const policy = loadPolicyForCell(harnessConfig, cell);
  assertSamples(artifact, policy, issuedAtMs);
  if (artifact.loadIsolation?.policyId !== policy.policyId) {
    throw new Error("R2_ADMISSION_LOAD: load policy identity mismatch");
  }
  const observedHost = assertAllowedHost(harnessConfig, cell, observedHostIdentity);
  if (!sameJson(artifact.host, observedHost)) {
    throw new Error("R2_ADMISSION_HOST: admitted host identity changed");
  }
  const processCheckedAt = Date.parse(artifact.priorProcessClosure?.checkedAt);
  if (artifact.priorProcessClosure?.closed !== true
      || artifact.priorProcessClosure.active?.length !== 0
      || !Number.isFinite(processCheckedAt)
      || processCheckedAt > issuedAtMs
      || issuedAtMs - processCheckedAt > 5_000) {
    throw new Error("R2_ADMISSION_PROCESS: prior process tree is not closed");
  }
  const expectedPorts = allCampaignPorts(harnessConfig);
  const portsCheckedAt = Date.parse(artifact.ports?.checkedAt);
  if (artifact.ports?.unbound !== true
      || JSON.stringify(artifact.ports.values) !== JSON.stringify(expectedPorts)
      || !Number.isFinite(portsCheckedAt)
      || portsCheckedAt > issuedAtMs
      || issuedAtMs - portsCheckedAt > 5_000) {
    throw new Error("R2_ADMISSION_PORTS: all campaign registered ports are not freshly proven unbound");
  }
  const harness = harnessConfig.harnesses[cell.harness];
  if (
    artifact.harness?.key !== cell.harness
    || artifact.harness.binary !== harness.binary
    || artifact.harness.observedVersion !== harness.observedVersion
    || artifact.harness.version?.ok !== true
    || artifact.harness.auth?.ok !== true
  ) {
    throw new Error("R2_ADMISSION_HARNESS: version/auth evidence is absent or mismatched");
  }
  verifyExclusiveHostLock(artifact.exclusiveHostLock, harnessConfig, cellId);
  if (requireControllerClaim !== null) {
    assertExclusiveHostLockHeld({
      lock: artifact.exclusiveHostLock,
      harnessConfig,
      cellId,
      claim: requireControllerClaim,
    });
  }
  if (campaignState !== null && !sameJson(artifact.seriality, campaignState)) {
    throw new Error("R2_ADMISSION_SERIALITY: campaign state changed after admission");
  }
  return artifact;
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

async function bindProbe(port, host) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolvePromise(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolvePromise(true));
    });
  });
}

async function portIsUnbound(port) {
  return await bindProbe(port, "0.0.0.0") && await bindProbe(port, "::");
}

export async function probeLaunchQuiet({
  harnessConfig,
  seriality,
  repositoryRoot = REPOSITORY_ROOT,
  now = Date.now,
  processProbe = activeCampaignProcesses,
  portProbe = portIsUnbound,
  ignoredPid = process.pid,
}) {
  const processes = processProbe({
    harnessConfig,
    committedPrefix: seriality.committedPrefix,
    repositoryRoot,
    ignoredPid,
  });
  const processCheckedAt = new Date(now()).toISOString();
  if (processes.active.length > 0) {
    throw new Error(
      `R2_ADMISSION_PROCESS: campaign process evidence remains active (${processes.active.map((item) => item.pid).join(",")})`,
    );
  }
  const ports = allCampaignPorts(harnessConfig);
  const portResults = await Promise.all(ports.map((port) => portProbe(port)));
  const portsCheckedAt = new Date(now()).toISOString();
  if (portResults.some((unbound) => !unbound)) {
    throw new Error("R2_ADMISSION_PORTS: one or more campaign registered ports are bound");
  }
  return {
    priorProcessClosure: {
      scope: "campaign-private-root-cell-recorded-pid-and-isolated-process-group.v1",
      checkedAt: processCheckedAt,
      closed: true,
      recorded: processes.recorded,
      active: [],
    },
    ports: {
      scope: "all-campaign-registered-ipv4-and-ipv6-ports.v1",
      values: ports,
      checkedAt: portsCheckedAt,
      unbound: true,
    },
  };
}

function harnessEvidence(harnessKey, harness) {
  const version = spawnSync(harness.binary, ["--version"], { encoding: "utf8" });
  const versionText = `${version.stdout ?? ""}\n${version.stderr ?? ""}`;
  const authArgs = harnessKey === "codex-sol"
    ? ["login", "status"]
    : harnessKey === "claude-opus5"
      ? ["auth", "status", "--json"]
      : ["models"];
  const auth = spawnSync(harness.binary, authArgs, { encoding: "utf8" });
  const authText = `${auth.stdout ?? ""}\n${auth.stderr ?? ""}`;
  const authOk = auth.status === 0 && (
    harnessKey === "codex-sol" ? /logged in/iu.test(authText)
      : harnessKey === "claude-opus5" ? /"loggedIn"\s*:\s*true/u.test(authText)
      : !/not authenticated|log in/iu.test(authText)
  );
  return {
    key: harnessKey,
    binary: harness.binary,
    observedVersion: harness.observedVersion,
    version: { ok: version.status === 0 && versionText.includes(harness.observedVersion), argv: ["--version"] },
    auth: { ok: authOk, argv: authArgs },
  };
}

export async function createAdmissionArtifact({
  harnessConfigPath,
  cellId,
  reservedBy,
  admissionPath,
  recoverStaleLock = false,
  dependencies = {},
}) {
  const configBytes = readRegular(harnessConfigPath, "harness config");
  const harnessConfig = JSON.parse(configBytes);
  if (
    harnessConfig.status !== "serial-per-cell-admission"
    || harnessConfig.execution?.serial !== true
    || harnessConfig.execution?.maxConcurrentCells !== 1
  ) {
    throw new Error("R2_ADMISSION_SERIALITY: campaign is not in strict per-cell serial admission mode");
  }
  const cell = harnessConfig.cells.find((candidate) => candidate.id === cellId);
  if (!cell) throw new Error(`R2_ADMISSION_INVALID: unknown cell ${cellId}`);
  const repositoryRoot = dependencies.repositoryRoot ?? REPOSITORY_ROOT;
  (dependencies.assertCommittedConfig ?? assertCommittedConfig)({
    harnessConfigPath,
    configBytes,
    repositoryRoot,
    gitRead: dependencies.gitRead ?? git,
  });
  const seriality = await (dependencies.inspectSeriality ?? inspectCommittedSeriality)({
    harnessConfig,
    cellId,
    repositoryRoot,
  });
  const execution = (dependencies.configuredExecutionBinding ?? configuredExecutionBinding)({
    harnessConfig,
    cell,
    repositoryRoot,
  });
  if (
    execution.controller.sha256 !== `sha256:${harnessConfig.pins.instrument.d06MeteringOverlay.laneControllerSha256}`
    || execution.driver.sha256 !== `sha256:${harnessConfig.pins.instrument.d06MeteringOverlay.productionDriverSha256}`
  ) {
    throw new Error("R2_ADMISSION_COMMAND: live controller/driver bytes disagree with the frozen overlay pins");
  }
  const observedHostIdentity = (dependencies.currentHostIdentity ?? currentHostIdentity)(dependencies);
  const host = assertAllowedHost(harnessConfig, cell, observedHostIdentity);
  const harness = (dependencies.harnessEvidence ?? harnessEvidence)(cell.harness, harnessConfig.harnesses[cell.harness]);
  if (!harness.version.ok || !harness.auth.ok) throw new Error("R2_ADMISSION_HARNESS: version/auth probe failed");
  const instrumentPath = resolve(repositoryRoot, harnessConfig.pins.instrument.manifestPath);
  let materializedInstrument;
  try {
    materializedInstrument = (dependencies.resolveInstrument ?? resolveInstrumentArtifacts)({
      instrumentRoot: harnessConfig.paths.instrumentRoot,
      instrumentPin: harnessConfig.pins.instrument.instrumentPin,
    });
  } catch (error) {
    throw new Error(`R2_ADMISSION_INSTRUMENT: materialized snapshot is invalid: ${error.message}`);
  }

  const now = dependencies.now ?? Date.now;
  const sampleLoad = dependencies.loadavg ?? loadavg;
  const sleep = dependencies.sleep ?? ((millis) => new Promise((done) => setTimeout(done, millis)));
  const policy = loadPolicyForCell(harnessConfig, cell);
  const lock = (dependencies.acquireExclusiveHostLock ?? acquireExclusiveHostLock)({
    harnessConfig,
    cellId,
    purpose: "admission",
    reservedBy,
    nowMs: now(),
    awaitingControllerUntil: now()
      + ((policy.preStartConsecutivePassingSamples - 1) * policy.sampleEverySeconds * 1_000)
      + 120_000,
    recoverStale: recoverStaleLock,
    mayRecoverOwner: (owner) => {
      if (owner.runId !== harnessConfig.runId) return false;
      const ownerIndex = harnessConfig.cellOrder.indexOf(owner.cellId);
      if (ownerIndex >= 0 && ownerIndex < seriality.requestedIndex) {
        return seriality.committedPrefix.includes(owner.cellId);
      }
      return !existsSync(resolve(harnessConfig.paths.privateExecutionRoot, "cells", owner.cellId));
    },
  });
  try {
    const samples = [];
    for (let index = 0; index < policy.preStartConsecutivePassingSamples; index += 1) {
      if (index > 0) await sleep(policy.sampleEverySeconds * 1_000);
      const [loadavg1, loadavg5, loadavg15] = sampleLoad();
      samples.push({
        ordinal: index + 1,
        sampledAt: new Date(now()).toISOString(),
        loadavg1,
        loadavg5,
        loadavg15,
      });
    }
    const quiet = await (dependencies.probeLaunchQuiet ?? probeLaunchQuiet)({
      harnessConfig,
      seriality,
      repositoryRoot,
      now,
      processProbe: dependencies.processProbe ?? activeCampaignProcesses,
      portProbe: dependencies.portIsUnbound ?? portIsUnbound,
    });
    const issuedAtMs = now();
    const artifact = {
      version: R2_ADMISSION_VERSION,
      runId: harnessConfig.runId,
      cellId,
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(issuedAtMs + 30_000).toISOString(),
      harnessConfig: { path: resolve(harnessConfigPath), sha256: digest(configBytes) },
      controllerCommand: cell.controllerCommand,
      execution,
      registeredCell: registeredCellExpectations(harnessConfig, cell),
      instrument: {
        instrumentPin: harnessConfig.pins.instrument.instrumentPin,
        source: {
          path: instrumentPath,
          sha256: digest(readRegular(instrumentPath, "instrument manifest")),
        },
        materialized: {
          root: materializedInstrument.root,
          manifestPath: materializedInstrument.manifest.path,
          sha256: `sha256:${materializedInstrument.manifest.sha256}`,
        },
      },
      seriality,
      ...quiet,
      harness,
      host,
      exclusiveHostLock: lock,
      loadIsolation: {
        policyId: policy.policyId,
        samples,
      },
    };
    artifact.identity = { algorithm: "sha256-canonical-json-without-identity", sha256: admissionIdentity(artifact) };
    verifyAdmissionArtifact({
      artifact,
      harnessConfig,
      harnessConfigPath,
      cellId,
      admissionPath,
      nowMs: issuedAtMs,
      campaignState: seriality,
      observedHostIdentity,
      repositoryRoot,
      executionBinding: dependencies.configuredExecutionBinding ?? configuredExecutionBinding,
      resolveInstrument: dependencies.resolveInstrument ?? resolveInstrumentArtifacts,
    });
    mkdirSync(dirname(resolve(admissionPath)), { recursive: true });
    const privateCell = inspectPrivateCellPath({ harnessConfig, cellId });
    if (existsSync(privateCell.cellRoot)) {
      throw new Error("R2_ADMISSION_EXISTING_UNRECORDED_EVIDENCE: private cell appeared before admission publication");
    }
    publishAdmissionArtifact({
      admissionPath,
      artifact,
      privateCellPath: privateCell.cellRoot,
      issuedAtMs,
    });
    return artifact;
  } catch (error) {
    try {
      (dependencies.releaseExclusiveHostLock ?? releaseExclusiveHostLock)({
        lock,
        outcome: "admission-failed",
        nowMs: now(),
      });
    } catch (releaseError) {
      throw new AggregateError([error, releaseError], "admission and exclusive host-lock release failed");
    }
    throw error;
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--recover-stale-lock") {
      values.recoverStaleLock = true;
      continue;
    }
    index += 1;
    if (index >= argv.length) throw new Error(`${arg} requires a value`);
    if (arg === "--harness-config") values.harnessConfigPath = argv[index];
    else if (arg === "--cell") values.cellId = argv[index];
    else if (arg === "--reserved-by") values.reservedBy = argv[index];
    else if (arg === "--out") values.admissionPath = argv[index];
    else throw new Error(`unknown argument ${arg}`);
  }
  return values;
}

const USAGE = "node r2-cell-admission.mjs --harness-config <path> --cell <id> --reserved-by <operator> --out <admission.json> [--recover-stale-lock]";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) process.stdout.write(`${USAGE}\n`);
  else createAdmissionArtifact(options).then((artifact) => {
    process.stdout.write(`${JSON.stringify({ ok: true, cellId: artifact.cellId, sha256: artifact.identity.sha256 })}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
