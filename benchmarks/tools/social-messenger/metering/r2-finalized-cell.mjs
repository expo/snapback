import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { validateSocialMessengerRunRecord } from "../record-validator.mjs";
import { validateCoverageManifestBytes } from "./coverage-manifest.mjs";
import { joinUsageToMilestones } from "./joiner.mjs";
import { loadMeteringManifest } from "./manifest.mjs";
import { composeRunRecord } from "./record-composer.mjs";
import { validateR2ExecutionEnvironmentPolicy } from "./r2-execution-environment.mjs";

const FINAL_STATUSES = new Set(["recovered-finalized", "recorded-finalized"]);
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/u;

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

function admissionIdentity(artifact) {
  const unsigned = structuredClone(artifact);
  delete unsigned.identity;
  return digest(JSON.stringify(canonical(unsigned)));
}

function inside(root, path) {
  const logical = relative(resolve(root), resolve(path));
  return logical === ""
    || (logical !== ".." && !logical.startsWith(`..${sep}`) && !isAbsolute(logical));
}

function readRegular(path, root, label) {
  const absolute = resolve(path);
  if (!inside(root, absolute)) throw new Error(`${label} escapes the finalized cell`);
  if (lstatSync(absolute).isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link`);
  const canonicalPath = realpathSync(absolute);
  if (!inside(realpathSync(root), canonicalPath)) throw new Error(`${label} escapes after canonical resolution`);
  if (!statSync(canonicalPath).isFile()) throw new Error(`${label} must be a regular file`);
  return readFileSync(canonicalPath);
}

function checkedDescriptor(cellRoot, descriptor, label, expectedPath = null) {
  if (
    descriptor === null
    || typeof descriptor !== "object"
    || typeof descriptor.path !== "string"
    || descriptor.path.length === 0
    || isAbsolute(descriptor.path)
    || !SHA256.test(descriptor.sha256 ?? "")
    || (expectedPath !== null && descriptor.path !== expectedPath)
  ) {
    throw new Error(`${label} must declare ${expectedPath ?? "a relative path"} and its exact SHA-256`);
  }
  const bytes = readRegular(resolve(cellRoot, descriptor.path), cellRoot, label);
  const actual = digest(bytes);
  const expected = descriptor.sha256.startsWith("sha256:")
    ? descriptor.sha256
    : `sha256:${descriptor.sha256}`;
  if (actual !== expected) {
    throw new Error(`${label} digest mismatch: expected ${expected}, received ${actual}`);
  }
  return { path: descriptor.path, bytes, sha256: actual };
}

export function collectHashDescriptors(value, found = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) collectHashDescriptors(item, found);
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  if (
    typeof value.path === "string"
    && value.path.length > 0
    && !isAbsolute(value.path)
    && SHA256.test(value.sha256 ?? "")
  ) {
    const expected = value.sha256.startsWith("sha256:")
      ? value.sha256
      : `sha256:${value.sha256}`;
    const prior = found.get(value.path);
    if (prior !== undefined && prior !== expected) {
      throw new Error(`hash-linked evidence path ${value.path} carries conflicting digests`);
    }
    found.set(value.path, expected);
  }
  for (const child of Object.values(value)) collectHashDescriptors(child, found);
  return found;
}

function normalizedDescriptorMap(files, label) {
  if (!Array.isArray(files)) throw new Error(`${label} files must be an array`);
  const found = new Map();
  for (const file of files) {
    if (
      typeof file?.path !== "string"
      || !SHA256.test(file.sha256 ?? "")
      || !Number.isInteger(file.bytes)
      || file.bytes < 0
    ) {
      throw new Error(`${label} carries an invalid file descriptor`);
    }
    const sha256 = file.sha256.startsWith("sha256:") ? file.sha256 : `sha256:${file.sha256}`;
    if (found.has(file.path)) throw new Error(`${label} repeats ${file.path}`);
    found.set(file.path, sha256);
  }
  return found;
}

function assertSameDescriptorMaps(actual, expected, label) {
  const actualEntries = [...actual].sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = [...expected].sort(([left], [right]) => left.localeCompare(right));
  if (!sameJson(actualEntries, expectedEntries)) {
    throw new Error(`${label} does not equal the complete validation-required evidence graph`);
  }
}

function configuredRegisteredCell(harnessConfig, cell) {
  const harness = harnessConfig.harnesses?.[cell.harness];
  const policy = cell.meteringPolicy;
  const exactPolicy = cell.harness === "codex-sol"
    ? ["codex", "gpt-frontier", "required"]
    : cell.harness === "claude-opus5"
      ? ["claude", "claude-frontier", "required"]
      : cell.harness === "grok-46"
        ? ["unavailable", "grok-advisory", "registered-unavailable"]
        : null;
  if (
    !harness
    || exactPolicy === null
    || !sameJson([policy?.adapter, policy?.capFamily, policy?.nativeCounts], exactPolicy)
    || (cell.harness === "grok-46" && policy?.unavailableReason !== harness.meteringUnavailableReason)
  ) {
    throw new Error(`registered cell ${cell.id} has no exact harness-native metering policy`);
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
    harnessBinary: harness?.binary,
    harnessVersion: harness?.observedVersion,
    model: cell.model,
    effort: cell.effort,
    adapter: policy?.adapter,
    capFamily: policy?.capFamily,
    nativeCounts: policy?.nativeCounts,
    unavailableReason: policy?.unavailableReason ?? null,
    allowedHostId: cell.allowedHostId,
    loadCeilingId: cell.loadCeilingId,
    controllerCommand: cell.controllerCommand,
  };
}

function sourceClosureRegistration(closure) {
  return {
    version: closure?.version,
    meteringRoot: {
      kind: closure?.meteringRoot?.kind,
      path: closure?.meteringRoot?.path,
      sha256: closure?.meteringRoot?.sha256,
    },
    files: (closure?.files ?? []).map((file) => ({
      kind: file.kind,
      path: file.path,
      sha256: file.sha256,
    })).sort((left, right) => left.path.localeCompare(right.path)),
  };
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

function validatedCoverageManifest({ cellRoot, record, manifest, expectedMilestones, cellId }) {
  const coverage = record.socialMessenger?.coverageManifest;
  const manifestCoverage = manifest.coverageManifest ?? null;
  if (coverage?.validated !== true && coverage?.sha256 === null && manifestCoverage === null) return null;
  if (coverage?.path !== "coverage-manifest.json" || coverage.validated !== true) {
    throw new Error(`${cellId} finalized coverage manifest is not validation-qualified`);
  }
  const coverageBytes = readRegular(
    resolve(cellRoot, coverage.path),
    cellRoot,
    `${cellId} coverage manifest`,
  );
  const assertion = checkedDescriptor(
    cellRoot,
    record.socialMessenger?.assertionManifest,
    `${cellId} assertion manifest`,
  );
  const validated = validateCoverageManifestBytes({
    coverageBytes,
    assertionBytes: assertion.bytes,
    expectedMilestones,
    runScope: record.socialMessenger.runScope,
    instrumentPin: record.socialMessenger.instrumentVersion,
  });
  if (
    (coverage.sha256 !== null && coverage.sha256 !== validated.sha256)
    || (manifestCoverage !== null && (
      manifestCoverage.path !== coverage.path || manifestCoverage.sha256 !== validated.sha256
    ))
  ) {
    throw new Error(`${cellId} coverage manifest digest differs from its record/manifest binding`);
  }
  return { path: coverage.path, sha256: validated.sha256 };
}

function checkedWaveConfig({ repositoryRoot, cellRoot, slot, attempt, cellId, gitRead, requireCommitted }) {
  if (slot.waveConfig !== "../../harness-config.json") {
    throw new Error(`${cellId} finalized slot does not name the registered harness config`);
  }
  const path = resolve(cellRoot, slot.waveConfig);
  if (!inside(repositoryRoot, path) || lstatSync(path).isSymbolicLink()) {
    throw new Error(`${cellId} harness config escapes the repository or is a symbolic link`);
  }
  const canonicalPath = realpathSync(path);
  if (!inside(realpathSync(repositoryRoot), canonicalPath) || !statSync(canonicalPath).isFile()) {
    throw new Error(`${cellId} harness config is not a contained regular file`);
  }
  const bytes = readFileSync(canonicalPath);
  if (requireCommitted) {
    if (typeof gitRead !== "function") throw new Error("committed validation requires a Git object reader");
    const committed = committedBytes(gitRead, repositoryRoot, canonicalPath);
    if (!committed.bytes.equals(bytes)) {
      throw new Error(`${cellId} harness config bytes differ from committed HEAD`);
    }
  }
  const config = JSON.parse(bytes.toString("utf8"));
  const cell = config.cells?.find((candidate) => candidate.id === cellId);
  if (!cell) throw new Error(`${cellId} is absent from the published harness config`);
  if (attempt.harnessConfig?.path !== canonicalPath || attempt.harnessConfig?.sha256 !== digest(bytes)) {
    throw new Error(`${cellId} attempt does not bind the exact published harness config path/bytes`);
  }
  if (!sameJson(attempt.registeredCell, configuredRegisteredCell(config, cell))) {
    throw new Error(`${cellId} attempt registration differs from its published harness cell`);
  }
  const environmentPolicy = validateR2ExecutionEnvironmentPolicy(config.execution?.environment);
  if (!sameJson(attempt.execution?.environment, environmentPolicy)) {
    throw new Error(`${cellId} attempt execution environment differs from its published harness policy`);
  }
  if (!sameJson(
    sourceClosureRegistration(attempt.execution?.sourceClosure),
    sourceClosureRegistration(config.execution?.sourceClosure),
  )) {
    throw new Error(`${cellId} attempt source closure differs from its published harness config`);
  }
  return config;
}

function assertRecordedProvenance({
  repositoryRoot,
  cellRoot,
  cellId,
  slot,
  record,
  metering,
  manifest,
  coverage,
  gitRead,
  requireCommitted,
}) {
  const publicationArtifact = checkedDescriptor(
    cellRoot,
    slot.publicationManifest,
    `${cellId} publication manifest`,
    "publication-manifest.json",
  );
  const publication = JSON.parse(publicationArtifact.bytes.toString("utf8"));
  if (
    publication.version !== "snapback.r2-publication-manifest.v2"
    || publication.cellId !== cellId
    || publication.attemptCount !== 1
    || publication.campaignCellRerun !== false
  ) {
    throw new Error(`${cellId} publication manifest is not the registered one-attempt graph`);
  }
  const expected = collectHashDescriptors({ record, manifest, provenance: publication.provenance });
  if (coverage !== null) expected.set(coverage.path, coverage.sha256);
  for (const [path, bytes] of [
    ["metering-manifest.json", readFileSync(resolve(cellRoot, "metering-manifest.json"))],
    ["record-base.json", readFileSync(resolve(cellRoot, "record-base.json"))],
    ["metering.json", Buffer.from(`${JSON.stringify(metering, null, 2)}\n`)],
    ["record.json", Buffer.from(`${JSON.stringify(record, null, 2)}\n`)],
  ]) expected.set(path, digest(bytes));
  assertSameDescriptorMaps(
    normalizedDescriptorMap(publication.files, `${cellId} publication manifest`),
    expected,
    `${cellId} publication manifest`,
  );
  for (const file of publication.files) {
    const artifact = checkedDescriptor(cellRoot, file, `${cellId} published evidence ${file.path}`);
    if (artifact.bytes.byteLength !== file.bytes) {
      throw new Error(`${cellId} publication byte count differs at ${file.path}`);
    }
  }
  const transactionArtifact = checkedDescriptor(
    cellRoot,
    slot.publicationTransaction,
    `${cellId} publication transaction`,
    "publication-transaction.json",
  );
  const transaction = JSON.parse(transactionArtifact.bytes.toString("utf8"));
  if (
    transaction.version !== "snapback.r2-publication-transaction.v1"
    || transaction.cellId !== cellId
    || transaction.publicationManifestSha256 !== publicationArtifact.sha256
    || !sameJson(transaction.files, publication.files)
    || transaction.finalSlotPath !== "cell.json"
    || transaction.finalSlotLast !== true
  ) {
    throw new Error(`${cellId} publication transaction does not bind the exact manifest and final-slot-last protocol`);
  }

  const attemptArtifact = checkedDescriptor(cellRoot, publication.provenance?.attempt, `${cellId} attempt`, "attempt.json");
  const attempt = JSON.parse(attemptArtifact.bytes.toString("utf8"));
  const admissionArtifact = checkedDescriptor(
    cellRoot,
    publication.provenance?.admission,
    `${cellId} admission provenance`,
    "provenance/admission.json",
  );
  const admission = JSON.parse(admissionArtifact.bytes.toString("utf8"));
  const ownershipStart = checkedDescriptor(
    cellRoot,
    publication.provenance?.processOwnershipStart,
    `${cellId} process ownership start`,
    "process-ownership.start.json",
  );
  const owner = checkedDescriptor(
    cellRoot,
    publication.provenance?.hostLockOwner,
    `${cellId} host lock owner`,
    "provenance/host-lock-owner.json",
  );
  const claim = checkedDescriptor(
    cellRoot,
    publication.provenance?.controllerClaim,
    `${cellId} controller claim`,
    "provenance/controller-claim.json",
  );
  const ownership = JSON.parse(ownershipStart.bytes.toString("utf8"));
  const ownershipFinalArtifact = checkedDescriptor(
    cellRoot,
    publication.provenance?.processOwnershipFinal,
    `${cellId} final process ownership`,
    "process-ownership.json",
  );
  const ownershipFinal = JSON.parse(ownershipFinalArtifact.bytes.toString("utf8"));
  const ownerValue = JSON.parse(owner.bytes.toString("utf8"));
  const claimValue = JSON.parse(claim.bytes.toString("utf8"));
  if (
    attempt.version !== "snapback.r2-private-cell-attempt.v2"
    || attempt.runId !== admission.runId
    || attempt.cellId !== cellId
    || attempt.attemptCount !== 1
    || attempt.campaignCellRerun !== false
    || attempt.state !== "one-attempt-started"
    || attempt.admission.sha256 !== admissionArtifact.sha256
    || attempt.admission.identitySha256 !== admission.identity?.sha256
    || admission.identity?.algorithm !== "sha256-canonical-json-without-identity"
    || admission.identity?.sha256 !== admissionIdentity(admission)
    || !sameJson(attempt.registeredCell, admission.registeredCell)
    || !sameJson(attempt.execution, admission.execution)
    || !sameJson(attempt.host, admission.host)
    || attempt.processOwnershipStart.sha256 !== ownershipStart.sha256
    || attempt.exclusiveHostLock.owner.sha256 !== owner.sha256
    || attempt.exclusiveHostLock.controllerClaim.sha256 !== claim.sha256
    || ownership.runId !== attempt.runId
    || ownership.cellId !== cellId
    || ownership.admissionIdentitySha256 !== admission.identity.sha256
    || ownershipFinal.version !== ownership.version
    || ownershipFinal.runId !== ownership.runId
    || ownershipFinal.cellId !== ownership.cellId
    || ownershipFinal.controllerPid !== ownership.controllerPid
    || ownershipFinal.controllerParentPid !== ownership.controllerParentPid
    || ownershipFinal.controllerKernelStartedAt !== ownership.controllerKernelStartedAt
    || ownershipFinal.controllerExecPath !== ownership.controllerExecPath
    || ownershipFinal.processGroupId !== ownership.processGroupId
    || ownershipFinal.processGroupIsolated !== ownership.processGroupIsolated
    || ownershipFinal.admissionIdentitySha256 !== ownership.admissionIdentitySha256
    || ownerValue.token !== attempt.exclusiveHostLock.token
    || claimValue.token !== attempt.exclusiveHostLock.token
    || claimValue.artifactSha256 !== admission.identity.sha256
    || claimValue.pid !== ownership.controllerPid
    || claimValue.parentPid !== ownership.controllerParentPid
  ) {
    throw new Error(`${cellId} attempt/admission/lock/process provenance graph is inconsistent`);
  }
  if (publication.provenance?.attemptFailure !== undefined) {
    const failureArtifact = checkedDescriptor(
      cellRoot,
      publication.provenance.attemptFailure,
      `${cellId} attempt failure`,
      "attempt-failure.json",
    );
    const failure = JSON.parse(failureArtifact.bytes.toString("utf8"));
    if (
      failure.version !== "snapback.r2-private-cell-attempt-failure.v1"
      || typeof failure.phase !== "string"
      || typeof failure.message !== "string"
      || !Number.isFinite(Date.parse(failure.failedAt))
      || failure.modelOrProductLaunchStarted !== Number.isInteger(ownershipFinal.nativeHarnessPid)
    ) {
      throw new Error(`${cellId} attempt-failure receipt is not consistent with process ownership`);
    }
  }
  const harnessConfig = checkedWaveConfig({
    repositoryRoot,
    cellRoot,
    slot,
    attempt,
    cellId,
    gitRead,
    requireCommitted,
  });
  const configuredCell = harnessConfig.cells.find((candidate) => candidate.id === cellId);
  const allowedMachine = harnessConfig.machines?.[configuredCell.allowedHostId];
  const expectedHost = {
    hostname: allowedMachine?.hostname,
    platform: allowedMachine?.platform,
    release: allowedMachine?.release,
    arch: allowedMachine?.arch,
    hardwareModel: allowedMachine?.hardwareModel,
    chip: allowedMachine?.chip,
    physicalCpuCount: allowedMachine?.physicalCpuCount,
    logicalCpuCount: allowedMachine?.logicalCpuCount,
    memoryBytes: allowedMachine?.memoryBytes,
  };
  const registered = attempt.registeredCell;
  const attemptStartedAt = Date.parse(attempt.timestamps?.attemptStartedAt);
  const driverStartedAt = Date.parse(manifest.driver?.startedAt);
  const nativeStartedAt = Date.parse(ownershipFinal.nativeHarnessStartedAt);
  const driverStampedAt = Date.parse(manifest.driver?.stampedAt);
  if (
    manifest.laneRunId !== registered.laneRunId
    || manifest.capFamily !== registered.capFamily
    || manifest.adapter !== registered.adapter
    || record.harness?.model !== registered.model
    || record.socialMessenger?.capFamily !== registered.capFamily
    || attempt.host?.allowedHostId !== configuredCell.allowedHostId
    || !sameJson(attempt.host?.observed, expectedHost)
    || !sameJson(admission.host, attempt.host)
    || attempt.instrument?.instrumentPin !== harnessConfig.pins.instrument.instrumentPin
    || attempt.instrument?.source?.path !== resolve(repositoryRoot, harnessConfig.pins.instrument.manifestPath)
    || attempt.instrument?.source?.sha256 !== `sha256:${harnessConfig.pins.instrument.manifestSha256}`
    || !Number.isInteger(ownershipFinal.nativeHarnessPid)
    || ownershipFinal.nativeHarnessPid <= 0
    || ownershipFinal.nativeHarness?.pid !== ownershipFinal.nativeHarnessPid
    || ownershipFinal.nativeHarness?.harnessKey !== registered.harnessKey
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
    throw new Error(`${cellId} retained manifest/record/session/process identity differs from the registered attempt`);
  }
  if (registered.nativeCounts === "required") {
    if (
      manifest.adapter === "unavailable"
      || metering.available !== true
      || metering.source === "unavailable"
      || Object.values(metering.milestones ?? {}).some((milestone) => (
        milestone.authoring?.tokens?.input === null || milestone.authoring?.tokens?.output === null
      ))
    ) {
      throw new Error(`${cellId} registered native usage is required and cannot be relabeled unavailable`);
    }
  } else if (
    registered.nativeCounts !== "registered-unavailable"
    || registered.harnessKey !== "grok-46"
    || manifest.adapter !== "unavailable"
    || manifest.sessions?.length !== 0
    || manifest.unavailableReason !== registered.unavailableReason
    || metering.available !== false
    || metering.unavailableReason !== registered.unavailableReason
    || Object.values(metering.milestones ?? {}).some((milestone) => (
      Object.values(milestone.authoring?.tokens ?? {}).some((value) => value !== null)
    ))
  ) {
    throw new Error(`${cellId} unavailable/null usage is not the exact registered Grok policy`);
  }
  return publication;
}

function committedBytes(gitRead, repositoryRoot, absolute) {
  const logical = relative(repositoryRoot, absolute).split(sep).join("/");
  let value;
  try {
    value = gitRead(["show", `HEAD:${logical}`], repositoryRoot);
  } catch (error) {
    throw new Error(`${logical} is absent from committed HEAD: ${error.message}`);
  }
  return {
    logical,
    bytes: Buffer.isBuffer(value) ? value : Buffer.from(value),
  };
}

// @ref LLP 0295#r2-load-isolated-calibration-rerun — a later cell may only
// follow a contiguous prefix whose single-attempt records and complete native
// evidence graphs replay under the same checked validator used by publication.
export async function validateFinalizedCellSlot({
  slotPath,
  cellId,
  repositoryRoot,
  expectedMilestones,
  gitRead,
  requireCommitted = true,
}) {
  const cellRoot = dirname(resolve(slotPath));
  const slotBytes = readRegular(slotPath, cellRoot, `cell slot ${cellId}`);
  const slot = JSON.parse(slotBytes.toString("utf8"));
  if (
    slot.schemaVersion !== "snapback.r2-cell-slot.v1"
    || slot.cellId !== cellId
    || !FINAL_STATUSES.has(slot.status)
    || slot.attemptCount !== 1
    || slot.campaignCellRerun !== false
  ) {
    throw new Error(`${cellId} is not an exact finalized single-attempt cell slot`);
  }
  const recordArtifact = checkedDescriptor(cellRoot, slot.record, `${cellId} record`, "record.json");
  const meteringArtifact = checkedDescriptor(cellRoot, slot.metering, `${cellId} metering`, "metering.json");
  const record = JSON.parse(recordArtifact.bytes.toString("utf8"));
  const metering = JSON.parse(meteringArtifact.bytes.toString("utf8"));
  const [baseSchema, extensionSchema, composedSchema] = [
    "benchmarks/schema/run-record.schema.json",
    "benchmarks/schema/social-messenger/run-record-extension.schema.json",
    "benchmarks/schema/social-messenger/run-record.schema.json",
  ].map((path) => JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")));
  const errors = validateSocialMessengerRunRecord(composedSchema, record, {
    schemas: [baseSchema, extensionSchema],
    artifactRoot: cellRoot,
  });
  if (errors.length > 0) {
    throw new Error(`${cellId} composed schema/native semantic replay failed: ${errors.join("; ")}`);
  }

  const manifestPath = resolve(cellRoot, "metering-manifest.json");
  const manifest = JSON.parse(readRegular(
    manifestPath,
    cellRoot,
    `${cellId} metering manifest`,
  ).toString("utf8"));
  const coverage = validatedCoverageManifest({
    cellRoot,
    record,
    manifest,
    expectedMilestones,
    cellId,
  });
  const meteringInput = await loadMeteringManifest(realpathSync(manifestPath));
  const replayedMetering = joinUsageToMilestones(meteringInput);
  if (!sameJson(metering, replayedMetering)) {
    throw new Error(`${cellId} metering.json does not equal the complete hash-bound native join replay`);
  }
  const recordBasePath = resolve(cellRoot, manifest.recordBase?.path ?? "");
  const recordBase = JSON.parse(readRegular(
    recordBasePath,
    cellRoot,
    `${cellId} record base`,
  ).toString("utf8"));
  const replayedRecord = composeRunRecord({
    base: recordBase,
    patch: replayedMetering,
    expectedMilestones,
  });
  if (!sameJson(record, replayedRecord)) {
    throw new Error(`${cellId} record.json does not equal the deterministic record composition replay`);
  }

  if (slot.status === "recorded-finalized") {
    assertRecordedProvenance({
      repositoryRoot,
      cellRoot,
      cellId,
      slot,
      record,
      metering,
      manifest,
      coverage,
      gitRead,
      requireCommitted,
    });
  }

  const descriptors = collectHashDescriptors({ slot, record, manifest });
  descriptors.set("record.json", recordArtifact.sha256);
  descriptors.set("metering.json", meteringArtifact.sha256);
  descriptors.set("metering-manifest.json", digest(readFileSync(manifestPath)));
  if (coverage !== null) descriptors.set(coverage.path, coverage.sha256);
  descriptors.set(relative(cellRoot, resolve(slotPath)).split(sep).join("/"), digest(slotBytes));
  for (const [path, expectedSha256] of descriptors) {
    const absolute = resolve(cellRoot, path);
    const bytes = readRegular(absolute, cellRoot, `${cellId} evidence ${path}`);
    if (digest(bytes) !== expectedSha256) {
      throw new Error(`${cellId} hash-linked evidence changed at ${path}`);
    }
    if (requireCommitted) {
      if (typeof gitRead !== "function") throw new Error("committed validation requires a Git object reader");
      const committed = committedBytes(gitRead, repositoryRoot, absolute);
      if (!committed.bytes.equals(bytes)) {
        throw new Error(`${committed.logical} is not the exact committed HEAD evidence byte sequence`);
      }
    }
  }
  return {
    slot,
    record,
    metering,
    evidencePaths: [...descriptors.keys()].sort(),
  };
}

export function isFinalizedStatus(status) {
  return FINAL_STATUSES.has(status);
}
