import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  EVIDENCE_DIMENSIONS,
  adjudicateCheckpoint,
  evaluateEvidenceConfidence,
  evaluateFirstHour,
} from './scoring.v0.mjs';

const sourceDir = new URL('.', import.meta.url);
const scoringLock = JSON.parse(await readFile(new URL('scoring-lock.candidate.v0.json', sourceDir), 'utf8'));
for (const file of scoringLock.files) {
  assert.equal(
    createHash('sha256').update(await readFile(new URL(file.path, sourceDir))).digest('hex'),
    file.sha256,
    `scoring lock drifted: ${file.path}`,
  );
}

const capsuleSha256 = 'a'.repeat(64);
const runId = 'checkpoint-run-1';
const sample = (arm, ordinal, executionSequence, overrides = {}) => ({
  implementation: 'snapback.convex-checkpoint-metric-events.candidate.v0',
  capsuleSha256,
  runId,
  executionSequence,
  arm,
  phase: 'timed',
  ordinal,
  agentSessionId: `${arm}-${ordinal}-${executionSequence}`,
  valid: true,
  localElapsedMs: 1000,
  hostedElapsedMs: 5000,
  localTopLevelCommands: 4,
  hostedTopLevelCommands: 8,
  agentTokens: 1000,
  toolCalls: 10,
  requiredFailures: 0,
  retries: 0,
  skippedGates: 0,
  humanInterventions: 0,
  unplannedCredentialRepairs: 0,
  correctnessFailures: 0,
  securityFailures: 0,
  cleanupDefects: 0,
  ...overrides,
});
const convexValid = Array.from({ length: 7 }, (_, index) =>
  sample('convex', index + 1, index * 2));
const snapbackValid = Array.from({ length: 7 }, (_, index) =>
  sample('snapback', index + 1, index * 2 + 1, {
    localElapsedMs: 1200,
    hostedElapsedMs: 6000,
    localTopLevelCommands: 6,
    hostedTopLevelCommands: 11,
    agentTokens: 1200,
    toolCalls: 12,
  }),
);
const interleave = (convex, snapback) =>
  convex.flatMap((value, index) => [value, snapback[index]]);
const allValidObservations = interleave(convexValid, snapbackValid);
const firstHour = evaluateFirstHour({
  convexValid,
  snapbackValid,
  allObservations: allValidObservations,
});
assert.equal(firstHour.pass, true);
assert.equal(firstHour.capsuleSha256, capsuleSha256);
assert.equal(firstHour.runId, runId);

const securityFailure = structuredClone(snapbackValid);
securityFailure[0].securityFailures = 1;
assert.equal(
  evaluateFirstHour({
    convexValid,
    snapbackValid: securityFailure,
    allObservations: interleave(convexValid, securityFailure),
  }).pass,
  false,
  'absolute floors include every retained observation',
);

const invalidReplacement = sample('convex', 1, 0, {
  valid: false,
  instrumentFailures: 1,
  localElapsedMs: null,
  hostedElapsedMs: null,
  localTopLevelCommands: null,
  hostedTopLevelCommands: null,
});
const convexAfterReplacement = structuredClone(convexValid);
convexAfterReplacement[0].executionSequence = 1;
convexAfterReplacement[0].agentSessionId = 'convex-1-1';
const snapbackAfterReplacement = structuredClone(snapbackValid);
for (let index = 0; index < snapbackAfterReplacement.length; index += 1) {
  snapbackAfterReplacement[index].executionSequence += 1;
  snapbackAfterReplacement[index].agentSessionId =
    `snapback-${index + 1}-${snapbackAfterReplacement[index].executionSequence}`;
  if (index > 0) {
    convexAfterReplacement[index].executionSequence += 1;
    convexAfterReplacement[index].agentSessionId =
      `convex-${index + 1}-${convexAfterReplacement[index].executionSequence}`;
  }
}
const observationsWithReplacement = [
  invalidReplacement,
  ...interleave(convexAfterReplacement, snapbackAfterReplacement),
];
assert.equal(
  evaluateFirstHour({
    convexValid: convexAfterReplacement,
    snapbackValid: snapbackAfterReplacement,
    allObservations: observationsWithReplacement,
  }).pass,
  true,
  'an instrument-invalid observation is retained and the same slot is repeated',
);
assert.throws(
  () => evaluateFirstHour({
    convexValid,
    snapbackValid,
    allObservations: [...convexValid, ...snapbackValid],
  }),
  /contiguous execution order|alternation or replacement-slot order/,
);

const capsuleContentSha256 = capsuleSha256;
const anchorSet = {
  status: 'ratified-before-evidence-reveal',
  capsuleContentSha256,
  anchors: EVIDENCE_DIMENSIONS.flatMap((dimension) =>
    ['snapback', 'convex'].map((arm) => ({
      dimension,
      arm,
      levels: { 0: 'missing or contradicted', 1: 'indirect evidence', 2: 'direct reproducible evidence' },
    })),
  ),
};
const confidence = evaluateEvidenceConfidence(anchorSet, {
  capsuleContentSha256,
  scorer: { modelFamily: 'independent-family', authoredArm: 'neither' },
  transcriptSha256: 'b'.repeat(64),
  decisions: EVIDENCE_DIMENSIONS.flatMap((dimension) =>
    [
      { dimension, arm: 'snapback', score: 2 },
      { dimension, arm: 'convex', score: dimension === 'authority-attribution' ? 0 : 2 },
    ].map((decision) => ({
      ...decision,
      evidenceArtifactSha256: 'c'.repeat(64),
      rationale: 'fixed-vector evidence',
    })),
  ),
});
assert.deepEqual(confidence.scores, { snapback: 16, convex: 14 });
assert.equal(confidence.snapbackFloorPass, true);
assert.equal(confidence.trustHypothesisConfirmed, true);

assert.equal(
  adjudicateCheckpoint({
    stopDefects: ['cross-user-access'],
    requiredPreRunSkips: ['provider-unavailable'],
    productCompletenessPass: true,
    firstHourPass: true,
    confidence,
    authorityGatesPass: true,
  }).outcome,
  'stop',
);
assert.deepEqual(
  adjudicateCheckpoint({
    stopDefects: [],
    requiredPreRunSkips: ['provider-unavailable'],
    productCompletenessPass: false,
    firstHourPass: false,
    confidence: null,
    authorityGatesPass: false,
  }),
  { outcome: 'reprioritize', phase: 'pre-run-readiness', reasons: ['provider-unavailable'] },
);
assert.equal(
  adjudicateCheckpoint({
    stopDefects: [],
    requiredPreRunSkips: [],
    productCompletenessPass: true,
    firstHourPass: true,
    confidence,
    authorityGatesPass: true,
  }).outcome,
  'continue',
);

console.log('competitive checkpoint candidate scoring engine passes');
