import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  ACTION_SPEC_FIELDS,
  JS_QUERY_SPEC_FIELDS,
  MUTATION_SPEC_FIELDS,
  QUERY_SPEC_FIELDS,
} from './define.mjs';
import { FAMILIAR_DISPOSITIONS } from './familiar-dispositions.mjs';
import { generate } from './index.mjs';
import {
  EXPLICIT_AUTHORING_PROFILE,
  FAMILIAR_AUTHORING_PROFILE,
  buildNormalizedApplicationDefinitionV1,
  buildSemanticGenerationInputs,
  canonicalGenerationJson,
  completeGenerationIdentities,
  computeGenerationContentIdentities,
} from './semantic-generation.mjs';
import {
  AUTHORING_PROFILE_READ_ALLOWLIST,
  scanAuthoringProfileBranches,
} from '../../scripts/check-authoring-profile-branches.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizedFixture() {
  return buildNormalizedApplicationDefinitionV1({
    schemaManifest: {
      schemaVersion: 'snapback.v0',
      appId: 'deployment-one',
      authoringProfile: FAMILIAR_AUTHORING_PROFILE,
      auth: { mode: 'sessions' },
      authProgram: null,
      api: { enabled: false },
      assets: null,
      pushSeam: null,
      strictDeclarations: true,
      requiredCapabilities: ['zeta', 'alpha'],
      ephemeralCollections: [],
      tables: [{
        name: 'todos',
        fields: [{ name: 'title', type: 'String' }],
        indexes: [{ name: 'by_title', fields: ['title'] }],
        membership: { scope: 'app' },
      }],
      portabilityFlags: ['portable'],
      migrations: { version: 1 },
      retention: { enabled: true },
      authorityProfile: { version: 1, dimensions: ['tenantId'] },
    },
    functionManifest: {
      appId: 'deployment-one',
      authoringProfile: FAMILIAR_AUTHORING_PROFILE,
      assetUploadIntents: [{
        id: 'deployment-one:avatar',
        name: 'avatar',
        exportedName: 'avatar',
        argsContractHash: 'sha256:args',
        implementationHash: 'sha256:implementation',
        intentPolicyHash: 'sha256:policy',
        authRequirement: 'authenticated',
        accept: ['image/png'],
        delivery: 'direct',
        access: 'private',
        grants: false,
        image: null,
        video: null,
        on: null,
        declaredReads: ['todos'],
        runtime: { IbexModule: { source: 'excluded behavior', export: 'avatar' } },
        handlerForm: 'inline',
        sourceSpan: { file: 'functions.mjs', line: 1 },
      }],
      functions: [
        {
          id: 'deployment-one:zeta',
          name: 'zeta',
          kind: 'Action',
          argsContract: { fields: [] },
          resultContract: { kind: 'value' },
          authRequirement: 'authenticated',
          authorityCreating: true,
          authorizationDependence: ['userId'],
          authorityProfileDependence: ['tenantId'],
          readSetSummary: { tables: [] },
          writeSetSummary: { tables: [] },
          effectCeiling: { hostOperations: [] },
          requiredCapabilities: ['zeta', 'alpha'],
          syncabilityClass: 'action',
          uses: [{ name: 'ZED' }, { name: 'ALPHA' }],
          stream: true,
          sequences: [{ name: 'delivery' }],
          boundedSkew: { maximumMs: 1000 },
          standardPattern: { helper: 'deliver', profile: 'v1' },
          runtime: { IbexModule: { source: 'behavior is excluded', export: 'zeta' } },
        },
        {
          id: 'deployment-one:alpha',
          name: 'alpha',
          kind: 'Mutation',
          argsContract: { fields: [{ name: 'title' }] },
          resultContract: { kind: 'document', table: 'todos' },
          authRequirement: 'public',
          authorityIndependent: true,
          authorizationDependence: [],
          fieldBoundary: { fields: ['title'] },
          readSetSummary: { tables: ['todos'] },
          writeSetSummary: { tables: ['todos'] },
          effectCeiling: { writes: [{ table: 'todos' }] },
          requiredCapabilities: [],
          apiExposure: { expose: false },
          refusals: [{ code: 'Z' }, { code: 'A' }],
          trackedRefusals: [{ code: 'TRACKED' }],
          syncabilityClass: 'mutation',
          retainable: true,
          retentionClass: 'bounded',
          uses: [],
          runtime: { HostPlan: { Mutation: { steps: [] } } },
        },
      ],
    },
    routesManifest: {
      formatVersion: 1,
      app: 'deployment-one',
      routes: [{ path: '/todos', function: 'alpha' }],
    },
  });
}

