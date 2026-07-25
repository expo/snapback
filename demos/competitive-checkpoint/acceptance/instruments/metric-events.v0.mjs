// Candidate LLP 0075 event-to-metric projection. Raw events remain the
// authority; this module rejects ambiguous ledgers instead of guessing.

export const METRIC_EVENTS_IMPLEMENTATION_ID =
  'snapback.convex-checkpoint-metric-events.candidate.v0';
const METRIC_EVENTS_SCHEMA_VERSION =
  'snapback.convex-checkpoint-metric-events.candidate.v0';
const PROTOCOL_ID = 'llp-0075-convex-checkpoint-v0';
const PROTOCOL_VERSION = 'v0.4';
const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const CLASSIFICATION_KEYS = Object.freeze({
  'expected-refusal': 'expectedRefusals',
  'unexpected-failure': 'requiredFailures',
  retry: 'retries',
  'required-skip': 'skippedGates',
  'human-intervention': 'humanInterventions',
  'unplanned-credential-repair': 'unplannedCredentialRepairs',
  'correctness-failure': 'correctnessFailures',
  'security-failure': 'securityFailures',
  'cleanup-defect': 'cleanupDefects',
  'instrument-failure': 'instrumentFailures',
});

function canonicalUint(value, label) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${label} must be a canonical unsigned decimal string`);
  }
  return BigInt(value);
}

function requireSafeCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function elapsedMilliseconds(start, end, label) {
  if (end < start) throw new TypeError(`${label} precedes work-started`);
  const nanoseconds = end - start;
  const whole = nanoseconds / 1_000_000n;
  const remainder = nanoseconds % 1_000_000n;
  return Number(whole) + Number(remainder) / 1_000_000;
}

export function deriveSampleMetrics(receipt) {
  if (!receipt || typeof receipt !== 'object' || !Array.isArray(receipt.events)) {
    throw new TypeError('metric receipt must contain an events array');
  }
  if (
    receipt.schemaVersion !== METRIC_EVENTS_SCHEMA_VERSION
    || receipt.protocolId !== PROTOCOL_ID
    || receipt.protocolVersion !== PROTOCOL_VERSION
    || !SHA256.test(receipt.capsuleSha256 ?? '')
    || !IDENTIFIER.test(receipt.runId ?? '')
    || !IDENTIFIER.test(receipt.agentSessionId ?? '')
    || !['snapback', 'convex'].includes(receipt.arm)
    || !Number.isSafeInteger(receipt.executionSequence)
    || receipt.executionSequence < 0
    || !receipt.sample
    || !Number.isSafeInteger(receipt.sample.ordinal)
    || !(
      (receipt.sample.phase === 'timed'
        && receipt.sample.ordinal >= 1
        && receipt.sample.ordinal <= 7)
      || (receipt.sample.phase === 'warmup'
        && receipt.sample.ordinal >= 1
        && receipt.sample.ordinal <= 2)
    )
  ) {
    throw new TypeError('metric receipt has invalid protocol, run, arm, or timed-sample identity');
  }
  if (receipt.events.length < 2) {
    throw new TypeError('metric receipt must contain work-started and sample-finished');
  }

  const commandStarts = new Map();
  const commandFinishes = new Set();
  const milestones = new Map();
  const counts = Object.fromEntries(
    Object.values(CLASSIFICATION_KEYS).map((key) => [key, 0]),
  );
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let toolCalls = 0;
  let previousMonotonic = -1n;
  let workStarted = null;
  let sampleFinished = null;

  receipt.events.forEach((event, index) => {
    if (!event || typeof event !== 'object' || event.sequence !== index) {
      throw new TypeError(`event sequence must be contiguous at index ${index}`);
    }
    const monotonic = canonicalUint(event.monotonicNs, `events[${index}].monotonicNs`);
    if (monotonic <= previousMonotonic) {
      throw new TypeError(`event monotonicNs must increase strictly at index ${index}`);
    }
    previousMonotonic = monotonic;

    switch (event.kind) {
      case 'work-started':
        if (index !== 0 || workStarted !== null) {
          throw new TypeError('work-started must be the unique first event');
        }
        workStarted = monotonic;
        break;
      case 'command-started':
        if (commandStarts.has(event.commandId)) {
          throw new TypeError(`duplicate commandId ${event.commandId}`);
        }
        commandStarts.set(event.commandId, {
          monotonic,
          authored: event.authored,
        });
        break;
      case 'command-finished':
        if (!commandStarts.has(event.commandId) || commandFinishes.has(event.commandId)) {
          throw new TypeError(`unmatched command-finished ${event.commandId}`);
        }
        commandFinishes.add(event.commandId);
        break;
      case 'milestone-observed':
        if (milestones.has(event.milestone)) {
          throw new TypeError(`duplicate milestone ${event.milestone}`);
        }
        milestones.set(event.milestone, monotonic);
        break;
      case 'agent-usage':
        inputTokens += requireSafeCount(event.inputTokens, 'inputTokens');
        outputTokens += requireSafeCount(event.outputTokens, 'outputTokens');
        cachedInputTokens += requireSafeCount(event.cachedInputTokens, 'cachedInputTokens');
        toolCalls += requireSafeCount(event.toolCalls, 'toolCalls');
        break;
      case 'classification': {
        const key = CLASSIFICATION_KEYS[event.classification];
        if (!key) throw new TypeError(`unknown classification ${event.classification}`);
        counts[key] += 1;
        if (
          event.classification === 'expected-refusal'
          && (typeof event.expectedByGateId !== 'string' || event.expectedByGateId.length === 0)
        ) {
          throw new TypeError('expected-refusal must name expectedByGateId');
        }
        if (
          event.classification === 'instrument-failure'
          && (
            typeof event.documenter !== 'string'
            || event.documenter.length === 0
            || typeof event.rationale !== 'string'
            || event.rationale.length === 0
          )
        ) {
          throw new TypeError('instrument-failure must retain documenter and rationale');
        }
        break;
      }
      case 'sample-finished':
        if (index !== receipt.events.length - 1 || sampleFinished !== null) {
          throw new TypeError('sample-finished must be the unique final event');
        }
        sampleFinished = event;
        break;
      default:
        throw new TypeError(`unknown metric event kind ${event.kind}`);
    }
  });

  if (workStarted === null || sampleFinished === null) {
    throw new TypeError('receipt lacks exact work-started/sample-finished boundaries');
  }
  for (const commandId of commandStarts.keys()) {
    if (!commandFinishes.has(commandId)) {
      throw new TypeError(`command ${commandId} lacks command-finished`);
    }
  }
  const invalid = sampleFinished.outcome === 'instrument-invalid';
  if (invalid !== (counts.instrumentFailures > 0)) {
    throw new TypeError(
      'instrument-invalid outcome and retained instrument-failure classification must agree',
    );
  }

  const milestone = (name) => {
    const value = milestones.get(name);
    if (value === undefined) {
      if (invalid) return null;
      throw new TypeError(`valid sample lacks milestone ${name}`);
    }
    return value;
  };
  const local = milestone('first-local-live-row');
  const hosted = milestone('hosted-live-url');
  const authoredCommandsBefore = (boundary) => boundary === null
    ? null
    : [...commandStarts.values()].filter(
      (command) => command.authored && command.monotonic <= boundary,
    ).length;

  return {
    implementation: METRIC_EVENTS_IMPLEMENTATION_ID,
    capsuleSha256: receipt.capsuleSha256,
    runId: receipt.runId,
    executionSequence: receipt.executionSequence,
    arm: receipt.arm,
    phase: receipt.sample.phase,
    ordinal: receipt.sample.ordinal,
    agentSessionId: receipt.agentSessionId,
    valid: !invalid,
    localElapsedMs: local === null ? null : elapsedMilliseconds(workStarted, local, 'local milestone'),
    hostedElapsedMs:
      hosted === null ? null : elapsedMilliseconds(workStarted, hosted, 'hosted milestone'),
    localTopLevelCommands: authoredCommandsBefore(local),
    hostedTopLevelCommands: authoredCommandsBefore(hosted),
    agentTokens: inputTokens + outputTokens,
    agentTokenBreakdown: { inputTokens, outputTokens, cachedInputTokens },
    toolCalls,
    ...counts,
  };
}
