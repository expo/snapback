export function parseJsonLines(text, label = "JSONL input") {
  const records = [];
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new SyntaxError(`${label}:${index + 1}: ${error.message}`);
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
