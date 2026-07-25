import { median, summarizeTwoArmMetric } from './statistics.v0.mjs';

const DIMENSIONS = [
  'authority-attribution',
  'transport-attribution',
  'target-identity',
  'settlement-precision',
  'negative-authorization',
  'cleanup',
  'artifact-immutability',
  'receipt-reproducibility',
];
const ZERO_FLOORS = [
  'humanInterventions',
  'unplannedCredentialRepairs',
  'correctnessFailures',
  'securityFailures',
  'cleanupDefects',
];
const METRIC_IMPLEMENTATION =
  'snapback.convex-checkpoint-metric-events.candidate.v0';
const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function sampleIdentity(sample) {
  return [
    sample.capsuleSha256,
    sample.runId,
    sample.executionSequence,
    sample.arm,
    sample.phase,
    sample.ordinal,
    sample.agentSessionId,
  ].join('\0');
}

function validateObservationIdentity(observation, label) {
  if (
    !observation
    || observation.implementation !== METRIC_IMPLEMENTATION
    || !SHA256.test(observation.capsuleSha256 ?? '')
    || !IDENTIFIER.test(observation.runId ?? '')
    || !IDENTIFIER.test(observation.agentSessionId ?? '')
    || !['convex', 'snapback'].includes(observation.arm)
    || observation.phase !== 'timed'
    || !Number.isSafeInteger(observation.executionSequence)
    || observation.executionSequence < 0
    || !Number.isSafeInteger(observation.ordinal)
    || observation.ordinal < 1
    || observation.ordinal > 7
    || typeof observation.valid !== 'boolean'
  ) {
    throw new Error(`${label} has invalid capsule, run, arm, or timed-sample identity`);
  }
}

function requireSevenValid(samples, arm, capsuleSha256, runId) {
  if (!Array.isArray(samples) || samples.length !== 7) {
    throw new Error(`${arm} requires exactly seven valid timed samples`);
  }
  const ordinals = new Set();
  for (const [index, sample] of samples.entries()) {
    validateObservationIdentity(sample, `${arm}Valid[${index}]`);
    if (
      sample.valid !== true
      || sample.arm !== arm
      || sample.capsuleSha256 !== capsuleSha256
      || sample.runId !== runId
    ) {
      throw new Error(`${arm} requires exactly seven valid timed samples from one capsule and run`);
    }
    ordinals.add(sample.ordinal);
  }
  if (ordinals.size !== 7 || ![1, 2, 3, 4, 5, 6, 7].every((ordinal) => ordinals.has(ordinal))) {
    throw new Error(`${arm} valid samples must cover ordinals 1 through 7 exactly once`);
  }
}

function values(samples, key) {
  const result = samples.map((sample) => sample[key]);
  if (result.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`${key} samples must be finite non-negative numbers`);
  }
  return result;
}

function comparison(id, actual, limit, details) {
  return { id, pass: actual <= limit, actual, limit, ...details };
}

