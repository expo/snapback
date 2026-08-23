import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadavg } from "node:os";

// @ref LLP 0295#d06--efficiency-instrument-and-target-registration — typed
// retained events are the authority for every claimed observability aggregate;
// unavailable native streams become explicit scorecard-affecting non-claims.
export const OBSERVATION_VERSION = "social-messenger-observation.v1";
export const COSTLY_EPISODE_THRESHOLD_ACTIONS = 2;

export const OBSERVABILITY_BLOCKS = Object.freeze([
  "semanticActions",
  "failureToRecoveryEpisodes",
  "restartReseed",
  "browserAssertionWait",
  "hostLoad",
  "apiInterruptions",
]);

export const SEMANTIC_ACTION_CLASSES = Object.freeze([
  "guide-lookup",
  "source-inspection",
  "edit",
  "generate",
  "process",
  "reseed",
  "suite",
  "choreography",
  "retry",
]);

const RETRIED_CLASSES = new Set(
  SEMANTIC_ACTION_CLASSES.filter((value) => value !== "retry"),
);
const DISPOSITIONS = new Set(["progress", "correction"]);
const CARRIERS = new Set([
  "snapback-refusal",
  "compiler-codegen-diagnostic",
  "bare-not-found",
  "silent-discovery-miss",
  "other",
]);
const ATTRIBUTIONS = new Set([
  "snapback-defect",
  "agent-error",
  "environment",
  "ambiguous",
]);
const SUB_ATTRIBUTIONS = new Set(["defect", "knowledge-gap"]);
const OUTCOMES = new Set(["recovered", "unresolved"]);
const MILESTONE = /^M[1-8]$/u;
const BASE_FIELDS = ["version", "laneRunId", "milestone", "sequence", "at", "type"];
const EVENT_FIELDS = Object.freeze({
  "block-claim": [...BASE_FIELDS, "block", "claimed", "reason"],
  "semantic-action": [
    ...BASE_FIELDS,
    "actionId",
    "actionClass",
    "disposition",
    "episodeId",
    "retriedClass",
    "binaryExcavation",
  ],
  "recovery-episode": [
    ...BASE_FIELDS,
    "episodeId",
    "carrier",
    "attribution",
    "subAttribution",
    "outcome",
    "recoveredAt",
    "actionCount",
  ],
  lifecycle: [...BASE_FIELDS, "operation", "destructive"],
  "assertion-wait": [
    ...BASE_FIELDS,
    "owner",
    "assertion",
    "attempt",
    "durationMs",
    "pass",
  ],
  "host-load-sample": [
    ...BASE_FIELDS,
    "loadavg1",
    "loadavg5",
    "loadavg15",
    "ceiling1",
    "ceiling5",
    "ceiling15",
  ],
  "api-request": [
    ...BASE_FIELDS,
    "provider",
    "operation",
    "requestId",
    "outcome",
    "retryOf",
  ],
});

const NON_CLAIM_REASONS = Object.freeze({
  semanticActions: "harness-native-semantic-actions-unavailable",
  failureToRecoveryEpisodes: "harness-native-recovery-episodes-unavailable",
  restartReseed: "lane-lifecycle-events-unavailable",
  browserAssertionWait: "complete-suite-and-choreography-waits-unavailable",
  hostLoad: "host-load-sampling-unavailable",
  apiInterruptions: "harness-api-request-outcomes-unavailable",
});

