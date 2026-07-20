// LLP 0063 Step 3 / WS4 cumulative provider-boundary witness.
//
// @ref LLP 0063#workstream-4--generated-provider-boundaries-and-a-closed-type-loop
//   — one receipt joins deterministic generation, closed mapping/handshake,
//   typed bindings, a second producer, retained race tests, and client-only
//   artifact inspection. The manifest claim remains a separate explicit edit.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { generate } from '../../../../packages/snapback-codegen/index.mjs';
import {
  PROVIDER_ADAPTER_HANDSHAKE_VERSION,
  PROVIDER_INTROSPECTION_SCHEMA_VERSION,
  assertProviderAdapterHandshake,
  createProviderBindingMetadata,
  projectContractDataManifest,
  serializeProviderBindingMetadata,
  serializeProviderIntrospection,
  validateContractDataManifestProjection,
  validateProviderAdapterHandshake,
  validateProviderIntrospection,
  validateProviderResultShapeVocabulary,
} from '../../../../packages/snapback-codegen/provider-introspection.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const backendRoot = join(demoRoot, 'snapback');
const generatedRoot = join(backendRoot, 'generated');
const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1];
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const fileDigest = (path) => digest(readFileSync(resolve(repoRoot, path)));
const identity = (path) => ({ path, sha256: fileDigest(path) });
const readGeneratedJson = (name) => JSON.parse(readFileSync(join(generatedRoot, name), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const providerBindingsSchema = JSON.parse(readFileSync(
  join(repoRoot, 'packages', 'snapback-codegen', 'provider-bindings.schema.json'),
  'utf8',
));
const validateProviderBindingsSchema = new Ajv2020({ allErrors: true, strict: true })
  .compile(providerBindingsSchema);
const suite = createSuite('partiful matrix / Step 3 generated provider boundary', {
  expectedChecks: 11,
});
const childTests = [];

await runAcceptance(suite, async () => {
  const introspection = readGeneratedJson('provider-introspection.json');
  const bindings = readGeneratedJson('provider-bindings.json');
  const contractManifest = readGeneratedJson('contract-data.manifest.json');
  const artifactIndex = readGeneratedJson('artifacts.json');
  const generatedPackage = readGeneratedJson('package.json');

  await suite.check('provider introspection is persisted, versioned, exported, and indexed', async () => {
    assert.equal(introspection.artifactKind, 'providerIntrospection');
    assert.equal(introspection.schemaVersion, PROVIDER_INTROSPECTION_SCHEMA_VERSION);
    assert.equal(introspection.provider.id, 'snapback');
    assert.match(introspection.provider.version, /^snapback\.v\d+$/);
    assert.equal(
      validateProviderBindingsSchema(bindings),
      true,
      JSON.stringify(validateProviderBindingsSchema.errors),
    );
    assert.equal(generatedPackage.exports['./provider-introspection'], './provider-introspection.json');
    assert.equal(generatedPackage.exports['./provider-bindings'].types, './provider-bindings.d.ts');
    assert.equal(generatedPackage.exports['./provider-bindings'].default, './provider-bindings.json');
    for (const artifact of [
      'provider-introspection.json',
      'provider-bindings.json',
      'provider-bindings.d.ts',
    ]) assert(artifactIndex.artifacts.includes(artifact), `${artifact} is not indexed`);
  });

  await suite.check('delete and regenerate restores provider sidecars byte-for-byte', async () => {
    const temp = makeTemporaryPartitimeBackend();
    try {
      const first = await generate(temp.backend);
      assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
      const firstBytes = Object.fromEntries([
        'provider-introspection.json',
        'provider-bindings.json',
        'provider-bindings.d.ts',
      ].map((name) => [name, readFileSync(join(temp.backend, 'generated', name))]));
      rmSync(join(temp.backend, 'generated', 'provider-introspection.json'));
      const second = await generate(temp.backend);
      assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
      for (const [name, bytes] of Object.entries(firstBytes)) {
        assert.deepEqual(readFileSync(join(temp.backend, 'generated', name)), bytes, `${name} drifted`);
      }
    } finally {
      rmSync(temp.root, { recursive: true, force: true });
    }
  });

  await suite.check('generated query result types reach function refs and binding metadata', async () => {
    const apiTypes = readFileSync(join(generatedRoot, 'api.d.ts'), 'utf8');
    const bindingTypes = readFileSync(join(generatedRoot, 'provider-bindings.d.ts'), 'utf8');
    assert.match(apiTypes, /readonly __result\?: Result/);
    for (const name of ['listEvents', 'eventDetails', 'guestList', 'eventWall']) {
      const binding = bindings.bindings.queries.find((entry) => entry.name === name);
      assert(binding, `missing ${name} binding metadata`);
      assert.match(binding.resultType, /^ReadonlyArray<\{/);
      assert(!binding.resultType.includes('unknown'), `${name} degraded to unknown`);
      assert.match(apiTypes, new RegExp(`${name}: FunctionReference<[^\\n]+ReadonlyArray<\\{`));
      assert.match(bindingTypes, new RegExp(`export type ${pascal(name)}Result = ReadonlyArray<\\{`));
      const meta = readFileSync(
        join(generatedRoot, 'contract', `${name}.query.contract-meta.ts`),
        'utf8',
      );
      assert.match(meta, new RegExp(`result: '${pascal(name)}Row\\[\\]'`));
    }
  });

  await suite.check('adapter handshake accepts the exact tuple and refuses stale artifacts', async () => {
    const handshake = contractHandshake(introspection);
    assert.deepEqual(validateProviderAdapterHandshake(introspection, handshake), []);
    assert.equal(assertProviderAdapterHandshake(introspection, handshake), introspection);
    const stale = clone(handshake);
    stale.expectedSource.inputsHash = 'sha256:stale';
    const refused = validateProviderAdapterHandshake(introspection, stale);
    assert.equal(refused[0]?.code, 'PROVIDER_INTROSPECTION_HANDSHAKE_INCOMPATIBLE');
    assert.throws(
      () => assertProviderAdapterHandshake(introspection, stale),
      (error) => error.code === 'PROVIDER_INTROSPECTION_HANDSHAKE_INCOMPATIBLE'
        && error.diagnostic?.details?.adapter === 'contract-data-manifest.v2',
    );
  });

  await suite.check('Snapback passes neutral validation and exact projection conformance', async () => {
    assert.deepEqual(validateProviderIntrospection(introspection), []);
    assert.deepEqual(validateProviderResultShapeVocabulary(introspection), []);
    assert.deepEqual(validateContractDataManifestProjection(introspection, contractManifest), []);
    assert.deepEqual(clone(projectContractDataManifest(introspection)), contractManifest);
    assert.equal(serializeProviderIntrospection(introspection), readFileSync(
      join(generatedRoot, 'provider-introspection.json'),
      'utf8',
    ));
    assert.equal(serializeProviderBindingMetadata(bindings), readFileSync(
      join(generatedRoot, 'provider-bindings.json'),
      'utf8',
    ));
  });

  await suite.check('SQLite gateway passes the same producer and handshake conformance', async () => {
    const sqlite = sqliteProviderIntrospection();
    assert.deepEqual(validateProviderIntrospection(sqlite), []);
    assert.deepEqual(validateProviderResultShapeVocabulary(sqlite), []);
    const result = createProviderBindingMetadata(sqlite);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(
      result.metadata.bindings.queries[0].resultType,
      'ReadonlyArray<{ "id": string; "title": string }>',
    );
    assert.equal(projectContractDataManifest(sqlite).provider, 'sqlite-gateway');
    assert.deepEqual(validateProviderAdapterHandshake(sqlite, contractHandshake(sqlite)), []);
  });

  await suite.check('a polling producer cannot claim push', async () => {
    const dishonest = sqliteProviderIntrospection();
    dishonest.operations.queries[0].delivery.transports.push({ kind: 'push', role: 'fallback' });
    const diagnostics = validateProviderIntrospection(dishonest);
    assert.equal(diagnostics[0]?.code, 'PROVIDER_INTROSPECTION_SCHEMA_INVALID');
    assert(diagnostics[0].problems.some((problem) => problem.includes('cannot also claim push')));
  });

  await suite.check('unknown result shapes degrade explicitly and novel shapes fail closed', async () => {
    const unknown = sqliteProviderIntrospection();
    unknown.operations.queries[0].result.row = { shape: 'unknown' };
    const degraded = createProviderBindingMetadata(unknown);
    assert.equal(degraded.ok, true);
    assert.equal(degraded.metadata.bindings.queries[0].resultType, 'ReadonlyArray<unknown>');
    assert(degraded.diagnostics.some(
      ({ code, severity }) => code === 'PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED'
        && severity === 'warning',
    ));
    const novel = sqliteProviderIntrospection();
    novel.operations.queries[0].result.row = { shape: 'tuple', items: [] };
    assert.equal(
      validateProviderResultShapeVocabulary(novel)[0]?.code,
      'PROVIDER_INTROSPECTION_RESULT_SHAPE_UNMAPPED',
    );
    assert.equal(createProviderBindingMetadata(novel).ok, false);

    const collision = sqliteProviderIntrospection();
    const first = clone(collision.operations.queries[0]);
    first.name = 'a-b';
    const second = clone(collision.operations.queries[0]);
    second.name = 'a_b';
    collision.operations.queries = [first, second];
    const refused = createProviderBindingMetadata(collision);
    assert.equal(refused.ok, false);
    assert(refused.diagnostics.some(
      ({ code }) => code === 'PROVIDER_INTROSPECTION_BINDING_TYPE_COLLISION',
    ));
  });

  await suite.check('switching producer metadata does not edit Contract view source', async () => {
    const sourcePaths = [
      'demos/partiful-matrix/surfaces/contract/feed.contract',
      'demos/partiful-matrix/surfaces/contract/event.contract',
    ];
    const before = sourcePaths.map(fileDigest);
    projectContractDataManifest(introspection);
    projectContractDataManifest(sqliteProviderIntrospection());
    assert.deepEqual(sourcePaths.map(fileDigest), before);
  });

  await suite.check('retained provider race suites pass deterministically', async () => {
    for (const path of [
      'packages/snapback-contract/render-first.test.mjs',
      'packages/snapback-contract/auth-coordinator-missed-wakeup.test.mjs',
      'packages/snapback-contract/ephemeral-resubscribe-race.test.mjs',
      'packages/snapback-contract/index.test.mjs',
    ]) {
      const child = spawnSync(process.execPath, [path], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 120_000,
      });
      assert.equal(child.signal, null, `${path} was signaled: ${child.signal}`);
      assert.equal(child.status, 0, `${path} failed:\n${child.stdout}\n${child.stderr}`);
      childTests.push({
        path,
        sha256: fileDigest(path),
        outputSha256: digest(`${child.stdout}${child.stderr}`),
      });
    }
  });

  await suite.check('browser and native client artifacts exclude server implementation', async () => {
    const clientArtifacts = [
      'api.mjs',
      'api.d.ts',
      'provider-introspection.json',
      'provider-bindings.json',
      'provider-bindings.d.ts',
      'contract-data.manifest.json',
      ...artifactIndex.artifacts.filter((path) => path.startsWith('contract/')),
    ];
    const forbidden = ['src/server.rs', 'snapback-server', 'IbexModule', '__snapbackHandlers', 'handlers.mjs'];
    for (const path of clientArtifacts) {
      const source = readFileSync(join(generatedRoot, path), 'utf8');
      for (const marker of forbidden) {
        assert(!source.includes(marker), `${path} contains server-only marker ${marker}`);
      }
    }
    const android = JSON.parse(readFileSync(
      join(demoRoot, 'acceptance', 'results', 'step2-react-expo-android.json'),
      'utf8',
    ));
    assert.equal(android.ok, true);
    assert(android.results.some(
      ({ ok, name }) => ok === true && name.includes('release artifact excludes Snapback server code'),
    ));
  });
}, {
  reportFile: option('receipt'),
  reportExtra: {
    schemaVersion: 'partitime.step3-provider-boundary.v1',
    claimId: 'STEP3.PROVIDER_BOUNDARY',
    claimPromoted: false,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    childTests,
    testInventory: [
      'demos/partiful-matrix/tests/acceptance/step3-provider-boundary.mjs',
      'packages/snapback-codegen/index.mjs',
      'packages/snapback-codegen/provider-introspection.mjs',
      'packages/snapback-codegen/provider-introspection.schema.json',
      'packages/snapback-codegen/provider-bindings.schema.json',
      'packages/snapback-codegen/provider-introspection.test.mjs',
      'packages/snapback-contract/render-first.test.mjs',
      'packages/snapback-contract/auth-coordinator-missed-wakeup.test.mjs',
      'packages/snapback-contract/ephemeral-resubscribe-race.test.mjs',
      'packages/snapback-contract/index.test.mjs',
      'demos/partiful-matrix/snapback/schema.mjs',
      'demos/partiful-matrix/snapback/functions.mjs',
      'demos/partiful-matrix/snapback/handlers.mjs',
      'demos/partiful-matrix/snapback/generated/provider-introspection.json',
      'demos/partiful-matrix/snapback/generated/provider-bindings.json',
      'demos/partiful-matrix/snapback/generated/provider-bindings.d.ts',
      'demos/partiful-matrix/acceptance/results/step2-react-expo-android.json',
    ].map(identity),
  },
});

function makeTemporaryPartitimeBackend() {
  const root = mkdtempSync(join(repoRoot, 'demos', '.partitime-provider-boundary-'));
  const demo = join(root, 'partiful-matrix');
  const backend = join(demo, 'snapback');
  const kit = join(root, '_kit');
  mkdirSync(backend, { recursive: true });
  mkdirSync(kit, { recursive: true });
  for (const name of ['schema.mjs', 'functions.mjs', 'handlers.mjs', 'seed.json']) {
    copyFileSync(join(backendRoot, name), join(backend, name));
  }
  copyFileSync(join(demoRoot, 'demo.snapback.json'), join(demo, 'demo.snapback.json'));
  const defineUrl = pathToFileURL(join(repoRoot, 'packages', 'snapback-codegen', 'define.mjs')).href;
  writeFileSync(join(kit, 'define.mjs'), `export * from ${JSON.stringify(defineUrl)};\n`);
  return { root, backend };
}

function contractHandshake(introspection) {
  return {
    handshakeVersion: PROVIDER_ADAPTER_HANDSHAKE_VERSION,
    adapter: 'contract-data-manifest.v2',
    supportedIntrospectionVersions: [PROVIDER_INTROSPECTION_SCHEMA_VERSION],
    supportedProviderVersions: {
      [introspection.provider.id]: [introspection.provider.version],
    },
    requiredCapabilities: [],
    expectedSource: { inputsHash: introspection.source.inputsHash },
  };
}

function sqliteProviderIntrospection() {
  return {
    artifactKind: 'providerIntrospection',
    schemaVersion: PROVIDER_INTROSPECTION_SCHEMA_VERSION,
    provider: { id: 'sqlite-gateway', version: 'sqlite-gateway.v1' },
    source: {
      inputsHash: 'sha256:partitime-sqlite-declarations',
      schemaHash: 'sha256:partitime-sqlite-schema',
      implementationHash: 'sha256:partitime-sqlite-adapter',
    },
    capabilities: {
      claims: { subscriptions: false, initialSnapshot: true },
      receipts: { mutation: false, subscription: false },
    },
    operations: {
      queries: [{
        name: 'listEvents',
        arguments: { fields: {}, order: [] },
        result: {
          kind: 'list',
          row: {
            shape: 'object',
            fields: {
              id: { shape: 'primitive', name: 'string' },
              title: { shape: 'primitive', name: 'string' },
            },
          },
        },
        execution: { serverRunnable: true, localRunnable: false },
        dependencies: { reads: ['events'] },
        delivery: {
          mode: 'poll',
          initialSnapshot: true,
          defaultLive: true,
          transports: [{ kind: 'poll', role: 'primary', cadenceMs: 1000 }],
        },
      }],
      mutations: [],
      ephemeral: [],
    },
  };
}

function pascal(value) {
  return value
    .replace(/(^|[^A-Za-z0-9])([A-Za-z0-9])/g, (_match, _separator, character) => character.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, '');
}
