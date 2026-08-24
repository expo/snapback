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

export function adaptClaudeSessionTree(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    throw new TypeError("Claude session tree must contain at least one session");
  }
  const byMessage = new Map();
  let usageRecords = 0;
  for (const [sessionIndex, session] of sessions.entries()) {
    if (
      session === null
      || typeof session !== "object"
      || typeof session.sourceId !== "string"
      || !Array.isArray(session.records)
    ) {
      throw new TypeError(`Claude session tree entry ${sessionIndex + 1} is invalid`);
    }
    for (const [recordIndex, record] of session.records.entries()) {
      const usage = record?.message?.usage;
      if (usage === undefined || usage === null) continue;
      usageRecords += 1;
      const id = record.message.id;
      const label = `Claude usage record ${session.sourceId}:${recordIndex + 1}`;
      if (typeof id !== "string" || id.length === 0) {
        throw new TypeError(`${label} has no message.id`);
      }
      const completedAt = record.timestamp;
      const completedAtMs = timestampMillis(completedAt, `${label}.timestamp`);
      const turn = {
        id: `claude-message:${id}`,
        nativeId: id,
        sourceId: session.sourceId,
        completedAt,
        usage: normalizeClaudeUsage(usage, `${label}.usage`),
      };
      const previous = byMessage.get(id);
      if (previous === undefined || completedAtMs >= previous.completedAtMs) {
        byMessage.set(id, { ...turn, completedAtMs });
      }
    }
  }

  const turns = [...byMessage.values()]
    .sort((left, right) => left.completedAtMs - right.completedAtMs)
    .map(({ completedAtMs: _completedAtMs, ...turn }) => turn);
  return {
    adapter: "claude-session-jsonl",
    adapterVersion: "claude-session-jsonl.v1",
    source: TOKEN_SOURCES.claude,
    turns,
    unavailableReason: null,
    sourceIds: sessions.map((session) => session.sourceId),
    usageRecords,
    deduplicatedRecords: usageRecords - turns.length,
    compatibilityEvents: [],
  };
}

export function adaptClaudeSession(records) {
  return adaptClaudeSessionTree([{ sourceId: "session", records }]);
}
