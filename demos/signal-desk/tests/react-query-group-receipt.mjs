// @ref LLP 0112#evidence-and-acceptance — independently read the retained
// report so generated, binding, adoption, adapter, delivery, and cleanup
// provenance cannot disappear behind a green in-process check.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, '..');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const digest = (path) => `sha256:${createHash('sha256')
  .update(readFileSync(path))
  .digest('hex')}`;
const receipt = JSON.parse(readFileSync(
  join(demoRoot, 'acceptance', 'results', 'react-query-group.v1.json'),
  'utf8',
));
const { groups } = await import(pathToFileURL(join(generatedRoot, 'api.mjs')).href);
const sha256 = /^sha256:[0-9a-f]{64}$/u;

assert.equal(receipt.schemaVersion, 'snapback.real-adapter-query-group-receipt.v1');
assert.equal(receipt.appId, 'backend-bakeoff');
assert.equal(receipt.ok, true);
assert.equal(receipt.skipped, 0);
assert.equal(receipt.cleanupErrorCount, 0);

assert.equal(receipt.generated.artifactManifest.path, 'snapback/generated/artifacts.json');
assert.equal(
  receipt.generated.artifactManifest.sha256,
  digest(join(generatedRoot, 'artifacts.json')),
);
assert.equal(receipt.generated.routeSource.path, 'snapback/routes.mjs');
assert.equal(
  receipt.generated.routeSource.sha256,
  digest(join(demoRoot, 'snapback', 'routes.mjs')),
);
assert.equal(receipt.generated.runtime.path, 'snapback/generated/api.mjs');
assert.equal(receipt.generated.runtime.sha256, digest(join(generatedRoot, 'api.mjs')));
assert.equal(receipt.generated.declarations.path, 'snapback/generated/api.d.ts');
assert.equal(
  receipt.generated.declarations.sha256,
  digest(join(generatedRoot, 'api.d.ts')),
);
assert.deepEqual(receipt.generated.group, {
  id: groups['/'].id,
  route: groups['/'].route,
  definitionHash: groups['/'].definitionHash,
  queryNames: groups['/'].queries.map((query) => query.name),
});
assert.match(receipt.generated.group.definitionHash, sha256);

assert.equal(receipt.binding.preparation, 'SnapbackClient.prepareReactBinding');
assert.equal(
  receipt.binding.evidence,
  'exact generated-manifest admission before adapter setup',
);
assert.equal(
  receipt.binding.generatedManifest.schemaHash,
  receipt.binding.result.deploymentIdentity.schemaHash,
);
assert.equal(
  receipt.binding.generatedManifest.bundleHash,
  receipt.binding.result.deploymentIdentity.bundleHash,
);
assert.equal(receipt.binding.generatedManifest.targetProfileId, 'local-dev-sqlite-ibex');
assert.equal(receipt.binding.generatedManifest.routeCount, 1);
assert.equal(receipt.binding.result.appId, receipt.appId);
assert.equal(receipt.binding.result.profile, 'local-dev-sqlite-ibex');
assert.equal(receipt.binding.result.authMode, 'sessions');
assert.match(receipt.binding.result.routeManifestHash, sha256);
assert.equal(receipt.binding.result.registeredBundleAvailable, true);
assert.deepEqual(receipt.binding.result.groupIds, [receipt.generated.group.id]);

assert.equal(receipt.adapter.source.path, 'src/backends/snapback.ts');
assert.equal(
  receipt.adapter.source.sha256,
  digest(join(demoRoot, 'src', 'backends', 'snapback.ts')),
);
assert.match(receipt.adapter.compiledBundleSha256, sha256);
assert.equal(receipt.adapter.kind, 'snapback');
assert.equal(receipt.adapter.label, 'Snapback');
assert.equal(
  receipt.adapter.transport,
  'native WebSocket live queries + ephemeral overlay',
);
assert.equal(receipt.adapter.setupCompleted, true);

assert.equal(receipt.adoption.source, 'registered-bundle');
assert.equal(receipt.adoption.bootSource, 'registered-bundle');
assert(Number.isSafeInteger(receipt.adoption.commitVersion));
assert(receipt.adoption.commitVersion >= 0);
assert.equal(typeof receipt.adoption.generation, 'string');
assert.equal(typeof receipt.adoption.versionStream, 'string');
assert.equal(receipt.adoption.opaquePreparation, true);
assert.equal(receipt.adoption.providerCustody, true);
assert.equal(receipt.adoption.adapterConsumer, 'SnapbackAdapter.subscribeWorkspace');

const checks = new Map(receipt.results.map((result) => [result.name, result]));
const delivery = checks.get('real-adapter-mutation-and-live-delivery');
assert.equal(delivery?.ok, true);
assert.equal(delivery?.details?.mutation, 'addComment');
assert.equal(
  delivery?.details?.liveBody,
  'Real generated-group adapter witness',
);
const cleanup = checks.get('real-adapter-cleanup');
assert.equal(cleanup?.ok, true);
assert.deepEqual(cleanup?.details, {
  terminal: true,
  stores: 0,
  consumers: 0,
  serverSubscriptions: 0,
  preparedRegistrations: 0,
});

console.log('PASS backend bakeoff / retained real-adapter query-group receipt');
