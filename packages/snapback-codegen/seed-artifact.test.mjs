import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VERSIONED_SEED_MAX_EFFECTS_V1,
  buildSeedArtifactV1,
  canonicalSeedArtifactJson,
  parseSeedSourceV1,
} from './seed-artifact.mjs';

test('versioned seed identity is deterministic and order-sensitive for rows', () => {
  const source = {
    seedVersion: '2026-07-27.1',
    tables: { todos: [{ _id: 'a', title: 'A' }, { _id: 'b', title: 'B' }] },
  };
  const first = buildSeedArtifactV1(source, 'demo').artifact;
  const second = buildSeedArtifactV1(structuredClone(source), 'demo').artifact;
  assert.equal(first.seedDigest, second.seedDigest);
  assert.equal(canonicalSeedArtifactJson(first), canonicalSeedArtifactJson(second));
  const reordered = structuredClone(source);
  reordered.tables.todos.reverse();
  assert.notEqual(buildSeedArtifactV1(reordered, 'demo').artifact.seedDigest, first.seedDigest);
});

test('version reuse inputs are closed and never derived', () => {
  assert.throws(
    () => buildSeedArtifactV1({ seedVersion: 'v1', tables: {}, seedDigest: 'forged' }, 'demo'),
    { code: 'SNAPBACK_SEED_DECLARATION_INVALID' },
  );
  assert.throws(
    () => buildSeedArtifactV1({ seedVersion: '../bad', tables: {} }, 'demo'),
    { code: 'SNAPBACK_SEED_DECLARATION_INVALID' },
  );
});

test('empty arrays still count as named targets and effects are bounded', () => {
  const parsed = parseSeedSourceV1(
    JSON.stringify({ seedVersion: 'v1', tables: { occupiedTarget: [] } }),
    'demo',
  );
  assert.equal(parsed.versioned, true);
  assert.deepEqual(Object.keys(parsed.artifact.tables), ['occupiedTarget']);
  const rows = Array.from({ length: VERSIONED_SEED_MAX_EFFECTS_V1 + 1 }, (_, i) => ({ _id: `${i}` }));
  assert.throws(
    () => buildSeedArtifactV1({ seedVersion: 'v2', tables: { rows } }, 'demo'),
    { code: 'SNAPBACK_SEED_EFFECT_LIMIT' },
  );
});

test('legacy declaration remains explicit', () => {
  assert.deepEqual(
    parseSeedSourceV1('{"tables":{"todos":[]}}', 'demo'),
    { versioned: false, seed: { tables: { todos: [] } } },
  );
});
