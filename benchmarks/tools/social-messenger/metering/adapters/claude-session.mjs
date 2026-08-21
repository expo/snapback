import { assertTokenCounts } from "../counts.mjs";
import { timestampMillis } from "../jsonl.mjs";
import { TOKEN_SOURCES } from "../sources.mjs";

function optionalCount(value, label) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function requiredCount(value, label) {
  const count = optionalCount(value, label);
  if (count === null) throw new TypeError(`${label} is required`);
  return count;
}

function normalizeClaudeUsage(usage, label) {
  return assertTokenCounts({
    input: requiredCount(usage.input_tokens, `${label}.input_tokens`),
    output: requiredCount(usage.output_tokens, `${label}.output_tokens`),
    cacheRead: optionalCount(
      usage.cache_read_input_tokens,
      `${label}.cache_read_input_tokens`,
    ),
    cacheWrite: optionalCount(
      usage.cache_creation_input_tokens,
      `${label}.cache_creation_input_tokens`,
    ),
    reasoning: optionalCount(
      usage.output_tokens_details?.thinking_tokens,
      `${label}.output_tokens_details.thinking_tokens`,
    ),
  }, label);
}

export function adaptClaudeSession(records) {
  const byMessage = new Map();
  for (const [index, record] of records.entries()) {
    const usage = record?.message?.usage;
    if (usage === undefined || usage === null) continue;
    const id = record.message.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError(`Claude usage record ${index + 1} has no message.id`);
    }
    const completedAt = record.timestamp;
    const completedAtMs = timestampMillis(
      completedAt,
      `Claude usage record ${index + 1}.timestamp`,
    );
    const turn = {
      id,
      completedAt,
      usage: normalizeClaudeUsage(usage, `Claude usage record ${index + 1}.usage`),
    };
    const previous = byMessage.get(id);
    if (previous === undefined || completedAtMs >= previous.completedAtMs) {
      byMessage.set(id, { ...turn, completedAtMs });
    }
  }

  const turns = [...byMessage.values()]
    .sort((left, right) => left.completedAtMs - right.completedAtMs)
    .map(({ completedAtMs: _completedAtMs, ...turn }) => turn);
  return {
    adapter: "claude-session-jsonl",
    source: TOKEN_SOURCES.claude,
    turns,
    unavailableReason: null,
  };
}
