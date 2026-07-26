import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import {
  DEFAULT_BOOTSTRAP_RESAMPLES,
  DEFAULT_BOOTSTRAP_SEED,
  median,
  nearestRankPercentile,
  summarizeTwoArmMetric,
} from './statistics.v0.mjs';
import { deriveSampleMetrics } from './metric-events.v0.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (name) => JSON.parse(await readFile(join(here, name), 'utf8'));

const statisticsPin = await readJson('statistics.candidate.v0.json');
const metricPin = await readJson('metric-definitions.candidate.v0.json');
const instrumentLock = await readJson('instrument-lock.candidate.v0.json');
const schema = await readJson('metric-events.candidate.v0.schema.json');
const sourceDigest = async (name) => sha256(await readFile(join(here, name)));

for (const file of instrumentLock.files) {
  assert.equal(file.sha256, await sourceDigest(file.path), `instrument lock drifted: ${file.path}`);
}
assert.equal(
  statisticsPin.implementation.sha256,
  await sourceDigest('statistics.v0.mjs'),
  'statistics source digest drifted',
);
assert.equal(
  metricPin.eventSchema.sha256,
  await sourceDigest('metric-events.candidate.v0.schema.json'),
  'metric event schema digest drifted',
);
assert.equal(
  metricPin.projection.sha256,
  await sourceDigest('metric-events.v0.mjs'),
  'metric projection digest drifted',
);

assert.equal(median([7, 1, 6, 2, 5, 3, 4]), 4);
assert.equal(median([4, 1, 3, 2]), 2.5);
assert.equal(nearestRankPercentile([7, 1, 6, 2, 5, 3, 4], 0.95), 7);
const summary = summarizeTwoArmMetric({
  convex: [100, 110, 120, 130, 140, 150, 160],
  snapback: [115, 125, 135, 145, 155, 165, 175],
  ratio: true,
});
assert.equal(summary.seed, DEFAULT_BOOTSTRAP_SEED);
assert.equal(summary.resamples, DEFAULT_BOOTSTRAP_RESAMPLES);
assert.equal(statisticsPin.bootstrap.seedUnsigned32, DEFAULT_BOOTSTRAP_SEED);
assert.equal(statisticsPin.bootstrap.resamples, DEFAULT_BOOTSTRAP_RESAMPLES);
assert.equal(summary.convex.median, 130);
assert.equal(summary.snapback.median, 145);
assert.equal(summary.snapbackMinusConvex.estimate, 15);
assert.equal(summary.snapbackDividedByConvex.estimate, 145 / 130);
assert.deepEqual(
  summary,
  summarizeTwoArmMetric({
    convex: [100, 110, 120, 130, 140, 150, 160],
    snapback: [115, 125, 135, 145, 155, 165, 175],
    ratio: true,
  }),
  'fixed seed must reproduce every bootstrap draw',
);
assert.throws(
  () => summarizeTwoArmMetric({ convex: [0], snapback: [1], ratio: true }),
  /finite positive number/,
);

