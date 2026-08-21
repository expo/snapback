import { validateJsonSchema } from "../lib/json-schema.mjs";

const ATTEMPTED_STATUSES = new Set([
  "green",
  "capability-failure",
  "aborted",
]);

function tokenActual(counts) {
  return Number.isInteger(counts?.input) && Number.isInteger(counts?.output)
    ? counts.input + counts.output
    : null;
}

function exactFlags(flags, expected) {
  return Array.isArray(flags)
    && flags.length === expected.length
    && flags.every((flag, index) => flag === expected[index]);
}

function requireEqual(errors, path, actual, expected, rule) {
  if (actual !== expected) {
    errors.push(`${path}: ${rule}; expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function validateReasoningSubset(errors, counts, path) {
  if (
    Number.isInteger(counts?.reasoning)
    && Number.isInteger(counts?.output)
    && counts.reasoning > counts.output
  ) {
    errors.push(`${path}/reasoning: reasoning must be a subset of output`);
  }
}

// Cross-field charging equalities are deliberately adjacent to the composed
// schema: JSON Schema can constrain each field and flag shape, but cannot
// express chargedTokens === tokenCap or chargedTokens === input + output.
// @ref LLP 0201#d2--quantitative-instrument — published driver-shaped records
// preserve the cap/abort charging rules and honest native/null token posture.
export function validateSocialMessengerRecordSemantics(record) {
  const errors = [];
  const extension = record?.socialMessenger;
  if (extension === null || typeof extension !== "object") return errors;

  for (const [milestone, value] of Object.entries(extension.milestones ?? {})) {
    if (value === null || typeof value !== "object") continue;
    const path = `$/socialMessenger/milestones/${milestone}`;
    const authoring = value.authoring ?? {};
    const charging = value.charging ?? {};
    const caps = value.caps ?? {};
    const actualTokens = tokenActual(authoring.tokens);
    validateReasoningSubset(errors, authoring.tokens, `${path}/authoring/tokens`);
    if (!ATTEMPTED_STATUSES.has(value.status)) continue;

    switch (authoring.terminalReason) {
      case "green":
        if (!exactFlags(charging.flags, [])) {
          errors.push(`${path}/charging/flags: green charging requires no flags`);
        }
        requireEqual(
          errors,
          `${path}/charging/chargedWallSeconds`,
          charging.chargedWallSeconds,
          value.adjudication?.adjudicatedCapabilityFailure === true
            ? caps.wallCapSeconds
            : authoring.wallSeconds,
          "green charges actual wall unless grader-adjudicated",
        );
        requireEqual(
          errors,
          `${path}/charging/chargedTokens`,
          charging.chargedTokens,
          actualTokens,
          "green charges actual input + output",
        );
        break;
      case "token-cap":
        if (!exactFlags(charging.flags, ["capped-tokens"])) {
          errors.push(`${path}/charging/flags: token-cap requires exactly capped-tokens`);
        }
        requireEqual(
          errors,
          `${path}/charging/chargedTokens`,
          charging.chargedTokens,
          caps.tokenCap,
          "token-cap charges the token cap",
        );
        requireEqual(
          errors,
          `${path}/charging/chargedWallSeconds`,
          charging.chargedWallSeconds,
          authoring.wallSeconds,
          "token-cap charges actual wall",
        );
        break;
      case "wall-cap":
        if (!exactFlags(charging.flags, ["capped-wall"])) {
          errors.push(`${path}/charging/flags: wall-cap requires exactly capped-wall`);
        }
        requireEqual(
          errors,
          `${path}/charging/chargedWallSeconds`,
          charging.chargedWallSeconds,
          caps.wallCapSeconds,
          "wall-cap charges the wall cap",
        );
        requireEqual(
          errors,
          `${path}/charging/chargedTokens`,
          charging.chargedTokens,
          actualTokens,
          "wall-cap charges actual input + output",
        );
        break;
      case "abort":
        if (!exactFlags(charging.flags, ["aborted"])) {
          errors.push(`${path}/charging/flags: abort requires exactly aborted`);
        }
        requireEqual(
          errors,
          `${path}/charging/chargedWallSeconds`,
          charging.chargedWallSeconds,
          caps.wallCapSeconds,
          "abort charges the wall cap",
        );
        requireEqual(
          errors,
          `${path}/charging/chargedTokens`,
          charging.chargedTokens,
          actualTokens,
          "abort charges actual input + output",
        );
        break;
      default:
        break;
    }
  }
  validateReasoningSubset(
    errors,
    extension.firstProductEdit?.orientationTokens,
    "$/socialMessenger/firstProductEdit/orientationTokens",
  );
  return errors;
}

export function validateSocialMessengerRunRecord(
  schema,
  record,
  { schemas = [], tolerateAdditiveFields = false } = {},
) {
  return [
    ...validateJsonSchema(schema, record, { schemas, tolerateAdditiveFields }),
    ...validateSocialMessengerRecordSemantics(record),
  ];
}
