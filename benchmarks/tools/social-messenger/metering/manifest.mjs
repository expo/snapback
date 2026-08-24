import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";

import { adaptClaudeSessionTree } from "./adapters/claude-session.mjs";
import { adaptCodexSessionTree } from "./adapters/codex-session.mjs";
import {
  adaptUnavailableFamily,
  assertUnavailableReason,
} from "./adapters/unavailable.mjs";
import {
  boundariesFromReceiptRecords,
  mergeBoundaryMaps,
  normalizeBoundaryMap,
} from "./boundaries.mjs";
import { parseJsonLines, timestampMillis } from "./jsonl.mjs";
import {
  observationLaneRunIdMatches,
  parseObservationJsonLines,
} from "./observations.mjs";
import { assertCapFamily } from "./sources.mjs";
import { validateJsonSchema } from "../../lib/json-schema.mjs";

const MANIFEST_VERSION = "social-messenger-metering-manifest.v1";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MILESTONE = /^M[1-8]$/u;
const CURRENT_CHOREOGRAPHY_VERSION = "0.3.3-m8";
const RECEIPT_SCHEMA = JSON.parse(readFileSync(
  new URL("../choreography/receipts.schema.json", import.meta.url),
  "utf8",
));

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function artifactPath(manifestDirectory, value, label) {
  const relative = requiredString(value, `${label}.path`);
  if (isAbsolute(relative)) {
    throw new TypeError(`${label}.path must be relative to the lane manifest`);
  }
  const normalized = normalize(relative);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new TypeError(`${label}.path must stay within the manifest directory`);
  }
  return resolve(manifestDirectory, normalized);
}

function digest(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

async function readArtifact(manifestDirectory, artifact, label) {
  if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new TypeError(`${label} must be an artifact object`);
  }
  if (!SHA256.test(artifact.sha256)) {
    throw new TypeError(`${label}.sha256 must be a sha256:<lowercase hex> digest`);
  }
  const path = artifactPath(manifestDirectory, artifact.path, label);
  if ((await lstat(path)).isSymbolicLink()) {
    throw new Error(`${label}.path cannot be a symbolic link`);
  }
  const canonicalPath = await realpath(path);
  if (!inside(await realpath(manifestDirectory), canonicalPath)) {
    throw new Error(`${label}.path escapes the manifest directory after canonical resolution`);
  }
  const contents = await readFile(canonicalPath);
  const actual = digest(contents);
  if (actual !== artifact.sha256) {
    throw new Error(`${label} digest mismatch: expected ${artifact.sha256}, received ${actual}`);
  }
  return { path: canonicalPath, text: contents.toString("utf8"), sha256: actual };
}

function validateSessionTree(sessions, adapter) {
  if (!Array.isArray(sessions)) throw new TypeError("manifest.sessions must be an array");
  if (adapter === "unavailable" && sessions.length === 0) return;
  const byId = new Map();
  const nativeIdentities = new Set();
  for (const [index, session] of sessions.entries()) {
    const label = `manifest.sessions[${index}]`;
    const sourceId = requiredString(session?.sourceId, `${label}.sourceId`);
    if (byId.has(sourceId)) throw new Error(`duplicate session sourceId ${sourceId}`);
    if (!["builder", "builder-descendant"].includes(session.role)) {
      throw new TypeError(`${label}.role must be builder or builder-descendant`);
    }
    if (session.parentSourceId !== null && typeof session.parentSourceId !== "string") {
      throw new TypeError(`${label}.parentSourceId must be a string or null`);
    }
    requiredString(session.nativeSessionId, `${label}.nativeSessionId`);
    if (adapter === "claude" && session.nativeAgentId !== null && typeof session.nativeAgentId !== "string") {
      throw new TypeError(`${label}.nativeAgentId must be a string or null for Claude`);
    }
    const nativeIdentity = adapter === "claude"
      ? `${session.nativeSessionId}:${session.nativeAgentId ?? "builder"}`
      : session.nativeSessionId;
    if (nativeIdentities.has(nativeIdentity)) {
      throw new Error(`duplicate native session-tree identity ${nativeIdentity}`);
    }
    nativeIdentities.add(nativeIdentity);
    byId.set(sourceId, session);
  }
  const roots = sessions.filter((session) => session.parentSourceId === null);
  if (roots.length !== 1 || roots[0].role !== "builder") {
    throw new Error("session tree must contain exactly one root builder");
  }
  for (const session of sessions) {
    if (session === roots[0]) continue;
    if (session.role !== "builder-descendant" || !byId.has(session.parentSourceId)) {
      throw new Error(`session ${session.sourceId} is not connected to the root builder`);
    }
    const visited = new Set([session.sourceId]);
    let cursor = session;
    while (cursor.parentSourceId !== null) {
      if (visited.has(cursor.parentSourceId)) {
        throw new Error(`session tree contains a cycle at ${cursor.parentSourceId}`);
      }
      visited.add(cursor.parentSourceId);
      cursor = byId.get(cursor.parentSourceId);
      if (cursor === undefined) throw new Error(`unknown parent session ${session.parentSourceId}`);
    }
    if (cursor !== roots[0]) throw new Error(`session ${session.sourceId} is disconnected`);
  }
}

