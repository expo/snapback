import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalExecutableSource,
  completeGenerationIdentities,
  computeBundleId,
  computeGenerationContentIdentities,
  generationAddressNeutralProjection,
  generationHashingRules,
} from './semantic-generation.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(
  join(packageRoot, 'fixtures', 'semantic-generation-golden.v1.json'),
  'utf8',
)).vectors;

function computeVector(inputs) {
  const contentIdentities = computeGenerationContentIdentities(inputs);
  return completeGenerationIdentities({
    contentIdentities,
    bundleId: computeBundleId(inputs.bundleInput),
    appIdentity: inputs.appIdentity,
    dataIdentity: inputs.dataIdentity,
    targetIdentity: inputs.targetIdentity,
  });
}

test('five-identity canonicalization matches committed golden vectors', () => {
  for (const vector of vectors) {
    assert.deepEqual(computeVector(vector.inputs), vector.expected, vector.name);
  }
  assert.equal(vectors[0].expected.semanticId, vectors[1].expected.semanticId);
  assert.equal(vectors[0].expected.executableId, vectors[1].expected.executableId);
  assert.notEqual(vectors[0].expected.evidenceId, vectors[1].expected.evidenceId);
  assert.notEqual(vectors[0].expected.bundleId, vectors[1].expected.bundleId);
  assert.notEqual(vectors[0].expected.generationId, vectors[1].expected.generationId);
  assert.notEqual(vectors[0].expected.semanticId, vectors[2].expected.semanticId);
  assert.notEqual(vectors[0].expected.executableId, vectors[2].expected.executableId);
});

test('canonical executable bytes exclude comments and formatting', () => {
  const compact = 'export function value(input) { return input + 1; }\n';
  const evidenceEdited = `// review evidence\nexport function value ( input ) {\n  /* @ref LLP 0241#d1-split-identity-by-what-changed */ return input + 1;\n}\n`;
  assert.equal(canonicalExecutableSource(compact), canonicalExecutableSource(evidenceEdited));
  assert.notEqual(
    canonicalExecutableSource(compact),
    canonicalExecutableSource('export function value(input) { return input + 2; }\n'),
  );
});

test('root address fields are excluded from bundle and generation preimages', () => {
  const baseline = vectors[0].expected;
  const changedRoots = {
    ...baseline,
    bundleId: `sha256:${'9'.repeat(64)}`,
    generationId: `sha256:${'8'.repeat(64)}`,
  };
  const common = {
    appIdentity: vectors[0].inputs.appIdentity,
    dataIdentity: vectors[0].inputs.dataIdentity,
    targetIdentity: vectors[0].inputs.targetIdentity,
    members: vectors[0].inputs.bundleInput.members,
  };
  assert.deepEqual(
    generationAddressNeutralProjection({ ...common, identities: baseline }),
    generationAddressNeutralProjection({ ...common, identities: changedRoots }),
  );
  assert.notDeepEqual(
    generationAddressNeutralProjection({ ...common, identities: baseline }),
    generationAddressNeutralProjection({
      ...common,
      identities: { ...baseline, semanticId: `sha256:${'7'.repeat(64)}` },
    }),
  );
  assert.deepEqual(generationHashingRules().excludedRootAddressFields, [
    'artifacts.json.identities.bundleId',
    'artifacts.json.identities.generationId',
    'generation.json.identities.bundleId',
    'generation.json.identities.generationId',
    'integrity.json.generationId',
  ]);
});
