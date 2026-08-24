import {
  FinalizationDiagnosticError,
  retainRawEventContext,
} from "./finalization-diagnostics.mjs";

export function parseJsonLines(text, label = "JSONL input") {
  const records = [];
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    try {
      records.push(retainRawEventContext(JSON.parse(line), {
        source: label,
        streamLine: index + 1,
        rawPayload: rawLine,
      }));
    } catch (error) {
      throw new FinalizationDiagnosticError(
        new SyntaxError(`${label}:${index + 1}: ${error.message}`),
        {
          stage: "jsonl-parse",
          source: label,
          streamLine: index + 1,
          rawPayload: rawLine,
        },
      );
    }
  }
  return records;
}

export function timestampMillis(value, label) {
  const millis = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(millis)) {
    throw new TypeError(`${label} must be an RFC 3339 timestamp`);
  }
  return millis;
}
