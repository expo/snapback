import {
  addTokenCounts,
  nullTokenCounts,
  subtractTokenCounts,
  tokenCountsEqual,
  zeroTokenCounts,
} from "./counts.mjs";
import { milestoneBoundaryAt, normalizeBoundaryMap } from "./boundaries.mjs";
import { timestampMillis } from "./jsonl.mjs";
import {
  CURRENT_INSTRUMENT_PIN,
  OBSERVATION_VERSION,
  projectMilestoneObservability,
  scorecardEligibility,
} from "./observations.mjs";

function normalizedTurns(channel) {
  if (channel.turns === null) return null;
  if (!Array.isArray(channel.turns)) {
    throw new TypeError("usage channel turns must be an array or null");
  }
  const turns = channel.turns
    .map((turn, index) => ({
      ...turn,
      completedAtMs: timestampMillis(
        turn.completedAt,
        `usage turn ${index + 1}.completedAt`,
      ),
    }))
    .sort((left, right) => left.completedAtMs - right.completedAtMs);
  const identities = new Map();
  for (const turn of turns) {
    if (typeof turn.id !== "string" || turn.id.length === 0) {
      throw new TypeError("usage turns must carry lane-global stable IDs");
    }
    const previous = identities.get(turn.id);
    if (previous !== undefined) {
      if (!tokenCountsEqual(previous.usage, turn.usage)) {
        throw new RangeError(`usage turn ${turn.id} has conflicting counts`);
      }
      continue;
    }
    identities.set(turn.id, turn);
  }
  return [...identities.values()].sort(
    (left, right) => left.completedAtMs - right.completedAtMs,
  );
}

function prefixAt(turns, atMs) {
  if (turns === null) return nullTokenCounts();
  let prefix = zeroTokenCounts();
  for (const turn of turns) {
    if (turn.completedAtMs > atMs) break;
    prefix = addTokenCounts(prefix, turn.usage);
  }
  return prefix;
}

function normalizeFirstProductEdit(marker) {
  if (marker === undefined || marker === null) {
    return {
      at: null,
      orientationBytes: null,
      selectedSkills: [],
    };
  }
  const at = marker.at ?? marker.firstProductEditAt;
  timestampMillis(at, "first product edit marker.at");
  if (
    marker.orientationBytes !== null
    && (!Number.isInteger(marker.orientationBytes) || marker.orientationBytes < 0)
  ) {
    throw new TypeError("first product edit marker.orientationBytes must be null or a non-negative integer");
  }
  if (!Array.isArray(marker.selectedSkills)) {
    throw new TypeError("first product edit marker.selectedSkills must be an array");
  }
  const selectedSkills = [];
  const seen = new Set();
  for (const skill of marker.selectedSkills) {
    if (typeof skill !== "string" || skill.length === 0) {
      throw new TypeError("first product edit marker.selectedSkills must contain non-empty strings");
    }
    if (!seen.has(skill)) {
      selectedSkills.push(skill);
      seen.add(skill);
    }
  }
  return { at, orientationBytes: marker.orientationBytes, selectedSkills };
}

function assertClockUnambiguous(turns, atMs, maxClockSkewMs, label) {
  if (turns === null || maxClockSkewMs === 0) return;
  const ambiguous = turns.find((turn) => (
    Math.abs(turn.completedAtMs - atMs) <= maxClockSkewMs
  ));
  if (ambiguous !== undefined) {
    throw new Error(
      `${label} is within the recorded ${maxClockSkewMs}ms clock-skew bound of usage turn ${ambiguous.id}`,
    );
  }
}

function firstProductEditSnapshot(turns, marker, maxClockSkewMs) {
  const normalized = normalizeFirstProductEdit(marker);
  if (normalized.at !== null) {
    assertClockUnambiguous(
      turns,
      Date.parse(normalized.at),
      maxClockSkewMs,
      "first-product-edit boundary",
    );
  }
  return {
    ...normalized,
    orientationTokens: normalized.at === null
      ? nullTokenCounts()
      : prefixAt(turns, Date.parse(normalized.at)),
  };
}