function validateClaudeIdentity(session, records) {
  let sawSession = false;
  for (const [index, record] of records.entries()) {
    const recordSessionId = record?.sessionId ?? record?.session_id;
    if (recordSessionId !== undefined) {
      sawSession = true;
      if (recordSessionId !== session.nativeSessionId) {
        throw new Error(
          `Claude source ${session.sourceId}:${index + 1} has sessionId ${recordSessionId}, expected ${session.nativeSessionId}`,
        );
      }
    }
    if (record?.message?.usage !== undefined) {
      const nativeAgentId = record.agentId ?? null;
      if (nativeAgentId !== session.nativeAgentId) {
        throw new Error(
          `Claude source ${session.sourceId}:${index + 1} has agentId ${nativeAgentId}, expected ${session.nativeAgentId}`,
        );
      }
    }
  }
  if (!sawSession) throw new Error(`Claude source ${session.sourceId} has no native session identity`);
}

function validateCodexIdentity(session, records) {
  const identities = new Set(records
    .filter((record) => record?.type === "session_meta")
    .map((record) => record?.payload?.id)
    .filter((value) => typeof value === "string"));
  if (identities.size !== 1 || !identities.has(session.nativeSessionId)) {
    throw new Error(
      `Codex source ${session.sourceId} does not identify native session ${session.nativeSessionId}`,
    );
  }
}

async function loadSessions(manifestDirectory, sessions, adapter) {
  const loaded = [];
  for (const session of sessions) {
    const artifact = await readArtifact(
      manifestDirectory,
      session,
      `session ${session.sourceId}`,
    );
    const records = parseJsonLines(artifact.text, artifact.path);
    if (adapter === "claude") validateClaudeIdentity(session, records);
    else validateCodexIdentity(session, records);
    loaded.push({ ...session, records, resolvedSha256: artifact.sha256 });
  }
  return loaded;
}

async function loadObservations(manifestDirectory, observations, laneRunId) {
  if (observations === undefined || observations === null) {
    return { events: [], provenance: [] };
  }
  if (!Array.isArray(observations)) {
    throw new TypeError("manifest.observations must be an array");
  }
  const sourceIds = new Set();
  const events = [];
  const provenance = [];
  for (const [index, observation] of observations.entries()) {
    const label = `manifest.observations[${index}]`;
    const sourceId = requiredString(observation?.sourceId, `${label}.sourceId`);
    if (sourceIds.has(sourceId)) throw new Error(`duplicate observation sourceId ${sourceId}`);
    sourceIds.add(sourceId);
    const artifact = await readArtifact(manifestDirectory, observation, label);
    const sourceEvents = parseObservationJsonLines(artifact.text, artifact.path);
    for (const event of sourceEvents) {
      if (!observationLaneRunIdMatches(event.laneRunId, laneRunId)) {
        throw new Error(`${label} event does not belong to laneRunId ${laneRunId}`);
      }
      event.laneRunId = laneRunId;
    }
    events.push(...sourceEvents);
    provenance.push({ sourceId, path: observation.path, sha256: artifact.sha256 });
  }
  events.sort((left, right) => (
    Date.parse(left.at) - Date.parse(right.at) || left.sequence - right.sequence
  ));
  return { events, provenance };
}

