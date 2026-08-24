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

function orientationTokenEvidenceAvailable(counts) {
  return Number.isInteger(counts?.input)
    && Number.isInteger(counts?.output)
    && (counts.cacheRead === null || Number.isInteger(counts.cacheRead))
    && (counts.cacheWrite === null || Number.isInteger(counts.cacheWrite))
    && (counts.reasoning === null || Number.isInteger(counts.reasoning));
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
  usageSettlements = null,
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
  let settlementByMilestone = null;
  if (usageSettlements !== null) {
    if (!Array.isArray(usageSettlements) || usageSettlements.length !== ordered.length) {
      throw new Error("usage settlements must cover every attempted milestone exactly once");
    }
    settlementByMilestone = new Map();
    for (const [index, settlement] of usageSettlements.entries()) {
      const item = ordered[index];
      if (
        settlement?.milestone !== item.milestone
        || settlement.originalTerminalAt !== item.boundary.terminalAt
        || typeof settlement.usageAvailable !== "boolean"
      ) {
        throw new Error(`${item.milestone} usage settlement does not bind its protocol terminal`);
      }
      if (settlement.usageAvailable) {
        timestampMillis(settlement.usageSettledAt, `${item.milestone}.usageSettledAt`);
        if (!Number.isInteger(settlement.usageRecordOrdinal)) {
          throw new TypeError(`${item.milestone}.usageRecordOrdinal must be an integer`);
        }
      } else if (settlement.usageSettledAt !== null || settlement.usageRecordOrdinal !== null) {
        throw new Error(`${item.milestone} unavailable usage settlement must retain null time and ordinal`);
      }
      settlementByMilestone.set(item.milestone, settlement);
    }
  }
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
    const retainedExactException = observationWindowExceptions.some((exception) => (
      exception.observationSourceId === event.evidenceSourceId
      && exception.milestone === event.milestone
      && exception.sequence === event.sequence
      && exception.at === event.at
      && exception.type === event.type
    ));
    if (eventAt > upper + maxClockSkewMs && !retainedExactException) {
      throw new Error(
        `${event.milestone} observation ${event.type} is after its terminal boundary`,
      );
    }
    if (lower !== null && eventAt < lower - maxClockSkewMs && !retainedExactException) {
      throw new Error(
        `${event.milestone} observation ${event.type} predates its milestone window`,
      );
    }
  }
  for (const [index, item] of ordered.entries()) {
    if (originMs !== null && item.atMs < originMs - maxClockSkewMs) {
      throw new Error(`${item.milestone} terminal boundary predates the lane wall-clock origin`);
    }
    const settlement = settlementByMilestone?.get(item.milestone);
    if (settlement === undefined || settlement.usageAvailable) {
      assertClockUnambiguous(
        turns,
        settlement === undefined ? item.atMs : Date.parse(settlement.usageSettledAt),
        maxClockSkewMs,
        `${item.milestone} usage boundary`,
      );
    }
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
  const lastSettlement = settlementByMilestone?.get(lastBoundary.milestone);
  if (lastSettlement === undefined || lastSettlement.usageAvailable) {
    const usageUpperMs = lastSettlement === undefined
      ? lastBoundary.atMs
      : Date.parse(lastSettlement.usageSettledAt);
    const trailingTurn = turns?.find((turn) => (
      turn.completedAtMs > usageUpperMs + maxClockSkewMs
    ));
    if (trailingTurn !== undefined) {
      throw new Error(
        `usage turn ${trailingTurn.id} completes after the final ${lastBoundary.milestone} usage settlement`,
      );
    }
  }

  let previousPrefix = turns === null ? nullTokenCounts() : zeroTokenCounts();
  let phaseUsageAvailable = turns !== null;
  const milestones = {};
  const boundarySnapshots = {};
  for (const item of ordered) {
    const settlement = settlementByMilestone?.get(item.milestone);
    const usageAvailable = turns !== null && (settlement?.usageAvailable ?? true);
    const usageAtMs = settlement === undefined
      ? item.atMs
      : settlement.usageAvailable
      ? Date.parse(settlement.usageSettledAt)
      : null;
    const prefix = usageAvailable ? prefixAt(turns, usageAtMs) : nullTokenCounts();
    const tokens = !usageAvailable
      ? nullTokenCounts()
      : subtractTokenCounts(prefix, previousPrefix);
    if (!usageAvailable) phaseUsageAvailable = false;
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
    previousPrefix = usageAvailable ? prefix : nullTokenCounts();
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
    available: phaseUsageAvailable,
    unavailableReason: phaseUsageAvailable
      ? (channel.unavailableReason ?? null)
      : channel.unavailableReason
        ?? `native-usage-settlement-unavailable-${(
          usageSettlements?.find((item) => !item.usageAvailable)?.milestone ?? "attempt"
        ).toLowerCase()}`,
    capAdjudicationEligible: phaseUsageAvailable,
    capCounters: ["input", "output"],
    totals: previousPrefix,
    executionOrder: ordered.map((item) => item.milestone),
    milestones,
    efficiencyScorecardEligibility: scorecardEligibility({
      milestones,
      phaseUsageAvailable,
      orientationEvidenceAvailable: firstEdit.at !== null
        && firstEdit.orientationBytes !== null
        && orientationTokenEvidenceAvailable(firstEdit.orientationTokens),
    }),
    boundarySnapshots,
    firstProductEdit: firstEdit,
    meteringProvenance: provenance,
    ...(suiteStatusLinkage === null ? {} : { suiteStatusLinkage }),
  };
}
