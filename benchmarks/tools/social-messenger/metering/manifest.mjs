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
  R2_CODEX_SETTLED_TERMINAL_RULE,
  R2_CODEX_SHARED_HOST_CLOCK_EVIDENCE,
  recoverCodexSignalSettlements,
} from "./codex-native-evidence.mjs";
import {
  observationLaneRunIdMatches,
  parseObservationJsonLines,
} from "./observations.mjs";
import {
  rawEventContext,
  retainRawEventContext,
  withEventDiagnostic,
} from "./finalization-diagnostics.mjs";
import { addTokenCounts, nullTokenCounts, zeroTokenCounts } from "./counts.mjs";
import { usageTurnCompletesAfterSettlement } from "./joiner.mjs";
import { validateScaleReplayEvidence } from "./scale-replay-evidence.mjs";
import { assertCapFamily } from "./sources.mjs";
import { validateJsonSchema } from "../../lib/json-schema.mjs";

const MANIFEST_VERSION = "social-messenger-metering-manifest.v1";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MILESTONE = /^M[1-8]$/u;
const CURRENT_CHOREOGRAPHY_VERSION = "0.3.4-m8";
const R2_DRIVER_V1_TERMINAL_RULE = R2_CODEX_SETTLED_TERMINAL_RULE;
const R2_DRIVER_V1_CLOCK_EVIDENCE =
  "controller and native CLI use the same host clock; 5s covers receipt-to-final-sample handoff";
const FULL_JOURNEY_DRIVER_ID = "social-messenger-full-journey-native-cli-driver.v1";
const FULL_JOURNEY_CODEX_SETTLED_TERMINAL_RULE =
  "social-messenger-full-journey-native-cli-driver.v1-codex-usage-settlement.v1";
const R2_RECOVERED_HANDOFF_REGISTRATION = Object.freeze({
  ruleId: "social-messenger-r2-cell-1-signal-handoff-exclusions.v1",
  laneRunId: "2026-08-23-r2-published-0125/sol-clique-explicit",
  nativeStreamSha256: "sha256:f9838d32f9f1357eb40ed7661d350cc9e341431ab0fcc3df0dc6e280e2035c0d",
  observationSourceId: "2026-08-23-r2-published-0125/sol-clique-explicit-lane-controller",
  observationStreamSha256: "sha256:8098e3f1589151e6540c5ec00840531ebc6471fb244eb43c048e5da8c62a9363",
  exclusions: Object.freeze([
    Object.freeze({
      priorMilestone: "M1",
      nextMilestone: "M2",
      nativeSignalItemId: "exec-99d072d0-74ea-481c-939e-ed8b90b63fb4",
      nativeSignalRecordOrdinal: 1229,
      observationSequence: 209,
      observationEventSha256: "sha256:d92ea49111e98c37bcadf1728fdb0bbd7fd21fc1543f98c36203eea30d7a5a08",
    }),
    Object.freeze({
      priorMilestone: "M2",
      nextMilestone: "M3",
      nativeSignalItemId: "exec-be790ed3-4d77-4fdd-b6e6-a908beba9560",
      nativeSignalRecordOrdinal: 1413,
      observationSequence: 244,
      observationEventSha256: "sha256:d178e9e6ddd350036a188924392086b70507ce1af0356c8c1f77e6353c710d35",
    }),
  ]),
});
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

export function suiteReceiptVerdict(contents, milestone, label = "suite receipt") {
  let receipt;
  try {
    receipt = JSON.parse(Buffer.isBuffer(contents) ? contents.toString("utf8") : contents);
  } catch (error) {
    throw new Error(`${label} must contain JSON verdict evidence: ${error.message}`);
  }
  if (!receipt || Array.isArray(receipt) || typeof receipt !== "object") {
    throw new TypeError(`${label} must contain a JSON object`);
  }
  if (
    receipt.milestone !== undefined
    && String(receipt.milestone).toUpperCase() !== milestone
  ) {
    throw new Error(
      `${label} milestone identity differs: expected ${milestone}, received ${receipt.milestone}`,
    );
  }
  if (typeof receipt.pass === "boolean") return receipt.pass;
  if (
    Array.isArray(receipt.results)
    && receipt.results.length > 0
    && receipt.results.every((result) => typeof result?.pass === "boolean")
  ) {
    return receipt.results.every((result) => result.pass === true);
  }
  throw new Error(`${label} lacks a boolean pass verdict or boolean results verdicts`);
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
  const versions = new Set(records
    .filter((record) => record?.type === "session_meta")
    .map((record) => record?.payload?.cli_version)
    .filter((value) => typeof value === "string" && value.length > 0));
  if (versions.size > 1) {
    throw new Error(`Codex source ${session.sourceId} has conflicting cli_version values`);
  }
  return [...versions][0] ?? null;
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
    let nativeCliVersion = null;
    if (adapter === "claude") validateClaudeIdentity(session, records);
    else nativeCliVersion = validateCodexIdentity(session, records);
    loaded.push({
      ...session,
      records,
      nativeCliVersion,
      resolvedSha256: artifact.sha256,
    });
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
    const sourceEvents = parseObservationJsonLines(
      artifact.text,
      artifact.path,
      { laneRunId },
    );
    for (const event of sourceEvents) {
      withEventDiagnostic("observation-lane-identity", event, () => {
        if (!observationLaneRunIdMatches(event.laneRunId, laneRunId)) {
          throw new Error(`${label} event does not belong to laneRunId ${laneRunId}`);
        }
        event.laneRunId = laneRunId;
      });
    }
    events.push(...sourceEvents.map((event) => {
      const projected = { ...event, evidenceSourceId: sourceId };
      const context = rawEventContext(event);
      if (context !== null) retainRawEventContext(projected, context);
      return projected;
    }));
    provenance.push({ sourceId, path: observation.path, sha256: artifact.sha256 });
  }
  events.sort((left, right) => (
    Date.parse(left.at) - Date.parse(right.at) || left.sequence - right.sequence
  ));
  return { events, provenance };
}

