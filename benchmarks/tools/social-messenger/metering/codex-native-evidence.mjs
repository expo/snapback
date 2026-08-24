import { basename, relative, resolve, sep } from "node:path";

import { OBSERVATION_VERSION } from "./observations.mjs";
import { timestampMillis } from "./jsonl.mjs";

export const R2_CODEX_SETTLED_TERMINAL_RULE =
  "social-messenger-r2-native-cli-driver.v1-codex-signal-settlement.v2";
export const R2_CODEX_SHARED_HOST_CLOCK_EVIDENCE =
  "controller and Codex native events use the shared host system clock; native execution order, not receipt latency, determines terminal usage settlement";

function requiredOrdinal(record, index) {
  if (!Number.isInteger(record?.ordinal) || record.ordinal !== index) {
    throw new Error(
      `Codex native record ${index + 1} must carry zero-based ordinal ${index}`,
    );
  }
  timestampMillis(record.timestamp, `Codex native record ${index + 1}.timestamp`);
  return record.ordinal;
}

function tokenCountRecord(record) {
  return record?.type === "event_msg"
    && record?.payload?.type === "token_count"
    && record?.payload?.info?.total_token_usage !== undefined;
}

function taskCompleteRecord(record) {
  return record?.type === "event_msg" && record?.payload?.type === "task_complete";
}

function completedItem(record, itemType) {
  const item = record?.payload?.item;
  return record?.type === "event_msg"
    && record?.payload?.type === "item_completed"
    && item?.type === itemType
    && item?.status === "completed"
    ? item
    : null;
}

function commandText(item) {
  return Array.isArray(item?.command)
    ? item.command.filter((value) => typeof value === "string").join("\n")
    : "";
}

