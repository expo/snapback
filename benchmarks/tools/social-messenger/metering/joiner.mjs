import {
  addTokenCounts,
  nullTokenCounts,
  subtractTokenCounts,
  zeroTokenCounts,
} from "./counts.mjs";
import { milestoneBoundaryAt, normalizeBoundaryMap } from "./boundaries.mjs";
import { timestampMillis } from "./jsonl.mjs";

function normalizedTurns(channel) {
  if (channel.turns === null) return null;
  if (!Array.isArray(channel.turns)) {
    throw new TypeError("usage channel turns must be an array or null");
  }
  return channel.turns
    .map((turn, index) => ({
      ...turn,
      completedAtMs: timestampMillis(
        turn.completedAt,
        `usage turn ${index + 1}.completedAt`,
      ),
    }))
    .sort((left, right) => left.completedAtMs - right.completedAtMs);
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
  if (!Number.isInteger(marker.orientationBytes) || marker.orientationBytes < 0) {
    throw new TypeError("first product edit marker.orientationBytes must be a non-negative integer");
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

function firstProductEditSnapshot(turns, marker) {
  const normalized = normalizeFirstProductEdit(marker);
  return {
    ...normalized,
    orientationTokens: normalized.at === null
      ? nullTokenCounts()
      : prefixAt(turns, Date.parse(normalized.at)),
  };
}

// @ref LLP 0201#d2--quantitative-instrument — phases are exact deltas of
// harness-native usage prefix sums at the neutral milestone-green receipts.
export function joinUsageToMilestones({ channel, boundaries, firstProductEdit }) {
  if (channel === null || typeof channel !== "object") {
    throw new TypeError("usage channel is required");
  }
  const turns = normalizedTurns(channel);
  const boundaryMap = normalizeBoundaryMap(boundaries);
  const ordered = Object.entries(boundaryMap)
    .map(([milestone, boundary]) => ({
      milestone,
      boundary,
      at: milestoneBoundaryAt(boundary),
    }))
    .filter((item) => item.at !== null)
    .map((item) => ({ ...item, atMs: Date.parse(item.at) }))
    .sort((left, right) => left.atMs - right.atMs);

  let previousPrefix = turns === null ? nullTokenCounts() : zeroTokenCounts();
  const milestones = {};
  const boundarySnapshots = {};
  for (const item of ordered) {
    const prefix = prefixAt(turns, item.atMs);
    const tokens = turns === null
      ? nullTokenCounts()
      : subtractTokenCounts(prefix, previousPrefix);
    milestones[item.milestone] = {
      authoring: {
        tokens,
        firstGreenAt: item.boundary.firstGreenAt ?? item.at,
        suitePassAt: item.boundary.suitePassAt,
        choreoPassAt: item.boundary.choreoPassAt,
      },
    };
    boundarySnapshots[item.milestone] = {
      at: item.at,
      tokens: prefix,
    };
    previousPrefix = prefix;
  }

  // @ref LLP 0295#d06--efficiency-instrument-and-target-registration — the
  // first-edit marker carries measured orientation bytes and selected skills;
  // its token snapshot is the same native prefix channel used by milestones.
  const firstEdit = firstProductEditSnapshot(turns, firstProductEdit);
  return {
    source: channel.source ?? null,
    available: turns !== null,
    unavailableReason: channel.unavailableReason ?? null,
    capCounters: ["input", "output"],
    milestones,
    boundarySnapshots,
    firstProductEdit: firstEdit,
  };
}
