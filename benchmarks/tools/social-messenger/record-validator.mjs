import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";

import { validateJsonSchema } from "../lib/json-schema.mjs";
import {
  CURRENT_INSTRUMENT_PIN,
  OBSERVABILITY_BLOCKS,
  OBSERVATION_VERSION,
  parseObservationJsonLines,
  projectMilestoneObservability,
  scorecardEligibility,
} from "./metering/observations.mjs";
import { parseJsonLines } from "./metering/jsonl.mjs";

const ATTEMPTED_STATUSES = new Set([
  "green",
  "capability-failure",
  "aborted",
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const CURRENT_CHOREOGRAPHY_VERSION = "0.3.3-m8";
const RECEIPT_SCHEMA = JSON.parse(readFileSync(
  new URL("./choreography/receipts.schema.json", import.meta.url),
  "utf8",
));

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function inside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function resolveArtifact(errors, artifactRoot, artifact, path) {
  if (!artifactRoot) {
    errors.push(`${path}: artifactRoot is required to resolve hash-linked evidence`);
    return null;
  }
  if (
    !artifact
    || typeof artifact !== "object"
    || typeof artifact.path !== "string"
    || artifact.path.length === 0
    || isAbsolute(artifact.path)
    || !SHA256.test(artifact.sha256 ?? "")
  ) {
    errors.push(`${path}: expected a relative path plus sha256:<lowercase hex>`);
    return null;
  }
  const absolute = resolve(artifactRoot, normalize(artifact.path));
  if (!inside(artifactRoot, absolute)) {
    errors.push(`${path}/path: artifact escapes the record evidence directory`);
    return null;
  }
  let contents;
  let canonical;
  try {
    if (lstatSync(absolute).isSymbolicLink()) throw new Error("symbolic links are forbidden");
    canonical = realpathSync(absolute);
    if (!inside(realpathSync(artifactRoot), canonical)) {
      throw new Error("canonical path escapes the record evidence directory");
    }
    if (!statSync(canonical).isFile()) throw new Error("not a file");
    contents = readFileSync(canonical);
  } catch (error) {
    errors.push(`${path}/path: cannot read retained artifact ${artifact.path}: ${error.message}`);
    return null;
  }
  const actual = sha256(contents);
  if (actual !== artifact.sha256) {
    errors.push(`${path}/sha256: digest mismatch; expected ${artifact.sha256}, received ${actual}`);
    return null;
  }
  return { absolute: canonical, contents, text: contents.toString("utf8") };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

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
  if (semantic?.claimed === true) {
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
    requireEqual(
      errors,
      `${path}/semanticActions/byClass/retry`,
      semantic.byClass?.retry,
      integerSum(semantic.byRetriedClass),
      "every retry must project the class retried",
    );
    if (semantic.byClass?.retry > semantic.byDisposition?.correction) {
      errors.push(`${path}/semanticActions/byClass/retry: retry actions must be correction actions`);
    }
  }

  const episodes = value.failureToRecoveryEpisodes;
  if (episodes?.claimed === true) {
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

  if (
    value.restartReseed?.claimed === true
    && value.restartReseed.destructiveReseeds > value.restartReseed.reseeds
  ) {
    errors.push(
      `${path}/restartReseed/destructiveReseeds: destructive reseeds must be a subset of reseeds`,
    );
  }

  const hostLoad = value.hostLoad;
  if (hostLoad?.claimed === true) {
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
  if (interruptions?.claimed === true) {
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

  if (milestone && semantic?.claimed === true && episodes?.claimed === true) {
    const correctionActions = semantic.byDisposition?.correction;
    if (Number.isInteger(correctionActions) && correctionActions < episodes.total) {
      errors.push(
        `${path}/semanticActions/byDisposition/correction: each failure-to-recovery episode must contain at least its first failed action`,
      );
    }
  }
}

function loadObservationEvidence(errors, extension, artifactRoot) {
  const artifacts = extension.meteringProvenance?.observations ?? [];
  const evidence = [];
  const events = [];
  const paths = new Set();
  for (const [index, artifact] of artifacts.entries()) {
    const path = `$/socialMessenger/meteringProvenance/observations/${index}`;
    if (paths.has(artifact?.path)) {
      errors.push(`${path}/path: duplicate observation artifact path`);
      continue;
    }
    paths.add(artifact?.path);
    const loaded = resolveArtifact(errors, artifactRoot, artifact, path);
    if (loaded === null) continue;
    let sourceEvents;
    try {
      sourceEvents = parseObservationJsonLines(loaded.text, artifact.path);
    } catch (error) {
      errors.push(`${path}: invalid observation event stream: ${error.message}`);
      continue;
    }
    for (const event of sourceEvents) {
      if (event.laneRunId !== extension.meteringProvenance?.laneRunId) {
        errors.push(`${path}: observation laneRunId does not match metering provenance`);
      }
    }
    events.push(...sourceEvents);
    evidence.push({ path: artifact.path, sha256: artifact.sha256 });
  }
  events.sort((left, right) => (
    Date.parse(left.at) - Date.parse(right.at) || left.sequence - right.sequence
  ));
  return { evidence, events };
}

function validateObservationBinding(errors, record, extension, artifactRoot, currentInstrument) {
  const attempted = Object.entries(extension.milestones ?? {}).filter(
    ([, value]) => ATTEMPTED_STATUSES.has(value?.status),
  );
  const hasObservability = attempted.some(([, value]) => (
    OBSERVABILITY_BLOCKS.some((block) => value?.[block] !== undefined)
  ));
  if (!currentInstrument && !hasObservability) return;

  if (currentInstrument) {
    if (extension.observabilityProtocol !== "social-messenger-observation.v1") {
      errors.push("$/socialMessenger/observabilityProtocol: current instrument must identify the typed observation protocol");
    }
    if (!Array.isArray(extension.meteringProvenance?.observations)) {
      errors.push("$/socialMessenger/meteringProvenance/observations: current instrument must declare its complete observation artifact set, including an empty set for all-non-claim records");
    }
  }

  const loaded = loadObservationEvidence(errors, extension, artifactRoot);
  const observationSkewMillis = Number.isInteger(
    extension.meteringProvenance?.clockCorrelation?.maxSkewMillis,
  )
    ? extension.meteringProvenance.clockCorrelation.maxSkewMillis
    : 0;
  const ordered = attempted
    .filter(([, value]) => Number.isInteger(value?.authoring?.terminalSequence))
    .sort((left, right) => (
      left[1].authoring.terminalSequence - right[1].authoring.terminalSequence
    ));
  const observationWindow = new Map(ordered.map(([milestone, value], index) => [
    milestone,
    {
      lower: index === 0 ? null : Date.parse(ordered[index - 1][1].authoring.terminalAt),
      upper: Date.parse(value.authoring.terminalAt),
    },
  ]));
  for (const event of loaded.events) {
    const window = observationWindow.get(event.milestone);
    if (!window) {
      errors.push(`$/socialMessenger/meteringProvenance/observations: ${event.type} names unattempted milestone ${event.milestone}`);
      continue;
    }
    const at = Date.parse(event.at);
    if (at > window.upper + observationSkewMillis) {
      errors.push(`$/socialMessenger/meteringProvenance/observations: ${event.milestone} ${event.type} is after its terminal boundary`);
    }
    if (window.lower !== null && at < window.lower - observationSkewMillis) {
      errors.push(`$/socialMessenger/meteringProvenance/observations: ${event.milestone} ${event.type} predates its milestone window`);
    }
  }
  for (const [milestone, value] of attempted) {
    const path = `$/socialMessenger/milestones/${milestone}`;
    let projected;
    try {
      projected = projectMilestoneObservability({
        events: loaded.events,
        evidence: loaded.evidence,
        milestone,
      });
    } catch (error) {
      errors.push(`${path}: observation projection failed: ${error.message}`);
      continue;
    }
    for (const block of OBSERVABILITY_BLOCKS) {
      if (value[block] === undefined) {
        if (currentInstrument) {
          errors.push(`${path}/${block}: current instrument requires an explicit claimed or non-claimed block`);
        }
        continue;
      }
      if (!sameJson(value[block], projected[block])) {
        errors.push(
          `${path}/${block}: record block does not equal the projection recomputed from its typed, hash-verified observation events`,
        );
      }
    }
  }

  const observedMilestones = Object.fromEntries(attempted.map(([milestone, value]) => [
    milestone,
    Object.fromEntries(OBSERVABILITY_BLOCKS.map((block) => [
      block,
      value[block] ?? { claimed: false, reason: "absent" },
    ])),
  ]));
  const expectedEligibility = scorecardEligibility({
    milestones: observedMilestones,
    phaseUsageAvailable: Number.isInteger(record.tokens?.input)
      && Number.isInteger(record.tokens?.output),
  });
  if (!sameJson(extension.efficiencyScorecardEligibility, expectedEligibility)) {
    errors.push(
      "$/socialMessenger/efficiencyScorecardEligibility: eligibility must equal the validator-recomputed phase, claim, load, and interruption consequences",
    );
  }
}

function loadSuiteReceiptAttestations(errors, extension, artifactRoot, currentInstrument) {
  const byMilestone = new Map();
  if (!currentInstrument) return byMilestone;
  const receipts = Array.isArray(extension.meteringProvenance?.receipts)
    ? extension.meteringProvenance.receipts
    : [];
  for (const [index, descriptor] of receipts.entries()) {
    const path = `$/socialMessenger/meteringProvenance/receipts/${index}`;
    const milestone = descriptor?.milestone;
    if (!/^M[1-8]$/u.test(milestone ?? "")) continue;
    const loaded = resolveArtifact(errors, artifactRoot, descriptor, path);
    if (loaded === null) continue;
    let records;
    try {
      records = parseJsonLines(loaded.text, descriptor.path);
    } catch (error) {
      errors.push(`${path}: invalid choreography receipt stream: ${error.message}`);
      continue;
    }
    for (const [recordIndex, record] of records.entries()) {
      const receiptPath = `${path}/records/${recordIndex}`;
      const schemaErrors = validateJsonSchema(RECEIPT_SCHEMA, record);
      if (schemaErrors.length > 0) {
        errors.push(
          `${receiptPath}: receipt does not satisfy receipts.schema.json: ${schemaErrors.join("; ")}`,
        );
        continue;
      }
      for (const [timingIndex, timing] of (record.timings ?? []).entries()) {
        if (timing.settlementWaitMs > timing.durationMs) {
          errors.push(
            `${receiptPath}/timings/${timingIndex}/settlementWaitMs: settlement wait exceeds the complete attempt duration`,
          );
        }
      }
      if (record?.runId !== descriptor.runId) {
        errors.push(`${path}: receipt ${recordIndex + 1} does not match retained runId`);
      }
      if (
        typeof record?.segment === "string"
        && record.segment.toUpperCase() !== milestone
      ) {
        errors.push(`${path}: receipt ${recordIndex + 1} does not match ${milestone}`);
      }
      if (
        record?.type === "segment-summary"
        && record?.version === CURRENT_CHOREOGRAPHY_VERSION
        && record?.segment?.toUpperCase() === milestone
      ) {
        const attestations = byMilestone.get(milestone) ?? [];
        attestations.push(record);
        byMilestone.set(milestone, attestations);
      }
    }
  }
  return byMilestone;
}

function validateSuiteStatusLinkage(errors, extension, artifactRoot, currentInstrument) {
  const linkage = extension.suiteStatusLinkage;
  if (!linkage) {
    if (currentInstrument) {
      errors.push("$/socialMessenger/suiteStatusLinkage: current instrument requires hash-bound suite-status custody");
    }
    return;
  }
  const receiptAttestations = loadSuiteReceiptAttestations(
    errors,
    extension,
    artifactRoot,
    currentInstrument,
  );
  const input = resolveArtifact(
    errors,
    artifactRoot,
    linkage.input,
    "$/socialMessenger/suiteStatusLinkage/input",
  );
  let statuses = null;
  if (input !== null) {
    try {
      statuses = JSON.parse(input.text);
    } catch (error) {
      errors.push(`$/socialMessenger/suiteStatusLinkage/input: invalid JSON: ${error.message}`);
    }
    if (!statuses || Array.isArray(statuses) || typeof statuses !== "object") {
      errors.push("$/socialMessenger/suiteStatusLinkage/input: expected an object keyed by milestone");
      statuses = null;
    }
  }
  const linked = new Set();
  const linkageMilestones = Array.isArray(linkage.milestones) ? linkage.milestones : [];
  for (const [index, entry] of linkageMilestones.entries()) {
    const path = `$/socialMessenger/suiteStatusLinkage/milestones/${index}`;
    if (!entry || typeof entry !== "object" || !/^M[1-8]$/u.test(entry.milestone ?? "")) {
      errors.push(`${path}/milestone: expected M1 through M8`);
      continue;
    }
    if (linked.has(entry.milestone)) {
      errors.push(
        `${path}/milestone: duplicate suite-status milestone`,
      );
    }
    linked.add(entry.milestone);
    if (!Object.hasOwn(extension.milestones ?? {}, entry.milestone)) {
      errors.push(
        `$/socialMessenger/suiteStatusLinkage/milestones/${index}/milestone: linked milestone is absent from the run record`,
      );
    }
    const status = statuses?.[entry.milestone.toLowerCase()];
    if (!status || typeof status !== "object" || typeof status.pass !== "boolean") {
      errors.push(`${path}: retained suite-status input lacks ${entry.milestone.toLowerCase()}`);
      continue;
    }
    if (status.pass !== entry.pass) {
      errors.push(`${path}/pass: value differs from the retained suite-status input`);
    }
    if (currentInstrument) {
      const attestations = receiptAttestations.get(entry.milestone) ?? [];
      const milestoneRecord = extension.milestones?.[entry.milestone];
      const requiredAttestations = milestoneRecord?.status === "green" ? 1 : 0;
      if (
        attestations.length > 1
        || (requiredAttestations === 1 && attestations.length !== 1)
      ) {
        errors.push(
          `${path}: expected ${requiredAttestations === 1 ? "exactly one" : "at most one"} hash-verified 0.3.3-m8 segment-summary, received ${attestations.length}`,
        );
      } else if (attestations.length === 1) {
        const attestation = attestations[0];
        if (attestation.suite?.pass !== entry.pass) {
          errors.push(`${path}/pass: value differs from the refusal-time segment-summary`);
        }
        if ((attestation.suite?.receipt ?? null) !== (status.receipt ?? null)) {
          errors.push(`${path}/receipt: suite-status path differs from the refusal-time segment-summary`);
        }
        if (
          (attestation.suite?.receiptSha256 ?? null)
          !== (entry.receipt?.sha256 ?? null)
        ) {
          errors.push(`${path}/receipt/sha256: digest differs from the refusal-time segment-summary`);
        }
        if (
          milestoneRecord?.status === "green"
          && (
            attestation.green !== true
            || attestation.choreography?.pass !== true
            || Date.parse(attestation.recordedAt)
              !== Date.parse(milestoneRecord.authoring?.firstGreenAt)
            || Date.parse(attestation.recordedAt)
              > Date.parse(milestoneRecord.authoring?.terminalAt)
          )
        ) {
          errors.push(`${path}: green milestone lacks a matching first-green 0.3.3-m8 segment-summary`);
        }
      }
    }
    if (entry.pass && entry.receipt === null) {
      errors.push(`${path}/receipt: pass:true requires a retained receipt artifact`);
    }
    const rawReceipt = status.receipt ?? null;
    if (rawReceipt !== null && (typeof rawReceipt !== "string" || rawReceipt.length === 0)) {
      errors.push(`${path}/receipt: suite-status receipt must be null or a non-empty string`);
      continue;
    }
    if (rawReceipt === null) {
      if (entry.receipt !== null) {
        errors.push(`${path}/receipt: record links a receipt absent from suite-status input`);
      }
      continue;
    }
    if (isAbsolute(rawReceipt)) {
      errors.push(`${path}/receipt: suite-status receipt path must be relative to its input file`);
      continue;
    }
    const canonicalArtifactRoot = artifactRoot ? realpathSync(artifactRoot) : null;
    if (!canonicalArtifactRoot) {
      errors.push(`${path}/receipt: artifactRoot is required to resolve the suite receipt`);
      continue;
    }
    const expectedPath = resolve(dirname(input?.absolute ?? canonicalArtifactRoot), normalize(rawReceipt));
    if (!inside(canonicalArtifactRoot, expectedPath)) {
      errors.push(`${path}/receipt: suite-status receipt escapes the record evidence directory`);
      continue;
    }
    let canonicalExpectedPath;
    try {
      canonicalExpectedPath = realpathSync(expectedPath);
      if (!inside(canonicalArtifactRoot, canonicalExpectedPath)) {
        throw new Error("canonical path escapes the record evidence directory");
      }
    } catch (error) {
      errors.push(`${path}/receipt: cannot resolve suite-status receipt path: ${error.message}`);
      continue;
    }
    const receipt = entry.receipt === null
      ? null
      : resolveArtifact(errors, artifactRoot, entry.receipt, `${path}/receipt`);
    if (receipt === null) {
      if (entry.receipt === null) errors.push(`${path}/receipt: referenced suite receipt is not retained`);
      continue;
    }
    if (resolve(receipt.absolute) !== resolve(canonicalExpectedPath)) {
      errors.push(`${path}/receipt/path: linked artifact does not resolve to the suite-status receipt path`);
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
export function validateSocialMessengerRecordSemantics(record, { artifactRoot = null } = {}) {
  const errors = [];
  const extension = record?.socialMessenger;
  if (extension === null || typeof extension !== "object") return errors;
  const currentInstrument = extension.instrumentVersion === CURRENT_INSTRUMENT_PIN;
  const currentProtocolMarker = extension.observabilityProtocol === OBSERVATION_VERSION;
  const currentOrientationMarker = (
    extension.orientation?.instrument?.pin === CURRENT_INSTRUMENT_PIN
    || extension.orientation?.instrument?.versions?.choreography === CURRENT_CHOREOGRAPHY_VERSION
  );
  if (!currentInstrument && (currentProtocolMarker || currentOrientationMarker)) {
    errors.push(
      `$/socialMessenger/instrumentVersion: current observability/orientation markers require ${CURRENT_INSTRUMENT_PIN}`,
    );
  }

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
    if (currentInstrument && value.status === "green") {
      for (const owner of ["suite", "choreography"]) {
        if (
          value.browserAssertionWait?.[owner]?.claimed === true
          && value.browserAssertionWait[owner].attempts === 0
        ) {
          errors.push(
            `${path}/browserAssertionWait/${owner}/attempts: green current-instrument milestones require at least one measured ${owner} settlement attempt`,
          );
        }
      }
    }
    if (
      currentInstrument
      && value.status === "green"
      && value.semanticActions?.claimed === true
      && value.semanticActions.total === 0
    ) {
      errors.push(
        `${path}/semanticActions/total: green current-instrument milestones require at least one native-driver semantic action`,
      );
    }
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
  // @ref LLP 0201#d2--quantitative-instrument — current records either bind
  // typed observation streams or retain explicit non-claims; the validator
  // derives eligibility from the same events.
  validateObservationBinding(errors, record, extension, artifactRoot, currentInstrument);
  // @ref LLP 0281#w6-suite-status-linkage-ergonomics — a retained linkage
  // covers every attempted milestone; the choreography refuses it earlier.
  validateSuiteStatusLinkage(errors, extension, artifactRoot, currentInstrument);
  return errors;
}

export function validateSocialMessengerRunRecord(
  schema,
  record,
  { schemas = [], tolerateAdditiveFields = false, artifactRoot = null } = {},
) {
  return [
    ...validateJsonSchema(schema, record, { schemas, tolerateAdditiveFields }),
    ...validateSocialMessengerRecordSemantics(record, { artifactRoot }),
  ];
}
