export const TOKEN_FIELDS = Object.freeze([
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "reasoning",
]);

export function zeroTokenCounts() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  };
}

export function nullTokenCounts() {
  return {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
  };
}

export function assertTokenCounts(counts, label = "token counts") {
  if (counts === null || typeof counts !== "object" || Array.isArray(counts)) {
    throw new TypeError(`${label} must be an object`);
  }
  for (const field of TOKEN_FIELDS) {
    const value = counts[field];
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new TypeError(`${label}.${field} must be a non-negative integer or null`);
    }
  }
  if (counts.input === null || counts.output === null) {
    if (counts.input !== null || counts.output !== null) {
      throw new TypeError(`${label}.input and ${label}.output must be metered together`);
    }
  }
  return counts;
}

export function addTokenCounts(left, right) {
  assertTokenCounts(left, "left token counts");
  assertTokenCounts(right, "right token counts");
  return Object.fromEntries(
    TOKEN_FIELDS.map((field) => [
      field,
      left[field] === null || right[field] === null
        ? null
        : left[field] + right[field],
    ]),
  );
}

export function subtractTokenCounts(later, earlier) {
  assertTokenCounts(later, "later token counts");
  assertTokenCounts(earlier, "earlier token counts");
  const result = {};
  for (const field of TOKEN_FIELDS) {
    if (later[field] === null || earlier[field] === null) {
      result[field] = null;
      continue;
    }
    const value = later[field] - earlier[field];
    if (value < 0) {
      throw new RangeError(`token counter ${field} moved backwards`);
    }
    result[field] = value;
  }
  return result;
}

export function capTokenCount(counts) {
  assertTokenCounts(counts);
  return counts.input === null ? null : counts.input + counts.output;
}

export function tokenCountsEqual(left, right) {
  return TOKEN_FIELDS.every((field) => left[field] === right[field]);
}