test('NormalizedApplicationDefinitionV1 has a frozen canonical golden vector', () => {
  const artifact = normalizedFixture();
  assert.deepEqual(artifact.excludedFields, [
    'behavior',
    'graphRecords',
    'authoringProfile',
    'appId',
  ]);
  assert.deepEqual(
    artifact.definition.operations.map(({ operationName }) => operationName),
    ['alpha', 'zeta'],
  );
  assert.deepEqual(artifact.definition.operations[1].secrets, [
    { name: 'ALPHA' },
    { name: 'ZED' },
  ]);
  assert.deepEqual(artifact.definition.operations[0].refusals, [
    { code: 'Z' },
    { code: 'A' },
  ]);
  assert.deepEqual(artifact.definition.operations[0].plan, {
    Mutation: { steps: [] },
  });
  assert.equal(artifact.definition.operations[1].plan, null);
  assert.equal(artifact.definition.operations[1].runtime, null);
  assert.equal(artifact.definition.operations[1].stream, true);
  assert.deepEqual(artifact.definition.operations[1].sequences, [{ name: 'delivery' }]);
  assert.deepEqual(artifact.definition.operations[1].boundedSkew, { maximumMs: 1000 });
  assert.deepEqual(artifact.definition.operations[1].standardPattern, {
    helper: 'deliver',
    profile: 'v1',
  });
  assert.deepEqual(
    artifact.definition.operations[1].authority.authorityProfileDependence,
    ['tenantId'],
  );
  assert.deepEqual(artifact.definition.application.authorityProfile, {
    dimensions: ['tenantId'],
    version: 1,
  });
  assert.equal(artifact.definition.application.assetUploadIntents[0].name, 'avatar');
  assert.equal(
    canonicalGenerationJson(artifact.definition.application.assetUploadIntents).includes('excluded behavior'),
    false,
  );
  assert.equal('app' in artifact.definition.application.routes, false);
  assert.equal(canonicalGenerationJson(artifact.definition).includes('deployment-one'), false);
  assert.equal(
    artifact.normalizedContractId,
    'sha256:b23af27b28fca3e8495e3236a483777d67f75896f69a0cf4fb231a1e3edfe325',
  );
  assert.equal(
    artifact.normalizedSchemaId,
    'sha256:5ffb4d887d15534f19dcc2c43c0428ad49208278a318a54e05edcc3585e30e66',
  );

  const schema = readJson(join(repoRoot, 'schemas', 'normalized-definition.v1.schema.json'));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors));

  assert.throws(
    () => buildNormalizedApplicationDefinitionV1({
      schemaManifest: { schemaVersion: 'snapback.v0', tables: [] },
      functionManifest: {
        functions: [{
          name: 'future',
          kind: 'Query',
          canonicalFieldAddedLater: true,
        }],
      },
      routesManifest: null,
    }),
    (error) => error?.code === 'CODEGEN_WRITE_FAILED'
      && /canonicalFieldAddedLater/u.test(error.message),
  );
});

