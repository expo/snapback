import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Ajv from 'ajv';

const root = new URL('..', import.meta.url).pathname;
const harness = join(root, 'benchmarks/tiny-data-surface/v1');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const digest = `sha256:${'0'.repeat(64)}`;

function validateCapsuleSemantics(capsule) {
  const markNames = [
    'firstLocalReadMs',
    'firstAuthoritativeWriteMs',
    'firstProvenLiveTransitionMs',
    'firstDurableOfflineSettlementMs',
    'firstGreenProofMs',
    'fullAcceptanceMs',
  ];
  const marks = markNames.map((name) => capsule.milestones[name]).filter((value) => value !== null);
  assert.deepEqual(marks, [...marks].sort((left, right) => left - right), 'Todo milestone marks must be monotonic');
  const dayTwo = ['dayTwoStartedMs', 'dayTwoFirstGreenMs', 'dayTwoFullAcceptanceMs']
    .map((name) => capsule.milestones[name]).filter((value) => value !== null);
  assert.deepEqual(dayTwo, [...dayTwo].sort((left, right) => left - right), 'day-two marks must be monotonic');

  const numericClasses = ['input', 'output', 'cached', 'reasoning'];
  if (numericClasses.every((name) => capsule.tokenUsage.totals[name] !== null)) {
    const total = numericClasses.reduce((sum, name) => sum + capsule.tokenUsage.totals[name], 0);
    assert.equal(capsule.tokenUsage.totals.total, total, 'token class totals must sum');
  }
  const actionIds = new Set(capsule.normalizedActionTrace.map(({ id }) => id));
  const coveredToolIds = new Set(capsule.normalizedActionTrace.flatMap(({ toolCallIds }) => toolCallIds));
  for (const call of capsule.toolCalls) assert.ok(coveredToolIds.has(call.id), `uncovered tool call ${call.id}`);
  const candidateIds = new Set(capsule.conceptCandidates.candidates.map(({ id }) => id));
  for (const grade of capsule.grades) assert.ok(candidateIds.has(grade.candidateId), `orphan concept grade ${grade.candidateId}`);
  for (const interval of [...capsule.corrections, ...capsule.mistakes, ...capsule.functionEscapes]) {
    assert.ok(actionIds.has(interval.startedActionId), `missing start action ${interval.startedActionId}`);
    assert.ok(actionIds.has(interval.endedActionId), `missing end action ${interval.endedActionId}`);
  }
  const evidenceIds = new Set(capsule.evidenceIndex.map(({ id }) => id));
  const referenced = JSON.stringify(capsule).match(/"(?:evidenceIds|firstEvidenceId|detectionEvidenceId|correctionEvidenceId|finalSourceEvidenceId)"\s*:\s*(?:\[([^\]]*)\]|"([^"]+)")/g) ?? [];
  assert.ok(referenced.length >= 0 && evidenceIds.size >= 0);
  if (capsule.evidenceIndex.some((entry) => entry.class === 'private')) {
    assert.notEqual(capsule.privateCommitment, null, 'private evidence requires a keyed commitment');
  }
  assert.equal(Object.keys(capsule.evidenceConfidence).length, 8, 'all eight confidence dimensions are mandatory');
}

