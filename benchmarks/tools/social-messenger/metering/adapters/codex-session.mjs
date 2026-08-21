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

export function adaptCodexSession(records) {
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
    turns.push({
      id: `codex-token-count-${entry.recordIndex}-${entry.completedAt}`,
      completedAt: entry.completedAt,
      usage,
    });
    previous = entry.cumulative;
  }
  return {
    adapter: "codex-rollout-jsonl",
    source: TOKEN_SOURCES.codex,
    turns,
    unavailableReason: null,
  };
}