export function loadObservationCompatibility(manifest, observationResult) {
  const rules = manifest.observationCompatibility ?? [];
  if (!Array.isArray(rules)) {
    throw new TypeError("manifest.observationCompatibility must be an array");
  }
  const admitted = [];
  for (const [index, rule] of rules.entries()) {
    const label = `manifest.observationCompatibility[${index}]`;
    if (rule?.ruleId !== "retained-orphaned-recovery-episode-nonclaim.v1") {
      throw new Error(`${label}.ruleId is unsupported`);
    }
    const event = observationResult.events.find((candidate) => (
      candidate.evidenceSourceId === rule.observationSourceId
      && candidate.milestone === rule.milestone
      && candidate.sequence === rule.sequence
      && candidate.at === rule.at
      && candidate.type === rule.type
      && candidate.actionId === rule.actionId
      && candidate.episodeId === rule.episodeId
    ));
    if (
      event === undefined
      || event.type !== "semantic-action"
      || event.disposition !== "correction"
      || event.episodeId === null
    ) {
      throw new Error(`${label} does not bind one exact retained correction action`);
    }
    const episodeExists = observationResult.events.some((candidate) => (
      candidate.milestone === event.milestone
      && candidate.type === "recovery-episode"
      && candidate.episodeId === event.episodeId
    ));
    if (episodeExists) {
      throw new Error(`${label} cannot downgrade a complete recovery episode`);
    }
    admitted.push({
      ruleId: rule.ruleId,
      observationSourceId: event.evidenceSourceId,
      milestone: event.milestone,
      sequence: event.sequence,
      at: event.at,
      type: event.type,
      actionId: event.actionId,
      episodeId: event.episodeId,
    });
  }
  return admitted;
}