test('explicit-profile default omission preserves the todo semantic identity', () => {
  const generated = join(repoRoot, 'demos', 'todo', 'snapback', 'generated');
  const common = {
    artifactVersion: 'snapback.v0',
    authMode: 'dev',
    appId: 'todo',
    appIdentity: null,
    dataIdentity: null,
    targetProfile: 'local-dev-sqlite-ibex',
    schemaManifest: readJson(join(generated, 'schema.manifest.json')),
    functionManifest: readJson(join(generated, 'functions.manifest.json')),
    handlerRuntimeProfile: readJson(join(generated, 'handler-runtime-profile.v1.json')),
    capabilityManifest: readJson(join(generated, 'capability.manifest.json')),
    routesManifest: null,
    authoredSourceItems: [],
    sourceSpans: {},
    schemaFieldSpans: {},
    generationLog: {},
  };
  const omitted = buildSemanticGenerationInputs(common);
  const explicit = buildSemanticGenerationInputs({
    ...common,
    authoringProfile: EXPLICIT_AUTHORING_PROFILE,
  });
  assert.deepEqual(explicit.semanticInput, omitted.semanticInput);
  assert.equal('authoringProfile' in explicit.semanticInput, false);
  const omittedIds = computeGenerationContentIdentities(omitted);
  const explicitIds = computeGenerationContentIdentities(explicit);
  assert.equal(explicitIds.semanticId, omittedIds.semanticId);
  assert.equal(
    explicitIds.semanticId,
    'sha256:9166e295f5d6901b63b08406e5551245275fbcb8f0d65ce630dd90e86afffdb9',
  );
  assert.deepEqual(
    completeGenerationIdentities({
      contentIdentities: explicitIds,
      bundleId: `sha256:${'a'.repeat(64)}`,
      appIdentity: { appId: 'todo' },
      dataIdentity: { kind: 'fixture' },
      targetIdentity: { profile: 'local-dev-sqlite-ibex' },
    }),
    completeGenerationIdentities({
      contentIdentities: omittedIds,
      bundleId: `sha256:${'a'.repeat(64)}`,
      appIdentity: { appId: 'todo' },
      dataIdentity: { kind: 'fixture' },
      targetIdentity: { profile: 'local-dev-sqlite-ibex' },
    }),
  );
  const familiar = buildSemanticGenerationInputs({
    ...common,
    authoringProfile: FAMILIAR_AUTHORING_PROFILE,
  });
  assert.equal(familiar.semanticInput.authoringProfile, FAMILIAR_AUTHORING_PROFILE);
  assert.notEqual(computeGenerationContentIdentities(familiar).semanticId, omittedIds.semanticId);
});