export function evaluateFirstHour({ convexValid, snapbackValid, allObservations }) {
  if (!Array.isArray(allObservations) || allObservations.length < 14) {
    throw new Error('allObservations must retain every valid and invalid observation');
  }
  const first = allObservations[0];
  validateObservationIdentity(first, 'allObservations[0]');
  const capsuleSha256 = first.capsuleSha256;
  const runId = first.runId;
  const firstSequence = first.executionSequence;
  const validBySlot = new Map();
  const sessions = new Set();
  let expectedSlot = 0;
  for (const [index, observation] of allObservations.entries()) {
    validateObservationIdentity(observation, `allObservations[${index}]`);
    if (
      observation.capsuleSha256 !== capsuleSha256
      || observation.runId !== runId
      || observation.executionSequence !== firstSequence + index
    ) {
      throw new Error('allObservations must be one capsule/run in contiguous execution order');
    }
    if (sessions.has(observation.agentSessionId)) {
      throw new Error('allObservations repeats an agent session');
    }
    sessions.add(observation.agentSessionId);
    const slot = (observation.ordinal - 1) * 2 + (observation.arm === 'convex' ? 0 : 1);
    if (slot !== expectedSlot) {
      throw new Error('allObservations violates Convex-first alternation or replacement-slot order');
    }
    if (observation.valid) {
      validBySlot.set(slot, observation);
      expectedSlot += 1;
    }
  }
  if (expectedSlot !== 14) {
    throw new Error('allObservations does not contain one valid observation for every timed slot');
  }
  requireSevenValid(convexValid, 'convex', capsuleSha256, runId);
  requireSevenValid(snapbackValid, 'snapback', capsuleSha256, runId);
  for (const sample of [...convexValid, ...snapbackValid]) {
    const slot = (sample.ordinal - 1) * 2 + (sample.arm === 'convex' ? 0 : 1);
    if (sampleIdentity(sample) !== sampleIdentity(validBySlot.get(slot))) {
      throw new Error('selected valid samples do not match the retained observation closure');
    }
  }

  const summaries = {};
  const summarize = (key, ratio = false) => {
    const summary = summarizeTwoArmMetric({
      convex: values(convexValid, key),
      snapback: values(snapbackValid, key),
      ratio,
    });
    summaries[key] = summary;
    return summary;
  };
  const localElapsed = summarize('localElapsedMs', true);
  const hostedElapsed = summarize('hostedElapsedMs', true);
  const localCommands = summarize('localTopLevelCommands');
  const hostedCommands = summarize('hostedTopLevelCommands');
  const tokens = summarize('agentTokens', true);
  const toolCalls = summarize('toolCalls', true);
  const requiredFailures = summarize('requiredFailures');
  const retries = summarize('retries');
  const skippedGates = summarize('skippedGates');

  const checks = [
    comparison('local-elapsed-ratio', localElapsed.snapbackDividedByConvex.estimate, 1.25),
    comparison('local-elapsed-absolute', localElapsed.snapbackMinusConvex.estimate, 120000, { unit: 'ms' }),
    comparison('hosted-elapsed-ratio', hostedElapsed.snapbackDividedByConvex.estimate, 1.25),
    comparison('hosted-elapsed-absolute', hostedElapsed.snapbackMinusConvex.estimate, 300000, { unit: 'ms' }),
    comparison('local-command-delta', localCommands.snapbackMinusConvex.estimate, 2),
    comparison('hosted-command-delta', hostedCommands.snapbackMinusConvex.estimate, 3),
    comparison('agent-token-ratio', tokens.snapbackDividedByConvex.estimate, 1.25),
    comparison('tool-call-ratio', toolCalls.snapbackDividedByConvex.estimate, 1.25),
    comparison('required-failure-median', median(values(snapbackValid, 'requiredFailures')), median(values(convexValid, 'requiredFailures'))),
    comparison('retry-median', median(values(snapbackValid, 'retries')), median(values(convexValid, 'retries'))),
    comparison('skipped-gate-median', median(values(snapbackValid, 'skippedGates')), median(values(convexValid, 'skippedGates'))),
  ];

  const zeroFloorTotals = Object.fromEntries(
    ZERO_FLOORS.map((key) => {
      const total = allObservations.reduce((sum, observation) => {
        const value = observation[key];
        if (!Number.isSafeInteger(value) || value < 0) {
          throw new Error(`${key} observations must be non-negative safe integers`);
        }
        return sum + value;
      }, 0);
      return [key, total];
    }),
  );
  for (const [key, total] of Object.entries(zeroFloorTotals)) {
    checks.push(comparison(`absolute-zero:${key}`, total, 0));
  }

  return {
    implementation: 'snapback.convex-checkpoint-scoring.candidate.v0',
    capsuleSha256,
    runId,
    pass: checks.every(({ pass }) => pass),
    checks,
    summaries,
    zeroFloorTotals,
  };
}

