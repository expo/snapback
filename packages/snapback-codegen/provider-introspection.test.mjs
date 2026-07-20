import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { generate } from './index.mjs';
import {
  PROVIDER_ADAPTER_HANDSHAKE_VERSION,
  PROVIDER_BINDING_METADATA_SCHEMA_VERSION,
  PROVIDER_INTROSPECTION_SCHEMA_VERSION,
  assertProviderAdapterHandshake,
  createProviderBindingMetadata,
  createSnapbackProviderIntrospection,
  projectContractDataManifest,
  renderProviderBindingTypes,
  serializeProviderIntrospection,
  validateContractDataManifestProjection,
  validateProviderAdapterHandshake,
  validateProviderIntrospection,
  validateProviderResultShapeVocabulary,
  validateSnapbackIntrospectionSource,
} from './provider-introspection.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(
  join(packageRoot, 'provider-introspection.schema.json'),
  'utf8',
));
assert.equal(schema.$id, 'https://schemas.snapback.dev/provider-introspection/v1.schema.json');
assert.equal(schema.properties.artifactKind.const, 'providerIntrospection');
assert.equal(schema.properties.schemaVersion.const, 'provider-introspection.v1');
const bindingSchema = JSON.parse(readFileSync(
  join(packageRoot, 'provider-bindings.schema.json'),
  'utf8',
));
const validateBindingSchema = new Ajv2020({ allErrors: true, strict: true }).compile(bindingSchema);
assert.equal(bindingSchema.$id, 'https://schemas.snapback.dev/provider-bindings/v1.schema.json');
const codegenPackage = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
assert.equal(
  codegenPackage.exports['./provider-bindings.schema.json'],
  './provider-bindings.schema.json',
);

const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const backend = mkdtempSync(join(tmpdir(), 'snapback-provider-introspection-'));

