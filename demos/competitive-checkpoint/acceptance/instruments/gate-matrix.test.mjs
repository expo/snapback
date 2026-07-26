import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateGateReceipt, validateGateMatrix } from './gate-matrix.v0.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const matrix = JSON.parse(await readFile(join(here, 'gate-matrix.candidate.v0.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(here, 'gate-matrix-lock.candidate.v0.json'), 'utf8'));
for (const file of lock.files) {
  const bytes = await readFile(join(here, file.path));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    file.sha256,
    `gate matrix lock drifted: ${file.path}`,
  );
}
validateGateMatrix(matrix);

const unknownCategory = structuredClone(matrix);
unknownCategory.gates[0].category = 'product-typo';
assert.throws(() => validateGateMatrix(unknownCategory), /has invalid category/);

const missingCategory = structuredClone(matrix);
delete missingCategory.gates[0].category;
assert.throws(() => validateGateMatrix(missingCategory), /has invalid category/);

const evidenceArtifactSha256 = 'a'.repeat(64);
const receipt = {
  schemaVersion: 'snapback.convex-checkpoint-gate-receipt.candidate.v0',
  protocolId: matrix.protocolId,
  protocolVersion: matrix.protocolVersion,
  capsuleSha256: 'b'.repeat(64),
  runId: 'gate-matrix-self-test',
  decisions: matrix.gates.flatMap((gate) =>
    gate.requiredArms.map((arm) => ({
      gateId: gate.id,
      arm,
      outcome: gate.expectedOutcome === 'refusal' ? 'expected-refusal' : 'pass',
      evidenceArtifactSha256,
      rationale: 'fixed-vector candidate self-test evidence',
    })),
  ),
};

const passed = evaluateGateReceipt(matrix, receipt);
assert.equal(passed.complete, true);
assert.equal(passed.productCompletenessPass, true);
assert.equal(passed.armSpecificConstraintsPass, true);
assert.equal(passed.failures.length, 0);

const missingRunId = structuredClone(receipt);
delete missingRunId.runId;
assert.throws(() => evaluateGateReceipt(matrix, missingRunId), /requires a stable runId/);

const nonStringRunId = structuredClone(receipt);
nonStringRunId.runId = 1;
assert.throws(() => evaluateGateReceipt(matrix, nonStringRunId), /requires a stable runId/);

const missingDelete = structuredClone(receipt);
missingDelete.decisions = missingDelete.decisions.filter(
  ({ gateId, arm }) => !(gateId === 'auth.cross-user-delete' && arm === 'convex'),
);
const missingResult = evaluateGateReceipt(matrix, missingDelete);
assert.equal(missingResult.complete, false);
assert.equal(missingResult.productCompletenessPass, false);
assert.deepEqual(
  missingResult.failures.find(({ gateId, arm }) => gateId === 'auth.cross-user-delete' && arm === 'convex'),
  {
    gateId: 'auth.cross-user-delete',
    arm: 'convex',
    category: 'negative-authorization',
    outcome: 'missing',
  },
);

const falsePass = structuredClone(receipt);
falsePass.decisions.find(
  ({ gateId, arm }) => gateId === 'auth.cross-user-read' && arm === 'snapback',
).outcome = 'pass';
assert.equal(evaluateGateReceipt(matrix, falsePass).productCompletenessPass, false);

const inventedNa = structuredClone(receipt);
inventedNa.decisions[0].outcome = 'not-applicable';
assert.equal(evaluateGateReceipt(matrix, inventedNa).productCompletenessPass, false);

const duplicate = structuredClone(receipt);
duplicate.decisions.push(structuredClone(duplicate.decisions[0]));
assert.throws(() => evaluateGateReceipt(matrix, duplicate), /duplicate gate decision/);

console.log('competitive checkpoint candidate gate matrix passes');