async function loadReceipts(manifestDirectory, receipts) {
  if (!Array.isArray(receipts)) throw new TypeError("manifest.receipts must be an array");
  const maps = [];
  const provenance = [];
  const milestones = new Set();
  const sourceIds = new Set();
  const greenAttestations = new Map();
  for (const [index, receipt] of receipts.entries()) {
    const label = `manifest.receipts[${index}]`;
    const sourceId = requiredString(receipt?.sourceId, `${label}.sourceId`);
    if (sourceIds.has(sourceId)) throw new Error(`duplicate receipt sourceId ${sourceId}`);
    sourceIds.add(sourceId);
    const runId = requiredString(receipt?.runId, `${label}.runId`);
    if (!MILESTONE.test(receipt?.milestone)) {
      throw new TypeError(`${label}.milestone must name M1 through M8`);
    }
    const artifact = await readArtifact(manifestDirectory, receipt, label);
    const records = parseJsonLines(artifact.text, artifact.path);
    if (records.length === 0) throw new Error(`${label} is empty`);
    for (const [recordIndex, record] of records.entries()) {
      if (record?.version === CURRENT_CHOREOGRAPHY_VERSION) {
        const schemaErrors = validateJsonSchema(RECEIPT_SCHEMA, record);
        if (schemaErrors.length > 0) {
          throw new Error(
            `${label}:${recordIndex + 1} does not satisfy receipts.schema.json: ${schemaErrors.join("; ")}`,
          );
        }
        for (const [timingIndex, timing] of record.timings.entries()) {
          if (timing.settlementWaitMs > timing.durationMs) {
            throw new Error(
              `${label}:${recordIndex + 1}/timings/${timingIndex}: settlement wait exceeds complete attempt duration`,
            );
          }
        }
      }
      if (record?.runId !== runId) {
        throw new Error(`${label}:${recordIndex + 1} does not belong to runId ${runId}`);
      }
      if (
        typeof record.segment === "string"
        && record.segment.toUpperCase() !== receipt.milestone
      ) {
        throw new Error(`${label}:${recordIndex + 1} does not belong to ${receipt.milestone}`);
      }
      if (
        record?.type === "segment-summary"
        && typeof record.segment === "string"
        && record.segment.toUpperCase() === receipt.milestone
      ) {
        const attestations = greenAttestations.get(receipt.milestone) ?? [];
        attestations.push({
          version: record.version ?? null,
          green: record.green === true,
          suitePass: record.suite?.pass === true,
          suiteReceipt: record.suite?.receipt ?? null,
          suiteReceiptSha256: record.suite?.receiptSha256 ?? null,
          choreoPass: record.choreography?.pass === true,
          recordedAt: record.recordedAt ?? null,
          sourceId,
        });
        greenAttestations.set(receipt.milestone, attestations);
      }
    }
    maps.push(boundariesFromReceiptRecords(records, sourceId));
    milestones.add(receipt.milestone);
    provenance.push({
      sourceId,
      runId,
      milestone: receipt.milestone,
      path: receipt.path,
      sha256: artifact.sha256,
    });
  }
  return { maps, milestones, provenance, greenAttestations };
}

function inside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function logicalRelative(root, path) {
  return relative(resolve(root), resolve(path)).split(sep).join("/");
}

async function loadSuiteStatusLinkage(
  manifestDirectory,
  suiteStatus,
  receiptResult,
  boundaries,
) {
  if (suiteStatus === undefined || suiteStatus === null) return null;
  const artifact = await readArtifact(
    manifestDirectory,
    suiteStatus,
    "manifest.suiteStatus",
  );
  const parsed = JSON.parse(artifact.text);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new TypeError("manifest.suiteStatus must contain an object keyed by milestone");
  }
  const milestones = [];
  for (const milestone of Object.keys(boundaries).filter((value) => value !== "M7")) {
    const segment = milestone.toLowerCase();
    const status = parsed[segment];
    if (!status || typeof status !== "object" || typeof status.pass !== "boolean") {
      throw new Error(`suite-status input lacks boolean ${segment}.pass`);
    }
    if (status.pass && (typeof status.receipt !== "string" || status.receipt.length === 0)) {
      throw new Error(`suite-status ${segment}.receipt must name evidence when pass is true`);
    }
    let receiptArtifact = null;
    if (typeof status.receipt === "string" && status.receipt.length > 0) {
      if (isAbsolute(status.receipt)) {
        throw new Error(`suite-status ${segment}.receipt must be relative to the suite-status file`);
      }
      const receiptPath = resolve(dirname(artifact.path), normalize(status.receipt));
      if (!inside(manifestDirectory, receiptPath)) {
        throw new Error(`suite-status ${segment}.receipt escapes the lane manifest directory`);
      }
      if ((await lstat(receiptPath)).isSymbolicLink()) {
        throw new Error(`suite-status ${segment}.receipt cannot be a symbolic link`);
      }
      const canonicalReceiptPath = await realpath(receiptPath);
      if (!inside(await realpath(manifestDirectory), canonicalReceiptPath)) {
        throw new Error(`suite-status ${segment}.receipt escapes after canonical resolution`);
      }
      const receiptStatus = await stat(canonicalReceiptPath);
      if (!receiptStatus.isFile()) {
        throw new Error(`suite-status ${segment}.receipt must name a retained file`);
      }
      const receiptContents = await readFile(canonicalReceiptPath);
      receiptArtifact = {
        path: logicalRelative(manifestDirectory, receiptPath),
        sha256: digest(receiptContents),
      };
    } else if (status.receipt !== null && status.receipt !== undefined) {
      throw new TypeError(`suite-status ${segment}.receipt must be string or null`);
    }

    const attestations = receiptResult.greenAttestations.get(milestone) ?? [];
    const currentAttestations = attestations.filter(
      (candidate) => candidate.version === CURRENT_CHOREOGRAPHY_VERSION,
    );
    if (currentAttestations.length > 1) {
      throw new Error(`suite-status ${segment} has duplicate 0.3.3-m8 attestations`);
    }
    const current = currentAttestations[0] ?? null;
    if (current === null && boundaries[milestone].status === "green") {
      throw new Error(`suite-status ${segment} lacks a 0.3.3-m8 refusal-time attestation`);
    }
    if (current !== null && current.suitePass !== status.pass) {
      throw new Error(`suite-status ${segment}.pass changed after choreography refusal-check time`);
    }
    if (current !== null && (current.suiteReceipt ?? null) !== (status.receipt ?? null)) {
      throw new Error(`suite-status ${segment}.receipt path changed after choreography refusal-check time`);
    }
    if (
      current !== null
      && receiptArtifact !== null
      && current.suiteReceiptSha256 !== receiptArtifact.sha256
    ) {
      throw new Error(`suite-status ${segment}.receipt changed after choreography refusal-check time`);
    }
    milestones.push({ milestone, pass: status.pass, receipt: receiptArtifact });
  }
  return {
    input: { path: suiteStatus.path, sha256: artifact.sha256 },
    milestones,
  };
}