test('disposition seed covers canonical fields, constructors, methods, and schema options', () => {
  const functionFields = new Set([
    ...QUERY_SPEC_FIELDS,
    ...MUTATION_SPEC_FIELDS,
    ...ACTION_SPEC_FIELDS,
    ...JS_QUERY_SPEC_FIELDS,
    'effects',
    'outgrewIr',
    'runtime',
    'sequences',
  ]);
  const source = readFileSync(join(packageRoot, 'define.mjs'), 'utf8');
  const constructors = new Set([
    ...[...source.matchAll(
      /^export (?:function|const) (define[A-Z][A-Za-z0-9_]*)\b/gmu,
    )].map((match) => match[1]),
    'action',
    'allow',
    'ephemeral',
    'mutation',
    'query',
    'v',
  ]);
  const tableBuilder = source.slice(
    source.indexOf('class TableBuilder {'),
    source.indexOf('export function defineTable'),
  );
  const tableMethods = [...tableBuilder.matchAll(
    /^  ([A-Za-z][A-Za-z0-9_]*)\([^\n]*\) \{/gmu,
  )].map((match) => match[1]).filter((name) => name !== 'constructor');
  const cases = [
    ['function field', functionFields, FAMILIAR_DISPOSITIONS.functionSpecFields],
    ['constructor', constructors, FAMILIAR_DISPOSITIONS.constructors],
    ['table-builder method', tableMethods, FAMILIAR_DISPOSITIONS.tableBuilderMethods],
    [
      'schema option',
      ['ephemeral', 'auth', 'authProgram', 'requiredCapabilities'],
      FAMILIAR_DISPOSITIONS.schemaOptions,
    ],
  ];
  for (const [label, names, table] of cases) {
    for (const name of names) {
      assert(table[name], `missing familiar disposition for ${label} ${name}`);
      assert([1, 2, 3, 4].includes(table[name].disposition), `${label} ${name} has invalid disposition`);
      assert.equal(typeof table[name].route, 'string', `${label} ${name} has no route`);
      assert(table[name].route.length > 0, `${label} ${name} has an empty route`);
    }
  }
  assert(Object.isFrozen(FAMILIAR_DISPOSITIONS));
  assert(Object.isFrozen(FAMILIAR_DISPOSITIONS.functionSpecFields.args));
});

test('no-branch checker fails closed outside its exact sanctioned allowlist', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-authoring-profile-branches-'));
  roots.push(root);
  for (const path of ['src', 'packages/snapback-client', 'packages/snapback-react', 'packages/snapback-harness']) {
    mkdirSync(join(root, path), { recursive: true });
  }
  const allowed = AUTHORING_PROFILE_READ_ALLOWLIST[0].path;
  writeFileSync(join(root, allowed), 'export const admitted = ref.authoringProfile;\n');
  const bad = join(root, 'packages', 'snapback-react', 'behavior.mjs');
  writeFileSync(bad, 'export const selected = value.authoringProfile === "familiar";\n');
  const refused = scanAuthoringProfileBranches({ root });
  assert.deepEqual(refused.findings.map(({ path }) => path), [
    'packages/snapback-react/behavior.mjs',
  ]);
  rmSync(bad);
  assert.deepEqual(scanAuthoringProfileBranches({ root }).findings, []);

  const live = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'check-authoring-profile-branches.mjs')],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(live.status, 0, live.stderr);
  assert.match(live.stdout, /authoring-profile-branches.*PASS/u);
});

test('generation emits normalized definition and profile custody; invalid policy is atomic', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-familiar-phase-a-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  todos: defineTable({ title: v.string() }).index('by_title', ['title']).sync(),
});
`);
  writeFileSync(join(root, 'functions.mjs'), `
