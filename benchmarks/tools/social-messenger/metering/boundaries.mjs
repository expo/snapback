import { readFile } from "node:fs/promises";

import { parseJsonLines, timestampMillis } from "./jsonl.mjs";

const MILESTONES = Object.freeze([
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
  "M6",
  "M7",
  "M8",
]);

function milestoneName(value, label) {
  const normalized = typeof value === "string" ? value.toUpperCase() : value;
  if (!MILESTONES.includes(normalized)) {
    throw new TypeError(`${label} must name M1 through M8`);
  }
  return normalized;
}

function optionalTimestamp(value, label) {
  if (value === undefined || value === null) return null;
  timestampMillis(value, label);
  return value;
}

function firstTimestamp(left, right) {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function latestTimestamp(...values) {
  const present = values.filter((value) => value !== null);
  if (present.length === 0) return null;
  return present.reduce((latest, value) => (
    Date.parse(value) > Date.parse(latest) ? value : latest
  ));
}

function mergeBoundary(target, milestone, incoming) {
  const current = target[milestone] ?? {
    suitePassAt: null,
    choreoPassAt: null,
    firstGreenAt: null,
    status: null,
    terminalAt: null,
    terminalSequence: null,
    terminalReason: null,
  };
  for (const field of ["status", "terminalAt", "terminalSequence", "terminalReason"]) {
    if (
      current[field] !== null
      && incoming[field] !== null
      && current[field] !== incoming[field]
    ) {
      throw new Error(`conflicting ${milestone}.${field} boundary values`);
    }
  }
  target[milestone] = {
    suitePassAt: firstTimestamp(current.suitePassAt, incoming.suitePassAt),
    choreoPassAt: firstTimestamp(current.choreoPassAt, incoming.choreoPassAt),
    firstGreenAt: firstTimestamp(current.firstGreenAt, incoming.firstGreenAt),
    status: current.status ?? incoming.status,
    terminalAt: current.terminalAt ?? incoming.terminalAt,
    terminalSequence: current.terminalSequence ?? incoming.terminalSequence,
    terminalReason: current.terminalReason ?? incoming.terminalReason,
  };
}

function optionalSequence(value, label) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function boundaryFromValue(value, label, { requireTerminal = false } = {}) {
  const authoring = value?.authoring ?? value;
  if (authoring === null || typeof authoring !== "object" || Array.isArray(authoring)) {
    throw new TypeError(`${label} must be an object`);
  }
  const suitePassAt = optionalTimestamp(authoring.suitePassAt, `${label}.suitePassAt`);
  const choreoPassAt = optionalTimestamp(authoring.choreoPassAt, `${label}.choreoPassAt`);
  let firstGreenAt = optionalTimestamp(authoring.firstGreenAt, `${label}.firstGreenAt`);
  const status = value.status ?? authoring.status ?? null;
  const terminal = value.terminal ?? authoring.terminal ?? authoring;
  const terminalAt = optionalTimestamp(
    terminal.at ?? terminal.terminalAt,
    `${label}.terminalAt`,
  );
  const terminalSequence = optionalSequence(
    terminal.sequence ?? terminal.terminalSequence,
    `${label}.terminalSequence`,
  );
  const terminalReason = terminal.reason ?? terminal.terminalReason ?? null;
  if (
    status !== null
    && !["green", "capability-failure", "aborted"].includes(status)
  ) {
    throw new TypeError(`${label}.status must be green, capability-failure, or aborted`);
  }
  if (
    terminalReason !== null
    && !["green", "token-cap", "wall-cap", "abort"].includes(terminalReason)
  ) {
    throw new TypeError(`${label}.terminalReason is invalid`);
  }
  if (
    firstGreenAt === null
    && suitePassAt !== null
    && choreoPassAt !== null
    && status !== "capability-failure"
    && status !== "aborted"
  ) {
    firstGreenAt = latestTimestamp(suitePassAt, choreoPassAt);
  }
  const receiptGreenAt = latestTimestamp(suitePassAt, choreoPassAt);
  if (
    firstGreenAt !== null
    && receiptGreenAt !== null
    && Date.parse(firstGreenAt) < Date.parse(receiptGreenAt)
  ) {
    throw new RangeError(`${label}.firstGreenAt precedes its suite/choreography receipt`);
  }
  if (requireTerminal) {
    if (status === null || terminalAt === null || terminalSequence === null || terminalReason === null) {
      throw new TypeError(`${label} must carry a driver-stamped terminal status, time, sequence, and reason`);
    }
    if (status === "green") {
      if (terminalReason !== "green" || firstGreenAt === null) {
        throw new Error(`${label} green terminal boundary requires firstGreenAt and reason green`);
      }
      if (Date.parse(firstGreenAt) !== Date.parse(terminalAt)) {
        throw new Error(`${label}.firstGreenAt must equal the green terminal boundary`);
      }
    } else {
      const expectedReason = status === "aborted"
        ? ["abort"]
        : ["token-cap", "wall-cap"];
      if (firstGreenAt !== null || !expectedReason.includes(terminalReason)) {
        throw new Error(`${label} non-green terminal boundary is inconsistent with its status`);
      }
    }
  }
  return {
    suitePassAt,
    choreoPassAt,
    firstGreenAt,
    status,
    terminalAt,
    terminalSequence,
    terminalReason,
  };
}

export function normalizeBoundaryMap(value, { requireTerminal = true } = {}) {
  const source = value?.milestones ?? value;
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("milestone boundaries must be an object");
  }
  const boundaries = {};
  for (const [rawMilestone, boundary] of Object.entries(source)) {
    const milestone = milestoneName(rawMilestone, `boundary key ${rawMilestone}`);
    mergeBoundary(
      boundaries,
      milestone,
      boundaryFromValue(
        boundary,
        `milestone boundaries.${milestone}`,
        { requireTerminal },
      ),
    );
  }
  if (requireTerminal) {
    const sequences = new Set();
    for (const [milestone, boundary] of Object.entries(boundaries)) {
      if (sequences.has(boundary.terminalSequence)) {
        throw new Error(`duplicate terminal sequence ${boundary.terminalSequence} at ${milestone}`);
      }
      sequences.add(boundary.terminalSequence);
    }
  }
  return boundaries;
}