const BLOCK_EVENT_TYPES = Object.freeze({
  semanticActions: ["semantic-action"],
  failureToRecoveryEpisodes: ["recovery-episode"],
  restartReseed: ["lifecycle"],
  browserAssertionWait: ["assertion-wait"],
  hostLoad: ["host-load-sample"],
  apiInterruptions: ["api-request"],
});

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requiredTimestamp(value, label) {
  requiredString(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an RFC 3339 timestamp`);
  }
  return value;
}

function requiredInteger(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function requiredNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
  return value;
}

function requiredEnum(value, values, label) {
  if (!values.has(value)) {
    throw new TypeError(`${label} must be one of: ${[...values].join(", ")}`);
  }
  return value;
}

function requiredNullableString(value, label) {
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    throw new TypeError(`${label} must be null or a non-empty string`);
  }
  return value;
}

function normalizeBase(event, label) {
  if (!event || Array.isArray(event) || typeof event !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  if (event.version !== OBSERVATION_VERSION) {
    throw new TypeError(`${label}.version must be ${OBSERVATION_VERSION}`);
  }
  const laneRunId = requiredString(event.laneRunId, `${label}.laneRunId`);
  if (!MILESTONE.test(event.milestone)) {
    throw new TypeError(`${label}.milestone must name M1 through M8`);
  }
  return {
    version: OBSERVATION_VERSION,
    laneRunId,
    milestone: event.milestone,
    sequence: requiredInteger(event.sequence, `${label}.sequence`),
    at: requiredTimestamp(event.at, `${label}.at`),
    type: requiredString(event.type, `${label}.type`),
  };
}

function rejectUnknownFields(event, label, type) {
  const allowed = EVENT_FIELDS[type];
  if (!allowed) return;
  const unknown = Object.keys(event).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`${label} has unknown field(s): ${unknown.join(", ")}`);
  }
}

export function normalizeObservationEvent(event, label = "observation") {
  const base = normalizeBase(event, label);
  rejectUnknownFields(event, label, base.type);
  switch (base.type) {
    case "block-claim": {
      if (!OBSERVABILITY_BLOCKS.includes(event.block)) {
        throw new TypeError(`${label}.block is not a D0.6 observability block`);
      }
      if (typeof event.claimed !== "boolean") {
        throw new TypeError(`${label}.claimed must be boolean`);
      }
      const reason = event.reason ?? null;
      if (event.claimed && reason !== null) {
        throw new TypeError(`${label}.reason must be null when claimed is true`);
      }
      if (!event.claimed) requiredString(reason, `${label}.reason`);
      return { ...base, block: event.block, claimed: event.claimed, reason };
    }
    case "semantic-action": {
      const actionClass = requiredEnum(
        event.actionClass,
        new Set(SEMANTIC_ACTION_CLASSES),
        `${label}.actionClass`,
      );
      const disposition = requiredEnum(event.disposition, DISPOSITIONS, `${label}.disposition`);
      const episodeId = requiredNullableString(event.episodeId ?? null, `${label}.episodeId`);
      const retriedClass = requiredNullableString(event.retriedClass ?? null, `${label}.retriedClass`);
      if (actionClass === "retry" && !RETRIED_CLASSES.has(retriedClass)) {
        throw new TypeError(`${label}.retriedClass must name the failed class when actionClass is retry`);
      }
      if (actionClass !== "retry" && retriedClass !== null) {
        throw new TypeError(`${label}.retriedClass is only valid for retry actions`);
      }
      if (typeof event.binaryExcavation !== "boolean") {
        throw new TypeError(`${label}.binaryExcavation must be boolean`);
      }
      if (event.binaryExcavation && actionClass !== "source-inspection") {
        throw new TypeError(`${label}.binaryExcavation requires source-inspection`);
      }
      if (disposition === "progress" && episodeId !== null) {
        throw new TypeError(`${label}.episodeId is only valid for correction actions`);
      }
      if (actionClass === "retry" && episodeId === null) {
        throw new TypeError(`${label}.episodeId is required for retry actions`);
      }
      return {
        ...base,
        actionId: requiredString(event.actionId, `${label}.actionId`),
        actionClass,
        disposition,
        episodeId,
        retriedClass,
        binaryExcavation: event.binaryExcavation,
      };
    }
    case "recovery-episode": {
      const attribution = requiredEnum(event.attribution, ATTRIBUTIONS, `${label}.attribution`);
      const subAttribution = requiredNullableString(
        event.subAttribution ?? null,
        `${label}.subAttribution`,
      );
      if (
        attribution === "snapback-defect"
        && !SUB_ATTRIBUTIONS.has(subAttribution)
      ) {
        throw new TypeError(`${label}.subAttribution is required for snapback-defect`);
      }
      if (attribution !== "snapback-defect" && subAttribution !== null) {
        throw new TypeError(`${label}.subAttribution is forbidden outside snapback-defect`);
      }
      const outcome = requiredEnum(event.outcome, OUTCOMES, `${label}.outcome`);
      const recoveredAt = event.recoveredAt ?? null;
      if (recoveredAt !== null) requiredTimestamp(recoveredAt, `${label}.recoveredAt`);
      if ((outcome === "recovered") !== (recoveredAt !== null)) {
        throw new TypeError(`${label}.recoveredAt must be present exactly for recovered episodes`);
      }
      return {
        ...base,
        episodeId: requiredString(event.episodeId, `${label}.episodeId`),
        carrier: requiredEnum(event.carrier, CARRIERS, `${label}.carrier`),
        attribution,
        subAttribution,
        outcome,
        recoveredAt,
        actionCount: requiredInteger(
          event.actionCount,
          `${label}.actionCount`,
          COSTLY_EPISODE_THRESHOLD_ACTIONS,
        ),
      };
    }
    case "lifecycle": {
      if (!["restart", "reseed"].includes(event.operation)) {
        throw new TypeError(`${label}.operation must be restart or reseed`);
      }
      if (typeof event.destructive !== "boolean") {
        throw new TypeError(`${label}.destructive must be boolean`);
      }
      if (event.operation === "restart" && event.destructive) {
        throw new TypeError(`${label}.destructive is only valid for reseed`);
      }
      return { ...base, operation: event.operation, destructive: event.destructive };
    }
    case "assertion-wait": {
      if (!["suite", "choreography"].includes(event.owner)) {
        throw new TypeError(`${label}.owner must be suite or choreography`);
      }
      if (typeof event.pass !== "boolean") {
        throw new TypeError(`${label}.pass must be boolean`);
      }
      return {
        ...base,
        owner: event.owner,
        assertion: requiredString(event.assertion, `${label}.assertion`),
        attempt: requiredInteger(event.attempt, `${label}.attempt`, 1),
        durationMs: requiredNumber(event.durationMs, `${label}.durationMs`),
        pass: event.pass,
      };
    }
    case "host-load-sample":
      return {
        ...base,
        loadavg1: requiredNumber(event.loadavg1, `${label}.loadavg1`),
        loadavg5: requiredNumber(event.loadavg5, `${label}.loadavg5`),
        loadavg15: requiredNumber(event.loadavg15, `${label}.loadavg15`),
        ceiling1: requiredNumber(event.ceiling1, `${label}.ceiling1`),
        ceiling5: requiredNumber(event.ceiling5, `${label}.ceiling5`),
        ceiling15: requiredNumber(event.ceiling15, `${label}.ceiling15`),
      };
    case "api-request": {
      if (!["error", "success"].includes(event.outcome)) {
        throw new TypeError(`${label}.outcome must be error or success`);
      }
      return {
        ...base,
        provider: requiredString(event.provider, `${label}.provider`),
        operation: requiredString(event.operation, `${label}.operation`),
        requestId: requiredString(event.requestId, `${label}.requestId`),
        outcome: event.outcome,
        retryOf: requiredNullableString(event.retryOf ?? null, `${label}.retryOf`),
      };
    }
    default:
      throw new TypeError(`${label}.type is not recognized: ${base.type}`);
  }
}

export function parseObservationJsonLines(text, label = "observations") {
  const events = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.trim() === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new SyntaxError(`${label}:${index + 1}: ${error.message}`);
    }
    events.push(normalizeObservationEvent(event, `${label}:${index + 1}`));
  }
  const identities = new Set();
  for (const event of events) {
    const identity = `${event.laneRunId}\0${event.sequence}`;
    if (identities.has(identity)) {
      throw new Error(`${label}: duplicate observation sequence ${event.sequence}`);
    }
    identities.add(identity);
  }
  return events.sort((left, right) => (
    Date.parse(left.at) - Date.parse(right.at) || left.sequence - right.sequence
  ));
}

function zeroMap(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function blockClaim(events, milestone, block) {
  const claims = events.filter((event) => (
    event.type === "block-claim"
    && event.milestone === milestone
    && event.block === block
  ));
  if (claims.length > 1) {
    throw new Error(`${milestone}.${block} has duplicate claim events`);
  }
  return claims[0] ?? null;
}

function nonClaim(block, reason = NON_CLAIM_REASONS[block]) {
  return { claimed: false, reason };
}

function claimedBase(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error("claimed observability requires at least one retained evidence artifact");
  }
  return { claimed: true, evidence: structuredClone(evidence) };
}

function milestoneEvents(events, milestone, type) {
  return events.filter((event) => event.milestone === milestone && event.type === type);
}

function semanticProjection(events, milestone, evidence) {
  const actions = milestoneEvents(events, milestone, "semantic-action");
  const byClass = zeroMap(SEMANTIC_ACTION_CLASSES);
  const byDisposition = { progress: 0, correction: 0 };
  const byRetriedClass = zeroMap([...RETRIED_CLASSES]);
  let binaryExcavation = 0;
  for (const action of actions) {
    byClass[action.actionClass] += 1;
    byDisposition[action.disposition] += 1;
    if (action.retriedClass !== null) byRetriedClass[action.retriedClass] += 1;
    if (action.binaryExcavation) binaryExcavation += 1;
  }
  return {
    ...claimedBase(evidence),
    total: actions.length,
    byClass,
    byDisposition,
    byRetriedClass,
    binaryExcavation,
  };
}

function episodeProjection(events, milestone, evidence) {
  const episodes = milestoneEvents(events, milestone, "recovery-episode");
  const byCarrier = zeroMap([...CARRIERS]);
  const byAttribution = zeroMap([...ATTRIBUTIONS]);
  const bySubAttribution = zeroMap([...SUB_ATTRIBUTIONS]);
  const byOutcome = zeroMap([...OUTCOMES]);
  const ids = new Set();
  for (const episode of episodes) {
    if (ids.has(episode.episodeId)) {
      throw new Error(`${milestone} repeats recovery episode ${episode.episodeId}`);
    }
    ids.add(episode.episodeId);
    byCarrier[episode.carrier] += 1;
    byAttribution[episode.attribution] += 1;
    if (episode.subAttribution !== null) bySubAttribution[episode.subAttribution] += 1;
    byOutcome[episode.outcome] += 1;
  }
  return {
    ...claimedBase(evidence),
    costlyEpisodeThresholdActions: COSTLY_EPISODE_THRESHOLD_ACTIONS,
    total: episodes.length,
    byCarrier,
    byAttribution,
    bySubAttribution,
    byOutcome,
  };
}

function validateActionEpisodeJoin(events, milestone) {
  const actions = milestoneEvents(events, milestone, "semantic-action");
  const episodes = milestoneEvents(events, milestone, "recovery-episode");
  const episodeById = new Map(episodes.map((episode) => [episode.episodeId, episode]));
  const actionCountByEpisode = new Map();
  const actionIds = new Set();
  for (const action of actions) {
    if (actionIds.has(action.actionId)) {
      throw new Error(`${milestone} repeats semantic action ${action.actionId}`);
    }
    actionIds.add(action.actionId);
    if (action.episodeId === null) continue;
    if (!episodeById.has(action.episodeId)) {
      throw new Error(`${milestone} correction action ${action.actionId} names missing episode ${action.episodeId}`);
    }
    actionCountByEpisode.set(
      action.episodeId,
      (actionCountByEpisode.get(action.episodeId) ?? 0) + 1,
    );
  }
  for (const episode of episodes) {
    const actual = actionCountByEpisode.get(episode.episodeId) ?? 0;
    if (actual !== episode.actionCount) {
      throw new Error(
        `${milestone} episode ${episode.episodeId} actionCount ${episode.actionCount} does not match ${actual} correction actions`,
      );
    }
  }
}

function lifecycleProjection(events, milestone, evidence) {
  const lifecycle = milestoneEvents(events, milestone, "lifecycle");
  return {
    ...claimedBase(evidence),
    restarts: lifecycle.filter((event) => event.operation === "restart").length,
    reseeds: lifecycle.filter((event) => event.operation === "reseed").length,
    destructiveReseeds: lifecycle.filter(
      (event) => event.operation === "reseed" && event.destructive,
    ).length,
  };
}

function assertionProjection(events, milestone, evidence) {
  const waits = milestoneEvents(events, milestone, "assertion-wait");
  const projection = {
    ...claimedBase(evidence),
    suite: { attempts: 0, waitMillis: 0 },
    choreography: { attempts: 0, waitMillis: 0 },
  };
  for (const wait of waits) {
    projection[wait.owner].attempts += 1;
    projection[wait.owner].waitMillis += wait.durationMs;
  }
  return projection;
}

function hostLoadProjection(events, milestone, evidence) {
  const samples = milestoneEvents(events, milestone, "host-load-sample");
  if (samples.length === 0) {
    throw new Error(`${milestone}.hostLoad was claimed but contains no samples`);
  }
  const breaches = [];
  for (const sample of samples) {
    for (const [metric, observed, ceiling] of [
      ["loadavg1", sample.loadavg1, sample.ceiling1],
      ["loadavg5", sample.loadavg5, sample.ceiling5],
      ["loadavg15", sample.loadavg15, sample.ceiling15],
    ]) {
      if (observed > ceiling) breaches.push({ at: sample.at, metric, observed, ceiling });
    }
  }
  return {
    ...claimedBase(evidence),
    startedAt: samples[0].at,
    endedAt: samples.at(-1).at,
    sampleCount: samples.length,
    contamination: breaches.length > 0,
    breaches,
  };
}

function apiProjection(events, milestone, evidence) {
  const requests = milestoneEvents(events, milestone, "api-request");
  const open = new Map();
  const requestById = new Map();
  const windows = [];
  for (const request of requests) {
    if (requestById.has(request.requestId)) {
      throw new Error(`${milestone} repeats API request identity ${request.requestId}`);
    }
    if (request.retryOf !== null) {
      const prior = requestById.get(request.retryOf);
      if (
        prior === undefined
        || prior.outcome !== "error"
        || prior.provider !== request.provider
        || prior.operation !== request.operation
      ) {
        throw new Error(
          `${milestone} API request ${request.requestId} retries no matching failed request ${request.retryOf}`,
        );
      }
    }
    const key = `${request.provider}\0${request.operation}`;
    if (request.outcome === "error") {
      const current = open.get(key);
      if (current) current.failedRequests += 1;
      else {
        const window = {
          provider: request.provider,
          operation: request.operation,
          startedAt: request.at,
          recoveredAt: null,
          failedRequests: 1,
        };
        windows.push(window);
        open.set(key, window);
      }
    } else if (open.has(key)) {
      if (request.retryOf === null) {
        throw new Error(
          `${milestone} API recovery ${request.requestId} must identify the failed request it retries`,
        );
      }
      open.get(key).recoveredAt = request.at;
      open.delete(key);
    }
    requestById.set(request.requestId, request);
  }
  return {
    ...claimedBase(evidence),
    interrupted: windows.length > 0,
    windows,
  };
}

const PROJECTORS = Object.freeze({
  semanticActions: semanticProjection,
  failureToRecoveryEpisodes: episodeProjection,
  restartReseed: lifecycleProjection,
  browserAssertionWait: assertionProjection,
  hostLoad: hostLoadProjection,
  apiInterruptions: apiProjection,
});

export function projectMilestoneObservability({ events = [], evidence = [], milestone }) {
  const result = {};
  for (const block of OBSERVABILITY_BLOCKS) {
    const claim = blockClaim(events, milestone, block);
    const observed = events.filter((event) => (
      event.milestone === milestone && BLOCK_EVENT_TYPES[block].includes(event.type)
    ));
    if (claim === null) {
      if (observed.length > 0) {
        throw new Error(`${milestone}.${block} has observations but no explicit coverage claim`);
      }
      result[block] = nonClaim(block);
    } else if (!claim.claimed) {
      if (observed.length > 0) {
        throw new Error(`${milestone}.${block} is non-claimed but contains observations`);
      }
      result[block] = nonClaim(block, claim.reason);
    } else {
      result[block] = PROJECTORS[block](events, milestone, evidence);
    }
  }
  if (result.semanticActions.claimed && result.failureToRecoveryEpisodes.claimed) {
    validateActionEpisodeJoin(events, milestone);
  }
  return result;
}

export function scorecardEligibility({ milestones, phaseUsageAvailable }) {
  const reasons = [];
  if (!phaseUsageAvailable) reasons.push("phase-usage-unavailable");
  for (const value of Object.values(milestones)) {
    if (value?.semanticActions?.claimed !== true) reasons.push("semantic-actions-non-claimed");
    if (value?.failureToRecoveryEpisodes?.claimed !== true) reasons.push("recovery-episodes-non-claimed");
    if (value?.restartReseed?.claimed !== true) reasons.push("restart-reseed-non-claimed");
    if (value?.browserAssertionWait?.claimed !== true) reasons.push("assertion-waits-non-claimed");
    if (value?.hostLoad?.claimed !== true) reasons.push("host-load-non-claimed");
    else if (value.hostLoad.contamination) reasons.push("host-load-contamination");
    if (value?.apiInterruptions?.claimed !== true) reasons.push("api-interruptions-non-claimed");
    else if (value.apiInterruptions.interrupted) reasons.push("api-interruption");
  }
  const uniqueReasons = [...new Set(reasons)].sort();
  const correctionActionTargetEligible = uniqueReasons.length === 0;
  return {
    eligible: uniqueReasons.length === 0,
    correctionActionTargetEligible,
    ineligibilityReasons: uniqueReasons,
  };
}

export class ObservationWriter {
  constructor({ path, laneRunId, now = () => new Date().toISOString() }) {
    this.path = path;
    this.laneRunId = requiredString(laneRunId, "laneRunId");
    this.now = now;
    this.sequence = 0;
    this.initialized = false;
  }

  async initialize({ append = false } = {}) {
    await mkdir(dirname(this.path), { recursive: true });
    if (!append) await writeFile(this.path, "", "utf8");
    this.initialized = true;
  }

  async record(milestone, type, fields = {}) {
    if (!this.initialized) throw new Error("observation writer must be initialized");
    this.sequence += 1;
    const event = normalizeObservationEvent({
      version: OBSERVATION_VERSION,
      laneRunId: this.laneRunId,
      milestone,
      sequence: this.sequence,
      at: this.now(),
      type,
      ...fields,
    });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  claim(milestone, block) {
    return this.record(milestone, "block-claim", { block, claimed: true, reason: null });
  }

  nonClaim(milestone, block, reason = NON_CLAIM_REASONS[block]) {
    return this.record(milestone, "block-claim", { block, claimed: false, reason });
  }

  restart(milestone) {
    return this.record(milestone, "lifecycle", { operation: "restart", destructive: false });
  }

  reseed(milestone, { destructive = false } = {}) {
    return this.record(milestone, "lifecycle", { operation: "reseed", destructive });
  }

  assertionWait(milestone, fields) {
    return this.record(milestone, "assertion-wait", fields);
  }

  semanticAction(milestone, fields) {
    return this.record(milestone, "semantic-action", fields);
  }

  recoveryEpisode(milestone, fields) {
    return this.record(milestone, "recovery-episode", fields);
  }

  apiRequest(milestone, fields) {
    return this.record(milestone, "api-request", fields);
  }
}

export class HostLoadSampler {
  constructor({ writer, milestone, ceilings, intervalMs = 60_000, sample = loadavg }) {
    if (!(writer instanceof ObservationWriter)) {
      throw new TypeError("HostLoadSampler.writer must be an ObservationWriter");
    }
    this.writer = writer;
    this.milestone = milestone;
    this.ceilings = {
      loadavg1: requiredNumber(ceilings?.loadavg1, "ceilings.loadavg1"),
      loadavg5: requiredNumber(ceilings?.loadavg5, "ceilings.loadavg5"),
      loadavg15: requiredNumber(ceilings?.loadavg15, "ceilings.loadavg15"),
    };
    this.intervalMs = requiredInteger(intervalMs, "intervalMs", 1);
    this.sample = sample;
    this.timer = null;
    this.pending = Promise.resolve();
  }

  async sampleNow() {
    const values = this.sample();
    if (!Array.isArray(values) || values.length !== 3) {
      throw new Error("host load sampler must return [loadavg1, loadavg5, loadavg15]");
    }
    return this.writer.record(this.milestone, "host-load-sample", {
      loadavg1: values[0],
      loadavg5: values[1],
      loadavg15: values[2],
      ceiling1: this.ceilings.loadavg1,
      ceiling5: this.ceilings.loadavg5,
      ceiling15: this.ceilings.loadavg15,
    });
  }

  async start() {
    if (this.timer !== null) throw new Error("host load sampler is already running");
    await this.writer.claim(this.milestone, "hostLoad");
    await this.sampleNow();
    this.timer = setInterval(() => {
      this.pending = this.pending.then(() => this.sampleNow());
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer === null) throw new Error("host load sampler is not running");
    clearInterval(this.timer);
    this.timer = null;
    await this.pending;
    await this.sampleNow();
  }
}

// The lane controller owns these seams: lifecycle commands, harness API
// requests, and the wall-clock interval surrounding a milestone. Keeping the
// calls beside the operations prevents post-hoc reconstruction from prose.
export class LaneObservationHarness {
  constructor({ writer, loadCeilings, loadIntervalMs = 60_000, loadSample = loadavg }) {
    if (!(writer instanceof ObservationWriter)) {
      throw new TypeError("LaneObservationHarness.writer must be an ObservationWriter");
    }
    this.writer = writer;
    this.loadCeilings = loadCeilings;
    this.loadIntervalMs = loadIntervalMs;
    this.loadSample = loadSample;
    this.samplers = new Map();
  }

  async startMilestone(
    milestone,
    {
      semanticActionsClaimed = false,
      semanticActionsReason = NON_CLAIM_REASONS.semanticActions,
      recoveryEpisodesClaimed = false,
      recoveryEpisodesReason = NON_CLAIM_REASONS.failureToRecoveryEpisodes,
    } = {},
  ) {
    if (this.samplers.has(milestone)) throw new Error(`${milestone} is already being observed`);
    await this.writer.claim(milestone, "restartReseed");
    await this.writer.claim(milestone, "apiInterruptions");
    if (semanticActionsClaimed) await this.writer.claim(milestone, "semanticActions");
    else await this.writer.nonClaim(milestone, "semanticActions", semanticActionsReason);
    if (recoveryEpisodesClaimed) {
      await this.writer.claim(milestone, "failureToRecoveryEpisodes");
    } else {
      await this.writer.nonClaim(
        milestone,
        "failureToRecoveryEpisodes",
        recoveryEpisodesReason,
      );
    }
    const sampler = new HostLoadSampler({
      writer: this.writer,
      milestone,
      ceilings: this.loadCeilings,
      intervalMs: this.loadIntervalMs,
      sample: this.loadSample,
    });
    await sampler.start();
    this.samplers.set(milestone, sampler);
  }

  restart(milestone) {
    return this.writer.restart(milestone);
  }

  reseed(milestone, options) {
    return this.writer.reseed(milestone, options);
  }

  semanticAction(milestone, event) {
    return this.writer.semanticAction(milestone, event);
  }

  recoveryEpisode(milestone, event) {
    return this.writer.recoveryEpisode(milestone, event);
  }

  async apiRequest(milestone, fields, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("LaneObservationHarness.apiRequest requires an operation function");
    }
    try {
      const result = await operation();
      await this.writer.apiRequest(milestone, { ...fields, outcome: "success" });
      return result;
    } catch (error) {
      await this.writer.apiRequest(milestone, { ...fields, outcome: "error" });
      throw error;
    }
  }

  async finishMilestone(milestone) {
    const sampler = this.samplers.get(milestone);
    if (!sampler) throw new Error(`${milestone} is not being observed`);
    this.samplers.delete(milestone);
    await sampler.stop();
  }
}

export function defaultNonClaimReason(block) {
  if (!OBSERVABILITY_BLOCKS.includes(block)) throw new Error(`unknown observability block ${block}`);
  return NON_CLAIM_REASONS[block];
}
