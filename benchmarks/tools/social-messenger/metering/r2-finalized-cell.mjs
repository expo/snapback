import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { validateSocialMessengerRunRecord } from "../record-validator.mjs";
import { joinUsageToMilestones } from "./joiner.mjs";
import { loadMeteringManifest } from "./manifest.mjs";
import { composeRunRecord } from "./record-composer.mjs";

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

function collectDescriptors(value, found = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) collectDescriptors(item, found);
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
  for (const child of Object.values(value)) collectDescriptors(child, found);
  return found;
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

  const descriptors = collectDescriptors({ slot, record, manifest });
  descriptors.set("record.json", recordArtifact.sha256);
  descriptors.set("metering.json", meteringArtifact.sha256);
  descriptors.set("metering-manifest.json", digest(readFileSync(manifestPath)));
  descriptors.set(relative(cellRoot, resolve(slotPath)).split(sep).join("/"), digest(slotBytes));
  for (const [path, expectedSha256] of descriptors) {
    const absolute = resolve(cellRoot, path);
    const bytes = readRegular(absolute, cellRoot, `${cellId} evidence ${path}`);
    if (digest(bytes) !== expectedSha256) {
      throw new Error(`${cellId} hash-linked evidence changed at ${path}`);
    }
    const committed = committedBytes(gitRead, repositoryRoot, absolute);
    if (!committed.bytes.equals(bytes)) {
      throw new Error(`${committed.logical} is not the exact committed HEAD evidence byte sequence`);
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
