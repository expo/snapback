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
  };
  target[milestone] = {
    suitePassAt: firstTimestamp(current.suitePassAt, incoming.suitePassAt),
    choreoPassAt: firstTimestamp(current.choreoPassAt, incoming.choreoPassAt),
    firstGreenAt: firstTimestamp(current.firstGreenAt, incoming.firstGreenAt),
  };
}

function boundaryFromValue(value, label) {
  const authoring = value?.authoring ?? value;
  if (authoring === null || typeof authoring !== "object" || Array.isArray(authoring)) {
    throw new TypeError(`${label} must be an object`);
  }
  const suitePassAt = optionalTimestamp(authoring.suitePassAt, `${label}.suitePassAt`);
  const choreoPassAt = optionalTimestamp(authoring.choreoPassAt, `${label}.choreoPassAt`);
  let firstGreenAt = optionalTimestamp(authoring.firstGreenAt, `${label}.firstGreenAt`);
  if (firstGreenAt === null && suitePassAt !== null && choreoPassAt !== null) {
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
  return { suitePassAt, choreoPassAt, firstGreenAt };
}

export function normalizeBoundaryMap(value) {
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
      boundaryFromValue(boundary, `milestone boundaries.${milestone}`),
    );
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
        suitePassAt: optionalTimestamp(record.suitePassAt, `${recordLabel}.suitePassAt`),
        choreoPassAt: record.choreography?.pass === true ? recordedAt : null,
        firstGreenAt: record.green === true ? recordedAt : null,
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
  return mergeBoundaryMaps(...maps);
}

export function milestoneBoundaryAt(boundary) {
  if (boundary.firstGreenAt !== null) return boundary.firstGreenAt;
  if (boundary.suitePassAt !== null && boundary.choreoPassAt !== null) {
    return latestTimestamp(boundary.suitePassAt, boundary.choreoPassAt);
  }
  return null;
}

export { MILESTONES };
