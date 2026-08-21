import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve, sep } from "node:path";

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
import { assertCapFamily } from "./sources.mjs";

const MANIFEST_VERSION = "social-messenger-metering-manifest.v1";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MILESTONE = /^M[1-8]$/u;

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
  const text = await readFile(path, "utf8");
  const actual = digest(text);
  if (actual !== artifact.sha256) {
    throw new Error(`${label} digest mismatch: expected ${artifact.sha256}, received ${actual}`);
  }
  return { path, text, sha256: actual };
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
    if (record?.sessionId !== undefined) {
      sawSession = true;
      if (record.sessionId !== session.nativeSessionId) {
        throw new Error(
          `Claude source ${session.sourceId}:${index + 1} has sessionId ${record.sessionId}, expected ${session.nativeSessionId}`,
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

async function loadReceipts(manifestDirectory, receipts) {
  if (!Array.isArray(receipts)) throw new TypeError("manifest.receipts must be an array");
  const maps = [];
  const provenance = [];
  const milestones = new Set();
  const sourceIds = new Set();
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
      if (record?.runId !== runId) {
        throw new Error(`${label}:${recordIndex + 1} does not belong to runId ${runId}`);
      }
      if (
        typeof record.segment === "string"
        && record.segment.toUpperCase() !== receipt.milestone
      ) {
        throw new Error(`${label}:${recordIndex + 1} does not belong to ${receipt.milestone}`);
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
  return { maps, milestones, provenance };
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
  const manifestDirectory = dirname(resolve(manifestPath));

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
    if (boundary.status === "green" && !receiptResult.milestones.has(milestone)) {
      throw new Error(`green milestone ${milestone} has no hash-bound receipt stream`);
    }
  }

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
      boundaries: {
        path: manifest.boundaries.path,
        sha256: boundaryArtifact.sha256,
      },
      firstProductEdit: firstProductEditProvenance,
    },
  };
}

export { MANIFEST_VERSION };