// @ref LLP 0201#d2--quantitative-instrument — phases are exact deltas of
// harness-native usage prefix sums at every attempted milestone's terminal
// boundary. Failed and aborted attempts therefore cannot roll into a later
// green milestone.
export function joinUsageToMilestones({
  channel,
  boundaries,
  firstProductEdit,
  maxClockSkewMs = 0,
  wallClockOrigin = null,
  provenance = null,
  observations = null,
  suiteStatusLinkage = null,
}) {
  if (channel === null || typeof channel !== "object") {
    throw new TypeError("usage channel is required");
  }
  const turns = normalizedTurns(channel);
  if (!Number.isInteger(maxClockSkewMs) || maxClockSkewMs < 0) {
    throw new TypeError("maxClockSkewMs must be a non-negative integer");
  }
  let originMs = null;
  if (wallClockOrigin !== null) {
    originMs = timestampMillis(wallClockOrigin, "wallClockOrigin");
    const preOrigin = turns?.find((turn) => turn.completedAtMs < originMs - maxClockSkewMs);
    if (preOrigin !== undefined) {
      throw new Error(`usage turn ${preOrigin.id} predates the lane wall-clock origin`);
    }
  }
  const boundaryMap = normalizeBoundaryMap(boundaries);
  const ordered = Object.entries(boundaryMap)
    .map(([milestone, boundary]) => ({
      milestone,
      boundary,
      at: milestoneBoundaryAt(boundary),
    }))
    .map((item) => ({ ...item, atMs: Date.parse(item.at) }))
    .sort((left, right) => (
      left.boundary.terminalSequence - right.boundary.terminalSequence
    ));
  if (ordered.length === 0) throw new Error("at least one attempted milestone boundary is required");
  const observationEvents = observations?.events ?? [];
  const observationEvidence = observations?.evidence ?? [];
  const observationWindowExceptions = observations?.windowExceptions ?? [];
  const attemptedMilestones = new Set(ordered.map((item) => item.milestone));
  const outsideAttempt = observationEvents.find(
    (event) => !attemptedMilestones.has(event.milestone),
  );
  if (outsideAttempt !== undefined) {
    throw new Error(
      `observation event ${outsideAttempt.type} names unattempted milestone ${outsideAttempt.milestone}`,
    );
  }
  const orderedByMilestone = new Map(ordered.map((item, index) => [item.milestone, index]));
  for (const event of observationEvents) {
    const index = orderedByMilestone.get(event.milestone);
    const eventAt = Date.parse(event.at);
    const upper = ordered[index].atMs;
    const lower = index === 0 ? originMs : ordered[index - 1].atMs;
    if (eventAt > upper + maxClockSkewMs) {
      throw new Error(
        `${event.milestone} observation ${event.type} is after its terminal boundary`,
      );
    }
    const retainedHandoffOverlap = observationWindowExceptions.some((exception) => (
      exception.observationSourceId === event.evidenceSourceId
      && exception.milestone === event.milestone
      && exception.sequence === event.sequence
      && exception.at === event.at
      && exception.type === event.type
    ));
    if (lower !== null && eventAt < lower - maxClockSkewMs && !retainedHandoffOverlap) {
      throw new Error(
        `${event.milestone} observation ${event.type} predates its milestone window`,
      );
    }
  }
  for (const [index, item] of ordered.entries()) {
    if (originMs !== null && item.atMs < originMs - maxClockSkewMs) {
      throw new Error(`${item.milestone} terminal boundary predates the lane wall-clock origin`);
    }
    assertClockUnambiguous(
      turns,
      item.atMs,
      maxClockSkewMs,
      `${item.milestone} terminal boundary`,
    );
    if (
      index > 0
      && item.atMs + maxClockSkewMs < ordered[index - 1].atMs
    ) {
      throw new Error(
        `${item.milestone} terminal timestamp contradicts driver execution sequence`,
      );
    }
  }
  const lastBoundary = ordered.at(-1);
  const trailingTurn = turns?.find((turn) => (
    turn.completedAtMs > lastBoundary.atMs + maxClockSkewMs
  ));
  if (trailingTurn !== undefined) {
    throw new Error(
      `usage turn ${trailingTurn.id} completes after the final ${lastBoundary.milestone} terminal boundary; restamp terminalAt after retained overshoot settles`,
    );
  }

  let previousPrefix = turns === null ? nullTokenCounts() : zeroTokenCounts();
  const milestones = {};
  const boundarySnapshots = {};
  for (const item of ordered) {
    const prefix = prefixAt(turns, item.atMs);
    const tokens = turns === null
      ? nullTokenCounts()
      : subtractTokenCounts(prefix, previousPrefix);
    milestones[item.milestone] = {
      status: item.boundary.status,
      authoring: {
        tokens,
        firstGreenAt: item.boundary.status === "green"
          ? item.boundary.firstGreenAt
          : null,
        suitePassAt: item.boundary.suitePassAt,
        choreoPassAt: item.boundary.choreoPassAt,
        terminalAt: item.boundary.terminalAt,
        terminalSequence: item.boundary.terminalSequence,
        terminalReason: item.boundary.terminalReason,
      },
      ...projectMilestoneObservability({
        events: observationEvents,
        evidence: observationEvidence,
        milestone: item.milestone,
      }),
    };
    boundarySnapshots[item.milestone] = {
      at: item.at,
      sequence: item.boundary.terminalSequence,
      status: item.boundary.status,
      tokens: prefix,
    };
    previousPrefix = prefix;
  }

  // @ref LLP 0295#d06--efficiency-instrument-and-target-registration — the
  // first-edit marker carries measured orientation bytes and selected skills;
  // its token snapshot is the same native prefix channel used by milestones.
  const firstEdit = firstProductEditSnapshot(turns, firstProductEdit, maxClockSkewMs);
  if (
    originMs !== null
    && firstEdit.at !== null
    && Date.parse(firstEdit.at) < originMs - maxClockSkewMs
  ) {
    throw new Error("first-product-edit boundary predates the lane wall-clock origin");
  }
  return {
    instrumentVersion: CURRENT_INSTRUMENT_PIN,
    observabilityProtocol: OBSERVATION_VERSION,
    source: channel.source ?? null,
    available: turns !== null,
    unavailableReason: channel.unavailableReason ?? null,
    capAdjudicationEligible: turns !== null,
    capCounters: ["input", "output"],
    totals: previousPrefix,
    executionOrder: ordered.map((item) => item.milestone),
    milestones,
    efficiencyScorecardEligibility: scorecardEligibility({
      milestones,
      phaseUsageAvailable: turns !== null,
      orientationEvidenceAvailable: firstEdit.at !== null
        && firstEdit.orientationBytes !== null
        && Object.values(firstEdit.orientationTokens).every(Number.isInteger),
    }),
    boundarySnapshots,
    firstProductEdit: firstEdit,
    meteringProvenance: provenance,
    ...(suiteStatusLinkage === null ? {} : { suiteStatusLinkage }),
  };
}
