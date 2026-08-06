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
import { fileURLToPath, pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  appDescriptorDigestV1,
  canonicalizeAppDescriptorV1,
  serializeAppDescriptorV1,
  validateAppDescriptorV1,
} from './app-descriptor.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const root = mkdtempSync(join(tmpdir(), 'snapback-app-descriptor-'));
const backend = join(root, 'fixture', 'snapback');
mkdirSync(backend, { recursive: true });

const validSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  items: defineTable({ title: v.string() }).sync(),
});
`;
const validFunctions = `
import { arg, defineLiveQuery, defineMutation, insert, v } from '${defineUrl}';
export const listItems = defineLiveQuery({ table: 'items', args: {} });
export const createItem = defineMutation({
  args: { title: v.string() },
  plan: insert('items', { title: arg('title') }),
});
`;

function writeValidSources() {
  writeFileSync(join(backend, 'schema.mjs'), validSchema);
  writeFileSync(join(backend, 'functions.mjs'), validFunctions);
}

function readDescriptor() {
  return readFileSync(join(backend, 'generated', 'app.descriptor.json'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasCode(problems, code) {
  return problems.some((entry) => entry.code === code);
}

async function assertGenerationRefusedPreservingDescriptor(expectedCode) {
  const before = readDescriptor();
  const result = await generate(backend);
  assert.equal(result.ok, false, `expected ${expectedCode} refusal`);
  assert(
    result.diagnostics.some(({ code }) => code === expectedCode),
    `missing ${expectedCode}: ${JSON.stringify(result.diagnostics)}`,
  );
  assert(readDescriptor().equals(before), `${expectedCode} replaced the prior descriptor`);
}

try {
  writeValidSources();
  const generated = await generate(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));

  // Language-neutral inspection reads JSON only: no React import and no
  // application handler/module execution is needed to enumerate the app.
  // @ref LLP 0179#inspection-and-other-consumers — the portable document is
  // the inspection authority, including member provenance and requirements.
  const descriptorSource = readDescriptor().toString('utf8');
  const descriptor = JSON.parse(descriptorSource);
  assert.deepEqual(validateAppDescriptorV1(descriptor), []);
  assert.equal(descriptor.format, 'snapback.app.v1');
  assert.deepEqual(Object.keys(descriptor.api.queries), ['listItems']);
  assert.deepEqual(Object.keys(descriptor.api.mutations), ['createItem']);
  assert.deepEqual(Object.keys(descriptor.api.assets), []);
  assert.deepEqual(Object.keys(descriptor.api.ephemeral), []);
  assert.deepEqual(Object.keys(descriptor.api.queryGroups), []);
  assert.deepEqual(descriptor.commands, {});
  assert.deepEqual(descriptor.surfaces, {});
  assert(descriptor.capabilities.required.includes('live_subscriptions'));
  assert(descriptor.capabilities.required.includes('mutation_read_set_validation'));
  assert.deepEqual(descriptor.api.queries.listItems.sourceSpan, {
    file: 'functions.mjs',
    line: 3,
    column: 14,
  });
  assert.equal(descriptor.api.queries.listItems.argumentSchema.additionalProperties, false);
  assert.equal(descriptor.api.mutations.createItem.resultContract.kind, 'unknown');

  const schemaManifest = JSON.parse(readFileSync(join(backend, 'generated', 'schema.manifest.json')));
  const functionManifest = JSON.parse(readFileSync(join(backend, 'generated', 'functions.manifest.json')));
  assert.equal(descriptor.identity.app, schemaManifest.appId);
  assert.equal(descriptor.identity.schema, schemaManifest.schemaHash);
  assert.equal(descriptor.identity.functions, functionManifest.bundleHash);
  assert.equal(descriptor.identity.descriptor, appDescriptorDigestV1(descriptor));
  assert.equal(descriptorSource, serializeAppDescriptorV1(descriptor));
  const descriptorDigest = descriptor.identity.descriptor.replace(/^sha256:/u, '');
  const bindingSource = readFileSync(join(backend, 'generated', 'app.binding.mjs'), 'utf8');
  const descriptorModule = `app.descriptor.${descriptorDigest}.json`;
  assert(bindingSource.includes(`./${descriptorModule}`));
  assert(!bindingSource.includes('?identity='));
  assert.equal(
    readFileSync(join(backend, 'generated', descriptorModule), 'utf8'),
    descriptorSource,
    'the portable descriptor has an immutable filename for bundler hydration',
  );
  const apiSource = readFileSync(join(backend, 'generated', 'api.mjs'), 'utf8');
  const bindingModule = apiSource.match(/\.\/app\.binding\.([0-9a-f]{64})\.mjs/u)?.[0].slice(2);
  assert.equal(typeof bindingModule, 'string');
  assert(!apiSource.includes('?identity='));
  assert.equal(
    readFileSync(join(backend, 'generated', bindingModule), 'utf8'),
    bindingSource,
    'the generated binding has an immutable filename for Node, Vite, and Metro',
  );

  // No environment/binding/session/device fact enters the stable document.
  const forbiddenEnvironmentKeys = new Set([
    'url', 'endpoint', 'session', 'sessionToken', 'metro', 'eas', 'device',
    'host', 'port', 'persona', 'binding',
  ]);
  const visitKeys = (value) => {
    if (Array.isArray(value)) return value.forEach(visitKeys);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert(!forbiddenEnvironmentKeys.has(key), `environment key leaked into descriptor: ${key}`);
      visitKeys(child);
    }
  };
  visitKeys(descriptor);

  // The typed hydration and every compatibility spelling share object
  // identity; there is no independently generated reference tree.
  const appModule = await import(pathToFileURL(join(backend, 'generated', 'app.mjs')).href);
  const apiModule = await import(pathToFileURL(join(backend, 'generated', 'api.mjs')).href);
  assert.strictEqual(appModule.default, appModule.app);
  assert.strictEqual(apiModule.app, appModule.app);
  assert.strictEqual(apiModule.default.listItems, appModule.app.api.queries.listItems);
  assert.strictEqual(apiModule.default.createItem, appModule.app.api.mutations.createItem);
  assert.strictEqual(apiModule.listItems, appModule.app.api.queries.listItems);
  assert.strictEqual(apiModule.createItem, appModule.app.api.mutations.createItem);
  assert.strictEqual(appModule.listItems, appModule.app.api.queries.listItems);
  assert.strictEqual(appModule.createItem, appModule.app.api.mutations.createItem);
  assert(Object.isFrozen(appModule.app));

  const consumer = join(root, 'fixture', 'consumer.ts');
  writeFileSync(consumer, `