const event = (kind, sequence, monotonicNs, extra = {}) => ({
  kind,
  sequence,
  monotonicNs: String(monotonicNs),
  wallClock: `2026-07-24T00:00:0${Math.min(sequence, 9)}.000Z`,
  ...extra,
});
const validReceipt = {
  schemaVersion: 'snapback.convex-checkpoint-metric-events.candidate.v0',
  protocolId: 'llp-0075-convex-checkpoint-v0',
  protocolVersion: 'v0.4',
  capsuleSha256: 'a'.repeat(64),
  runId: 'run-1',
  executionSequence: 0,
  arm: 'snapback',
  sample: { phase: 'timed', ordinal: 1 },
  agentSessionId: 'agent-session-1',
  events: [
    event('work-started', 0, 1_000_000n),
    event('command-started', 1, 2_000_000n, {
      commandId: 'command-1',
      argv: ['snapback', 'new'],
      authored: true,
    }),
    event('command-finished', 2, 3_000_000n, {
      commandId: 'command-1',
      exitCode: 0,
      signal: null,
    }),
    event('milestone-observed', 3, 11_000_000n, {
      milestone: 'first-local-live-row',
      evidenceArtifactSha256: 'b'.repeat(64),
    }),
    event('classification', 4, 12_000_000n, {
      classification: 'expected-refusal',
      code: 'CROSS_USER_READ_REFUSED',
      expectedByGateId: 'auth.cross-user-read',
      evidenceArtifactSha256: 'c'.repeat(64),
    }),
    event('agent-usage', 5, 13_000_000n, {
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 20,
      toolCalls: 3,
    }),
    event('milestone-observed', 6, 21_000_000n, {
      milestone: 'hosted-live-url',
      evidenceArtifactSha256: 'd'.repeat(64),
    }),
    event('sample-finished', 7, 22_000_000n, { outcome: 'valid' }),
  ],
};

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  strictRequired: false,
  allowUnionTypes: true,
});
const validate = ajv.compile(schema);
assert.equal(validate(validReceipt), true, JSON.stringify(validate.errors));
assert.deepEqual(deriveSampleMetrics(validReceipt), {
  implementation: 'snapback.convex-checkpoint-metric-events.candidate.v0',
  capsuleSha256: 'a'.repeat(64),
  runId: 'run-1',
  executionSequence: 0,
  arm: 'snapback',
  phase: 'timed',
  ordinal: 1,
  agentSessionId: 'agent-session-1',
  valid: true,
  localElapsedMs: 10,
  hostedElapsedMs: 20,
  localTopLevelCommands: 1,
  hostedTopLevelCommands: 1,
  agentTokens: 150,
  agentTokenBreakdown: {
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 20,
  },
  toolCalls: 3,
  expectedRefusals: 1,
  requiredFailures: 0,
  retries: 0,
  skippedGates: 0,
  humanInterventions: 0,
  unplannedCredentialRepairs: 0,
  correctnessFailures: 0,
  securityFailures: 0,
  cleanupDefects: 0,
  instrumentFailures: 0,
});

const malformed = structuredClone(validReceipt);
malformed.events[4].expectedByGateId = '';
assert.equal(validate(malformed), false, 'schema rejects empty expected-refusal gate');
assert.throws(
  () => deriveSampleMetrics(malformed),
  /expected-refusal must name expectedByGateId/,
);

const unknownOutcome = structuredClone(validReceipt);
unknownOutcome.events.at(-1).outcome = 'unknown';
assert.equal(validate(unknownOutcome), false, 'schema rejects unknown sample outcome');
assert.throws(
  () => deriveSampleMetrics(unknownOutcome),
  /unknown sample-finished outcome unknown/,
);

const missingCommandId = structuredClone(validReceipt);
delete missingCommandId.events[1].commandId;
assert.equal(validate(missingCommandId), false, 'schema rejects missing commandId');
assert.throws(
  () => deriveSampleMetrics(missingCommandId),
  /command-started requires a stable commandId/,
);

const nonStringCommandId = structuredClone(validReceipt);
nonStringCommandId.events[1].commandId = 1;
assert.equal(validate(nonStringCommandId), false, 'schema rejects non-string commandId');
assert.throws(
  () => deriveSampleMetrics(nonStringCommandId),
  /command-started requires a stable commandId/,
);

const nonBooleanAuthored = structuredClone(validReceipt);
nonBooleanAuthored.events[1].authored = 'true';
assert.equal(validate(nonBooleanAuthored), false, 'schema rejects non-boolean authored');
assert.throws(
  () => deriveSampleMetrics(nonBooleanAuthored),
  /command-started authored must be boolean/,
);

const invalidReceipt = structuredClone(validReceipt);
invalidReceipt.events = [
  event('work-started', 0, 1_000_000n),
  event('classification', 1, 2_000_000n, {
    classification: 'instrument-failure',
    code: 'HARNESS_CLOCK_UNAVAILABLE',
    documenter: 'independent operator',
    rationale: 'monotonic clock source failed its preflight',
    evidenceArtifactSha256: 'e'.repeat(64),
  }),
  event('sample-finished', 2, 3_000_000n, { outcome: 'instrument-invalid' }),
];
assert.equal(validate(invalidReceipt), true, JSON.stringify(validate.errors));
assert.equal(deriveSampleMetrics(invalidReceipt).valid, false);

console.log('competitive checkpoint candidate statistics and metric instruments pass');
