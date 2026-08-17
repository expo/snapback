import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { buildContractMutationDescriptor, generate } from './index.mjs';
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
  const snapbackModules = join(backend, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(packageRoot, join(snapbackModules, 'snapback-codegen'), 'dir');

  writeFileSync(join(backend, 'schema.mjs'), `
import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
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
  args: { id: v.string(), title: v.string(), tags: v.array(v.string(), { maxItems: 3 }) },
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
  assert.deepEqual(Object.keys(generatedPackage.exports['.']), ['types', 'import']);
  assert.deepEqual(Object.keys(generatedPackage.exports['./provider-bindings']), ['types', 'default']);
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
  assert.match(apiTypes, /"aLive": FunctionReference<[^\n]+ReadonlyArray</);
  const clientModule = join(packageRoot, '../../demos/_kit/client.mjs');
  writeFileSync(join(backend, 'ephemeral-types.fixture.ts'), `
import { SnapbackClient } from ${JSON.stringify(clientModule)};
import type { GeneratedEphemeral } from './generated/api';

declare const client: SnapbackClient;
declare const cursors: GeneratedEphemeral['cursors'];
const overlay = await client.subscribeEphemeral(cursors, {
  connectionId: 'typed-cursor',
  scope: { roomId: 'room-a' },
});
const entry = overlay.currentEntries()[0];
entry.value.x.toFixed();
entry.value.y.toFixed();
// @ts-expect-error the generated value validator has no z field
entry.value.z;
`);
  execFileSync(join(packageRoot, '../../node_modules/.bin/tsc'), [
    '--noEmit',
    '--strict',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    'ephemeral-types.fixture.ts',
  ], { cwd: backend, stdio: 'pipe' });

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
  const cursorOperation = generated.providerIntrospection.operations.ephemeral[0];
  assert.deepEqual(cursorOperation.result, {
    kind: 'list',
    row: {
      shape: 'object',
      fields: {
        expiresAt: { shape: 'primitive', name: 'number', optional: true },
        key: { shape: 'primitive', name: 'string' },
        self: { shape: 'primitive', name: 'boolean' },
        sourceClientId: { shape: 'primitive', name: 'string' },
        updatedAt: { shape: 'primitive', name: 'number' },
        value: {
          shape: 'object',
          fields: {
            x: { shape: 'primitive', name: 'number' },
            y: { shape: 'primitive', name: 'number' },
          },
        },
      },
    },
  });
  const cursorBinding = generated.providerBindingMetadata.bindings.ephemeral[0];
  assert.equal(
    cursorBinding.resultType,
    'ReadonlyArray<{ "expiresAt"?: number; "key": string; "self": boolean; "sourceClientId": string; "updatedAt": number; "value": { "x": number; "y": number } }>',
  );
  assert(
    !generated.diagnostics.some(
      ({ code, path }) => code === 'PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED'
        && path?.startsWith('ephemeral.cursors.'),
    ),
    'a schema-known ephemeral result must not emit a degraded-type warning',
  );
  const editOperation = generated.providerIntrospection.operations.mutations
    .find(({ name }) => name === 'editTodo');
  assert.deepEqual(
    editOperation.arguments.fields.tags,
    {
      shape: 'array',
      items: { shape: 'primitive', name: 'string' },
    },
    'ordinary arrays retain their pre-vector provider bytes (no item bounds)',
  );

  const vectorNumber = {
    shape: 'primitive',
    name: 'number',
    minimum: -(2 ** 100),
    maximum: 2 ** 100,
  };
  const vectorDescriptor = {
    shape: 'array',
    items: vectorNumber,
    minItems: 4_096,
    maxItems: 4_096,
  };
  const vectorIntrospection = createSnapbackProviderIntrospection({
    artifactVersion: generated.contractManifest.schemaVersion,
    inputsHash: generated.contractManifest.inputsHash,
    schemaHash: generated.contractManifest.schemaHash,
    bundleHash: generated.contractManifest.bundleHash,
    capabilities: generated.contractManifest.capabilities,
    receipts: generated.contractManifest.receipts,
    queries: {
      nearest: {
        name: 'nearest',
        args: { vector: vectorDescriptor },
        argOrder: ['vector'],
        reads: ['documents'],
        result: {
          kind: 'list',
          minItems: 0,
          maxItems: 64,
          row: {
            shape: 'object',
            fields: {
              rowId: { shape: 'primitive', name: 'string' },
              distance: { shape: 'primitive', name: 'number' },
              fields: {
                shape: 'object',
                fields: { title: { shape: 'primitive', name: 'string' } },
              },
            },
          },
        },
        serverRunnable: true,
        localRunnable: false,
        mode: 'snapshot',
      },
    },
    mutations: {},
    ephemeral: {},
  });
  assert.deepEqual(validateProviderIntrospection(vectorIntrospection), []);
  assert.deepEqual(
    clone(vectorIntrospection.operations.queries[0].arguments.fields.vector),
    vectorDescriptor,
    'provider arguments carry exact D and the closed component domain',
  );
  const vectorBytes = serializeProviderIntrospection(vectorIntrospection);
  assert.equal(
    serializeProviderIntrospection(JSON.parse(vectorBytes)),
    vectorBytes,
    'the exact vector descriptor has canonical byte-stable serialization',
  );
  const missingDomain = clone(vectorIntrospection);
  delete missingDomain.operations.queries[0].arguments.fields.vector.items.minimum;
  delete missingDomain.operations.queries[0].arguments.fields.vector.items.maximum;
  const missingDomainProblems = validateProviderIntrospection(missingDomain);
  assert(
    missingDomainProblems.some(
      ({ code, problems }) => code === 'PROVIDER_INTROSPECTION_SCHEMA_INVALID'
        && problems?.some((problem) => /invalid array bounds/u.test(problem)),
    ),
    `D > 1024 is reserved for the exact bounded vector descriptor: ${JSON.stringify(missingDomainProblems)}`,
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
    authoredSourceHash: contract.authoredSourceHash,
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

  // Sequence-atomic withholding is a distinct additive Snapback fact. It
  // survives the closed native binding vocabulary, the neutral extension,
  // and the Contract projection without overloading optimistic:false.
  const withholdingContract = clone(contract);
  withholdingContract.mutations.editTodo = buildContractMutationDescriptor({
    ...withholdingContract.mutations.editTodo,
    plan: withholdingContract.mutations.editTodo.plan,
    sequenceAllocationCount: 1,
  });
  const withholdingIntrospection = createSnapbackProviderIntrospection({
    artifactVersion: withholdingContract.schemaVersion,
    inputsHash: withholdingContract.inputsHash,
    schemaHash: withholdingContract.schemaHash,
    bundleHash: withholdingContract.bundleHash,
    authoredSourceHash: withholdingContract.authoredSourceHash,
    capabilities: withholdingContract.capabilities,
    receipts: withholdingContract.receipts,
    queries: withholdingContract.queries,
    mutations: withholdingContract.mutations,
    ephemeral: withholdingContract.ephemeral,
  });
  assert.deepEqual(validateProviderIntrospection(withholdingIntrospection), []);
  assert.equal(
    withholdingIntrospection.operations.mutations[0]
      .extensions.snapback.atomicOptimisticWithholding,
    true,
  );
  assert.deepEqual(
    clone(projectContractDataManifest(withholdingIntrospection)),
    withholdingContract,
  );
  const contradictoryWithholding = clone(withholdingIntrospection);
  contradictoryWithholding.operations.mutations[0].optimistic.supported = true;
  contradictoryWithholding.operations.mutations[0].optimistic.source = 'consumer';
  assert(
    validateProviderIntrospection(contradictoryWithholding)[0]?.problems.some(
      (problem) => problem.includes('.optimistic.supported'),
    ),
    'atomic withholding cannot coexist with optimistic support',
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
  const closedComposite = clone(sqlite);
  closedComposite.operations.queries[0].result.row = {
    shape: 'object',
    fields: {
      kind: { shape: 'literal', value: 'visible' },
      parent: {
        shape: 'union',
        variants: [
          { shape: 'literal', value: null },
          {
            shape: 'object',
            fields: { id: { shape: 'primitive', name: 'string' } },
          },
        ],
      },
      children: {
        shape: 'array',
        items: {
          shape: 'object',
          fields: { id: { shape: 'primitive', name: 'string' } },
        },
      },
      continuation: {
        shape: 'union',
        variants: [
          { shape: 'literal', value: null },
          { shape: 'primitive', name: 'string' },
        ],
      },
    },
  };
  assert.deepEqual(validateProviderResultShapeVocabulary(closedComposite), []);
  assert.equal(validateProviderIntrospection(closedComposite).length, 0);
  const compositeBindings = createProviderBindingMetadata(closedComposite);
  assert.equal(compositeBindings.ok, true, JSON.stringify(compositeBindings.diagnostics));
  assert.equal(
    compositeBindings.metadata.bindings.queries[0].resultType,
    'ReadonlyArray<{ "children": ReadonlyArray<{ "id": string }>; "continuation": null | string; "kind": "visible"; "parent": null | { "id": string } }>',
  );
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