export function validateAnchorSet(anchorSet) {
  if (anchorSet?.status !== 'ratified-before-evidence-reveal') {
    throw new Error('scoring anchors must be ratified before evidence reveal');
  }
  if (!/^[a-f0-9]{64}$/.test(anchorSet.capsuleContentSha256 ?? '')) {
    throw new Error('scoring anchors must bind the run capsule content digest');
  }
  if (!Array.isArray(anchorSet.anchors)) throw new Error('scoring anchors must be an array');
  const seen = new Set();
  for (const anchor of anchorSet.anchors) {
    const key = `${anchor.dimension}\0${anchor.arm}`;
    if (!DIMENSIONS.includes(anchor.dimension) || !['snapback', 'convex'].includes(anchor.arm)) {
      throw new Error('scoring anchor names an unknown dimension or arm');
    }
    if (seen.has(key)) throw new Error(`duplicate scoring anchor ${anchor.dimension}/${anchor.arm}`);
    seen.add(key);
    if (!anchor.levels || !['0', '1', '2'].every((level) => typeof anchor.levels[level] === 'string' && anchor.levels[level])) {
      throw new Error(`${anchor.dimension}/${anchor.arm} must define non-empty 0/1/2 anchors`);
    }
  }
  if (seen.size !== DIMENSIONS.length * 2) throw new Error('scoring anchors must cover all dimensions for both arms');
  return anchorSet;
}

export function evaluateEvidenceConfidence(anchorSet, receipt) {
  validateAnchorSet(anchorSet);
  if (receipt.capsuleContentSha256 !== anchorSet.capsuleContentSha256) {
    throw new Error('confidence receipt does not bind the anchor capsule');
  }
  if (!receipt.scorer || receipt.scorer.authoredArm !== 'neither' || !receipt.scorer.modelFamily) {
    throw new Error('confidence scorer must name an independent model family that authored neither arm');
  }
  if (!/^[a-f0-9]{64}$/.test(receipt.transcriptSha256 ?? '')) {
    throw new Error('confidence receipt requires a retained transcript digest');
  }
  if (!Array.isArray(receipt.decisions)) throw new Error('confidence decisions must be an array');

  const scores = { snapback: 0, convex: 0 };
  const seen = new Set();
  for (const decision of receipt.decisions) {
    const key = `${decision.dimension}\0${decision.arm}`;
    if (seen.has(key)) throw new Error(`duplicate confidence decision ${decision.dimension}/${decision.arm}`);
    seen.add(key);
    if (!DIMENSIONS.includes(decision.dimension) || !['snapback', 'convex'].includes(decision.arm)) {
      throw new Error('confidence decision names an unknown dimension or arm');
    }
    if (![0, 1, 2].includes(decision.score)) throw new Error('confidence decision score must be 0, 1, or 2');
    if (!/^[a-f0-9]{64}$/.test(decision.evidenceArtifactSha256 ?? '') || !decision.rationale) {
      throw new Error('confidence decision requires evidence digest and rationale');
    }
    scores[decision.arm] += decision.score;
  }
  if (seen.size !== DIMENSIONS.length * 2) throw new Error('confidence decisions must cover all dimensions for both arms');
  return {
    scores,
    snapbackFloorPass: scores.snapback === 16,
    trustHypothesisConfirmed: scores.snapback === 16 && scores.snapback - scores.convex >= 2,
  };
}

export function adjudicateCheckpoint({
  stopDefects,
  requiredPreRunSkips,
  productCompletenessPass,
  firstHourPass,
  confidence,
  authorityGatesPass,
}) {
  if (!Array.isArray(stopDefects) || !Array.isArray(requiredPreRunSkips)) {
    throw new Error('adjudication requires explicit stop-defect and pre-run-skip arrays');
  }
  if (stopDefects.length > 0) return { outcome: 'stop', reasons: [...stopDefects] };
  if (requiredPreRunSkips.length > 0) {
    return { outcome: 'reprioritize', phase: 'pre-run-readiness', reasons: [...requiredPreRunSkips] };
  }
  const reasons = [];
  if (!productCompletenessPass) reasons.push('product-completeness');
  if (!firstHourPass) reasons.push('first-hour-cost');
  if (!confidence?.snapbackFloorPass) reasons.push('snapback-confidence-floor');
  if (!confidence?.trustHypothesisConfirmed) reasons.push('trust-hypothesis');
  if (!authorityGatesPass) reasons.push('authority-or-cleanup-gate');
  return reasons.length === 0 ? { outcome: 'continue', reasons: [] } : { outcome: 'reprioritize', phase: 'completed-run', reasons };
}

export const EVIDENCE_DIMENSIONS = Object.freeze([...DIMENSIONS]);