function validateClockCorrelation(clockCorrelation) {
  if (
    clockCorrelation === null
    || typeof clockCorrelation !== "object"
    || clockCorrelation.method !== "rfc3339-with-bounded-skew"
  ) {
    throw new TypeError(
      "manifest.clockCorrelation.method must be rfc3339-with-bounded-skew",
    );
  }
  if (!Number.isInteger(clockCorrelation.maxSkewMillis) || clockCorrelation.maxSkewMillis < 0) {
    throw new TypeError("manifest.clockCorrelation.maxSkewMillis must be a non-negative integer");
  }
  requiredString(clockCorrelation.evidence, "manifest.clockCorrelation.evidence");
  return clockCorrelation;
}

export async function loadMeteringManifest(manifestPath) {
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  if (manifest?.manifestVersion !== MANIFEST_VERSION) {
    throw new TypeError(`manifestVersion must be ${MANIFEST_VERSION}`);
  }
  const laneRunId = requiredString(manifest.laneRunId, "manifest.laneRunId");
  assertCapFamily(manifest.capFamily);
  if (!["claude", "codex", "unavailable"].includes(manifest.adapter)) {
    throw new TypeError("manifest.adapter must be claude, codex, or unavailable");
  }
  requiredString(manifest.driver?.id, "manifest.driver.id");
  const stampedAtMs = timestampMillis(manifest.driver?.stampedAt, "manifest.driver.stampedAt");
  const startedAtMs = timestampMillis(manifest.driver?.startedAt, "manifest.driver.startedAt");
  if (stampedAtMs < startedAtMs) {
    throw new Error("manifest.driver.stampedAt predates the lane wall-clock origin");
  }
  const clockCorrelation = validateClockCorrelation(manifest.clockCorrelation);
  const manifestDirectory = await realpath(dirname(resolve(manifestPath)));

  validateSessionTree(manifest.sessions, manifest.adapter);
  let loadedSessions = [];
  let channel;
  if (manifest.adapter === "unavailable") {
    if (manifest.sessions.length !== 0) {
      throw new Error("unavailable metering manifests cannot declare session sources");
    }
    channel = adaptUnavailableFamily(
      manifest.capFamily,
      assertUnavailableReason(manifest.unavailableReason),
    );
  } else {
    if (manifest.sessions.length === 0) {
      throw new Error("native metering manifests require the complete builder session tree");
    }
    loadedSessions = await loadSessions(manifestDirectory, manifest.sessions, manifest.adapter);
    if (manifest.adapter === "claude") {
      if (!["claude-frontier", "mid-tier"].includes(manifest.capFamily)) {
        throw new Error(`Claude adapter is not approved for ${manifest.capFamily}`);
      }
      channel = adaptClaudeSessionTree(loadedSessions);
    } else {
      if (manifest.capFamily !== "gpt-frontier") {
        throw new Error(`Codex adapter is not approved for ${manifest.capFamily}`);
      }
      channel = adaptCodexSessionTree(loadedSessions);
    }
  }

  const boundaryArtifact = await readArtifact(
    manifestDirectory,
    manifest.boundaries,
    "manifest.boundaries",
  );
  const boundaryValue = JSON.parse(boundaryArtifact.text);
  if (boundaryValue?.laneRunId !== laneRunId) {
    throw new Error("boundary artifact laneRunId does not match the lane manifest");
  }
  if (boundaryValue?.driverId !== manifest.driver.id) {
    throw new Error("boundary artifact driverId does not match the lane manifest");
  }
  const driverBoundaries = normalizeBoundaryMap(boundaryValue);
  const receiptResult = await loadReceipts(manifestDirectory, manifest.receipts);
  const boundaries = mergeBoundaryMaps(...receiptResult.maps, driverBoundaries);
  for (const [milestone, boundary] of Object.entries(boundaries)) {
    if (boundary.status !== "green") continue;
    if (!receiptResult.milestones.has(milestone)) {
      throw new Error(`green milestone ${milestone} has no hash-bound receipt stream`);
    }
    const attestations = receiptResult.greenAttestations.get(milestone) ?? [];
    const attestation = attestations.find((candidate) => (
      candidate.green === true
      && candidate.suitePass === true
      && candidate.choreoPass === true
      && Date.parse(candidate.recordedAt) === Date.parse(boundary.firstGreenAt)
      && Date.parse(candidate.recordedAt) === Date.parse(boundary.terminalAt)
    ));
    if (attestation === undefined) {
      const nonGreen = attestations.some((candidate) => candidate.green === false);
      throw new Error(
        nonGreen
          ? `green milestone ${milestone} conflicts with its non-green hash-bound receipt`
          : `green milestone ${milestone} lacks a hash-bound green segment-summary at its terminal boundary`,
      );
    }
  }

  const observations = await loadObservations(
    manifestDirectory,
    manifest.observations,
    laneRunId,
  );
  const suiteStatusLinkage = await loadSuiteStatusLinkage(
    manifestDirectory,
    manifest.suiteStatus,
    receiptResult,
    boundaries,
  );

  let firstProductEdit = null;
  let firstProductEditProvenance = null;
  if (manifest.firstProductEdit !== null && manifest.firstProductEdit !== undefined) {
    const artifact = await readArtifact(
      manifestDirectory,
      manifest.firstProductEdit,
      "manifest.firstProductEdit",
    );
    firstProductEdit = JSON.parse(artifact.text);
    if (firstProductEdit?.laneRunId !== laneRunId) {
      throw new Error("first-product-edit artifact laneRunId does not match the lane manifest");
    }
    firstProductEditProvenance = {
      path: manifest.firstProductEdit.path,
      sha256: artifact.sha256,
    };
  }

  return {
    channel,
    boundaries,
    firstProductEdit,
    observations: {
      events: observations.events,
      evidence: observations.provenance.map(({ path, sha256 }) => ({ path, sha256 })),
    },
    suiteStatusLinkage,
    maxClockSkewMs: clockCorrelation.maxSkewMillis,
    wallClockOrigin: manifest.driver.startedAt,
    provenance: {
      manifestVersion: MANIFEST_VERSION,
      laneRunId,
      driver: {
        id: manifest.driver.id,
        stampedAt: manifest.driver.stampedAt,
        startedAt: manifest.driver.startedAt,
      },
      manifestSha256: digest(manifestText),
      unavailableReason: channel.unavailableReason ?? null,
      clockCorrelation: {
        method: clockCorrelation.method,
        maxSkewMillis: clockCorrelation.maxSkewMillis,
        evidence: clockCorrelation.evidence,
      },
      sessions: loadedSessions.map((session) => ({
        sourceId: session.sourceId,
        parentSourceId: session.parentSourceId,
        role: session.role,
        nativeSessionId: session.nativeSessionId,
        nativeAgentId: session.nativeAgentId ?? null,
        path: session.path,
        sha256: session.resolvedSha256,
      })),
      receipts: receiptResult.provenance,
      observations: observations.provenance,
      boundaries: {
        path: manifest.boundaries.path,
        sha256: boundaryArtifact.sha256,
      },
      firstProductEdit: firstProductEditProvenance,
    },
  };
}

export { MANIFEST_VERSION };
