#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateSocialMessengerRunRecord } from "../record-validator.mjs";
import {
  admissionIdentity,
  allCampaignPorts,
  assertCommittedConfig,
  configuredExecutionBinding,
  currentHostIdentity,
  liveSourceClosure,
  loadPolicyForCell,
  probeLaunchQuiet,
  registeredCellExpectations,
} from "./r2-cell-admission.mjs";
import {
  acquireExclusiveHostLock,
  releaseExclusiveHostLock,
} from "./r2-host-lock.mjs";
import { joinUsageToMilestones } from "./joiner.mjs";
import { loadMeteringManifest } from "./manifest.mjs";
import { composeRunRecord } from "./record-composer.mjs";
import {
  collectHashDescriptors,
  isFinalizedStatus,
  validateFinalizedCellSlot,
} from "./r2-finalized-cell.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/u;

function git(args, repositoryRoot) {
  const value = execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: args[0] === "show" ? null : "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return Buffer.isBuffer(value) ? value : value.trim();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function inside(root, path) {
  const logical = relative(resolve(root), resolve(path));
  return logical === ""
    || (logical !== ".." && !logical.startsWith(`..${sep}`) && !isAbsolute(logical));
}

function readRegular(path, root, label) {
  const absolute = resolve(path);
  if (!inside(root, absolute)) throw new Error(`${label} escapes the private cell root`);
  if (lstatSync(absolute).isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link`);
  const canonicalPath = realpathSync(absolute);
  if (!inside(realpathSync(root), canonicalPath)) throw new Error(`${label} escapes after canonical resolution`);
  if (!statSync(canonicalPath).isFile()) throw new Error(`${label} must be a regular file`);
  return readFileSync(canonicalPath);
}

function descriptor(root, path) {
  const absolute = resolve(root, path);
  const bytes = readRegular(absolute, root, `retained artifact ${path}`);
  return { path: relative(root, absolute).split(sep).join("/"), sha256: digest(bytes) };
}

function writeExactOrAbsent(path, bytes) {
  if (existsSync(path)) {
    const existing = readFileSync(path);
    if (!existing.equals(bytes)) {
      throw new Error(`R2_FINALIZE_REFUSAL: refusing to overwrite divergent derived artifact ${path}`);
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: "wx" });
}

async function inspectFinalizationSeriality({ harnessConfig, cellId, repositoryRoot, gitRead = git }) {
  const requestedIndex = harnessConfig.cellOrder.indexOf(cellId);
  if (requestedIndex < 0) throw new Error(`R2_FINALIZE_REFUSAL: unknown cell ${cellId}`);
  const committedRoot = resolve(repositoryRoot, harnessConfig.paths.committedRunRoot);
  const committedPrefix = [];
  for (const [index, id] of harnessConfig.cellOrder.entries()) {
    const slotPath = resolve(committedRoot, "cells", id, "cell.json");
    const slot = JSON.parse(readFileSync(slotPath, "utf8"));
    const recordPath = resolve(committedRoot, "cells", id, "record.json");
    const meteringPath = resolve(committedRoot, "cells", id, "metering.json");
    if (index < requestedIndex) {
      if (!isFinalizedStatus(slot.status)) {
        throw new Error(`R2_FINALIZE_SERIALITY: prior cell ${id} is not finalized`);
      }
      await validateFinalizedCellSlot({
        slotPath,
        cellId: id,
        repositoryRoot,
        expectedMilestones: harnessConfig.execution.milestones,
        gitRead,
      });
      committedPrefix.push(id);
    } else if (index === requestedIndex) {
      if (slot.status !== "not-started" && slot.status !== "recorded-finalized") {
        throw new Error(`R2_FINALIZE_SERIALITY: target slot ${id} has an incompatible status`);
      }
    } else if (slot.status !== "not-started" || existsSync(recordPath) || existsSync(meteringPath)) {
      throw new Error(`R2_FINALIZE_SERIALITY: later slot ${id} is not pristine`);
    }
  }
  return {
    gitHead: gitRead(["rev-parse", "HEAD"], repositoryRoot),
    committedPrefix,
    requestedIndex,
    laterPristine: harnessConfig.cellOrder.slice(requestedIndex + 1),
    privateCellState: "retained-for-finalization",
  };
}

function observationSourcesFromRetainedEvidence(cellRoot, manifest) {
  const byId = new Map((manifest.observations ?? []).map((source) => [source.sourceId, source]));
  const add = (sourceId, path) => {
    if (!path) return;
    const next = descriptor(cellRoot, path);
    const source = { sourceId, ...next };
    const prior = byId.get(sourceId);
    if (prior !== undefined && !sameJson(prior, source)) {
      throw new Error(`R2_FINALIZE_REFUSAL: observation source ${sourceId} conflicts with retained bytes`);
    }
    byId.set(sourceId, source);
  };
  add(`${manifest.laneRunId}-lane-controller`, "events/lane-controller-observations.jsonl");
  if (existsSync(join(cellRoot, "events/codex-file-change-observations.jsonl"))) {
    add("codex-file-change-observations", "events/codex-file-change-observations.jsonl");
  }
  const markersPath = join(cellRoot, "events/cell-milestones.jsonl");
  if (existsSync(markersPath)) {
    const markers = readFileSync(markersPath, "utf8").split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    for (const marker of markers) {
      add(`${marker.milestone.toLowerCase()}-suite-observations`, marker.suiteObservations);
      add(`${marker.milestone.toLowerCase()}-choreography-observations`, marker.choreographyObservations);
    }
  }
  return [...byId.values()];
}

function updateManifestObservations(cellRoot, manifestPath) {
  const bytes = readRegular(manifestPath, cellRoot, "metering manifest");
  const manifest = JSON.parse(bytes.toString("utf8"));
  const observations = observationSourcesFromRetainedEvidence(cellRoot, manifest);
  if (sameJson(manifest.observations ?? [], observations)) return manifest;
  const recoveryRoot = join(cellRoot, "recovery");
  mkdirSync(recoveryRoot, { recursive: true });
  writeExactOrAbsent(join(recoveryRoot, "metering-manifest.before-finalize.json"), bytes);
  manifest.observations = observations;
  const nextPath = `${manifestPath}.finalize-next`;
  writeExactOrAbsent(nextPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  renameSync(nextPath, manifestPath);
  return manifest;
}

function schemas(repositoryRoot) {
  return [
    "benchmarks/schema/run-record.schema.json",
    "benchmarks/schema/social-messenger/run-record-extension.schema.json",
    "benchmarks/schema/social-messenger/run-record.schema.json",
  ].map((path) => JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")));
}

function checkedRetainedDescriptor(cellRoot, value, label, expectedPath) {
  if (
    value?.path !== expectedPath
    || !SHA256.test(value.sha256 ?? "")
  ) {
    throw new Error(`R2_FINALIZE_REFUSAL: ${label} descriptor is absent or changed`);
  }
  const actual = descriptor(cellRoot, expectedPath);
  const expectedSha256 = value.sha256.startsWith("sha256:") ? value.sha256 : `sha256:${value.sha256}`;
  if (actual.sha256 !== expectedSha256) {
    throw new Error(`R2_FINALIZE_REFUSAL: ${label} digest mismatch`);
  }
  return {
    ...actual,
    value: JSON.parse(readRegular(resolve(cellRoot, expectedPath), cellRoot, label).toString("utf8")),
  };
}

function assertAttemptProvenance({
  attempt,
  cellRoot,
  cell,
  harnessConfig,
  harnessConfigPath,
  configBytes,
  repositoryRoot,
  observedHostIdentity,
}) {
  const expectedCell = registeredCellExpectations(harnessConfig, cell);
  if (
    attempt.version !== "snapback.r2-private-cell-attempt.v2"
    || attempt.runId !== harnessConfig.runId
    || attempt.cellId !== cell.id
    || attempt.attemptCount !== 1
    || attempt.campaignCellRerun !== false
    || attempt.state !== "one-attempt-started"
    || !sameJson(attempt.registeredCell, expectedCell)
    || attempt.harnessConfig?.path !== resolve(harnessConfigPath)
    || attempt.harnessConfig?.sha256 !== digest(configBytes)
  ) {
    throw new Error("R2_FINALIZE_REFUSAL: private evidence is not the exact registered one-attempt capsule");
  }
  const admissionArtifact = checkedRetainedDescriptor(
    cellRoot,
    attempt.admission,
    "retained admission",
    "provenance/admission.json",
  );
  const admission = admissionArtifact.value;
  const originalAdmissionPath = resolve(attempt.admission.originalPath);
  if (lstatSync(originalAdmissionPath).isSymbolicLink() || !statSync(realpathSync(originalAdmissionPath)).isFile()) {
    throw new Error("R2_FINALIZE_REFUSAL: original admission artifact is not a regular file");
  }
  const originalAdmissionBytes = readFileSync(realpathSync(originalAdmissionPath));
  const expectedAdmissionPath = resolve(dirname(harnessConfigPath), cell.admissionArtifact);
  if (
    !originalAdmissionBytes.equals(readFileSync(resolve(cellRoot, attempt.admission.path)))
    || originalAdmissionPath !== expectedAdmissionPath
    || attempt.admission.identitySha256 !== admission.identity?.sha256
    || admission.identity?.algorithm !== "sha256-canonical-json-without-identity"
    || admission.identity?.sha256 !== admissionIdentity(admission)
    || admission.runId !== harnessConfig.runId
    || admission.cellId !== cell.id
    || !sameJson(admission.registeredCell, expectedCell)
    || !sameJson(admission.execution, attempt.execution)
    || !sameJson(admission.instrument, attempt.instrument)
    || !sameJson(admission.host, attempt.host)
    || !sameJson(admission.controllerCommand, cell.controllerCommand)
    || admission.harnessConfig?.sha256 !== digest(configBytes)
    || admission.harnessConfig?.path !== resolve(harnessConfigPath)
  ) {
    throw new Error("R2_FINALIZE_REFUSAL: admission identity/bytes/config/host/execution provenance mismatch");
  }
  const liveExecution = configuredExecutionBinding({ harnessConfig, cell, repositoryRoot });
  if (!sameJson(liveExecution, attempt.execution)) {
    throw new Error("R2_FINALIZE_REFUSAL: executing source/config closure changed since the admitted attempt");
  }
  const expectedActualExecution = {
    execPath: liveExecution.node.path,
    cwd: liveExecution.cwd,
    controllerPath: liveExecution.controller.path,
    driverPath: liveExecution.driver.path,
    argv: liveExecution.argv,
  };
  const harness = harnessConfig.harnesses?.[cell.harness];
  const instrumentManifestPath = resolve(repositoryRoot, harnessConfig.pins.instrument.manifestPath);
  const instrumentManifestBytes = readRegular(
    instrumentManifestPath,
    repositoryRoot,
    "registered instrument manifest",
  );
  const materializedManifestPath = resolve(attempt.instrument?.materialized?.manifestPath ?? "");
  const materializedRoot = resolve(attempt.instrument?.materialized?.root ?? "");
  if (
    admission.harness?.key !== cell.harness
    || admission.harness?.binary !== harness?.binary
    || admission.harness?.observedVersion !== harness?.observedVersion
    || admission.harness?.version?.ok !== true
    || admission.harness?.auth?.ok !== true
    || attempt.instrument?.instrumentPin !== harnessConfig.pins.instrument.instrumentPin
    || attempt.instrument?.source?.path !== instrumentManifestPath
    || attempt.instrument?.source?.sha256 !== digest(instrumentManifestBytes)
    || attempt.instrument.source.sha256 !== `sha256:${harnessConfig.pins.instrument.manifestSha256}`
    || !inside(materializedRoot, materializedManifestPath)
    || digest(readRegular(materializedManifestPath, materializedRoot, "materialized instrument manifest"))
      !== attempt.instrument?.materialized?.sha256
    || attempt.instrument.materialized.sha256 !== attempt.instrument.source.sha256
  ) {
    throw new Error("R2_FINALIZE_REFUSAL: retained harness/instrument provenance differs from the registered configuration");
  }
  const expectedMachine = harnessConfig.machines?.[cell.allowedHostId];
  const expectedHost = {
    hostname: expectedMachine?.hostname,
    platform: expectedMachine?.platform,
    release: expectedMachine?.release,
    arch: expectedMachine?.arch,
    hardwareModel: expectedMachine?.hardwareModel,
    chip: expectedMachine?.chip,
    physicalCpuCount: expectedMachine?.physicalCpuCount,
    logicalCpuCount: expectedMachine?.logicalCpuCount,
    memoryBytes: expectedMachine?.memoryBytes,
  };
  if (
    attempt.host?.allowedHostId !== cell.allowedHostId
    || !sameJson(attempt.host.observed, expectedHost)
    || !sameJson(observedHostIdentity, expectedHost)
  ) {
    throw new Error("R2_FINALIZE_REFUSAL: retained or live finalization host differs from the registered allowed host");
  }
  const issuedAt = Date.parse(admission.issuedAt);
  const expiresAt = Date.parse(admission.expiresAt);
  const loadPolicy = loadPolicyForCell(harnessConfig, cell);
  const samples = admission.loadIsolation?.samples;
  if (
    admission.version !== "snapback.r2-cell-admission.v2"
    || expiresAt - issuedAt !== 30_000
    || admission.loadIsolation?.policyId !== loadPolicy.policyId
    || !Array.isArray(samples)
    || samples.length !== loadPolicy.preStartConsecutivePassingSamples
    || samples.some((sample, index) => (
      sample.ordinal !== index + 1
      || !Number.isFinite(Date.parse(sample.sampledAt))
      || loadPolicy.metrics.some((metric) => (
        typeof sample[metric] !== "number" || sample[metric] > loadPolicy.ceilingInclusive[metric]
      ))
      || (index > 0 && (
        Date.parse(sample.sampledAt) - Date.parse(samples[index - 1].sampledAt)
          < loadPolicy.sampleEverySeconds * 1_000
        || Date.parse(sample.sampledAt) - Date.parse(samples[index - 1].sampledAt)
          > loadPolicy.sampleEverySeconds * 1_000 + 5_000
      ))
    ))
    || issuedAt - Date.parse(samples.at(-1)?.sampledAt) < 0
    || issuedAt - Date.parse(samples.at(-1)?.sampledAt) > 30_000
    || admission.priorProcessClosure?.closed !== true
    || admission.priorProcessClosure?.active?.length !== 0
    || admission.ports?.unbound !== true
    || !sameJson(admission.ports?.values, allCampaignPorts(harnessConfig))
  ) {
    throw new Error("R2_FINALIZE_REFUSAL: retained admission lacks exact load/process/port pre-launch evidence");
  }
  const ownershipStart = checkedRetainedDescriptor(
    cellRoot,
    attempt.processOwnershipStart,
    "process ownership start",
    "process-ownership.start.json",
  ).value;
  const owner = checkedRetainedDescriptor(
    cellRoot,
    attempt.exclusiveHostLock.owner,
    "host lock owner",
    "provenance/host-lock-owner.json",
  ).value;
  const claim = checkedRetainedDescriptor(
    cellRoot,
    attempt.exclusiveHostLock.controllerClaim,
    "controller lock claim",
    "provenance/controller-claim.json",
  ).value;
  const ownershipFinal = JSON.parse(readRegular(
    resolve(cellRoot, "process-ownership.json"),
    cellRoot,
    "final process ownership",
  ));
  const ownerCreatedAt = Date.parse(owner.createdAt);
  const claimedAt = Date.parse(claim.claimedAt);
  const attemptedAt = Date.parse(attempt.timestamps?.attemptStartedAt);
  if (
    admission.exclusiveHostLock?.version !== attempt.exclusiveHostLock.version
    || admission.exclusiveHostLock?.token !== attempt.exclusiveHostLock.token
    || admission.exclusiveHostLock?.owner?.sha256 !== attempt.exclusiveHostLock.owner.sha256
    || !sameJson(admission.exclusiveHostLock?.owner?.declaration, owner)
    || owner.version !== "snapback.r2-exclusive-host-lock.v1"
    || owner.runId !== harnessConfig.runId
    || owner.cellId !== cell.id
    || owner.purpose !== "admission"
    || owner.token !== attempt.exclusiveHostLock.token
    || claim.version !== "snapback.r2-exclusive-host-lock-claim.v1"
    || claim.token !== attempt.exclusiveHostLock.token
    || claim.artifactSha256 !== admission.identity.sha256
    || claim.runId !== harnessConfig.runId
    || claim.cellId !== cell.id
    || !sameJson(claim.execution, expectedActualExecution)
    || ownershipStart.version !== "snapback.r2-process-ownership.v2"
    || ownershipStart.runId !== harnessConfig.runId
    || ownershipStart.cellId !== cell.id
    || ownershipStart.admissionIdentitySha256 !== admission.identity.sha256
    || ownershipStart.controllerPid !== claim.pid
    || ownershipStart.controllerParentPid !== claim.parentPid
    || ownershipStart.controllerExecPath !== liveExecution.node.path
    || ownershipStart.startedAt !== attempt.timestamps?.attemptStartedAt
    || ownershipFinal.version !== ownershipStart.version
    || ownershipFinal.runId !== ownershipStart.runId
    || ownershipFinal.cellId !== ownershipStart.cellId
    || ownershipFinal.controllerParentPid !== ownershipStart.controllerParentPid
    || ownershipFinal.controllerExecPath !== ownershipStart.controllerExecPath
    || ownershipFinal.processGroupId !== ownershipStart.processGroupId
    || ownershipFinal.processGroupIsolated !== ownershipStart.processGroupIsolated
    || ownershipFinal.admissionIdentitySha256 !== ownershipStart.admissionIdentitySha256
    || ownershipFinal.controllerPid !== ownershipStart.controllerPid
    || ownershipFinal.controllerKernelStartedAt !== ownershipStart.controllerKernelStartedAt
    || attempt.timestamps?.admissionIssuedAt !== admission.issuedAt
    || attempt.timestamps?.controllerClaimedAt !== claim.claimedAt
    || !Number.isFinite(ownerCreatedAt)
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(claimedAt)
    || !Number.isFinite(attemptedAt)
    || ownerCreatedAt > issuedAt
    || issuedAt > claimedAt
    || claimedAt > attemptedAt
  ) {
    throw new Error("R2_FINALIZE_REFUSAL: controller lock/timestamp/process ownership graph is inconsistent");
  }
  return { admission, ownershipFinal };
}

function retainedSessionOwnership(manifest) {
  return (manifest.sessions ?? []).map((candidate) => ({
    sourceId: candidate.sourceId,
    parentSourceId: candidate.parentSourceId,
    role: candidate.role,
    nativeSessionId: candidate.nativeSessionId,
    nativeAgentId: candidate.nativeAgentId ?? null,
  }));
}

function assertRetainedCellIdentity({
  harnessConfig,
  cell,
  attempt,
  ownershipFinal,
  manifest,
  base,
  metering,
  record,
}) {
  const expected = registeredCellExpectations(harnessConfig, cell);
  const attemptStartedAt = Date.parse(attempt.timestamps?.attemptStartedAt);
  const driverStartedAt = Date.parse(manifest.driver?.startedAt);
  const nativeStartedAt = Date.parse(ownershipFinal.nativeHarnessStartedAt);
  const driverStampedAt = Date.parse(manifest.driver?.stampedAt);
  if (
    manifest.laneRunId !== expected.laneRunId
    || manifest.driver?.id !== "social-messenger-r2-native-cli-driver.v1"
    || manifest.capFamily !== expected.capFamily
    || manifest.adapter !== expected.adapter
    || base.harness?.model !== expected.model
    || record.harness?.model !== expected.model
    || base.socialMessenger?.capFamily !== expected.capFamily
    || record.socialMessenger?.capFamily !== expected.capFamily
    || !sameJson(attempt.registeredCell, expected)
    || !Number.isInteger(ownershipFinal.nativeHarnessPid)
    || ownershipFinal.nativeHarnessPid <= 0
    || ownershipFinal.nativeHarness?.pid !== ownershipFinal.nativeHarnessPid
    || ownershipFinal.nativeHarness?.harnessKey !== expected.harnessKey
    || ownershipFinal.nativeHarness?.adapter !== manifest.adapter
    || !sameJson(ownershipFinal.nativeHarness?.sessions, retainedSessionOwnership(manifest))
    || ownershipFinal.nativeHarness?.driverStartedAt !== manifest.driver.startedAt
    || ownershipFinal.nativeHarness?.driverStampedAt !== manifest.driver.stampedAt
    || ownershipFinal.updatedAt !== manifest.driver.stampedAt
    || !Number.isFinite(attemptStartedAt)
    || !Number.isFinite(driverStartedAt)
    || !Number.isFinite(nativeStartedAt)
    || !Number.isFinite(driverStampedAt)
    || attemptStartedAt > driverStartedAt
    || driverStartedAt > nativeStartedAt
    || nativeStartedAt > driverStampedAt
  ) {
    throw new Error("R2_FINALIZE_REFUSAL: retained manifest/record/driver/lane/session/process identity differs from the registered attempt");
  }
  if (expected.nativeCounts === "required") {
    if (
      manifest.adapter === "unavailable"
      || !Array.isArray(manifest.sessions)
      || manifest.sessions.length === 0
      || metering.available !== true
      || metering.source === "unavailable"
      || Object.values(metering.milestones ?? {}).some((milestone) => (
        milestone.authoring?.tokens?.input === null || milestone.authoring?.tokens?.output === null
      ))
    ) {
      throw new Error("R2_FINALIZE_REFUSAL: required native token counts/session evidence are missing");
    }
  } else if (
    expected.nativeCounts !== "registered-unavailable"
    || expected.harnessKey !== "grok-46"
    || manifest.adapter !== "unavailable"
    || manifest.sessions.length !== 0
    || manifest.unavailableReason !== expected.unavailableReason
    || metering.available !== false
    || metering.unavailableReason !== expected.unavailableReason
    || Object.values(metering.milestones ?? {}).some((milestone) => (
      Object.values(milestone.authoring?.tokens ?? {}).some((value) => value !== null)
    ))
  ) {
    throw new Error("R2_FINALIZE_REFUSAL: unavailable/null counts are not the exact registered Grok path");
  }
}

function publicationEvidence(record, manifest, provenance) {
  const paths = collectHashDescriptors({ record, manifest, provenance });
  for (const path of ["metering-manifest.json", "record-base.json", "metering.json", "record.json"]) {
    paths.set(path, null);
  }
  return paths;
}

function publicationProvenance(cellRoot, attempt) {
  return {
    attempt: descriptor(cellRoot, "attempt.json"),
    admission: descriptor(cellRoot, attempt.admission.path),
    processOwnershipStart: descriptor(cellRoot, attempt.processOwnershipStart.path),
    processOwnershipFinal: descriptor(cellRoot, "process-ownership.json"),
    hostLockOwner: descriptor(cellRoot, attempt.exclusiveHostLock.owner.path),
    controllerClaim: descriptor(cellRoot, attempt.exclusiveHostLock.controllerClaim.path),
    ...(existsSync(join(cellRoot, "attempt-failure.json"))
      ? { attemptFailure: descriptor(cellRoot, "attempt-failure.json") }
      : {}),
  };
}

function makePublicationManifest(cellRoot, cellId, record, manifest, attempt) {
  const provenance = publicationProvenance(cellRoot, attempt);
  const expected = publicationEvidence(record, manifest, provenance);
  const files = [];
  for (const [path, registeredSha256] of [...expected].sort(([left], [right]) => left.localeCompare(right))) {
    const value = descriptor(cellRoot, path);
    if (registeredSha256 !== null && value.sha256 !== registeredSha256) {
      throw new Error(`R2_FINALIZE_REFUSAL: validation evidence ${path} differs from its registered digest`);
    }
    const bytes = readFileSync(resolve(cellRoot, path));
    files.push({ ...value, bytes: bytes.byteLength });
  }
  return {
    version: "snapback.r2-publication-manifest.v2",
    cellId,
    attemptCount: 1,
    campaignCellRerun: false,
    provenance,
    files,
  };
}

function finalizedSlot(cellId, publication, publicationBytes, transactionDescriptor) {
  const byPath = new Map(publication.files.map((file) => [file.path, file]));
  return {
    schemaVersion: "snapback.r2-cell-slot.v1",
    cellId,
    status: "recorded-finalized",
    attemptCount: 1,
    campaignCellRerun: false,
    waveConfig: "../../harness-config.json",
    recordOutput: "record.json",
    recordSchema: "../../../../schema/social-messenger/run-record.schema.json",
    checkedValidator: "../../../../tools/social-messenger/record-validator.mjs",
    record: { path: "record.json", sha256: byPath.get("record.json").sha256 },
    metering: { path: "metering.json", sha256: byPath.get("metering.json").sha256 },
    publicationManifest: {
      path: "publication-manifest.json",
      sha256: digest(publicationBytes),
    },
    publicationTransaction: transactionDescriptor,
  };
}

function copyExactOrAbsent(source, destination) {
  const bytes = readFileSync(source);
  if (existsSync(destination)) {
    if (!readFileSync(destination).equals(bytes)) {
      throw new Error(`R2_FINALIZE_PUBLISH_REFUSAL: target artifact differs at ${destination}`);
    }
    return;
  }
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
}

function assertNoSymlinkAncestors(root, path, label) {
  const logical = relative(root, path);
  if (logical === "" || logical === ".") return;
  let cursor = root;
  for (const segment of logical.split(sep).slice(0, -1)) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) continue;
    if (lstatSync(cursor).isSymbolicLink() || !statSync(cursor).isDirectory()) {
      throw new Error(`R2_FINALIZE_PUBLISH_REFUSAL: ${label} has a non-directory or symbolic-link ancestor`);
    }
  }
}

function assertOnlyResumablePublicationFiles(targetRoot, allowedFiles) {
  const allowedDirectories = new Set();
  for (const path of allowedFiles) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      allowedDirectories.add(segments.slice(0, index).join("/"));
    }
  }
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const logical = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = join(directory, entry.name);
      if (lstatSync(absolute).isSymbolicLink()) {
        throw new Error(`R2_FINALIZE_PUBLISH_REFUSAL: target contains a symbolic link at ${logical}`);
      }
      if (entry.isDirectory()) {
        if (!allowedDirectories.has(logical)) {
          throw new Error(`R2_FINALIZE_PUBLISH_REFUSAL: target contains unrelated directory ${logical}`);
        }
        visit(absolute, logical);
      } else if (!entry.isFile() || !allowedFiles.has(logical)) {
        throw new Error(`R2_FINALIZE_PUBLISH_REFUSAL: target contains unrelated artifact ${logical}`);
      }
    }
  };
  visit(targetRoot);
}

function canonicalPublicationTarget(repositoryRoot, harnessConfig, cellId) {
  const runRoot = resolve(repositoryRoot, harnessConfig.paths.committedRunRoot);
  if (!inside(repositoryRoot, runRoot) || lstatSync(runRoot).isSymbolicLink()) {
    throw new Error("R2_FINALIZE_PUBLISH_REFUSAL: registered run root escapes the repository or is a symlink");
  }
  const canonicalRepository = realpathSync(repositoryRoot);
  const canonicalRunRoot = realpathSync(runRoot);
  if (!inside(canonicalRepository, canonicalRunRoot)) {
    throw new Error("R2_FINALIZE_PUBLISH_REFUSAL: registered run root escapes after canonical resolution");
  }
  const cellsRoot = resolve(runRoot, "cells");
  const targetRoot = resolve(cellsRoot, cellId);
  if (
    !inside(canonicalRunRoot, realpathSync(cellsRoot))
    || !inside(realpathSync(cellsRoot), realpathSync(targetRoot))
    || lstatSync(cellsRoot).isSymbolicLink()
    || lstatSync(targetRoot).isSymbolicLink()
  ) {
    throw new Error("R2_FINALIZE_PUBLISH_REFUSAL: cell target is not canonically contained in the registered run root");
  }
  return targetRoot;
}

function expectedPublicationTargets({ cellRoot, publication, publicationBytes, transactionBytes, slotBytes }) {
  const expected = new Map(publication.files.map((file) => [file.path, readFileSync(resolve(cellRoot, file.path))]));
  expected.set("publication-manifest.json", publicationBytes);
  expected.set("publication-transaction.json", transactionBytes);
  expected.set("cell.json.finalize-next", slotBytes);
  return expected;
}

function preflightPublicationTargets({ targetRoot, expected, slotBytes }) {
  const slotPath = join(targetRoot, "cell.json");
  if (lstatSync(slotPath).isSymbolicLink()) {
    throw new Error("R2_FINALIZE_PUBLISH_REFUSAL: committed cell slot cannot be a symbolic link");
  }
  const currentSlotBytes = readFileSync(slotPath);
  const currentSlot = JSON.parse(currentSlotBytes.toString("utf8"));
  if (
    !(currentSlot.status === "not-started" && currentSlot.attemptCount === undefined)
    && !currentSlotBytes.equals(slotBytes)
  ) {
    throw new Error("R2_FINALIZE_PUBLISH_REFUSAL: committed slot is neither pristine nor this exact finalized transaction");
  }
  const allowedFiles = new Set(["cell.json", ...expected.keys()]);
  assertOnlyResumablePublicationFiles(targetRoot, allowedFiles);
  for (const [logical, bytes] of expected) {
    const absolute = resolve(targetRoot, logical);
    if (!inside(targetRoot, absolute)) {
      throw new Error(`R2_FINALIZE_PUBLISH_REFUSAL: publication target escapes at ${logical}`);
    }
    assertNoSymlinkAncestors(targetRoot, absolute, logical);
    if (existsSync(absolute)) {
      if (lstatSync(absolute).isSymbolicLink() || !statSync(absolute).isFile()) {
        throw new Error(`R2_FINALIZE_PUBLISH_REFUSAL: publication target is not a regular file at ${logical}`);
      }
      if (!readFileSync(absolute).equals(bytes)) {
        throw new Error(`R2_FINALIZE_PUBLISH_REFUSAL: target artifact differs at ${logical}`);
      }
    }
  }
  return { alreadyFinalized: currentSlotBytes.equals(slotBytes), slotPath };
}

async function publish({
  repositoryRoot,
  harnessConfig,
  cellId,
  cellRoot,
  publication,
  publicationBytes,
  afterStep = async () => {},
}) {
  const transaction = {
    version: "snapback.r2-publication-transaction.v1",
    cellId,
    publicationManifestSha256: digest(publicationBytes),
    files: publication.files,
    finalSlotPath: "cell.json",
    finalSlotLast: true,
  };
  const transactionBytes = Buffer.from(`${JSON.stringify(transaction, null, 2)}\n`);
  writeExactOrAbsent(join(cellRoot, "publication-transaction.json"), transactionBytes);
  const transactionDescriptor = {
    path: "publication-transaction.json",
    sha256: digest(transactionBytes),
  };
  const slot = finalizedSlot(cellId, publication, publicationBytes, transactionDescriptor);
  const slotBytes = Buffer.from(`${JSON.stringify(slot, null, 2)}\n`);
  const targetRoot = canonicalPublicationTarget(repositoryRoot, harnessConfig, cellId);
  const expected = expectedPublicationTargets({
    cellRoot,
    publication,
    publicationBytes,
    transactionBytes,
    slotBytes,
  });

  // Validate every existing destination before the transaction creates even
  // its first target byte. A divergent later leaf therefore cannot leave an
  // otherwise-absent earlier leaf behind.
  const preflight = preflightPublicationTargets({ targetRoot, expected, slotBytes });
  if (!preflight.alreadyFinalized) {
    for (const [logical] of expected) {
      if (logical === "cell.json.finalize-next") continue;
      copyExactOrAbsent(resolve(cellRoot, logical), resolve(targetRoot, logical));
      await afterStep(`copy:${logical}`);
    }
    const next = `${preflight.slotPath}.finalize-next`;
    writeExactOrAbsent(next, slotBytes);
    await afterStep("slot:finalize-next");
    renameSync(next, preflight.slotPath);
    await afterStep("slot:finalized-last");
  }
  const validated = await validateFinalizedCellSlot({
    slotPath: preflight.slotPath,
    cellId,
    repositoryRoot,
    expectedMilestones: harnessConfig.execution.milestones,
    requireCommitted: false,
  });
  return { targetRoot, slot, validated };
}

// @ref LLP 0295#r2-load-isolated-calibration-rerun — existing single-attempt
// private evidence is finalized without prepare(), production-driver import,
// or a model/product launch; missing native counts or graph leaves are fatal.
export async function finalizeExisting({
  harnessConfigPath,
  cellId,
  publish: shouldPublish = false,
  recoverStaleLock = false,
  reservedBy = "r2-finalize-existing",
  dependencies = {},
}) {
  const repositoryRoot = resolve(dependencies.repositoryRoot ?? REPOSITORY_ROOT);
  const absoluteConfigPath = resolve(harnessConfigPath);
  const configBytes = readFileSync(absoluteConfigPath);
  const harnessConfig = JSON.parse(configBytes.toString("utf8"));
  (dependencies.assertCommittedConfig ?? assertCommittedConfig)({
    harnessConfigPath: absoluteConfigPath,
    configBytes,
    repositoryRoot,
    gitRead: dependencies.gitRead ?? git,
  });
  liveSourceClosure({ harnessConfig, repositoryRoot });
  const cell = harnessConfig.cells.find((candidate) => candidate.id === cellId);
  if (!cell) throw new Error(`R2_FINALIZE_REFUSAL: unknown cell ${cellId}`);
  const cellRoot = resolve(harnessConfig.paths.privateExecutionRoot, "cells", cellId);
  if (
    !inside(resolve(harnessConfig.paths.privateExecutionRoot), cellRoot)
    || lstatSync(cellRoot).isSymbolicLink()
  ) {
    throw new Error("R2_FINALIZE_REFUSAL: private cell is not canonically contained in the registered private root");
  }
  const attempt = JSON.parse(
    readRegular(join(cellRoot, "attempt.json"), cellRoot, "private attempt").toString("utf8"),
  );
  const observedHostIdentity = (dependencies.currentHostIdentity ?? currentHostIdentity)(dependencies);
  const provenance = assertAttemptProvenance({
    attempt,
    cellRoot,
    cell,
    harnessConfig,
    harnessConfigPath: absoluteConfigPath,
    configBytes,
    repositoryRoot,
    observedHostIdentity,
  });
  const seriality = await (dependencies.inspectSeriality ?? inspectFinalizationSeriality)({
    harnessConfig,
    cellId,
    repositoryRoot,
    gitRead: dependencies.gitRead ?? git,
  });
  if (
    provenance.admission.seriality?.gitHead !== seriality.gitHead
    || !sameJson(provenance.admission.seriality?.committedPrefix, seriality.committedPrefix)
    || provenance.admission.seriality?.requestedIndex !== seriality.requestedIndex
    || !sameJson(provenance.admission.seriality?.laterPristine, seriality.laterPristine)
    || provenance.admission.seriality?.privateCellState !== "absent"
  ) {
    throw new Error("R2_FINALIZE_REFUSAL: retained admission did not authorize this exact serial campaign transition");
  }
  const lock = (dependencies.acquireExclusiveHostLock ?? acquireExclusiveHostLock)({
    harnessConfig,
    cellId,
    purpose: "finalize-existing",
    reservedBy,
    recoverStale: recoverStaleLock,
    mayRecoverOwner: (owner) => owner.runId === harnessConfig.runId && owner.cellId === cellId,
  });
  let outcome = "finalize-existing-failed";
  try {
    await (dependencies.probeLaunchQuiet ?? probeLaunchQuiet)({
      harnessConfig,
      seriality,
      processProbe: dependencies.processProbe,
      portProbe: dependencies.portProbe,
    });
    // No derived/private or publication write occurs until the finalizer has
    // rebound the exact executing closure immediately after the quiet probe.
    liveSourceClosure({ harnessConfig, repositoryRoot });
    const manifestPath = join(cellRoot, "metering-manifest.json");
    const manifest = updateManifestObservations(cellRoot, manifestPath);
    const metering = joinUsageToMilestones(await loadMeteringManifest(realpathSync(manifestPath)));
    const meteringBytes = Buffer.from(`${JSON.stringify(metering, null, 2)}\n`);
    const base = JSON.parse(readRegular(
      resolve(cellRoot, manifest.recordBase?.path ?? ""),
      cellRoot,
      "record base",
    ).toString("utf8"));
    const record = composeRunRecord({ base, patch: metering, expectedMilestones: harnessConfig.execution.milestones });
    const recordBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    const [baseSchema, extensionSchema, composedSchema] = schemas(repositoryRoot);
    const errors = validateSocialMessengerRunRecord(composedSchema, record, {
      schemas: [baseSchema, extensionSchema],
      artifactRoot: cellRoot,
    });
    if (errors.length > 0) {
      throw new Error(`R2_FINALIZE_REFUSAL: derived record is not validator-clean: ${errors.join("; ")}`);
    }
    assertRetainedCellIdentity({
      harnessConfig,
      cell,
      attempt,
      ownershipFinal: provenance.ownershipFinal,
      manifest,
      base,
      metering,
      record,
    });
    writeExactOrAbsent(join(cellRoot, "metering.json"), meteringBytes);
    writeExactOrAbsent(join(cellRoot, "record.json"), recordBytes);
    const publication = makePublicationManifest(cellRoot, cellId, record, manifest, attempt);
    const publicationBytes = Buffer.from(`${JSON.stringify(publication, null, 2)}\n`);
    writeExactOrAbsent(join(cellRoot, "publication-manifest.json"), publicationBytes);
    const published = shouldPublish
      ? await publish({
        repositoryRoot,
        harnessConfig,
        cellId,
        cellRoot,
        publication,
        publicationBytes,
        afterStep: dependencies.afterPublicationStep,
      })
      : null;
    outcome = published === null ? "validator-clean-publication-manifest" : "published-finalized-cell";
    return {
      ok: true,
      cellId,
      record: descriptor(cellRoot, "record.json"),
      metering: descriptor(cellRoot, "metering.json"),
      publicationManifest: descriptor(cellRoot, "publication-manifest.json"),
      published: published !== null,
    };
  } finally {
    (dependencies.releaseExclusiveHostLock ?? releaseExclusiveHostLock)({ lock, outcome });
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--publish") {
      options.publish = true;
      continue;
    }
    if (arg === "--recover-stale-lock") {
      options.recoverStaleLock = true;
      continue;
    }
    index += 1;
    if (index >= argv.length) throw new Error(`${arg} requires a value`);
    if (arg === "--harness-config") options.harnessConfigPath = argv[index];
    else if (arg === "--cell") options.cellId = argv[index];
    else if (arg === "--reserved-by") options.reservedBy = argv[index];
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

const USAGE = "node r2-finalize-existing.mjs --harness-config <path> --cell <id> [--publish] [--recover-stale-lock] [--reserved-by <operator>]";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) process.stdout.write(`${USAGE}\n`);
  else finalizeExisting(options).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