// @ref LLP 0201#d2--quantitative-instrument — the protocol terminal and the
// later native usage settlement are distinct. The former bounds wall time and
// observations; the latter is provenance used only to select token prefixes.
function applyFullJourneyTerminalCompatibility({
  manifest,
  boundaryValue,
  observationEvents,
  clockCorrelation,
  loadedSessions,
}) {
  if (manifest.driver?.id !== FULL_JOURNEY_DRIVER_ID) return null;
  if (manifest.adapter !== "codex") {
    return {
      boundaryValue,
      clockCorrelation,
      compatibilityEvents: [],
      observationEvents,
      usageSettlements: null,
    };
  }
  if (
    clockCorrelation.maxSkewMillis !== 5_000
    || clockCorrelation.evidence !== R2_DRIVER_V1_CLOCK_EVIDENCE
  ) {
    throw new Error("Codex full-journey terminal recovery has unsupported clock evidence");
  }
  const boundaries = boundaryValue?.milestones ?? boundaryValue;
  const builder = loadedSessions.find((session) => session.sourceId === "builder");
  const freshM7 = loadedSessions.find((session) => session.sourceId === "fresh-m7");
  if (
    builder?.role !== "builder"
    || builder.parentSourceId !== null
    || (Object.hasOwn(boundaries, "M7") && (
      freshM7?.role !== "builder-descendant" || freshM7.parentSourceId !== "builder"
    ))
    || loadedSessions.some((session) => !["builder", "fresh-m7"].includes(session.sourceId))
  ) {
    throw new Error(
      "full-journey terminal recovery requires one builder stream and, when M7 ran, one fresh-m7 stream",
    );
  }
  const recover = (session, milestones) => {
    const selected = Object.fromEntries(milestones.flatMap((milestone) => (
      boundaries[milestone] === undefined ? [] : [[milestone, boundaries[milestone]]]
    )));
    if (Object.keys(selected).length === 0) return null;
    const replayFailed = session.sourceId === "builder"
      && manifest.scaleReplayFailure !== undefined;
    const settlementTimedOut = replayFailed
      && manifest.scaleReplayFailure.outcome === "settlement-timeout";
    return recoverCodexSignalSettlements({
      records: session.records,
      boundaryValue: { ...boundaryValue, milestones: selected },
      streamClosedAt: replayFailed
        || Object.values(selected).some((boundary) => boundary.status !== "green")
        ? manifest.driver.stampedAt
        : null,
      ...(session.sourceId === "builder" && Object.hasOwn(selected, "M8")
        ? {
            closingSettlementSelection: "first",
            allowTrailingUsage: true,
            ...(replayFailed ? { allowClosedWithoutTaskComplete: true } : {}),
            ...(settlementTimedOut ? { allowMissingClosingSettlement: true } : {}),
          }
        : {}),
    });
  };
  const recoveries = [
    { session: builder, recovery: recover(builder, ["M1", "M2", "M3", "M4", "M5", "M6", "M8"]) },
    ...(freshM7 === undefined ? [] : [{ session: freshM7, recovery: recover(freshM7, ["M7"]) }]),
  ].filter(({ recovery }) => recovery !== null);
  const usageSettlements = recoveries
    .flatMap(({ session, recovery }) => recovery.usageSettlements.map((settlement) => ({
      ...settlement,
      nativeSourceId: session.sourceId,
    })))
    .sort((left, right) => (
      boundaries[left.milestone].terminalSequence - boundaries[right.milestone].terminalSequence
    ));
  // The 5s correlation bound protects controller/native receipt comparisons.
  // Once a boundary has been recovered from an exact hash-bound native signal
  // ordinal and its exact following token_count ordinal, ordering rather than
  // wall-clock proximity selects the prefix. Retain the original evidence in
  // compatibilityEvents and use the shared-host zero-skew contract for this
  // ordinal-settled join, exactly as the reduced driver does below.
  const effectiveClockCorrelation = {
    method: "rfc3339-with-bounded-skew",
    maxSkewMillis: 0,
    evidence: R2_CODEX_SHARED_HOST_CLOCK_EVIDENCE,
  };
  const orderedMilestones = usageSettlements.map((settlement) => settlement.milestone);
  const milestoneIndex = new Map(orderedMilestones.map((milestone, index) => [milestone, index]));
  const observationTerminalInclusions = observationEvents
    .filter((event) => {
      const terminalAt = boundaries[event.milestone]?.terminalAt;
      if (terminalAt === undefined) return false;
      const lag = Date.parse(event.at) - Date.parse(terminalAt);
      if (lag <= 0 || lag > 1_000) return false;
      return (event.type === "semantic-action"
          && event.actionClass === "retry"
          && event.disposition === "correction")
        || event.type === "recovery-episode"
        || (event.type === "semantic-action"
          && event.actionClass === "choreography"
          && event.disposition === "progress");
    })
    .map((event) => ({
      observationSourceId: event.evidenceSourceId,
      milestone: event.milestone,
      sequence: event.sequence,
      at: event.at,
      type: event.type,
      terminalAt: boundaries[event.milestone].terminalAt,
      eventSha256: digest(JSON.stringify(event)),
      reason: "exact-protocol-terminal-observation-correlation-within-one-second",
    }));
  const inclusionKeys = new Set(observationTerminalInclusions.map((event) => (
    `${event.observationSourceId}\0${event.milestone}\0${event.sequence}\0${event.at}`
  )));
  const effectiveObservations = observationEvents.filter((event) => {
    const index = milestoneIndex.get(event.milestone);
    if (index === undefined) return true;
    const upper = Date.parse(boundaries[event.milestone].terminalAt);
    const lower = index === 0
      ? Date.parse(manifest.driver.startedAt)
      : Date.parse(boundaries[orderedMilestones[index - 1]].terminalAt);
    const at = Date.parse(event.at);
    return at >= lower && (
      at <= upper
      || inclusionKeys.has(`${event.evidenceSourceId}\0${event.milestone}\0${event.sequence}\0${event.at}`)
    );
  });
  return {
    boundaryValue,
    clockCorrelation: effectiveClockCorrelation,
    observationEvents: effectiveObservations,
    usageSettlements,
    compatibilityEvents: recoveries.map(({ session, recovery }) => ({
      ruleId: FULL_JOURNEY_CODEX_SETTLED_TERMINAL_RULE,
      originalClockCorrelation: clockCorrelation,
      effectiveClockCorrelation,
      nativeSourceId: session.sourceId,
      nativeSessionId: session.nativeSessionId,
      nativeStreamSha256: session.resolvedSha256,
      taskCompleteAt: recovery.taskCompleteAt,
      taskCompleteRecordOrdinal: recovery.taskCompleteRecordOrdinal,
      ...(recovery.streamClosedAt === null
        ? {}
        : { streamClosedAt: recovery.streamClosedAt }),
      usageSettlements: recovery.usageSettlements,
      observationWindowPolicy: "protocol-terminal-inclusive.v1",
      observationHandoffExclusions: [],
      observationTerminalInclusions,
    })),
  };
}