import legacyApi, { app, createItem as legacyCreateItem, listItems as legacyListItems } from './snapback/generated/api';
import generatedApp, { createItem, listItems } from './snapback/generated/app';
import type { FunctionArgs } from './snapback/generated/api';

const args: FunctionArgs<typeof createItem> = { title: 'typed' };
const query = generatedApp.api.queries.listItems;
const mutation = app.api.mutations.createItem;
const sameQuery: typeof query = legacyApi.listItems;
const sameMutation: typeof mutation = legacyApi.createItem;
const sameNamedQuery: typeof listItems = legacyListItems;
const sameNamedMutation: typeof createItem = legacyCreateItem;
// @ts-expect-error mutations do not appear in the query namespace
generatedApp.api.queries.createItem;
void args; void sameQuery; void sameMutation; void sameNamedQuery; void sameNamedMutation;
`);
  const typecheck = spawnSync(join(repoRoot, 'node_modules', '.bin', 'tsc'), [
    '--noEmit',
    '--strict',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    consumer,
  ], { cwd: join(root, 'fixture'), encoding: 'utf8' });
  assert.equal(typecheck.status, 0, `${typecheck.stdout}\n${typecheck.stderr}`);

  // Closed-document negative fixtures exercise the same validator codegen
  // invokes before publication.
  const wrongNamespaceKind = clone(descriptor);
  wrongNamespaceKind.api.queries.listItems.kind = 'Mutation';
  wrongNamespaceKind.identity.descriptor = appDescriptorDigestV1(wrongNamespaceKind);
  assert(hasCode(
    validateAppDescriptorV1(wrongNamespaceKind),
    'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
  ));

  const unknownMemberClass = clone(descriptor);
  unknownMemberClass.api.queries.listItems.artifactKind = 'commandDescriptor';
  unknownMemberClass.identity.descriptor = appDescriptorDigestV1(unknownMemberClass);
  assert(hasCode(
    validateAppDescriptorV1(unknownMemberClass),
    'SNAPBACK_APP_DESCRIPTOR_MEMBER_CLASS_UNSUPPORTED',
  ));

  const prematureSurface = clone(descriptor);
  prematureSurface.surfaces.conversation = { artifactKind: 'surfaceDescriptor' };
  prematureSurface.identity.descriptor = appDescriptorDigestV1(prematureSurface);
  assert(hasCode(
    validateAppDescriptorV1(prematureSurface),
    'SNAPBACK_APP_DESCRIPTOR_MEMBER_CLASS_UNSUPPORTED',
  ));

  assert(hasCode(
    validateAppDescriptorV1(descriptor, { maxBytes: 64 }),
    'SNAPBACK_APP_DESCRIPTOR_BUDGET_EXCEEDED',
  ));

  const insertionVariant = {
    surfaces: descriptor.surfaces,
    identity: descriptor.identity,
    commands: descriptor.commands,
    format: descriptor.format,
    capabilities: descriptor.capabilities,
    api: descriptor.api,
  };
  assert.equal(
    canonicalizeAppDescriptorV1(insertionVariant),
    canonicalizeAppDescriptorV1(descriptor),
    'JCS identity is independent of insertion order',
  );

  // Generation refusals for an S0 validator mismatch, an existing member
  // budget, and an unknown definition class all preserve the prior document.
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineLiveQuery } from '${defineUrl}';
export const listItems = defineLiveQuery({ table: 'items', args: { broken: 42 } });
`);
  await assertGenerationRefusedPreservingDescriptor('FUNCTION_INVALID_VALIDATOR');

  writeValidSources();
  writeFileSync(join(backend, 'schema.mjs'), `
import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from '${defineUrl}';
export default defineSchema(
  { items: defineTable({ title: v.string() }).sync() },
  { ephemeral: defineEphemeral({
    typing: ephemeral.collection({
      scope: { roomId: v.string() },
      value: v.object({ active: v.boolean() }),
      ttlMs: 1000,
      maxTtlMs: 30_001,
      publish: allow.all(),
      subscribe: allow.all(),
    }),
  }) },
);
`);
  await assertGenerationRefusedPreservingDescriptor('EPHEMERAL_INVALID_BUDGET');

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineLiveQuery } from '${defineUrl}';
const query = defineLiveQuery({ table: 'items', args: {} });
export const futureMember = { ...query, __snapbackDefinitionKind: 'surface' };
`);
  await assertGenerationRefusedPreservingDescriptor('CODEGEN_MODULE_EVALUATION_FAILED');

  // A checked-in real demo proves aliases survive ordinary generated-artifact
  // custody rather than only the temporary unit fixture.
  const demoGenerated = join(
    repoRoot,
    'demos',
    'zero-bakeoff',
    'apps',
    'field-notebook',
    'snapback',
    'generated',
  );
  const demoApp = await import(pathToFileURL(join(demoGenerated, 'app.mjs')).href);
  const demoApi = await import(pathToFileURL(join(demoGenerated, 'api.mjs')).href);
  assert.strictEqual(demoApi.assignedRecords, demoApp.app.api.queries.assignedRecords);
  assert.strictEqual(demoApi.createRecord, demoApp.app.api.mutations.createRecord);
  assert.strictEqual(demoApi.default.updateRecord, demoApp.app.api.mutations.updateRecord);

  const schema = JSON.parse(readFileSync(join(packageRoot, 'app-descriptor.schema.json')));
  assert.equal(schema.$id, 'https://schemas.snapback.dev/app-descriptor/v1.schema.json');
  assert.equal(schema.properties.format.const, 'snapback.app.v1');
  assert.equal(schema.properties.commands.maxProperties, 0);
  assert.equal(schema.properties.surfaces.maxProperties, 0);
  const validatePortableSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.equal(
    validatePortableSchema(descriptor),
    true,
    JSON.stringify(validatePortableSchema.errors),
  );
  assert.equal(validatePortableSchema(wrongNamespaceKind), false);
  assert.equal(validatePortableSchema(unknownMemberClass), false);
  assert.equal(validatePortableSchema(prematureSurface), false);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('app-descriptor.test.mjs: all cases passed');
