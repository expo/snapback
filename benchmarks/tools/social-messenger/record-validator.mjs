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

function integerSum(record) {
  return Object.values(record ?? {}).reduce(
    (sum, value) => sum + (Number.isInteger(value) ? value : 0),
    0,
  );
}

function validateD06Observability(errors, milestone, value, path) {
  const semantic = value.semanticActions;
  if (semantic) {
    requireEqual(
      errors,
      `${path}/semanticActions/total`,
      semantic.total,
      integerSum(semantic.byClass),
      "semantic-action total must equal the closed-taxonomy class counts",
    );
    requireEqual(
      errors,
      `${path}/semanticActions/total`,
      semantic.total,
      integerSum(semantic.byDisposition),
      "semantic-action total must equal progress + correction",
    );
    if (semantic.binaryExcavation > semantic.byClass?.["source-inspection"]) {
      errors.push(
        `${path}/semanticActions/binaryExcavation: binary excavation must be a subclass of source-inspection`,
      );
    }
  }

  const episodes = value.failureToRecoveryEpisodes;
  if (episodes) {
    requireEqual(
      errors,
      `${path}/failureToRecoveryEpisodes/total`,
      episodes.total,
      integerSum(episodes.byCarrier),
      "episode total must equal carrier counts",
    );
    requireEqual(
      errors,
      `${path}/failureToRecoveryEpisodes/total`,
      episodes.total,
      integerSum(episodes.byAttribution),
      "episode total must equal attribution counts",
    );
    requireEqual(
      errors,
      `${path}/failureToRecoveryEpisodes/total`,
      episodes.total,
      integerSum(episodes.byOutcome),
      "episode total must equal recovered + unresolved",
    );
  }

  if (value.restartReseed?.destructiveReseeds > value.restartReseed?.reseeds) {
    errors.push(
      `${path}/restartReseed/destructiveReseeds: destructive reseeds must be a subset of reseeds`,
    );
  }

  const hostLoad = value.hostLoad;
  if (hostLoad) {
    requireEqual(
      errors,
      `${path}/hostLoad/contamination`,
      hostLoad.contamination,
      Array.isArray(hostLoad.breaches) && hostLoad.breaches.length > 0,
      "host-load contamination must match retained breaches",
    );
    if (Date.parse(hostLoad.endedAt) < Date.parse(hostLoad.startedAt)) {
      errors.push(`${path}/hostLoad/endedAt: host-load window ends before it starts`);
    }
    for (const [index, breach] of (hostLoad.breaches ?? []).entries()) {
      if (breach.observed <= breach.ceiling) {
        errors.push(
          `${path}/hostLoad/breaches/${index}/observed: a breach must exceed its ceiling`,
        );
      }
    }
  }

  const interruptions = value.apiInterruptions;
  if (interruptions) {
    requireEqual(
      errors,
      `${path}/apiInterruptions/interrupted`,
      interruptions.interrupted,
      Array.isArray(interruptions.windows) && interruptions.windows.length > 0,
      "API interruption flag must match retained windows",
    );
    for (const [index, window] of (interruptions.windows ?? []).entries()) {
      if (
        window.recoveredAt !== null
        && Date.parse(window.recoveredAt) < Date.parse(window.startedAt)
      ) {
        errors.push(
          `${path}/apiInterruptions/windows/${index}/recoveredAt: recovery precedes interruption`,
        );
      }
    }
  }

  if (milestone && semantic && episodes) {
    const correctionActions = semantic.byDisposition?.correction;
    if (Number.isInteger(correctionActions) && correctionActions < episodes.total) {
      errors.push(
        `${path}/semanticActions/byDisposition/correction: each failure-to-recovery episode must contain at least its first failed action`,
      );
    }
  }
}

function validateSuiteStatusLinkage(errors, extension) {
  const linkage = extension.suiteStatusLinkage;
  if (!linkage) return;
  const linked = new Set();
  for (const [index, entry] of (linkage.milestones ?? []).entries()) {
    if (linked.has(entry.milestone)) {
      errors.push(
        `$/socialMessenger/suiteStatusLinkage/milestones/${index}/milestone: duplicate suite-status milestone`,
      );
    }
    linked.add(entry.milestone);
    if (!Object.hasOwn(extension.milestones ?? {}, entry.milestone)) {
      errors.push(
        `$/socialMessenger/suiteStatusLinkage/milestones/${index}/milestone: linked milestone is absent from the run record`,
      );
    }
  }
  for (const [milestone, value] of Object.entries(extension.milestones ?? {})) {
    if (
      milestone !== "M7"
      && ATTEMPTED_STATUSES.has(value?.status)
      && !linked.has(milestone)
    ) {
      errors.push(
        `$/socialMessenger/suiteStatusLinkage/milestones: attempted ${milestone} lacks hash-linked suite status`,
      );
    }
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
    // @ref LLP 0201#d2--quantitative-instrument — D0.6 records hash-linked
    // semantic actions, recovery, lifecycle, assertion wait, and contamination.
    validateD06Observability(errors, milestone, value, path);
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
  // @ref LLP 0281#w6-suite-status-linkage-ergonomics — a retained linkage
  // covers every attempted milestone; the choreography refuses it earlier.
  validateSuiteStatusLinkage(errors, extension);
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