try {
  writeFileSync(join(backend, 'schema.mjs'), `
import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).sync(),
}, {
  ephemeral: defineEphemeral({
    cursors: ephemeral.collection({
      scope: { roomId: v.string() },
      routing: ['roomId'],
      key: 'connection',
      ttlMs: 20000,
      maxTtlMs: 30000,
      maxValueBytes: 512,
      publishRate: { sustainedHz: 20, burst: 40 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({ x: v.number(), y: v.number() }),
      publish: allow.all(),
      subscribe: allow.all(),
      targets: ['local-dev-sqlite-ibex'],
    }),
  }),
});
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, defineLiveQuery, defineMutation, defineQuery, patch, returnChangedCount, v } from '${defineUrl}';
export const zSnapshot = defineQuery({ table: 'todos', args: {} });
export const aLive = defineLiveQuery({ table: 'todos', args: {} });
export const editTodo = defineMutation({
  args: { id: v.string(), title: v.string() },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnChangedCount(),
});
`);

  const generated = await generate(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert.deepEqual(validateProviderIntrospection(generated.providerIntrospection), []);
  assert.deepEqual(
    clone(projectContractDataManifest(generated.providerIntrospection)),
    clone(generated.contractManifest),
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(backend, 'generated', 'contract-data.manifest.json'), 'utf8')),
    clone(generated.contractManifest),
  );
  const persistedIntrospection = readFileSync(
    join(backend, 'generated', 'provider-introspection.json'),
    'utf8',
  );
  assert.equal(
    persistedIntrospection,
    serializeProviderIntrospection(generated.providerIntrospection),
  );
  const persistedBindings = JSON.parse(readFileSync(
    join(backend, 'generated', 'provider-bindings.json'),
    'utf8',
  ));
  assert.equal(persistedBindings.schemaVersion, PROVIDER_BINDING_METADATA_SCHEMA_VERSION);
  assert.equal(
    validateBindingSchema(persistedBindings),
    true,
    JSON.stringify(validateBindingSchema.errors),
  );
  const driftedBindings = clone(persistedBindings);
  driftedBindings.unversionedFact = true;
  assert.equal(validateBindingSchema(driftedBindings), false);
  assert.equal(persistedBindings.bindings.queries[0].name, 'aLive');
  assert.match(persistedBindings.bindings.queries[0].resultType, /^ReadonlyArray</);
  assert.equal(
    readFileSync(join(backend, 'generated', 'provider-bindings.d.ts'), 'utf8'),
    renderProviderBindingTypes(generated.providerBindingMetadata),
  );
  const generatedPackage = JSON.parse(readFileSync(join(backend, 'generated', 'package.json'), 'utf8'));
  assert.equal(generatedPackage.exports['./provider-introspection'], './provider-introspection.json');
  assert.equal(generatedPackage.exports['./provider-bindings'].types, './provider-bindings.d.ts');
  assert.equal(generatedPackage.exports['./provider-bindings'].default, './provider-bindings.json');
  const generatedIndex = JSON.parse(readFileSync(join(backend, 'generated', 'artifacts.json'), 'utf8'));
  for (const artifact of [
    'provider-introspection.json',
    'provider-bindings.json',
    'provider-bindings.d.ts',
  ]) {
    assert(generatedIndex.artifacts.includes(artifact), `${artifact} is absent from artifacts.json`);
  }
  const apiTypes = readFileSync(join(backend, 'generated', 'api.d.ts'), 'utf8');
  assert.match(apiTypes, /readonly __result\?: Result/);
  assert.match(apiTypes, /aLive: FunctionReference<[^\n]+ReadonlyArray</);

  // Deleting the persisted declaration and regenerating restores identical
  // bytes; no wall clock or insertion-order state enters the artifact.
  rmSync(join(backend, 'generated', 'provider-introspection.json'));
  const regenerated = await generate(backend);
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated.diagnostics));
  assert.equal(
    readFileSync(join(backend, 'generated', 'provider-introspection.json'), 'utf8'),
    persistedIntrospection,
  );

  assert.deepEqual(
    generated.providerIntrospection.operations.queries.map(({ name }) => name),
    ['aLive', 'zSnapshot'],
  );
  assert.deepEqual(
    generated.providerIntrospection.operations.ephemeral.map(({ name }) => name),
    ['cursors'],
  );
  const live = generated.providerIntrospection.operations.queries[0];
  assert.deepEqual(live.delivery.transports, [
    { kind: 'push', role: 'primary' },
    { cadenceMs: 1500, kind: 'poll', role: 'fallback' },
  ]);

  // Reordered input maps and capability keys serialize identically. Provider
  // operation order is normalized independently of JavaScript insertion order.
  const contract = generated.contractManifest;
  const reordered = createSnapbackProviderIntrospection({
    artifactVersion: contract.schemaVersion,
    inputsHash: contract.inputsHash,
    schemaHash: contract.schemaHash,
    bundleHash: contract.bundleHash,
    capabilities: reverseObject(contract.capabilities),
    receipts: contract.receipts,
    queries: reverseObject(contract.queries),
    mutations: reverseObject(contract.mutations),
    ephemeral: reverseObject(contract.ephemeral),
  });
  assert.equal(
    serializeProviderIntrospection(reordered),
    serializeProviderIntrospection(generated.providerIntrospection),
  );

  // The neutral transport representation makes the polling/push contradiction
  // structural rather than a documentation convention.
  const dishonestPoll = clone(generated.providerIntrospection);
  dishonestPoll.operations.queries[0].delivery.mode = 'poll';
  dishonestPoll.operations.queries[0].delivery.transports = [
    { kind: 'poll', role: 'primary', cadenceMs: 1500 },
    { kind: 'push', role: 'fallback' },
  ];
  const pollDiagnostics = validateProviderIntrospection(dishonestPoll);
  assert.equal(pollDiagnostics[0]?.code, 'PROVIDER_INTROSPECTION_SCHEMA_INVALID');
  assert(pollDiagnostics[0].problems.some((problem) => problem.includes('cannot also claim push')));

  // Projection drift names the exact JSON path and uses a stable diagnostic.
  const staleContract = clone(generated.contractManifest);
  staleContract.queries.aLive.livePush = false;
  const mismatch = validateContractDataManifestProjection(
    generated.providerIntrospection,
    staleContract,
  );
  assert.equal(mismatch[0]?.code, 'PROVIDER_INTROSPECTION_CONTRACT_MAPPING_MISMATCH');
  assert(mismatch[0].problems.includes('$.queries.aLive.livePush: expected true, received false'));

  // New Snapback facts cannot be dropped by the bounded v1 mapper.
  const futureQueries = clone(generated.contractManifest.queries);
  futureQueries.aLive.futureDeliveryFact = true;
  const unmapped = validateSnapbackIntrospectionSource({
    queries: futureQueries,
    mutations: generated.contractManifest.mutations,
    ephemeral: generated.contractManifest.ephemeral,
  });
  assert.equal(unmapped[0]?.code, 'PROVIDER_INTROSPECTION_SNAPBACK_SOURCE_UNMAPPED');
  assert.deepEqual(unmapped[0].problems, ['queries.aLive.futureDeliveryFact']);

  const snapbackHandshake = {
    handshakeVersion: PROVIDER_ADAPTER_HANDSHAKE_VERSION,
    adapter: 'contract-data-manifest.v2',
    supportedIntrospectionVersions: [PROVIDER_INTROSPECTION_SCHEMA_VERSION],
    supportedProviderVersions: {
      snapback: [generated.providerIntrospection.provider.version],
    },
    requiredCapabilities: ['subscriptions'],
    expectedSource: {
      inputsHash: generated.providerIntrospection.source.inputsHash,
    },
  };
  assert.deepEqual(
    validateProviderAdapterHandshake(generated.providerIntrospection, snapbackHandshake),
    [],
  );
  assert.equal(
    assertProviderAdapterHandshake(generated.providerIntrospection, snapbackHandshake),
    generated.providerIntrospection,
  );
  const staleHandshake = clone(snapbackHandshake);
  staleHandshake.supportedProviderVersions.snapback = ['snapback.future'];
  const refused = validateProviderAdapterHandshake(generated.providerIntrospection, staleHandshake);
  assert.equal(refused[0]?.code, 'PROVIDER_INTROSPECTION_HANDSHAKE_INCOMPATIBLE');
  assert.throws(
    () => assertProviderAdapterHandshake(generated.providerIntrospection, staleHandshake),
    (error) => error.code === 'PROVIDER_INTROSPECTION_HANDSHAKE_INCOMPATIBLE'
      && error.diagnostic?.problems?.[0] === refused[0].problems[0],
  );

  // A SQL gateway is the first non-Snapback producer. It passes the same
  // schema/type/handshake boundary while remaining honestly poll-only.
  const sqlite = sqliteProviderIntrospection();
  assert.deepEqual(validateProviderIntrospection(sqlite), []);
  const sqliteBindings = createProviderBindingMetadata(sqlite);
  assert.equal(sqliteBindings.ok, true, JSON.stringify(sqliteBindings.diagnostics));
  assert.equal(
    sqliteBindings.metadata.bindings.queries[0].resultType,
    'ReadonlyArray<{ "id": string; "title": string }>',
  );
  assert.equal(projectContractDataManifest(sqlite).provider, 'sqlite-gateway');
  assert.deepEqual(validateProviderAdapterHandshake(sqlite, {
    handshakeVersion: PROVIDER_ADAPTER_HANDSHAKE_VERSION,
    adapter: 'contract-data-manifest.v2',
    supportedIntrospectionVersions: [PROVIDER_INTROSPECTION_SCHEMA_VERSION],
    supportedProviderVersions: { 'sqlite-gateway': ['sqlite-gateway.v1'] },
  }), []);

  const sqliteClaimsPush = clone(sqlite);
  sqliteClaimsPush.operations.queries[0].delivery.transports.push({
    kind: 'push',
    role: 'fallback',
  });
  assert(
    validateProviderIntrospection(sqliteClaimsPush)[0].problems
      .some((problem) => problem.includes('cannot also claim push')),
  );

  // `unknown` is a named degraded mapping; a novel shape is an error with its
  // own stable code and cannot produce generated binding metadata.
  const degraded = clone(sqlite);
  degraded.operations.queries[0].result.row = { shape: 'unknown' };
  const degradedBindings = createProviderBindingMetadata(degraded);
  assert.equal(degradedBindings.ok, true);
  assert.equal(degradedBindings.metadata.bindings.queries[0].resultType, 'ReadonlyArray<unknown>');
  assert(degradedBindings.diagnostics.some(
    ({ code, severity }) => code === 'PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED'
      && severity === 'warning',
  ));
  const novelShape = clone(sqlite);
  novelShape.operations.queries[0].result.row = { shape: 'tuple', items: [] };
  assert.equal(
    validateProviderResultShapeVocabulary(novelShape)[0]?.code,
    'PROVIDER_INTROSPECTION_RESULT_SHAPE_UNMAPPED',
  );
  const novelBindings = createProviderBindingMetadata(novelShape);
  assert.equal(novelBindings.ok, false);
  assert.equal(novelBindings.metadata, null);

  // Provider wire names may use different punctuation while normalizing to
  // the same TypeScript identifier. Refuse the artifact before duplicate type
  // aliases can be emitted.
  const collidingNames = clone(sqlite);
  const first = clone(collidingNames.operations.queries[0]);
  first.name = 'a-b';
  const second = clone(collidingNames.operations.queries[0]);
  second.name = 'a_b';
  collidingNames.operations.queries = [first, second];
  assert.deepEqual(validateProviderIntrospection(collidingNames), []);
  const collidingBindings = createProviderBindingMetadata(collidingNames);
  assert.equal(collidingBindings.ok, false);
  assert.equal(collidingBindings.metadata, null);
  assert.equal(
    collidingBindings.diagnostics.find(({ code }) => (
      code === 'PROVIDER_INTROSPECTION_BINDING_TYPE_COLLISION'
    ))?.problems?.[0],
    '$.operations.queries[1].name: generated alias "AB" for "a_b" collides with "a-b" from $.operations.queries[0].name',
  );
  assert.throws(
    () => renderProviderBindingTypes({
      bindings: {
        queries: [
          { name: 'a-b', argumentsType: 'unknown', resultType: 'unknown' },
          { name: 'a_b', argumentsType: 'unknown', resultType: 'unknown' },
        ],
        mutations: [],
        ephemeral: [],
      },
    }),
    (error) => error.code === 'PROVIDER_INTROSPECTION_BINDING_TYPE_COLLISION',
  );
} finally {
  rmSync(backend, { recursive: true, force: true });
}

console.log('provider introspection tests passed');

function reverseObject(value) {
  return Object.fromEntries(Object.entries(value).reverse());
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sqliteProviderIntrospection() {
  return {
    artifactKind: 'providerIntrospection',
    schemaVersion: PROVIDER_INTROSPECTION_SCHEMA_VERSION,
    provider: { id: 'sqlite-gateway', version: 'sqlite-gateway.v1' },
    source: {
      inputsHash: 'sha256:sqlite-declarations',
      schemaHash: 'sha256:sqlite-schema',
      implementationHash: 'sha256:sqlite-adapter',
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
