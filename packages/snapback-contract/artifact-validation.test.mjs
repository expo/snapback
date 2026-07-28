import assert from 'node:assert/strict';

import { validateSnapbackContractArtifacts } from './artifact-validation.mjs';

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  schemaVersion: 'snapback.v0',
  queries: { listItems: { name: 'listItems', ephemeral: false } },
  mutations: {},
};
const artifactIndex = {
  artifactKind: 'artifactIndex',
  manifestVersion: 2,
  schemaVersion: 'snapback.v0',
  artifacts: [
    'contract-data.manifest.json',
    'contract/listItems.query.contract-meta.ts',
    'contract/listItems.query.ts',
  ],
  functions: [{ name: 'listItems', kind: 'Query' }],
  files: [
    {
      path: 'contract-data.manifest.json',
      sha256: `sha256:${'a'.repeat(64)}`,
      logicalKind: 'contract-data-manifest',
      custody: 'regenerable-cache',
      consumer: 'contract',
    },
    {
      path: 'contract/listItems.query.contract-meta.ts',
      sha256: `sha256:${'b'.repeat(64)}`,
      logicalKind: 'contract-projection',
      custody: 'regenerable-cache',
      consumer: 'contract',
    },
    {
      path: 'contract/listItems.query.ts',
      sha256: `sha256:${'c'.repeat(64)}`,
      logicalKind: 'contract-projection',
      custody: 'regenerable-cache',
      consumer: 'contract',
    },
  ],
};

assert.deepEqual(validateSnapbackContractArtifacts({ manifest, artifactIndex }), []);

const missingProjection = structuredClone(artifactIndex);
missingProjection.files = missingProjection.files.filter(({ path }) => path !== 'contract/listItems.query.ts');
assert(
  validateSnapbackContractArtifacts({ manifest, artifactIndex: missingProjection })
    .some(({ code }) => code === 'SNAPBACK_CODEGEN_REVIEW_MANIFEST_INVALID'),
);

console.log('artifact validation: v2 review manifest Contract projections verified');
