#!/usr/bin/env node

import { createHash } from "node:crypto";
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
  inspectCommittedSeriality,
  probeLaunchQuiet,
} from "./r2-cell-admission.mjs";
import {
  acquireExclusiveHostLock,
  releaseExclusiveHostLock,
} from "./r2-host-lock.mjs";
import { joinUsageToMilestones } from "./joiner.mjs";
import { loadMeteringManifest } from "./manifest.mjs";
import { composeRunRecord } from "./record-composer.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
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
  writeFileSync(nextPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
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

function publicationEvidence(record, manifest) {
  const paths = new Map();
  const add = (value) => {
    if (
      value
      && typeof value === "object"
      && typeof value.path === "string"
      && value.path.length > 0
      && !isAbsolute(value.path)
      && SHA256.test(value.sha256 ?? "")
    ) {
      const sha256 = value.sha256.startsWith("sha256:") ? value.sha256 : `sha256:${value.sha256}`;
      const prior = paths.get(value.path);
      if (prior !== undefined && prior !== sha256) {
        throw new Error(`R2_FINALIZE_REFUSAL: evidence path ${value.path} carries conflicting hashes`);
      }
      paths.set(value.path, sha256);
    }
  };
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    add(value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(manifest);
  visit(record.socialMessenger?.meteringProvenance);
  visit(record.socialMessenger?.suiteStatusLinkage);
  add(record.socialMessenger?.orientation?.instrument?.manifest);
  for (const path of ["metering-manifest.json", "record-base.json", "metering.json", "record.json"]) {
    paths.set(path, null);
  }
  return paths;
}

function makePublicationManifest(cellRoot, cellId, record, manifest) {
  const expected = publicationEvidence(record, manifest);
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
    version: "snapback.r2-publication-manifest.v1",
    cellId,
    attemptCount: 1,
    campaignCellRerun: false,
    files,
  };
}

function finalizedSlot(cellId, publication, publicationBytes) {
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

function assertOnlyResumablePublicationFiles(targetRoot, publication) {
  const allowedFiles = new Set([
    "cell.json",
    "publication-manifest.json",
    ...publication.files.map((file) => file.path),
  ]);
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

function publish({ repositoryRoot, harnessConfig, cellId, cellRoot, publication, publicationBytes }) {
  const targetRoot = resolve(repositoryRoot, harnessConfig.paths.committedRunRoot, "cells", cellId);
  const slotPath = join(targetRoot, "cell.json");
  const currentSlot = JSON.parse(readFileSync(slotPath, "utf8"));
  if (
    currentSlot.status !== "not-started"
    || currentSlot.attemptCount !== undefined
  ) {
    throw new Error("R2_FINALIZE_PUBLISH_REFUSAL: committed slot is not a pristine never-attempted cell");
  }
  // A crash may leave an exact prefix of this same publication graph beside
  // the still-not-started slot. Accept only byte-identical graph members so a
  // retry can complete atomically at cell.json without authorizing new work.
  assertOnlyResumablePublicationFiles(targetRoot, publication);
  for (const file of publication.files) {
    copyExactOrAbsent(resolve(cellRoot, file.path), resolve(targetRoot, file.path));
  }
  copyExactOrAbsent(join(cellRoot, "publication-manifest.json"), join(targetRoot, "publication-manifest.json"));
  const slot = finalizedSlot(cellId, publication, publicationBytes);
  const next = `${slotPath}.finalize-next`;
  writeFileSync(next, `${JSON.stringify(slot, null, 2)}\n`, { flag: "wx" });
  renameSync(next, slotPath);
  return { targetRoot, slot };
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
  const harnessConfig = JSON.parse(readFileSync(resolve(harnessConfigPath), "utf8"));
  const cell = harnessConfig.cells.find((candidate) => candidate.id === cellId);
  if (!cell) throw new Error(`R2_FINALIZE_REFUSAL: unknown cell ${cellId}`);
  const cellRoot = resolve(harnessConfig.paths.privateExecutionRoot, "cells", cellId);
  const attempt = JSON.parse(
    readRegular(join(cellRoot, "attempt.json"), cellRoot, "private attempt").toString("utf8"),
  );
  if (
    attempt.version !== "snapback.r2-private-cell-attempt.v1"
    || attempt.runId !== harnessConfig.runId
    || attempt.cellId !== cellId
    || attempt.attemptCount !== 1
    || attempt.campaignCellRerun !== false
  ) {
    throw new Error("R2_FINALIZE_REFUSAL: private evidence is not one exact non-rerun attempt");
  }
  const seriality = await (dependencies.inspectSeriality ?? inspectCommittedSeriality)({
    harnessConfig,
    cellId,
    repositoryRoot,
    privateExists: () => false,
  });
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
    writeExactOrAbsent(join(cellRoot, "metering.json"), meteringBytes);
    writeExactOrAbsent(join(cellRoot, "record.json"), recordBytes);
    const publication = makePublicationManifest(cellRoot, cellId, record, manifest);
    const publicationBytes = Buffer.from(`${JSON.stringify(publication, null, 2)}\n`);
    writeExactOrAbsent(join(cellRoot, "publication-manifest.json"), publicationBytes);
    const published = shouldPublish
      ? publish({ repositoryRoot, harnessConfig, cellId, cellRoot, publication, publicationBytes })
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
