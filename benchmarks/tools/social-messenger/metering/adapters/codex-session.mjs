import {
  subtractTokenCounts,
  tokenCountsEqual,
  zeroTokenCounts,
} from "../counts.mjs";
import { timestampMillis } from "../jsonl.mjs";
import { TOKEN_SOURCES } from "../sources.mjs";
import { withEventDiagnostic } from "../finalization-diagnostics.mjs";

export const CODEX_ADAPTER_VERSION = "codex-rollout-jsonl.v2";
export const CODEX_0149_ZERO_DELTA_RULE =
  "codex-0.149.0-unchanged-cumulative-zero-components-advisory-total.v1";

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

function diagnosticLastTokenUsage(usage, label) {
  return {
    inputTokens: optionalCount(usage?.input_tokens, `${label}.input_tokens`),
    cachedInputTokens: optionalCount(
      usage?.cached_input_tokens,
      `${label}.cached_input_tokens`,
    ),
    cacheWriteInputTokens: optionalCount(
      usage?.cache_write_input_tokens,
      `${label}.cache_write_input_tokens`,
    ),
    outputTokens: optionalCount(usage?.output_tokens, `${label}.output_tokens`),
    reasoningOutputTokens: optionalCount(
      usage?.reasoning_output_tokens,
      `${label}.reasoning_output_tokens`,
    ),
    totalTokens: optionalCount(usage?.total_tokens, `${label}.total_tokens`),
  };
}

function zeroDeltaCompatibilityEvent({
  entry,
  nativeCliVersion,
  nativeSessionId,
  sourceId,
}) {
  if (nativeCliVersion !== "0.149.0" || entry.lastRaw === null) return null;
  const label = `Codex token_count record ${entry.recordIndex}.last_token_usage`;
  const carried = diagnosticLastTokenUsage(entry.lastRaw, label);
  if (
    carried.inputTokens !== 0
    || carried.cachedInputTokens !== 0
    || carried.cacheWriteInputTokens !== 0
    || carried.outputTokens !== 0
    || carried.reasoningOutputTokens !== 0
    || carried.totalTokens === null
    || carried.totalTokens === 0
  ) {
    return null;
  }
  return {
    ruleId: CODEX_0149_ZERO_DELTA_RULE,
    sourceId,
    nativeSessionId,
    recordIndex: entry.recordIndex,
    recordedAt: entry.completedAt,
    nativeCliVersion,
    cumulativeUnchanged: true,
    ignoredLastTokenUsage: carried,
  };
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
        rawRecord: record,
        cumulative: normalizeCodexCumulative(
          info.total_token_usage,
          `Codex token_count record ${index + 1}.total_token_usage`,
        ),
        lastRaw: info.last_token_usage ?? null,
      };
    });
    if (entry !== null) cumulativeRecords.push(entry);
  }
  cumulativeRecords.sort((left, right) => left.completedAtMs - right.completedAtMs);

  let previous = zeroTokenCounts();
  const turns = [];
  const compatibilityEvents = [];
  for (const entry of cumulativeRecords) {
    withEventDiagnostic("codex-token-count-delta-join", entry.rawRecord, () => {
      if (tokenCountsEqual(entry.cumulative, previous)) {
        if (entry.lastRaw === null) return;
        try {
          normalizeCodexCumulative(
            entry.lastRaw,
            `Codex token_count record ${entry.recordIndex}.last_token_usage`,
          );
        } catch (error) {
          // @ref LLP 0201#d2--quantitative-instrument — charged usage comes
          // only from validated cumulative component deltas. Codex 0.149.0 can
          // repeat an unchanged cumulative status with zero last components and
          // a contradictory advisory total; retain that native shape but do not
          // invent a turn or tokens for it.
          const compatibilityEvent = zeroDeltaCompatibilityEvent({
            entry,
            nativeCliVersion,
            nativeSessionId,
            sourceId,
          });
          if (compatibilityEvent === null) throw error;
          compatibilityEvents.push(compatibilityEvent);
        }
        return;
      }
      const usage = subtractTokenCounts(entry.cumulative, previous);
      if (entry.lastRaw === null) {
        throw new Error(
          `Codex token_count record ${entry.recordIndex} changed cumulative usage without last_token_usage`,
        );
      }
      const last = normalizeCodexCumulative(
        entry.lastRaw,
        `Codex token_count record ${entry.recordIndex}.last_token_usage`,
      );
      if (!tokenCountsEqual(usage, last)) {
        throw new RangeError(
          `Codex token_count record ${entry.recordIndex} cumulative delta does not equal last_token_usage`,
        );
      }
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
        completedAt: entry.completedAt,
        usage,
      });
      previous = entry.cumulative;
    });
  }
  return { turns, compatibilityEvents, nativeCliVersion };
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
  const turns = [...byIdentity.values()].sort((left, right) => (
    timestampMillis(left.completedAt, `${left.id}.completedAt`)
    - timestampMillis(right.completedAt, `${right.id}.completedAt`)
  ));
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