function signalMilestone(item) {
  const command = commandText(item);
  if (
    item?.exit_code !== 0
    || !/(?:^|[/\\])r2-cell-signal\.mjs(?:["']|\s)/u.test(command)
  ) {
    return null;
  }
  return command.match(/(?:^|\s)--milestone\s+(M[1-8])(?:\s|$)/u)?.[1] ?? null;
}

function boundaryMap(boundaryValue) {
  const boundaries = boundaryValue?.milestones ?? boundaryValue;
  if (!boundaries || Array.isArray(boundaries) || typeof boundaries !== "object") {
    throw new TypeError("terminal recovery requires a milestone boundary map");
  }
  return boundaries;
}

// @ref LLP 0201#d2--quantitative-instrument — an intermediate terminal is
// the native token-count settlement immediately following its successful
// signal handoff. The closing terminal is the final native usage settlement
// before task completion, so neither boundary under-counts nor steals the
// next milestone's first turn.
export function recoverCodexSignalSettlements({
  records,
  boundaryValue,
  streamClosedAt = null,
}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new TypeError("Codex terminal recovery requires a non-empty native stream");
  }
  records.forEach(requiredOrdinal);
  const boundaries = boundaryMap(boundaryValue);
  const orderedMilestones = Object.entries(boundaries)
    .sort((left, right) => left[1].terminalSequence - right[1].terminalSequence)
    .map(([milestone]) => milestone);
  if (orderedMilestones.length === 0) {
    throw new Error("Codex terminal recovery requires at least one attempted milestone");
  }

  const signals = [];
  for (const [index, record] of records.entries()) {
    const item = completedItem(record, "CommandExecution");
    const milestone = signalMilestone(item);
    if (milestone !== null && Object.hasOwn(boundaries, milestone)) {
      signals.push({ milestone, index, record, item });
    }
  }
  const closingMilestone = orderedMilestones.at(-1);
  const closingFailure = boundaries[closingMilestone]?.status !== "green";
  for (const milestone of orderedMilestones) {
    const matching = signals.filter((signal) => signal.milestone === milestone);
    const allowedUnsignaledFailure = milestone === closingMilestone
      && closingFailure
      && matching.length === 0
      && streamClosedAt !== null;
    if (matching.length !== 1 && !allowedUnsignaledFailure) {
      throw new Error(
        `Codex terminal recovery requires exactly one successful ${milestone} signal; received ${matching.length}`,
      );
    }
  }
  const orderedSignals = orderedMilestones.map((milestone) => (
    signals.find((signal) => signal.milestone === milestone) ?? {
      milestone,
      index: records.length,
      record: null,
      item: null,
      unsignaledClosedFailure: true,
    }
  ));
  for (let index = 1; index < orderedSignals.length; index += 1) {
    if (
      !orderedSignals[index].unsignaledClosedFailure
      && orderedSignals[index].index <= orderedSignals[index - 1].index
    ) {
      throw new Error("Codex milestone signals contradict driver terminal sequence");
    }
  }

  const taskCompletes = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => taskCompleteRecord(record));
  const closedFailureWithoutTaskComplete = closingFailure
    && taskCompletes.length === 0
    && streamClosedAt !== null;
  if (taskCompletes.length !== 1 && !closedFailureWithoutTaskComplete) {
    throw new Error(
      `Codex closing-terminal recovery requires exactly one native task_complete; received ${taskCompletes.length}`,
    );
  }
  const taskComplete = taskCompletes[0] ?? null;
  if (streamClosedAt !== null) timestampMillis(streamClosedAt, "Codex streamClosedAt");
  const terminalAdjustments = [];
  for (const [index, signal] of orderedSignals.entries()) {
    const closing = index === orderedSignals.length - 1;
    const nextSignalIndex = closing
      ? (taskComplete?.index ?? records.length)
      : orderedSignals[index + 1].index;
    const lowerRecordIndex = signal.unsignaledClosedFailure
      ? (terminalAdjustments.at(-1)?.usageRecordOrdinal ?? -1)
      : signal.index;
    if (nextSignalIndex <= lowerRecordIndex) {
      throw new Error(`${signal.milestone} has no closed native settlement window`);
    }
    const settlements = records
      .map((record, recordIndex) => ({ record, recordIndex }))
      .filter(({ record, recordIndex }) => (
        recordIndex > lowerRecordIndex
        && recordIndex < nextSignalIndex
        && tokenCountRecord(record)
      ));
    let settled = closing ? settlements.at(-1) : settlements[0];
    if (
      settled === undefined
      && signal.unsignaledClosedFailure
      && terminalAdjustments.length > 0
    ) {
      const priorOrdinal = terminalAdjustments.at(-1).usageRecordOrdinal;
      settled = { record: records[priorOrdinal], recordIndex: priorOrdinal };
    }
    if (settled === undefined) {
      throw new Error(`${signal.milestone} has no native token_count settlement after its signal`);
    }
    if (!closing && settlements[0].recordIndex >= orderedSignals[index + 1].index) {
      throw new Error(`${signal.milestone} settlement would steal the next milestone's first turn`);
    }
    const boundary = boundaries[signal.milestone];
    timestampMillis(boundary?.terminalAt, `${signal.milestone}.terminalAt`);
    terminalAdjustments.push({
      milestone: signal.milestone,
      originalTerminalAt: boundary.terminalAt,
      signalItemId: signal.item?.id ?? null,
      signalCompletedAt: signal.record?.timestamp ?? streamClosedAt,
      signalRecordOrdinal: signal.record?.ordinal ?? null,
      usageSettledAt: settled.record.timestamp,
      usageRecordOrdinal: settled.record.ordinal,
      effectiveTerminalAt: settled.record.timestamp,
      settlementKind: signal.unsignaledClosedFailure
        ? "closed-failure-native-token-count"
        : closing
        ? "final-native-token-count"
        : "signal-turn-token-count",
    });
  }
  const lastSettlementOrdinal = terminalAdjustments.at(-1).usageRecordOrdinal;
  const trailingUsage = records.find((record) => (
    tokenCountRecord(record) && record.ordinal > lastSettlementOrdinal
  ));
  if (trailingUsage !== undefined) {
    throw new Error("Codex native usage continues after the recovered closing settlement");
  }
  return {
    terminalAdjustments,
    taskCompleteAt: taskComplete?.record.timestamp ?? null,
    taskCompleteRecordOrdinal: taskComplete?.record.ordinal ?? null,
    streamClosedAt,
  };
}

