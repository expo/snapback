import { strict as assert } from 'node:assert';

import {
  AGENT_DIGEST_CURSOR_PREFIX,
  buildAgentDigest,
  canonicalJson,
  parseDigestCursor,
} from './digest.mjs';

const baseSurface = () => ({
  source: 'local',
  appId: 'digest-app',
  bundleHash: 'sha256:bundle',
  generation: {
    schemaVersion: 'snapback.v0',
    appId: 'digest-app',
    schemaHash: 'sha256:schema',
    bundleHash: 'sha256:bundle',
    inputsHash: 'inputs-1',
  },
  schemaManifest: {
    schemaVersion: 'snapback.v0',
    schemaHash: 'sha256:schema',
    tables: [{
      name: 'tasks',
      fields: [{ name: 'title', field_type: 'String', optional: false }],
      indexes: [],
      syncable: true,
    }],
  },
  capabilityManifest: {
    targetProfileId: 'local-dev-sqlite-ibex',
    supportedCapabilities: ['result_contract_v1', 'args_contract_v1'],
    capabilityGaps: [],
  },
  functions: [{
    id: 'digest-app:list',
    name: 'list',
    kind: 'query',
    authRequirement: 'optional-user',
    argsSchema: { type: 'object', additionalProperties: false },
    resultContract: { kind: 'documents', table: 'tasks' },
    readSetSummary: { mode: 'singleTable', tables: ['tasks'] },
    writeSetSummary: { mode: 'none', tables: [] },
    requiredCapabilities: ['result_contract_v1', 'args_contract_v1'],
  }],
});

const inspection = {
  targetProfileId: 'local-dev-sqlite-ibex',
  storage: { version: 42, tables: ['tasks'] },
  recentDiagnostics: [
    { code: 'SNAPBACK_QUERY_REFUSED', severity: 'error', message: 'secret row value: never emit me' },
    { code: 'SNAPBACK_INFO', severity: 'info', message: 'also private' },
  ],
  capabilityGaps: [],
};

let cases = 0;

{
  const first = buildAgentDigest({ surface: baseSurface(), inspection, nowMs: 10 });
  const second = buildAgentDigest({ surface: baseSurface(), inspection, nowMs: 999 });
  assert.equal(canonicalJson(first), canonicalJson(second), 'unchanged digests are byte-identical');
  assert.equal(first.artifactKind, 'agentDigest');
  assert.equal(first.sections.static.key, first.envelopeHash);
  assert.equal(first.sections.dynamic.key, first.digestCursor);
  assert.equal(first.sections.dynamic.reason, 'coarse-resolution-v0-no-observation-retention');
  assert.deepEqual(
    first.sections.static.items.map(({ key }) => key),
    [...first.sections.static.items.map(({ key }) => key)].sort(),
  );
  assert.doesNotMatch(canonicalJson(first), /never emit me|also private/);
  cases += 1;
}

{
  const first = buildAgentDigest({ surface: baseSurface(), inspection });
  const unchanged = buildAgentDigest({ surface: baseSurface(), inspection, changedSince: first.digestCursor });
  assert.equal(unchanged.changeReason, 'envelope-unchanged');
  assert.equal(unchanged.sections.static.mode, 'delta');
  assert.deepEqual(unchanged.sections.static.items, []);
  assert.equal(unchanged.sections.dynamic.items.length, 3, 'coarse dynamic section is replayed whole');
  cases += 1;
}

{
  const first = buildAgentDigest({ surface: baseSurface(), inspection });
  const compatible = buildAgentDigest({ surface: baseSurface(), inspection, changedSince: first.envelopeHash });
  assert.equal(compatible.changeReason, 'bare-envelope-hash-match');
  assert.deepEqual(compatible.sections.static.items, []);
  assert.equal(compatible.sections.dynamic.mode, 'full');
  cases += 1;
}

{
  const degraded = buildAgentDigest({ surface: baseSurface(), inspection, changedSince: 'sbad1.not-json' });
  assert.equal(degraded.changeReason, 'unknown-cursor');
  assert.equal(degraded.sections.static.mode, 'full');
  assert.ok(degraded.sections.static.items.length > 0);
  cases += 1;
}

{
  const first = buildAgentDigest({ surface: baseSurface(), inspection });
  const payload = JSON.parse(Buffer.from(first.digestCursor.slice(AGENT_DIGEST_CURSOR_PREFIX.length), 'base64url').toString('utf8'));
  payload.expiresAtMs = 5;
  const expired = `${AGENT_DIGEST_CURSOR_PREFIX}${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  assert.equal(parseDigestCursor(expired, { nowMs: 10 }).status, 'expired-cursor');
  const degraded = buildAgentDigest({ surface: baseSurface(), inspection, changedSince: expired, nowMs: 10 });
  assert.equal(degraded.changeReason, 'expired-cursor');
  assert.equal(degraded.sections.static.mode, 'full');
  cases += 1;
}

{
  const firstSurface = baseSurface();
  const first = buildAgentDigest({ surface: firstSurface, inspection });
  const changedSurface = baseSurface();
  changedSurface.schemaManifest.tables[0].fields[0].optional = true;
  changedSurface.generation = { ...changedSurface.generation, schemaHash: 'sha256:schema-2', inputsHash: 'inputs-2' };
  const changed = buildAgentDigest({ surface: changedSurface, inspection, changedSince: first.digestCursor });
  assert.equal(changed.changeReason, 'envelope-changed');
  assert.deepEqual(changed.sections.static.items.map(({ key }) => key), [
    'artifact/identity',
    'schema/table/tasks',
  ]);
  assert.deepEqual(changed.sections.static.removedKeys, []);
  cases += 1;
}

{
  const firstSurface = baseSurface();
  firstSurface.functions.push({ ...firstSurface.functions[0], id: 'digest-app:old', name: 'old' });
  const first = buildAgentDigest({ surface: firstSurface, inspection });
  const changed = buildAgentDigest({ surface: baseSurface(), inspection, changedSince: first.digestCursor });
  assert.deepEqual(changed.sections.static.removedKeys, ['operation/digest-app:old']);
  cases += 1;
}

{
  const constrained = buildAgentDigest({
    surface: baseSurface(),
    inspection,
    budgetBytes: 2_048,
    budgetItems: 1,
  });
  assert.ok(constrained.budget.emittedItems <= 1);
  assert.ok(constrained.elisions.length > 0);
  assert.ok(constrained.elisions.every(({ request }) => request.flag === '--budget-bytes'));
  assert.equal(constrained.budget.emittedBytes, Buffer.byteLength(canonicalJson(constrained)));
  cases += 1;
}

{
  const observed = buildAgentDigest({
    surface: baseSurface(),
    inspection: {
      ...inspection,
      declarationConformance: [{ functionId: 'digest-app:list', status: 'passed', rawRows: ['must-not-emit'] }],
    },
  });
  const item = observed.sections.dynamic.items.find(({ key }) => key === 'dynamic/declaration-conformance');
  assert.deepEqual(item.value, {
    available: true,
    verdicts: [{ functionId: 'digest-app:list', status: 'passed' }],
  });
  assert.doesNotMatch(canonicalJson(observed), /must-not-emit/);
  cases += 1;
}

console.log(`digest.test.mjs: ${cases} D3 cases passed`);