export function boundariesFromReceiptRecords(records, label = "receipt stream") {
  const boundaries = {};
  for (const [index, record] of records.entries()) {
    const recordLabel = `${label}:${index + 1}`;
    if (record?.type === "segment-summary") {
      const milestone = milestoneName(record.segment, `${recordLabel}.segment`);
      const recordedAt = optionalTimestamp(record.recordedAt, `${recordLabel}.recordedAt`);
      if (recordedAt === null) {
        throw new TypeError(`${recordLabel}.recordedAt is required`);
      }
      mergeBoundary(boundaries, milestone, {
        suitePassAt: record.suite?.pass === true
          ? recordedAt
          : optionalTimestamp(record.suitePassAt, `${recordLabel}.suitePassAt`),
        choreoPassAt: record.choreography?.pass === true ? recordedAt : null,
        firstGreenAt: record.green === true ? recordedAt : null,
        status: record.green === true ? "green" : null,
        terminalAt: record.green === true ? recordedAt : null,
        terminalSequence: null,
        terminalReason: record.green === true ? "green" : null,
      });
      continue;
    }
    if (record?.type === "milestone-boundary") {
      const milestone = milestoneName(record.milestone, `${recordLabel}.milestone`);
      mergeBoundary(boundaries, milestone, boundaryFromValue(record, recordLabel));
    }
  }
  return boundaries;
}

export function mergeBoundaryMaps(...maps) {
  const merged = {};
  for (const map of maps) {
    for (const [milestone, value] of Object.entries(map)) {
      mergeBoundary(merged, milestoneName(milestone, "milestone"), value);
    }
  }
  return normalizeBoundaryMap(merged);
}

export async function readBoundaryFile(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  return normalizeBoundaryMap(value);
}

export async function readReceiptBoundaryFiles(paths) {
  const maps = [];
  for (const path of paths) {
    const records = parseJsonLines(await readFile(path, "utf8"), path);
    maps.push(boundariesFromReceiptRecords(records, path));
  }
  const merged = {};
  for (const map of maps) {
    for (const [milestone, value] of Object.entries(map)) {
      mergeBoundary(merged, milestoneName(milestone, "milestone"), value);
    }
  }
  return normalizeBoundaryMap(merged, { requireTerminal: false });
}

export function milestoneBoundaryAt(boundary) {
  return boundary.terminalAt;
}

export { MILESTONES };
