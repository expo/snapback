import {
  subtractTokenCounts,
  tokenCountsEqual,
  zeroTokenCounts,
} from "../counts.mjs";
import { timestampMillis } from "../jsonl.mjs";
import { TOKEN_SOURCES } from "../sources.mjs";

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
  const cumulativeRecords = [];
  for (const [index, record] of records.entries()) {
    const info = record?.type === "event_msg"
      && record?.payload?.type === "token_count"
      ? record.payload.info
      : null;
    if (info?.total_token_usage === undefined) continue;
    const completedAt = record.timestamp;
    cumulativeRecords.push({
      completedAt,
      completedAtMs: timestampMillis(
        completedAt,
        `Codex token_count record ${index + 1}.timestamp`,
      ),
      recordIndex: index + 1,
      cumulative: normalizeCodexCumulative(
        info.total_token_usage,
        `Codex token_count record ${index + 1}.total_token_usage`,
      ),
    });
  }
  cumulativeRecords.sort((left, right) => left.completedAtMs - right.completedAtMs);

  let previous = zeroTokenCounts();
  const turns = [];
  for (const entry of cumulativeRecords) {
    if (tokenCountsEqual(entry.cumulative, previous)) continue;
    const usage = subtractTokenCounts(entry.cumulative, previous);
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
  }
  return turns;
}

export function adaptCodexSessionTree(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    throw new TypeError("Codex session tree must contain at least one session");
  }
  const byIdentity = new Map();
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
    for (const turn of adaptOneCodexSession(session)) {
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
    source: TOKEN_SOURCES.codex,
    turns,
    unavailableReason: null,
    sourceIds: sessions.map((session) => session.sourceId),
  };
}

export function adaptCodexSession(records) {
  return adaptCodexSessionTree([{
    sourceId: "session",
    nativeSessionId: "legacy-session",
    records,
  }]);
}
