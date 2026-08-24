#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { hostname, loadavg } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveInstrumentArtifacts } from "../../lane-setup.mjs";

export const R2_ADMISSION_VERSION = "snapback.r2-cell-admission.v1";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const FINAL_STATUSES = new Set(["recovered-finalized", "recorded-finalized"]);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

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

function git(args, repositoryRoot) {
  const bytes = execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: args[0] === "show" ? null : "utf8",
  });
  return Buffer.isBuffer(bytes) ? bytes : bytes.trim();
}

export function inspectCommittedSeriality({
  harnessConfig,
  cellId,
  repositoryRoot = REPOSITORY_ROOT,
  privateExists = existsSync,
  gitRead = git,
}) {
  const requestedIndex = harnessConfig.cellOrder.indexOf(cellId);
  if (requestedIndex < 0) throw new Error(`R2_ADMISSION_INVALID: unknown cell ${cellId}`);
  const committedRoot = resolve(repositoryRoot, harnessConfig.paths.committedRunRoot);
  const privateRoot = resolve(harnessConfig.paths.privateExecutionRoot);
  const committedPrefix = [];
  let firstOpen = null;
  for (const [index, id] of harnessConfig.cellOrder.entries()) {
    const slotPath = resolve(committedRoot, "cells", id, "cell.json");
    const slot = JSON.parse(readRegular(slotPath, `cell slot ${id}`).toString("utf8"));
    const recordPath = resolve(committedRoot, "cells", id, "record.json");
    const meteringPath = resolve(committedRoot, "cells", id, "metering.json");
    if (FINAL_STATUSES.has(slot.status)) {
      if (
        firstOpen !== null
        || slot.record?.path !== "record.json"
        || slot.metering?.path !== "metering.json"
        || !existsSync(recordPath)
        || !existsSync(meteringPath)
      ) {
        throw new Error(`R2_ADMISSION_SERIALITY: finalized cells must form one contiguous recorded prefix (${id})`);
      }
      committedPrefix.push(id);
      for (const absolute of [slotPath, recordPath, meteringPath]) {
        const logical = relative(repositoryRoot, absolute).split(sep).join("/");
        const committed = gitRead(["show", `HEAD:${logical}`], repositoryRoot);
        const committedBytes = Buffer.isBuffer(committed) ? committed : Buffer.from(committed);
        const worktreeBytes = readFileSync(absolute);
        if (!committedBytes.equals(worktreeBytes)) {
          throw new Error(`R2_ADMISSION_SERIALITY: ${logical} is not the exact committed HEAD artifact`);
        }
      }
    } else {
      if (firstOpen === null) firstOpen = index;
      if (slot.status !== "not-started" || existsSync(recordPath)) {
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
  const instrumentPath = resolve(REPOSITORY_ROOT, harnessConfig.pins.instrument.manifestPath);
  let materializedInstrument;
  try {
    materializedInstrument = resolveInstrumentArtifacts({
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
  assertSamples(artifact, harnessConfig.execution.loadIsolation, issuedAtMs);
  if (artifact.loadIsolation?.policyId !== harnessConfig.execution.loadIsolation.policyId) {
    throw new Error("R2_ADMISSION_LOAD: load policy identity mismatch");
  }
  if (artifact.priorProcessClosure?.closed !== true
      || artifact.priorProcessClosure.activePids?.length !== 0
      || artifact.priorProcessClosure.checkedAt !== artifact.issuedAt) {
    throw new Error("R2_ADMISSION_PROCESS: prior process tree is not closed");
  }
  const expectedPorts = Array.from(
    { length: cell.ports[1] - cell.ports[0] + 1 },
    (_, index) => cell.ports[0] + index,
  );
  if (artifact.ports?.unbound !== true
      || JSON.stringify(artifact.ports.values) !== JSON.stringify(expectedPorts)
      || artifact.ports.checkedAt !== artifact.issuedAt) {
    throw new Error("R2_ADMISSION_PORTS: exact registered port range is not unbound");
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
  const reservation = artifact.hostReservation;
  const reservedAtMs = Date.parse(reservation?.declaration?.reservedAt);
  const reservationExpiresAtMs = Date.parse(reservation?.declaration?.expiresAt);
  if (
    reservation?.declaration?.version !== "snapback.r2-host-reservation.v1"
    || reservation.declaration.runId !== harnessConfig.runId
    || reservation.declaration.cellId !== cellId
    || reservation.declaration.hostname !== hostname()
    || reservation.declaration.exclusive !== true
    || typeof reservation.declaration.reservedBy !== "string"
    || reservation.declaration.reservedBy.length === 0
    || !Number.isFinite(reservedAtMs)
    || !Number.isFinite(reservationExpiresAtMs)
    || reservedAtMs > issuedAtMs
    || reservationExpiresAtMs < Date.parse(artifact.expiresAt)
  ) {
    throw new Error("R2_ADMISSION_RESERVATION: exclusive host reservation does not cover this run/cell");
  }
  const reservationBytes = readRegular(reservation.path, "host reservation");
  if (reservation.sha256 !== digest(reservationBytes)
      || !sameJson(JSON.parse(reservationBytes), reservation.declaration)) {
    throw new Error("R2_ADMISSION_RESERVATION: host reservation bytes do not match the declaration");
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

function activePriorProcesses(priorCell, privateRoot) {
  if (priorCell === null) return [];
  const output = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  return output.split("\n").filter((line) => (
    line.includes(priorCell) || line.includes(resolve(privateRoot, "cells", priorCell))
  )).map((line) => Number.parseInt(line.trim(), 10)).filter(Number.isInteger);
}

export async function createAdmissionArtifact({
  harnessConfigPath,
  cellId,
  reservationPath,
  admissionPath,
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
  const seriality = (dependencies.inspectSeriality ?? inspectCommittedSeriality)({
    harnessConfig,
    cellId,
    repositoryRoot: dependencies.repositoryRoot ?? REPOSITORY_ROOT,
  });
  const priorCell = seriality.committedPrefix.at(-1) ?? null;
  const activePids = (dependencies.activePriorProcesses ?? activePriorProcesses)(
    priorCell,
    harnessConfig.paths.privateExecutionRoot,
  );
  if (activePids.length > 0) throw new Error("R2_ADMISSION_PROCESS: prior process tree remains active");
  const ports = Array.from({ length: cell.ports[1] - cell.ports[0] + 1 }, (_, index) => cell.ports[0] + index);
  const portResults = await Promise.all(ports.map((dependencies.portIsUnbound ?? portIsUnbound)));
  if (portResults.some((unbound) => !unbound)) throw new Error("R2_ADMISSION_PORTS: registered ports are bound");
  const reservationBytes = readRegular(reservationPath, "host reservation");
  const reservation = JSON.parse(reservationBytes);
  const harness = (dependencies.harnessEvidence ?? harnessEvidence)(cell.harness, harnessConfig.harnesses[cell.harness]);
  if (!harness.version.ok || !harness.auth.ok) throw new Error("R2_ADMISSION_HARNESS: version/auth probe failed");
  const instrumentPath = resolve(REPOSITORY_ROOT, harnessConfig.pins.instrument.manifestPath);
  let materializedInstrument;
  try {
    materializedInstrument = (dependencies.resolveInstrument ?? resolveInstrumentArtifacts)({
      instrumentRoot: harnessConfig.paths.instrumentRoot,
      instrumentPin: harnessConfig.pins.instrument.instrumentPin,
    });
  } catch (error) {
    throw new Error(`R2_ADMISSION_INSTRUMENT: materialized snapshot is invalid: ${error.message}`);
  }

  const samples = [];
  const now = dependencies.now ?? Date.now;
  const sampleLoad = dependencies.loadavg ?? loadavg;
  const sleep = dependencies.sleep ?? ((millis) => new Promise((done) => setTimeout(done, millis)));
  for (let index = 0; index < harnessConfig.execution.loadIsolation.preStartConsecutivePassingSamples; index += 1) {
    if (index > 0) await sleep(harnessConfig.execution.loadIsolation.sampleEverySeconds * 1_000);
    const [loadavg1, loadavg5, loadavg15] = sampleLoad();
    samples.push({
      ordinal: index + 1,
      sampledAt: new Date(now()).toISOString(),
      loadavg1,
      loadavg5,
      loadavg15,
    });
  }
  const issuedAtMs = now();
  const artifact = {
    version: R2_ADMISSION_VERSION,
    runId: harnessConfig.runId,
    cellId,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + 30_000).toISOString(),
    harnessConfig: { path: resolve(harnessConfigPath), sha256: digest(configBytes) },
    controllerCommand: cell.controllerCommand,
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
    priorProcessClosure: { priorCell, checkedAt: new Date(issuedAtMs).toISOString(), closed: true, activePids },
    ports: { values: ports, checkedAt: new Date(issuedAtMs).toISOString(), unbound: true },
    harness,
    hostReservation: {
      path: resolve(reservationPath),
      sha256: digest(reservationBytes),
      declaration: reservation,
    },
    loadIsolation: {
      policyId: harnessConfig.execution.loadIsolation.policyId,
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
  });
  mkdirSync(dirname(resolve(admissionPath)), { recursive: true });
  writeFileSync(resolve(admissionPath), `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  return artifact;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    index += 1;
    if (index >= argv.length) throw new Error(`${arg} requires a value`);
    if (arg === "--harness-config") values.harnessConfigPath = argv[index];
    else if (arg === "--cell") values.cellId = argv[index];
    else if (arg === "--reservation") values.reservationPath = argv[index];
    else if (arg === "--out") values.admissionPath = argv[index];
    else throw new Error(`unknown argument ${arg}`);
  }
  return values;
}

const USAGE = "node r2-cell-admission.mjs --harness-config <path> --cell <id> --reservation <host-reservation.json> --out <admission.json>";

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