function applyR2DriverV1TerminalCompatibility({
  manifest,
  boundaryValue,
  observationEvents,
  clockCorrelation,
  loadedSessions = [],
}) {
  const fullJourney = applyFullJourneyTerminalCompatibility({
    manifest,
    boundaryValue,
    observationEvents,
    clockCorrelation,
    loadedSessions,
  });
  if (fullJourney !== null) return fullJourney;
  if (manifest.driver?.id !== "social-messenger-r2-native-cli-driver.v1") {
    return {
      boundaryValue,
      clockCorrelation,
      compatibilityEvents: [],
      observationEvents,
      usageSettlements: null,
    };
  }
  if (manifest.adapter !== "codex") {
    return {
      boundaryValue,
      clockCorrelation,
      compatibilityEvents: [],
      observationEvents,
      usageSettlements: null,
    };
  }
  if (
    clockCorrelation.maxSkewMillis !== 5_000
    || clockCorrelation.evidence !== R2_DRIVER_V1_CLOCK_EVIDENCE
  ) {
    throw new Error("Codex driver-v1 terminal recovery has unsupported clock evidence");
  }
  const builder = loadedSessions.find((session) => session.role === "builder");
  if (builder === undefined) {
    throw new Error("driver-v1 terminal recovery requires the hash-bound builder session");
  }
  const boundaries = boundaryValue?.milestones ?? boundaryValue;
  const recovery = recoverCodexSignalSettlements({
    records: builder.records,
    boundaryValue,
    streamClosedAt: Object.values(boundaryValue?.milestones ?? boundaryValue)
      .some((boundary) => boundary?.status !== "green")
      ? manifest.driver.stampedAt
      : null,
  });
  const usageSettlements = recovery.usageSettlements.map((settlement) => ({
    ...settlement,
    nativeSourceId: builder.sourceId,
  }));
  const effectiveClockCorrelation = {
    method: "rfc3339-with-bounded-skew",
    maxSkewMillis: 0,
    evidence: R2_CODEX_SHARED_HOST_CLOCK_EVIDENCE,
  };
  const orderedMilestones = usageSettlements.map((item) => item.milestone);
  const observationHandoffExclusions = [];
  const instrumentationCommandsObserved = manifest.driver.instrumentationCommandsObserved !== false;
  const observationDescriptor = manifest.observations?.find(
    (item) => item.sourceId === R2_RECOVERED_HANDOFF_REGISTRATION.observationSourceId,
  );
  const recoveredHandoffRegistered =
    manifest.laneRunId === R2_RECOVERED_HANDOFF_REGISTRATION.laneRunId
    && builder.resolvedSha256 === R2_RECOVERED_HANDOFF_REGISTRATION.nativeStreamSha256
    && observationDescriptor?.sha256 === R2_RECOVERED_HANDOFF_REGISTRATION.observationStreamSha256;
  if (instrumentationCommandsObserved && !recoveredHandoffRegistered) {
    throw new Error(
      "observed R2 signal commands require an exact versioned native/observation handoff registration",
    );
  }
  // Future driver streams filter signal commands at ingestion. Their first
  // legitimate next-milestone process action can occur on either side of the
  // native signal completion stamp, so a time-nearness heuristic has no safe
  // candidate set to inspect. Only recovered cell 1 uses the exact immutable
  // native/observation registration below.
  if (instrumentationCommandsObserved) {
    for (const [index, settlement] of usageSettlements.entries()) {
      if (index === orderedMilestones.length - 1 || settlement.signalRecordOrdinal === null) continue;
      const nextMilestone = orderedMilestones[index + 1];
      const candidates = observationEvents.filter((event) => (
        event.milestone === nextMilestone
        && event.type === "semantic-action"
        && event.actionClass === "process"
        && event.disposition === "progress"
        && Math.abs(Date.parse(event.at) - Date.parse(settlement.signalCompletedAt)) <= 1_000
      ));
      if (candidates.length !== 1) {
        throw new Error(
          `${settlement.milestone} native signal must map to its one exact registered next-milestone process observation; received ${candidates.length}`,
        );
      }
      const event = candidates[0];
      const registration = R2_RECOVERED_HANDOFF_REGISTRATION.exclusions[index];
      if (
        registration?.priorMilestone !== settlement.milestone
        || registration.nextMilestone !== nextMilestone
        || registration.nativeSignalItemId !== settlement.signalItemId
        || registration.nativeSignalRecordOrdinal !== settlement.signalRecordOrdinal
        || registration.observationSequence !== event.sequence
        || event.evidenceSourceId !== R2_RECOVERED_HANDOFF_REGISTRATION.observationSourceId
        || digest(JSON.stringify(event)) !== registration.observationEventSha256
      ) {
        throw new Error(
          `${settlement.milestone} handoff observation does not equal its immutable versioned registration`,
        );
      }
      observationHandoffExclusions.push({
        observationSourceId: event.evidenceSourceId,
        milestone: event.milestone,
        sequence: event.sequence,
        at: event.at,
        type: event.type,
        actionId: event.actionId,
        actionClass: event.actionClass,
        disposition: event.disposition,
        priorMilestone: settlement.milestone,
        nativeSignalItemId: settlement.signalItemId,
        nativeSignalRecordOrdinal: settlement.signalRecordOrdinal,
        registrationId: R2_RECOVERED_HANDOFF_REGISTRATION.ruleId,
        reason: "native-r2-cell-signal-instrumentation-is-not-a-product-action",
      });
    }
  }
  const excludedKeys = new Set(observationHandoffExclusions.map((event) => (
    `${event.observationSourceId}\0${event.milestone}\0${event.sequence}\0${event.at}`
  )));
  const milestoneIndex = new Map(orderedMilestones.map((milestone, index) => [milestone, index]));
  const observationTerminalInclusions = observationEvents
    .filter((event) => {
      const terminalAt = boundaries[event.milestone]?.terminalAt;
      if (terminalAt === undefined) return false;
      const lag = Date.parse(event.at) - Date.parse(terminalAt);
      if (lag <= 0 || lag > 1_000) return false;
      return (event.type === "semantic-action"
          && event.actionClass === "retry"
          && event.disposition === "correction")
        || event.type === "recovery-episode"
        || (event.type === "semantic-action"
          && event.actionClass === "choreography"
          && event.disposition === "progress");
    })
    .map((event) => ({
      observationSourceId: event.evidenceSourceId,
      milestone: event.milestone,
      sequence: event.sequence,
      at: event.at,
      type: event.type,
      terminalAt: boundaries[event.milestone].terminalAt,
      eventSha256: digest(JSON.stringify(event)),
      reason: "exact-protocol-terminal-observation-correlation-within-one-second",
    }));
  const terminalInclusionKeys = new Set(observationTerminalInclusions.map((event) => (
    `${event.observationSourceId}\0${event.milestone}\0${event.sequence}\0${event.at}`
  )));
  const effectiveObservations = observationEvents.filter((event) => {
    if (excludedKeys.has(`${event.evidenceSourceId}\0${event.milestone}\0${event.sequence}\0${event.at}`)) {
      return false;
    }
    const index = milestoneIndex.get(event.milestone);
    if (index === undefined) return true;
    const upper = Date.parse(boundaries[event.milestone].terminalAt);
    const lower = index === 0
      ? Date.parse(manifest.driver.startedAt)
      : Date.parse(boundaries[orderedMilestones[index - 1]].terminalAt);
    const at = Date.parse(event.at);
    return at >= lower && (
      at <= upper
      || terminalInclusionKeys.has(`${event.evidenceSourceId}\0${event.milestone}\0${event.sequence}\0${event.at}`)
    );
  });
  return {
    boundaryValue,
    clockCorrelation: effectiveClockCorrelation,
    observationEvents: effectiveObservations,
    usageSettlements,
    compatibilityEvents: [{
      ruleId: R2_DRIVER_V1_TERMINAL_RULE,
      originalClockCorrelation: clockCorrelation,
      effectiveClockCorrelation,
      nativeSourceId: builder.sourceId,
      nativeSessionId: builder.nativeSessionId,
      nativeStreamSha256: builder.resolvedSha256,
      taskCompleteAt: recovery.taskCompleteAt,
      taskCompleteRecordOrdinal: recovery.taskCompleteRecordOrdinal,
      ...(recovery.streamClosedAt === null
        ? {}
        : { streamClosedAt: recovery.streamClosedAt }),
      usageSettlements: recovery.usageSettlements,
      observationWindowPolicy: "protocol-terminal-inclusive.v1",
      observationHandoffRuleId: instrumentationCommandsObserved
        ? R2_RECOVERED_HANDOFF_REGISTRATION.ruleId
        : "r2-driver-signal-commands-filtered-at-ingestion.v1",
      observationHandoffExclusions,
      observationTerminalInclusions,
    }],
  };
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
  for (const milestone of Object.keys(boundaries)) {
    const segment = milestone.toLowerCase();
    const status = parsed[segment];
    if (!status || typeof status !== "object" || typeof status.pass !== "boolean") {
      throw new Error(`suite-status input lacks boolean ${segment}.pass`);
    }
    if (status.pass && (typeof status.receipt !== "string" || status.receipt.length === 0)) {
      throw new Error(`suite-status ${segment}.receipt must name evidence when pass is true`);
    }
    let receiptArtifact = null;
    let receiptVerdict = null;
    let receiptVerdictError = null;
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
      try {
        receiptVerdict = suiteReceiptVerdict(
          receiptContents,
          milestone,
          `suite-status ${segment}.receipt`,
        );
      } catch (error) {
        receiptVerdictError = error;
      }
    } else if (status.receipt !== null && status.receipt !== undefined) {
      throw new TypeError(`suite-status ${segment}.receipt must be string or null`);
    }

    const attestations = receiptResult.greenAttestations.get(milestone) ?? [];
    const currentAttestations = attestations.filter(
      (candidate) => candidate.version === CURRENT_CHOREOGRAPHY_VERSION,
    );
    if (currentAttestations.length > 1) {
      throw new Error(`suite-status ${segment} has duplicate 0.3.4-m8 attestations`);
    }
    const current = currentAttestations[0] ?? null;
    if (current === null && boundaries[milestone].status === "green") {
      throw new Error(`suite-status ${segment} lacks a 0.3.4-m8 refusal-time attestation`);
    }
    if (current !== null && current.suitePass !== status.pass) {
      throw new Error(
        `suite-status ${segment} verdict changed after choreography refusal-check: refusal-time=${current.suitePass} final=${status.pass}`,
      );
    }
    if (current !== null && (current.suiteReceipt ?? null) !== (status.receipt ?? null)) {
      throw new Error(`suite-status ${segment}.receipt path changed after choreography refusal-check time`);
    }
    if (
      current !== null
      && receiptArtifact !== null
      && current.suiteReceiptSha256 !== receiptArtifact.sha256
    ) {
      if (receiptVerdict !== null && current.suitePass !== receiptVerdict) {
        throw new Error(
          `suite-status ${segment} verdict changed after choreography refusal-check: refusal-time=${current.suitePass} retained-receipt=${receiptVerdict}`,
        );
      }
      throw new Error(`suite-status ${segment}.receipt changed after choreography refusal-check time`);
    }
    if (receiptVerdictError !== null) throw receiptVerdictError;
    if (current !== null && receiptVerdict !== null && current.suitePass !== receiptVerdict) {
      throw new Error(
        `suite-status ${segment} verdict changed after choreography refusal-check: refusal-time=${current.suitePass} retained-receipt=${receiptVerdict}`,
      );
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

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateScaleReplayFailure(value) {
  if (
    value?.version !== "snapback.full-journey-scale-replay-failure.v1"
    || !["aborted", "settlement-timeout"].includes(value.outcome)
    || value.clock?.attempted !== true
  ) {
    throw new Error("full-journey replay failure has an unsupported disposition");
  }
  const startedAtMs = timestampMillis(value.startedAt, "scale replay failure.startedAt");
  const finishedAtMs = timestampMillis(value.finishedAt, "scale replay failure.finishedAt");
  if (finishedAtMs < startedAtMs) {
    throw new Error("full-journey replay failure finishes before it starts");
  }
  const expectedWall = (finishedAtMs - startedAtMs) / 1_000;
  if (value.clock.wallSeconds !== expectedWall) {
    throw new Error("full-journey replay failure wall does not equal its retained timestamps");
  }
  if (value.outcome === "settlement-timeout") {
    const deadlineAtMs = timestampMillis(
      value.deadlineAt,
      "scale replay settlement timeout.deadlineAt",
    );
    if (
      value.failure?.cause !== "missing-post-m8-token-count"
      || !Number.isFinite(value.clock.capSeconds)
      || value.clock.capSeconds <= 0
      || deadlineAtMs !== startedAtMs + value.clock.capSeconds * 1_000
      || value.clock.capFractionUsed !== value.clock.wallSeconds / value.clock.capSeconds
      || value.clock.capExhausted !== true
      || finishedAtMs < deadlineAtMs
    ) {
      throw new Error("full-journey replay settlement timeout lacks its exact wall-cap disposition");
    }
  }
  return {
    firstStartedAt: value.startedAt,
    lastFinishedAt: value.finishedAt,
    clock: value.clock,
  };
}

// @ref LLP 0201#d2--quantitative-instrument — scale replay and fresh M7 are
// separate clocks. The first native settlement after M8 closes continuous
// authoring; later builder turns belong to replay and the fresh process launch
// is M7's independent wall origin.
export function bindFullJourneyAccountingValues({
  manifest,
  boundaryValue,
  driverCompatibility,
  loadedSessions,
  channel,
  replayValue = null,
  replayReceiptValue = null,
  replayFailureValue = null,
}) {
  if (manifest.driver.id !== FULL_JOURNEY_DRIVER_ID) {
    return { channel, milestoneWallStarts: {} };
  }
  const boundaries = boundaryValue?.milestones ?? boundaryValue;
  const builder = loadedSessions.find((session) => session.sourceId === "builder");
  const freshM7 = loadedSessions.find((session) => session.sourceId === "fresh-m7");
  timestampMillis(builder?.startedAt, "full-journey builder.startedAt");
  if (Object.hasOwn(boundaries, "M7")) {
    timestampMillis(freshM7?.startedAt, "full-journey fresh-m7.startedAt");
    const handoff = manifest.freshSessionHandoff;
    if (
      handoff?.contextPolicy !== "fresh-native-session-handoff-only.v1"
      || handoff.backendState !== "fresh-starter-only-pre-replay"
    ) {
      throw new Error("full-journey M7 lacks its fresh-session handoff policy binding");
    }
  }
  if (boundaries.M8?.status !== "green") {
    if (manifest.scaleReplay !== undefined || manifest.scaleReplayFailure !== undefined) {
      throw new Error("full-journey replay cannot be retained before M8 is green");
    }
    return {
      channel,
      milestoneWallStarts: freshM7 === undefined ? {} : { M7: freshM7.startedAt },
    };
  }
  const completedReplay = replayValue !== null || replayReceiptValue !== null;
  const failedReplay = replayFailureValue !== null;
  if (completedReplay === failedReplay) {
    throw new Error("full-journey green M8 requires exactly one completed or retained-failure replay disposition");
  }
  let replay;
  const settlementTimedOut = replayFailureValue?.outcome === "settlement-timeout";
  if (completedReplay) {
    if (replayValue === null || replayReceiptValue === null) {
      throw new Error("full-journey completed replay requires both replay and receipt values");
    }
    replay = validateScaleReplayEvidence(replayValue, replayReceiptValue);
    if (
      !sameJson(manifest.scaleReplay.attempts, replayValue.attempts)
      || !sameJson(manifest.scaleReplay.clock, replay.clock)
      || !sameJson(manifest.scaleReplay.receipt, replay.receipt)
    ) {
      throw new Error("full-journey replay descriptor differs from its hash-bound artifact");
    }
  } else {
    replay = validateScaleReplayFailure(replayFailureValue);
    if (freshM7 !== undefined) {
      throw new Error("fresh M7 cannot start after a failed scale replay");
    }
  }
  const m8Settlement = driverCompatibility.usageSettlements?.find(
    (settlement) => settlement.milestone === "M8",
  );
  if (!m8Settlement || (!m8Settlement.usageAvailable && !settlementTimedOut)) {
    throw new Error("full-journey M8 lacks a native usage settlement before scale replay");
  }
  if (
    m8Settlement.usageAvailable
    && Date.parse(replay.firstStartedAt) < Date.parse(m8Settlement.usageSettledAt)
  ) {
    throw new Error("full-journey scale replay starts before M8 native usage settles");
  }
  if (
    freshM7 !== undefined
    && Date.parse(freshM7.startedAt) < Date.parse(replay.lastFinishedAt)
  ) {
    throw new Error("fresh M7 starts before the scale replay clock closes");
  }
  const filteredChannel = settlementTimedOut || channel.turns === null ? channel : {
    ...channel,
    turns: channel.turns.filter((turn) => !(
      turn.sourceId === "builder"
      && usageTurnCompletesAfterSettlement(turn, m8Settlement)
    )),
  };
  const replayTurns = settlementTimedOut ? null : channel.turns?.filter((turn) => (
    turn.sourceId === "builder"
    && usageTurnCompletesAfterSettlement(turn, m8Settlement)
  )) ?? null;
  const replayTokens = replayTurns === null
    ? nullTokenCounts()
    : replayTurns.reduce(
        (total, turn) => addTokenCounts(total, turn.usage),
        zeroTokenCounts(),
      );
  return {
    channel: filteredChannel,
    milestoneWallStarts: freshM7 === undefined ? {} : { M7: freshM7.startedAt },
    separateTokenPhases: { replay: replayTokens },
    separateClockPhases: { replay: replay.clock },
  };
}

async function bindFullJourneyAccounting({
  manifest,
  manifestDirectory,
  boundaryValue,
  driverCompatibility,
  loadedSessions,
  channel,
}) {
  if (manifest.driver.id !== FULL_JOURNEY_DRIVER_ID) {
    return bindFullJourneyAccountingValues({
      manifest,
      boundaryValue,
      driverCompatibility,
      loadedSessions,
      channel,
    });
  }
  const boundaries = boundaryValue?.milestones ?? boundaryValue;
  if (Object.hasOwn(boundaries, "M7")) {
    const handoff = manifest.freshSessionHandoff;
    await readArtifact(manifestDirectory, handoff?.source, "manifest.freshSessionHandoff.source");
    await readArtifact(
      manifestDirectory,
      handoff?.renderedPrompt,
      "manifest.freshSessionHandoff.renderedPrompt",
    );
  }
  let replayValue = null;
  let replayReceiptValue = null;
  let replayFailureValue = null;
  if (boundaries.M8?.status === "green") {
    if (manifest.scaleReplayFailure !== undefined) {
      const replayFailureArtifact = await readArtifact(
        manifestDirectory,
        manifest.scaleReplayFailure,
        "manifest.scaleReplayFailure",
      );
      replayFailureValue = JSON.parse(replayFailureArtifact.text);
    } else {
      const replayArtifact = await readArtifact(
        manifestDirectory,
        manifest.scaleReplay,
        "manifest.scaleReplay",
      );
      replayValue = JSON.parse(replayArtifact.text);
      const replayReceiptArtifact = await readArtifact(
        manifestDirectory,
        replayValue.receipt,
        "manifest.scaleReplay receipt",
      );
      replayReceiptValue = JSON.parse(replayReceiptArtifact.text);
    }
  }
  return bindFullJourneyAccountingValues({
    manifest,
    boundaryValue,
    driverCompatibility,
    loadedSessions,
    channel,
    replayValue,
    replayReceiptValue,
    replayFailureValue,
  });
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

  const observations = await loadObservations(
    manifestDirectory,
    manifest.observations,
    laneRunId,
  );
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
  const driverCompatibility = applyR2DriverV1TerminalCompatibility({
    manifest,
    boundaryValue,
    observationEvents: observations.events,
    clockCorrelation,
    loadedSessions,
  });
  const fullJourneyAccounting = await bindFullJourneyAccounting({
    manifest,
    manifestDirectory,
    boundaryValue,
    driverCompatibility,
    loadedSessions,
    channel,
  });
  channel = fullJourneyAccounting.channel;
  const driverBoundaries = normalizeBoundaryMap(driverCompatibility.boundaryValue);
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
      && Date.parse(candidate.recordedAt) <= Date.parse(boundary.terminalAt)
    ));
    if (attestation === undefined) {
      const nonGreen = attestations.some((candidate) => candidate.green === false);
      throw new Error(
        nonGreen
          ? `green milestone ${milestone} conflicts with its non-green hash-bound receipt`
          : `green milestone ${milestone} lacks a hash-bound green segment-summary at its first-green boundary`,
      );
    }
  }

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

  const recordBaseArtifact = manifest.recordBase === undefined
    ? null
    : await readArtifact(
        manifestDirectory,
        manifest.recordBase,
        "manifest.recordBase",
      );
  const recordBase = recordBaseArtifact === null
    ? null
    : JSON.parse(recordBaseArtifact.text);
  const observationJoinExceptions = loadObservationCompatibility(manifest, observations);

  return {
    channel,
    boundaries,
    milestoneWallStarts: fullJourneyAccounting.milestoneWallStarts,
    separateTokenPhases: fullJourneyAccounting.separateTokenPhases ?? {},
    separateClockPhases: fullJourneyAccounting.separateClockPhases ?? {},
    usageSettlements: driverCompatibility.usageSettlements,
    firstProductEdit,
    recordBase,
    observations: {
      events: driverCompatibility.observationEvents,
      evidence: observations.provenance.map(({ path, sha256 }) => ({ path, sha256 })),
      joinExceptions: observationJoinExceptions,
      windowExceptions: driverCompatibility.compatibilityEvents
        .flatMap((event) => event.observationTerminalInclusions ?? []),
    },
    suiteStatusLinkage,
    maxClockSkewMs: driverCompatibility.clockCorrelation.maxSkewMillis,
    wallClockOrigin: manifest.driver.startedAt,
    provenance: {
      manifestVersion: MANIFEST_VERSION,
      laneRunId,
      manifest: {
        path: logicalRelative(manifestDirectory, manifestPath),
        sha256: digest(manifestText),
      },
      driver: {
        id: manifest.driver.id,
        stampedAt: manifest.driver.stampedAt,
        startedAt: manifest.driver.startedAt,
        compatibilityEvents: driverCompatibility.compatibilityEvents,
      },
      manifestSha256: digest(manifestText),
      unavailableReason: channel.unavailableReason ?? null,
      adapter: {
        id: channel.adapter,
        version: channel.adapterVersion,
        compatibilityEvents: channel.compatibilityEvents ?? [],
      },
      clockCorrelation: {
        method: driverCompatibility.clockCorrelation.method,
        maxSkewMillis: driverCompatibility.clockCorrelation.maxSkewMillis,
        evidence: driverCompatibility.clockCorrelation.evidence,
      },
      sessions: loadedSessions.map((session) => ({
        sourceId: session.sourceId,
        parentSourceId: session.parentSourceId,
        role: session.role,
        nativeSessionId: session.nativeSessionId,
        nativeAgentId: session.nativeAgentId ?? null,
        nativeCliVersion: session.nativeCliVersion,
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
      ...(recordBaseArtifact === null
        ? {}
        : { recordBase: {
            path: manifest.recordBase.path,
            sha256: recordBaseArtifact.sha256,
          } }),
    },
  };
}

export {
  applyR2DriverV1TerminalCompatibility,
  bindFullJourneyAccounting,
  MANIFEST_VERSION,
  R2_DRIVER_V1_TERMINAL_RULE,
  R2_DRIVER_V1_CLOCK_EVIDENCE,
};
