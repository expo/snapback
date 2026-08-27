import {
  nullTokenCounts,
  subtractTokenCounts,
  tokenCountsEqual,
  zeroTokenCounts,
} from "../counts.mjs";
import { timestampMillis } from "../jsonl.mjs";
import { TOKEN_SOURCES } from "../sources.mjs";
import { withEventDiagnostic } from "../finalization-diagnostics.mjs";

export const CODEX_ADAPTER_VERSION = "codex-rollout-jsonl.v4";

const CODEX_CUMULATIVE_RESET_RECORD_TYPES = new Set(["compacted"]);

function requiredCount(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function optionalCount(value, label) {
  if (value === undefined || value === null) return null;
  return requiredCount(value, label);
}

function codexCliVersion(records) {
  const versions = new Set(records
    .filter((record) => record?.type === "session_meta")
    .map((record) => record?.payload?.cli_version)
    .filter((value) => typeof value === "string" && value.length > 0));
  if (versions.size > 1) {
    throw new Error("Codex session carries conflicting cli_version values");
  }
  return [...versions][0] ?? null;
}

function normalizeCodexCumulative(usage, label) {
  const nativeInput = requiredCount(usage.input_tokens, `${label}.input_tokens`);
  const cacheRead = requiredCount(
    usage.cached_input_tokens,
    `${label}.cached_input_tokens`,
  );
  const cacheWrite = requiredCount(
    usage.cache_write_input_tokens,
    `${label}.cache_write_input_tokens`,
  );
  const input = nativeInput - cacheRead - cacheWrite;
  if (input < 0) {
    throw new RangeError(
      `${label} cache counters exceed the native input-token total`,
    );
  }
  const output = requiredCount(usage.output_tokens, `${label}.output_tokens`);
  if (
    usage.total_tokens !== undefined
    && requiredCount(usage.total_tokens, `${label}.total_tokens`) !== nativeInput + output
  ) {
    throw new RangeError(`${label}.total_tokens does not equal input_tokens + output_tokens`);
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning: optionalCount(
      usage.reasoning_output_tokens,
      `${label}.reasoning_output_tokens`,
    ),
  };
}

function normalizeCodexLast(usage, label) {
  const aggregateTotal = requiredCount(usage?.total_tokens, `${label}.total_tokens`);
  try {
    return {
      version: "codex-last-token-usage.v1",
      counts: normalizeCodexCumulative(usage, label),
      aggregateTotal,
    };
  } catch (error) {
    const aggregateOnly = aggregateTotal > 0
      && [
        "input_tokens",
        "cached_input_tokens",
        "cache_write_input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
      ].every((field) => usage?.[field] === 0);
    if (!aggregateOnly) throw error;
    return {
      version: "codex-last-token-usage.aggregate-only.v1",
      counts: nullTokenCounts(),
      aggregateTotal,
    };
  }
}

function rawTokenTotal(counts) {
  return counts.input + counts.output + counts.cacheRead + counts.cacheWrite;
}

function hasRegisteredResetMarker(records, previousRecordIndex, recordIndex) {
  return records
    .slice(previousRecordIndex, recordIndex - 1)
    .some((record) => CODEX_CUMULATIVE_RESET_RECORD_TYPES.has(record?.type));
}

function adaptOneCodexSession({ sourceId, nativeSessionId, records }) {
  const nativeCliVersion = codexCliVersion(records);
  const cumulativeRecords = [];
  for (const [index, record] of records.entries()) {
    const entry = withEventDiagnostic("codex-token-count-normalize", record, () => {
      const info = record?.type === "event_msg"
        && record?.payload?.type === "token_count"
        ? record.payload.info
        : null;
      if (info?.total_token_usage === undefined) return null;
      const completedAt = record.timestamp;
      return {
        completedAt,
        completedAtMs: timestampMillis(
          completedAt,
          `Codex token_count record ${index + 1}.timestamp`,
        ),
        recordIndex: index + 1,
        nativeRecordOrdinal: Number.isInteger(record.ordinal) ? record.ordinal : null,
        rawRecord: record,
        cumulative: normalizeCodexCumulative(
          info.total_token_usage,
          `Codex token_count record ${index + 1}.total_token_usage`,
        ),
        last: info.last_token_usage === undefined
          ? null
          : normalizeCodexLast(
              info.last_token_usage,
              `Codex token_count record ${index + 1}.last_token_usage`,
            ),
      };
    });
    if (entry !== null) cumulativeRecords.push(entry);
  }
  cumulativeRecords.sort((left, right) => (
    Number.isInteger(left.nativeRecordOrdinal)
    && Number.isInteger(right.nativeRecordOrdinal)
    && left.nativeRecordOrdinal !== right.nativeRecordOrdinal
      ? left.nativeRecordOrdinal - right.nativeRecordOrdinal
      : left.completedAtMs - right.completedAtMs
  ));

  let previous = zeroTokenCounts();
  let previousRecordIndex = 0;
  const turns = [];
  for (const entry of cumulativeRecords) {
    withEventDiagnostic("codex-token-count-delta-join", entry.rawRecord, () => {
      const cumulativeChanged = !tokenCountsEqual(entry.cumulative, previous);
      // @ref LLP 0201#d2--quantitative-instrument — Codex emits unchanged
      // cumulative usage recaps both periodically and while completing context
      // compaction. The cumulative ledger is the charging authority: a recap
      // creates no turn even when last_token_usage repeats a prior turn or
      // carries only an aggregate housekeeping total.
      if (!cumulativeChanged) return;
      let usage;
      try {
        usage = subtractTokenCounts(entry.cumulative, previous);
      } catch (error) {
        if (!hasRegisteredResetMarker(records, previousRecordIndex, entry.recordIndex)) {
          throw error;
        }
        // A native compacted marker is the only registered in-stream reset.
        // After one, the new cumulative origin is zero; the first post-reset
        // snapshot must still checksum against its own last_token_usage below.
        usage = entry.cumulative;
      }
      if (entry.last === null) {
        throw new Error(
          `Codex token_count record ${entry.recordIndex} changed cumulative usage without last_token_usage`,
        );
      }
      const cumulativeDeltaTotal = rawTokenTotal(usage);
      if (cumulativeDeltaTotal !== entry.last.aggregateTotal) {
        throw new RangeError(
          `Codex token_count record ${entry.recordIndex} cumulative delta does not equal last_token_usage.total_tokens; received ${cumulativeDeltaTotal} and ${entry.last.aggregateTotal}`,
        );
      }
      if (
        entry.last.version === "codex-last-token-usage.v1"
        && !tokenCountsEqual(usage, entry.last.counts)
      ) {
        throw new RangeError(
          `Codex token_count record ${entry.recordIndex} cumulative delta does not equal last_token_usage`,
        );
      }
      if (!cumulativeChanged) return;
      const cumulativeIdentity = [
        entry.cumulative.input,
        entry.cumulative.output,
        entry.cumulative.cacheRead,
        entry.cumulative.cacheWrite,
        entry.cumulative.reasoning,
      ].join(":");
      turns.push({
        id: `codex-token-count:${nativeSessionId}:${entry.completedAt}:${cumulativeIdentity}`,
        sourceId,
        nativeRecordOrdinal: entry.nativeRecordOrdinal,
        completedAt: entry.completedAt,
        usage,
      });
      previous = entry.cumulative;
      previousRecordIndex = entry.recordIndex;
    });
  }
  return { turns, compatibilityEvents: [], nativeCliVersion };
}

export function adaptCodexSessionTree(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    throw new TypeError("Codex session tree must contain at least one session");
  }
  const byIdentity = new Map();
  const compatibilityEvents = [];
  const nativeCliVersions = new Set();
  for (const [index, session] of sessions.entries()) {
    if (
      session === null
      || typeof session !== "object"
      || typeof session.sourceId !== "string"
      || typeof session.nativeSessionId !== "string"
      || !Array.isArray(session.records)
    ) {
      throw new TypeError(`Codex session tree entry ${index + 1} is invalid`);
    }
    const adapted = adaptOneCodexSession(session);
    if (adapted.nativeCliVersion !== null) {
      nativeCliVersions.add(adapted.nativeCliVersion);
    }
    compatibilityEvents.push(...adapted.compatibilityEvents);
    for (const turn of adapted.turns) {
      const previous = byIdentity.get(turn.id);
      if (previous !== undefined && !tokenCountsEqual(previous.usage, turn.usage)) {
        throw new RangeError(`Codex turn identity ${turn.id} has conflicting usage`);
      }
      byIdentity.set(turn.id, turn);
    }
  }
  const turns = [...byIdentity.values()].sort((left, right) => {
    const timestampDelta = timestampMillis(left.completedAt, `${left.id}.completedAt`)
      - timestampMillis(right.completedAt, `${right.id}.completedAt`);
    if (timestampDelta !== 0) return timestampDelta;
    if (
      left.sourceId === right.sourceId
      && Number.isInteger(left.nativeRecordOrdinal)
      && Number.isInteger(right.nativeRecordOrdinal)
    ) {
      return left.nativeRecordOrdinal - right.nativeRecordOrdinal;
    }
    return left.id.localeCompare(right.id);
  });
  return {
    adapter: "codex-rollout-jsonl",
    adapterVersion: CODEX_ADAPTER_VERSION,
    source: TOKEN_SOURCES.codex,
    turns,
    unavailableReason: null,
    sourceIds: sessions.map((session) => session.sourceId),
    nativeCliVersions: [...nativeCliVersions].sort(),
    compatibilityEvents,
  };
}

export function adaptCodexSession(records) {
  return adaptCodexSessionTree([{
    sourceId: "session",
    nativeSessionId: "legacy-session",
    records,
  }]);
}