function relativeChangedPath(absolutePath, productRoot) {
  if (typeof absolutePath !== "string" || absolutePath.length === 0) return null;
  const rel = relative(resolve(productRoot), resolve(absolutePath));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) return null;
  return rel.split(sep).join("/");
}

function evidenceOnlyPath(path) {
  const first = path.split("/")[0];
  return ["events", "receipts", "gates", "artifacts"].includes(first)
    || [
      "run-log.md",
      "diary.md",
      "essay.md",
      "final-report.md",
      "coverage-manifest.json",
      "suite-status.json",
      "terminal-boundaries.json",
      "first-product-edit.json",
      "metering-manifest.json",
      "metering.json",
      "record-base.json",
      "record.json",
      "validation.json",
    ].includes(path);
}

function fileChangeClass(changes) {
  const values = Object.values(changes ?? {});
  return values.length > 0 && values.every((change) => change?.type === "add")
    ? "generate"
    : "edit";
}

function milestoneAt(timestamp, orderedBoundaries) {
  const at = timestampMillis(timestamp, "FileChange timestamp");
  const match = orderedBoundaries.find(({ terminalAt }) => at <= Date.parse(terminalAt));
  if (match === undefined) {
    throw new Error(`FileChange at ${timestamp} follows the closing terminal`);
  }
  return match.milestone;
}

// Commandless Codex FileChange completions are native semantic actions. Their
// timestamps and ordinals come from the immutable rollout; orientation bytes
// remain null unless a separate counter actually measured them.
export function recoverCodexFileChanges({
  records,
  boundaryValue,
  laneRunId,
  productRoot,
  sourceId,
  nativeSessionId,
  nativeStreamSha256,
  selectedSkills = [],
}) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  records.forEach(requiredOrdinal);
  const boundaries = boundaryMap(boundaryValue);
  const orderedBoundaries = Object.entries(boundaries)
    .sort((left, right) => left[1].terminalSequence - right[1].terminalSequence)
    .map(([milestone, boundary]) => ({ milestone, terminalAt: boundary.terminalAt }));
  const events = [];
  let firstProductEdit = null;
  for (const record of records) {
    const item = completedItem(record, "FileChange");
    if (item === null) continue;
    const changedPaths = Object.keys(item.changes ?? {})
      .map((path) => relativeChangedPath(path, productRoot))
      .filter((path) => path !== null)
      .sort();
    if (changedPaths.length === 0) continue;
    const actionClass = fileChangeClass(item.changes);
    const milestone = milestoneAt(record.timestamp, orderedBoundaries);
    events.push({
      version: OBSERVATION_VERSION,
      laneRunId,
      milestone,
      sequence: record.ordinal + 1,
      at: record.timestamp,
      type: "semantic-action",
      actionId: `codex-file-change:${nativeSessionId}:${record.ordinal}`,
      actionClass,
      disposition: "progress",
      episodeId: null,
      retriedClass: null,
      binaryExcavation: false,
    });
    if (
      firstProductEdit === null
      && changedPaths.some((path) => !evidenceOnlyPath(path))
    ) {
      firstProductEdit = {
        laneRunId,
        at: record.timestamp,
        orientationBytes: null,
        selectedSkills: [...new Set(selectedSkills)],
        nativeEvidence: {
          sourceId,
          nativeSessionId,
          nativeStreamSha256,
          recordOrdinal: record.ordinal,
          itemId: item.id,
          itemType: "FileChange",
          actionClass,
          changedPaths,
        },
      };
    }
  }
  return { events, firstProductEdit };
}

export function productRootForCell(absolutePath, cellId) {
  if (basename(absolutePath) === cellId) return absolutePath;
  throw new Error(`product root ${absolutePath} does not end with cell id ${cellId}`);
}

export function inferCodexProductRoot(records, cellId) {
  const marker = `${sep}${cellId}${sep}`;
  for (const record of records) {
    const item = completedItem(record, "FileChange");
    for (const path of Object.keys(item?.changes ?? {})) {
      const index = path.indexOf(marker);
      if (index !== -1) return path.slice(0, index + marker.length - 1);
    }
  }
  throw new Error(`Codex native stream has no FileChange path rooted at ${cellId}`);
}