import { arg, defineLiveQuery, defineMutation, insert, v } from ${JSON.stringify(defineUrl)};
export const retainedTodos = defineLiveQuery({
  table: 'todos',
  auth: 'public',
  authorityIndependent: true,
  retainable: true,
});
export const createTodo = defineMutation({
  args: { title: v.string() },
  plan: insert('todos', { title: arg('title') }),
});
`);
  const generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert.equal(generated.schemaManifest.authoringProfile, EXPLICIT_AUTHORING_PROFILE);
  assert.equal(generated.functionManifest.authoringProfile, EXPLICIT_AUTHORING_PROFILE);
  assert.equal(generated.normalizedDefinition.normalizedContractId, generated.identities.normalizedContractId);
  assert.equal(generated.normalizedDefinition.normalizedSchemaId, generated.identities.normalizedSchemaId);
  assert.deepEqual(generated.artifactIndex.identities, generated.identities);
  const envelope = readJson(join(generated.generationEnvelopeRoot, 'generation.json'));
  assert.equal(envelope.identities.normalizedContractId, generated.identities.normalizedContractId);
  assert.equal(envelope.identities.normalizedSchemaId, generated.identities.normalizedSchemaId);

  const output = join(root, 'generated');
  const normalizedPath = join(output, 'normalized-definition.v1.json');
  const normalized = readJson(normalizedPath);
  assert.deepEqual(normalized, generated.normalizedDefinition);
  const descriptor = readJson(join(output, 'app.descriptor.json'));
  assert.equal(descriptor.authoringProfile, EXPLICIT_AUTHORING_PROFILE);
  assert.equal(
    (readFileSync(join(output, 'app.descriptor.json'), 'utf8').match(/"authoringProfile":/gu) ?? []).length,
    1,
    'the portable descriptor serializes the app profile exactly once',
  );
  const serializedDefaultReference = descriptor.api.mutations.createTodo;
  assert.equal(Object.hasOwn(serializedDefaultReference, 'authoringProfile'), false);
  assert.equal(Object.hasOwn(serializedDefaultReference, 'delivery'), false);
  assert.equal(Object.hasOwn(serializedDefaultReference, 'retention'), false);
  const serializedRetainedReference = descriptor.api.queries.retainedTodos;
  assert.equal(Object.hasOwn(serializedRetainedReference, 'authoringProfile'), false);
  assert.equal(Object.hasOwn(serializedRetainedReference, 'delivery'), false);
  assert.equal(
    serializedRetainedReference.retention,
    'opaque-authorized-snapshot-v1',
    'only non-default retention is serialized per reference',
  );
  const hydrated = await import(`${pathToFileURL(join(output, 'app.mjs')).href}?phase-a=${Date.now()}`);
  assert.equal(Object.hasOwn(hydrated.createTodo, 'authoringProfile'), true);
  assert.equal(hydrated.createTodo.authoringProfile, EXPLICIT_AUTHORING_PROFILE);
  assert.equal(Object.hasOwn(hydrated.createTodo, 'retention'), true);
  assert.equal(hydrated.createTodo.retention, 'none');
  assert.equal(Object.hasOwn(hydrated.createTodo, 'delivery'), false);
  assert.equal(Object.hasOwn(hydrated.retainedTodos, 'authoringProfile'), true);
  assert.equal(Object.hasOwn(hydrated.retainedTodos, 'retention'), true);
  assert.equal(Object.hasOwn(hydrated.retainedTodos, 'delivery'), true);
  assert.equal(hydrated.retainedTodos.retention, 'opaque-authorized-snapshot-v1');
  assert.equal(hydrated.retainedTodos.delivery, 'live');
  assert.equal(
    readJson(join(output, 'package.json')).exports['./normalized-definition'],
    './normalized-definition.v1.json',
  );
  assert(generated.artifactIndex.files.some(({ path, logicalKind }) => (
    path === 'normalized-definition.v1.json'
    && logicalKind === 'normalized-application-definition'
  )));

  const reviewSchema = readJson(join(packageRoot, 'review-manifest.schema.json'));
  const validateReview = new Ajv2020({ strict: false }).compile(reviewSchema);
  assert.equal(validateReview(generated.artifactIndex), true, JSON.stringify(validateReview.errors));
  const descriptorSchema = readJson(join(packageRoot, 'app-descriptor.schema.json'));
  const validateDescriptor = new Ajv2020({ strict: false }).compile(descriptorSchema);
  assert.equal(validateDescriptor(descriptor), true, JSON.stringify(validateDescriptor.errors));

  const policySchema = readJson(join(packageRoot, 'codegen-policy.schema.json'));
  const validatePolicy = new Ajv2020({ strict: false }).compile(policySchema);
  for (const authoringProfile of [EXPLICIT_AUTHORING_PROFILE, FAMILIAR_AUTHORING_PROFILE]) {
    assert.equal(validatePolicy({
      schemaVersion: 'snapback.codegen-policy.v1',
      committedProjections: [],
      authoringProfile,
    }), true, JSON.stringify(validatePolicy.errors));
  }
  assert.equal(validatePolicy({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    authoringProfile: 'not-a-profile',
  }), false);
  assert.equal(validatePolicy({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    extra: true,
  }), false);

  const before = readFileSync(normalizedPath);
  writeFileSync(join(root, 'codegen.policy.json'), JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    authoringProfile: 'not-a-profile',
  }));
  const refused = await generate(root);
  assert.equal(refused.ok, false);
  assert(refused.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_CODEGEN_AUTHORING_PROFILE_INVALID',
  ));
  assert(readFileSync(normalizedPath).equals(before));
});
