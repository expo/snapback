// @ref LLP 0075#frozen-application-facts — every required gate is explicit and category-closed before adjudication
const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ARMS = new Set(['snapback', 'convex']);
const CATEGORIES = new Set([
  'product',
  'stream',
  'negative-authorization',
  'hosted-lifecycle',
  'cleanup',
  'compatibility',
  'arm-specific-authoring',
]);
const OUTCOMES = new Set(['pass', 'fail', 'expected-refusal', 'not-applicable']);

function assertClosedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} has unknown field ${key}`);
  }
}

export function validateGateMatrix(matrix) {
  if (matrix?.status !== 'candidate-unratified-blocks-timed-runs') {
    throw new Error('gate matrix must remain explicitly candidate and unratified');
  }
  if (!Array.isArray(matrix.gates) || matrix.gates.length === 0) {
    throw new Error('gate matrix requires at least one gate');
  }
  const ids = new Set();
  for (const gate of matrix.gates) {
    assertClosedKeys(
      gate,
      new Set(['id', 'category', 'requiredArms', 'naAllowedArms', 'expectedOutcome', 'equivalence', 'requirement']),
      `gate ${gate?.id ?? '<missing>'}`,
    );
    if (typeof gate.id !== 'string' || !/^[a-z][a-z0-9.-]+$/.test(gate.id)) {
      throw new Error('gate id must be a stable lowercase identifier');
    }
    if (ids.has(gate.id)) throw new Error(`duplicate gate id ${gate.id}`);
    ids.add(gate.id);
    if (!CATEGORIES.has(gate.category)) {
      throw new Error(`${gate.id} has invalid category`);
    }
    if (!Array.isArray(gate.requiredArms) || gate.requiredArms.length === 0) {
      throw new Error(`${gate.id} requires at least one arm`);
    }
    if (new Set(gate.requiredArms).size !== gate.requiredArms.length) {
      throw new Error(`${gate.id} repeats a required arm`);
    }
    for (const arm of gate.requiredArms) {
      if (!ARMS.has(arm)) throw new Error(`${gate.id} names unknown arm ${arm}`);
    }
    for (const arm of gate.naAllowedArms ?? []) {
      if (!gate.requiredArms.includes(arm)) {
        throw new Error(`${gate.id} allows N/A for non-required arm ${arm}`);
      }
    }
    if (!['pass', 'refusal'].includes(gate.expectedOutcome)) {
      throw new Error(`${gate.id} has invalid expected outcome`);
    }
    if (typeof gate.requirement !== 'string' || gate.requirement.length === 0) {
      throw new Error(`${gate.id} requires normative text`);
    }
  }
  return matrix;
}

export function evaluateGateReceipt(matrix, receipt) {
  validateGateMatrix(matrix);
  assertClosedKeys(
    receipt,
    new Set(['schemaVersion', 'protocolId', 'protocolVersion', 'capsuleSha256', 'runId', 'decisions']),
    'gate receipt',
  );
  if (receipt.schemaVersion !== 'snapback.convex-checkpoint-gate-receipt.candidate.v0') {
    throw new Error('unsupported gate receipt schemaVersion');
  }
  if (receipt.protocolId !== matrix.protocolId || receipt.protocolVersion !== matrix.protocolVersion) {
    throw new Error('gate receipt protocol identity does not match matrix');
  }
  if (!SHA256.test(receipt.capsuleSha256 ?? '')) {
    throw new Error('gate receipt requires a lowercase capsule sha256');
  }
  if (typeof receipt.runId !== 'string' || !IDENTIFIER.test(receipt.runId)) {
    throw new Error('gate receipt requires a stable runId');
  }
  if (!Array.isArray(receipt.decisions)) throw new Error('gate receipt decisions must be an array');

  const expected = new Map();
  for (const gate of matrix.gates) {
    for (const arm of gate.requiredArms) expected.set(`${gate.id}\0${arm}`, gate);
  }
  const seen = new Set();
  const failures = [];
  const passed = [];
  for (const decision of receipt.decisions) {
    assertClosedKeys(
      decision,
      new Set(['gateId', 'arm', 'outcome', 'evidenceArtifactSha256', 'rationale']),
      `decision ${decision?.gateId ?? '<missing>'}`,
    );
    const key = `${decision.gateId}\0${decision.arm}`;
    const gate = expected.get(key);
    if (!gate) throw new Error(`decision is not required by the matrix: ${decision.gateId}/${decision.arm}`);
    if (seen.has(key)) throw new Error(`duplicate gate decision: ${decision.gateId}/${decision.arm}`);
    seen.add(key);
    if (!OUTCOMES.has(decision.outcome)) throw new Error(`invalid gate outcome ${decision.outcome}`);
    if (!SHA256.test(decision.evidenceArtifactSha256 ?? '')) {
      throw new Error(`${decision.gateId}/${decision.arm} requires an evidence digest`);
    }
    if (typeof decision.rationale !== 'string' || decision.rationale.length === 0) {
      throw new Error(`${decision.gateId}/${decision.arm} requires a rationale`);
    }

    let accepted = decision.outcome === 'pass' && gate.expectedOutcome === 'pass';
    if (decision.outcome === 'expected-refusal' && gate.expectedOutcome === 'refusal') accepted = true;
    if (decision.outcome === 'not-applicable') {
      accepted = (gate.naAllowedArms ?? []).includes(decision.arm);
    }
    (accepted ? passed : failures).push({
      gateId: decision.gateId,
      arm: decision.arm,
      outcome: decision.outcome,
      category: gate.category,
    });
  }

  const missing = [];
  for (const [key, gate] of expected) {
    if (!seen.has(key)) {
      const [gateId, arm] = key.split('\0');
      missing.push({ gateId, arm, category: gate.category });
    }
  }
  failures.push(...missing.map((entry) => ({ ...entry, outcome: 'missing' })));
  const symmetricFailures = failures.filter(({ category }) => category !== 'arm-specific-authoring');
  const armSpecificFailures = failures.filter(({ category }) => category === 'arm-specific-authoring');
  return {
    implementation: matrix.schemaVersion,
    complete: missing.length === 0,
    productCompletenessPass: symmetricFailures.length === 0,
    armSpecificConstraintsPass: armSpecificFailures.length === 0,
    passedCount: passed.length,
    failures,
  };
}