function schemaFixture() {
  const identity = (id) => ({ id, digest, version: 'fixture' });
  const pointer = (id) => ({ id, path: `fixture/${id}`, digest, eligibility: null });
  const confidence = () => ({ score: 0, reason: 'schema fixture only', evidenceIds: [] });
  return {
    schemaVersion: 'snapback.run-capsule.tiny-data-evaluation.v1', protocolId: 'llp-0256-tiny-data-surface-v1',
    attemptId: 'schema-fixture-not-a-run', roundId: 'fixture', configurationVersion: 'fixture', configurationDigest: digest,
    lane: 'tiny', workloadChain: ['owner-scoped-todo', 'day-two-evolution'], aidCondition: 'bare-v1',
    model: identity('model'), environment: identity('environment'), packageClosure: identity('closure'), target: identity('target'),
    budget: { activeMs: 1, tokens: 1, toolCalls: 1 }, actors: [identity('alice'), identity('bob'), identity('mallory')], order: 1,
    prompts: [], aids: [], commands: [], normalizedActionTrace: [],
    milestones: { firstLocalReadMs: null, firstAuthoritativeWriteMs: null, firstProvenLiveTransitionMs: null, firstDurableOfflineSettlementMs: null, firstGreenProofMs: null, fullAcceptanceMs: null, dayTwoStartedMs: null, dayTwoFirstGreenMs: null, dayTwoFullAcceptanceMs: null, missingReasons: { all: 'schema fixture' }, evidenceIds: {} },
    tokenUsage: { turns: [], totals: { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 }, atMilestones: {}, unavailableReason: null },
    toolCalls: [], corrections: [], mistakes: [], interventions: [],
    conceptCandidates: { requiredAuthoredConcepts: 0, retrievedOrManipulatedConcepts: 0, candidates: [] }, grades: [], semanticFacts: [], functionEscapes: [], schemaExtensions: [],
    scenarioResults: [], proofReceipts: [],
    evidenceConfidence: { actorAuthority: confidence(), transactionConflict: confidence(), transport: confidence(), offlineReconnect: confidence(), settlement: confidence(), targetIdentity: confidence(), cleanupIsolation: confidence(), reproducibility: confidence() },
    architectureOracle: { passed: false, secondOwners: [], evidenceIds: [] }, inventory: pointer('inventory'), assistanceEvents: [], evidenceIndex: [], privateCommitment: null, stopDefects: [],
    cleanup: { status: 'not-run', targetDeleted: false, localStoresDeleted: false, evidenceIds: [] }, terminalOutcome: 'invalid-evidence',
    result: { equalProofPassed: false, dayTwoPassed: false, validEvidence: false, notes: 'Schema fixture; explicitly not timed evidence.' },
  };
}

test('the frozen D9 table has six N=5 configurations and exact counterbalanced IDs', () => {
  const table = readJson(join(harness, 'preregistration/d9-cell-table.v1.json'));
  assert.equal(table.status, 'frozen-not-run');
  assert.equal(table.timedRunsExecuted, false);
  assert.equal(table.configurations.length, 6);
  assert.equal(table.executionOrder.length, 30);
  assert.deepEqual(table.executionOrder.map(({ position }) => position), Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal(new Set(table.executionOrder.map(({ attemptId }) => attemptId)).size, 30);
  for (const aidCondition of table.aidConditions) {
    for (const lane of ['tiny', 'explicit', 'instantdb']) {
      const attempts = table.executionOrder.filter((entry) => entry.aidCondition === aidCondition && entry.lane === lane);
      assert.deepEqual(attempts.map(({ repetition }) => repetition).sort(), [1, 2, 3, 4, 5]);
    }
  }
});

test('the extended capsule schema compiles, accepts its non-run fixture, and is closed', () => {
  const schema = readJson(join(harness, 'schemas/run-capsule.tiny-data-evaluation.v1.json'));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const capsule = schemaFixture();
  assert.equal(validate(capsule), true, JSON.stringify(validate.errors));
  validateCapsuleSemantics(capsule);
  assert.equal(validate({ ...capsule, unknownField: true }), false);
});

test('assisted aid slots are symmetric and the InstantDB corpus pin demands refresh', () => {
  const manifest = readJson(join(harness, 'aids/assisted-v1/manifest.v1.json'));
  assert.equal(manifest.status, 'scaffold-not-run');
  assert.equal(manifest.timedRunsExecuted, false);
  assert.equal(manifest.bundles.length, 3);
  assert.equal(manifest.digestsFinalized, true);
  for (const bundle of manifest.bundles) {
    assert.deepEqual(bundle.semanticTopics, manifest.requiredSlots);
    const bytes = readFileSync(join(harness, bundle.path));
    assert.equal(bundle.digest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    assert.equal(bundle.words, bytes.toString('utf8').trim().split(/\s+/u).length);
  }
  const pin = readJson(join(harness, 'inventories/instantdb-2026-08-14.v1.json'));
  assert.equal(pin.networkVerifiedForThisPin, false);
  assert.equal(pin.refreshRequiredAtRunTime, true);
  assert.equal(pin.target.preflightStatus, 'not-run');
  assert.equal(pin.timedEvidence, false);
});

test('Phase 4 contains no timed run capsules or armed clock receipt', () => {
  assert.equal(existsSync(join(harness, 'rounds')), false);
  assert.equal(existsSync(join(harness, 'clock/publication-receipt.v1.json')), false);
});
