import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
import {
  generate,
  SURFACE_MAX_MEMBER_BINDINGS,
  SURFACE_MAX_MEMBERS,
  SURFACE_MAX_PARAMS,
  SURFACE_MAX_PER_APP,
  SURFACE_MAX_SCOPE_RECORD_FIELDS,
} from './index.mjs';
import * as headlessClient from '../snapback-client/index.mjs';
import * as reactClient from '../snapback-react/index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const root = mkdtempSync(join(tmpdir(), 'snapback-app-descriptor-'));
const backend = join(root, 'fixture', 'snapback');
mkdirSync(backend, { recursive: true });
const snapbackModules = join(root, 'fixture', 'node_modules', '@expo');
mkdirSync(snapbackModules, { recursive: true });
symlinkSync(packageRoot, join(snapbackModules, 'snapback-codegen'), 'dir');

const validSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  items: defineTable({ group: v.string(), title: v.string() }).visibility({ kind: 'public-read' }).index('by_group', ['group']).sync(),
});
`;
const validFunctions = `
import { arg, bind, defineAssetUpload, defineCommand, defineLiveQuery, defineMutation, defineSurface, eq, input, insert, param, v } from '${defineUrl}';
export const listItems = defineLiveQuery({
  table: 'items',
  args: { group: v.string() },
  filter: [eq('group', arg('group'))],
  index: 'by_group',
});
export const createItem = defineMutation({
  args: { group: v.string(), title: v.string() },
  plan: insert('items', { group: arg('group'), title: arg('title') }),
});
export const create = defineCommand({ mutation: createItem });
export const itemAttachment = defineAssetUpload({
  args: { group: v.string() },
  auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-strict' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const commandAttachment = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-strict' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const createWithAttachment = defineMutation({
  args: {
    group: v.string(),
    title: v.string(),
    attachment: v.optional(v.assetRef({ upload: 'commandAttachment' })),
  },
  plan: insert('items', {
    group: arg('group'),
    title: arg('title'),
  }),
});
export const send = defineCommand({
  mutation: createWithAttachment,
  assets: {
    attachment: {
      intent: commandAttachment,
      mutationArg: 'attachment',
      optional: true,
    },
  },
});
export const items = defineSurface({
  params: { group: v.string() },
  reads: { rows: bind(listItems, { group: param('group') }) },
  mutations: {
    create: bind(createItem, { group: param('group'), title: input('title') }),
  },
  commands: {
    send: bind(send, {
      group: param('group'),
      title: input('title'),
      attachment: input('attachment'),
    }),
  },
  assets: {
    attachment: bind(itemAttachment, { group: param('group') }),
  },
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

async function assertGenerationRefusedPreservingDescriptor(
  expectedCode,
  { onlyExpectedError = false } = {},
) {
  const before = readDescriptor();
  const result = await generate(backend);
  assert.equal(result.ok, false, `expected ${expectedCode} refusal`);
  const diagnostic = result.diagnostics.find(({ code }) => code === expectedCode);
  assert(
    diagnostic,
    `missing ${expectedCode}: ${JSON.stringify(result.diagnostics)}`,
  );
  if (onlyExpectedError) {
    assert.deepEqual(
      result.diagnostics.filter(({ severity }) => severity === 'error').map(({ code }) => code),
      [expectedCode],
    );
  }
  assert(readDescriptor().equals(before), `${expectedCode} replaced the prior descriptor`);
  return diagnostic;
}

try {
  writeValidSources();
  const generated = await generate(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));

  // @ref LLP 0247#d5-generated-lifecycle-metadata-owns-normalization-and-failure-tables
  // — codegen owns the five-row origin artifact; both first-party JS arms
  // consume the same normalization version and public refusal class.
  const lifecycle = JSON.parse(readFileSync(
    join(backend, 'generated', 'client-lifecycle.manifest.json'),
    'utf8',
  ));
  const lifecycleSchema = JSON.parse(readFileSync(
    join(packageRoot, 'client-lifecycle.schema.json'),
    'utf8',
  ));
  const validateLifecycle = new Ajv2020({ strict: false }).compile(lifecycleSchema);
  assert.equal(validateLifecycle(lifecycle), true, JSON.stringify(validateLifecycle.errors));
  for (const [field, malformed] of [
    ['referenceKinds', [{}]],
    ['mutationSettlement', { bogus: true }],
    ['operations', [{}]],
  ]) {
    const candidate = structuredClone(lifecycle);
    candidate[field] = malformed;
    assert.equal(
      validateLifecycle(candidate),
      false,
      `${field} entries without the emitted closed shape must be refused`,
    );
  }
  assert.equal(lifecycle.schemaVersion, 'snapback.client-lifecycle.v1');
  assert.deepEqual(Object.keys(lifecycle.rows), [
    'anchors',
    'argumentNormalization',
    'authAnchors',
    'authBootstrapPolicy',
    'authBootstrapState',
    'authCustodyPlatforms',
    'authEntryMechanisms',
    'authOwnership',
    'authRecoveryLifecycle',
    'authSupervisedPrecedence',
    'authorityAdmission',
    'presenceLifecycle',
    'primaryFailureCarrier',
  ]);
  assert.equal(
    lifecycle.rows.argumentNormalization.version,
    headlessClient.ARGUMENT_NORMALIZATION_VERSION,
  );
  assert.equal(
    reactClient.ARGUMENT_NORMALIZATION_VERSION,
    headlessClient.ARGUMENT_NORMALIZATION_VERSION,
    'headless and React expose the same normalization behavior version',
  );
  assert.deepEqual(
    lifecycle.rows.argumentNormalization.operations.find(
      ({ name }) => name === 'createWithAttachment',
    ).optionalPropertyPaths,
    ['args.attachment'],
  );
  assert.equal(
    lifecycle.rows.primaryFailureCarrier.publicErrorType,
    headlessClient.SnapbackDiagnosticError.name,
  );
  assert.equal(
    reactClient.SnapbackDiagnosticError,
    headlessClient.SnapbackDiagnosticError,
    'headless and React use one public failure carrier',
  );
  assert.deepEqual(lifecycle.rows.primaryFailureCarrier.verbs, [
    { verb: 'query', operationKind: 'Query', carrier: 'throw' },
    { verb: 'run', operationKind: 'Action', carrier: 'throw' },
    { verb: 'mutate', operationKind: 'Mutation', carrier: 'throw-immediate' },
    { verb: 'action', operationKind: 'Action', carrier: 'raw-envelope-deprecated' },
    { verb: 'queued-mutate', operationKind: 'Mutation', carrier: 'resolved-queued-union' },
  ]);
  assert.deepEqual(lifecycle.rows.anchors.guide, [
    'guide/clients/headless.md',
    'guide/clients/react.md',
    'guide/realtime/ephemeral-state.md',
  ]);
  assert.equal(
    JSON.parse(readFileSync(join(backend, 'generated', 'package.json'), 'utf8'))
      .exports['./client-lifecycle'],
    './client-lifecycle.manifest.json',
  );

  // Language-neutral inspection reads JSON only: no React import and no
  // application handler/module execution is needed to enumerate the app.
  // @ref LLP 0179#inspection-and-other-consumers — the portable document is
  // the inspection authority, including member provenance and requirements.
  const descriptorSource = readDescriptor().toString('utf8');
  const descriptor = JSON.parse(descriptorSource);
  assert.deepEqual(validateAppDescriptorV1(descriptor), []);
  assert.equal(descriptor.format, 'snapback.app.v1');
  assert.deepEqual(Object.keys(descriptor.api.queries), ['listItems']);
  assert.deepEqual(Object.keys(descriptor.api.mutations), ['createItem', 'createWithAttachment']);
  assert.deepEqual(Object.keys(descriptor.api.assets), ['commandAttachment', 'itemAttachment']);
  assert.deepEqual(Object.keys(descriptor.api.ephemeral), []);
  assert.deepEqual(Object.keys(descriptor.api.queryGroups), []);
  assert.deepEqual(Object.keys(descriptor.commands), ['create', 'send']);
  assert.equal(descriptor.commands.create.asset, null);
  assert.deepEqual(descriptor.commands.create.passthroughArgs, ['group', 'title']);
  assert.equal(descriptor.commands.send.kind, 'asset-bearing-command.v1');
  assert.equal(descriptor.commands.send.mutation.name, 'createWithAttachment');
  assert.deepEqual(descriptor.commands.send.passthroughArgs, ['group', 'title']);
  assert.deepEqual({
    input: descriptor.commands.send.asset.input,
    intent: descriptor.commands.send.asset.intent.name,
    mutationArg: descriptor.commands.send.asset.mutationArg,
    optional: descriptor.commands.send.asset.optional,
  }, {
    input: 'attachment', intent: 'commandAttachment', mutationArg: 'attachment', optional: true,
  });
  assert.deepEqual(Object.keys(descriptor.surfaces), ['items']);
  assert.deepEqual(descriptor.surfaces.items.params.group.kind, 'string');
  assert.deepEqual(descriptor.surfaces.items.reads.rows.bindings.group, {
    kind: 'param', name: 'group',
  });
  assert.deepEqual(descriptor.surfaces.items.mutations.create.bindings, {
    group: { kind: 'param', name: 'group' },
    title: { kind: 'input', name: 'title' },
  });
  assert.deepEqual(Object.keys(descriptor.surfaces.items.mutations.create.inputs), ['title']);
  assert.deepEqual(Object.keys(descriptor.surfaces.items.commands.send.inputs), ['attachment', 'title']);
  assert.deepEqual(descriptor.surfaces.items.assets.attachment.bindings.group, {
    kind: 'param', name: 'group',
  });
  assert(descriptor.capabilities.required.includes('live_subscriptions'));
  assert(descriptor.capabilities.required.includes('mutation_read_set_validation'));
  assert.deepEqual(descriptor.api.queries.listItems.sourceSpan, {
    file: 'functions.mjs',
    line: 3,
    column: 14,
  });
  assert.equal(descriptor.api.queries.listItems.argumentSchema.additionalProperties, false);
  assert.equal(descriptor.api.mutations.createItem.resultContract.kind, 'unknown');
  const appTypes = readFileSync(join(backend, 'generated', 'app.d.ts'), 'utf8');
  assert(appTypes.includes('"attachment"?: CommandAssetSource'));
  assert(appTypes.includes('/** Surface member call payloads follow strict omission semantics:'));

  {
    const surfacelessRoot = mkdtempSync(join(tmpdir(), 'snapback-app-descriptor-surfaceless-'));
    try {
      const surfacelessBackend = join(surfacelessRoot, 'fixture', 'snapback');
      mkdirSync(surfacelessBackend, { recursive: true });
      writeFileSync(join(surfacelessBackend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  items: defineTable({ group: v.string(), title: v.string() }).visibility({ kind: 'public-read' }).index('by_group', ['group']).sync(),
});
`);
      writeFileSync(join(surfacelessBackend, 'functions.mjs'), `
import { arg, defineLiveQuery, eq, v } from '${defineUrl}';
export const listItems = defineLiveQuery({
  table: 'items',
  args: { group: v.string() },
  filter: [eq('group', arg('group'))],
  index: 'by_group',
});
`);
      const surfacelessGeneration = await generate(surfacelessBackend);
      assert.equal(
        surfacelessGeneration.ok,
        true,
        JSON.stringify(surfacelessGeneration.diagnostics),
      );

      const surfacelessDescriptor = JSON.parse(readFileSync(
        join(surfacelessBackend, 'generated', 'app.descriptor.json'),
        'utf8',
      ));
      assert.deepEqual(surfacelessDescriptor.surfaces, {});
      assert.deepEqual(validateAppDescriptorV1(surfacelessDescriptor), []);

      // The surface type block is emitted unconditionally: a surfaceless app
      // carries the same SurfaceMemberDescriptor/SurfaceDescriptor preamble as
      // a surface-bearing one and differs only by an empty GeneratedAppSurfaces
      // body. (Before the S1 grammar landed the surfaceless emission was
      // `export type SurfaceDescriptor = never;`, so every committed app.d.ts
      // in the corpus rotates once — this pins the post-S1 shape so a later
      // surface change cannot move surfaceless apps again unnoticed.)
      const surfacelessAppTypes = readFileSync(
        join(surfacelessBackend, 'generated', 'app.d.ts'),
        'utf8',
      );
      const committedSurfaceAppTypes = readFileSync(
        join(
          repoRoot,
          'packages',
          'snapback-cli',
          'fixtures',
          'comparator',
          'app',
          'snapback',
          'generated',
          'app.d.ts',
        ),
        'utf8',
      );
      const surfacePreamble = (source) => {
        const start = source.indexOf('export interface SurfaceMemberDescriptor<');
        const end = source.indexOf('export interface GeneratedAppSurfaces {');
        assert(start >= 0 && end > start, 'app.d.ts is missing the surface type preamble');
        return source.slice(start, end);
      };
      assert(surfacePreamble(surfacelessAppTypes).includes('Commands = Record<string, never>'));
      assert(surfacePreamble(surfacelessAppTypes).includes('readonly commands: Commands'));
      assert(surfacelessAppTypes.includes('export interface GeneratedAppSurfaces {\n}\n'));
      assert(surfacelessAppTypes.includes('  readonly surfaces: Readonly<GeneratedAppSurfaces>;\n'));
      assert(!surfacelessAppTypes.includes('export type SurfaceDescriptor = never;'));
      // The committed surface-bearing control names its one member, so the
      // empty-body assertion above is a real difference and not a tautology.
      assert(committedSurfaceAppTypes.includes('export interface GeneratedAppSurfaces {\n  readonly "fixtureSurface": SurfaceDescriptor<'));
    } finally {
      rmSync(surfacelessRoot, { recursive: true, force: true });
    }
  }

  const schemaManifest = JSON.parse(readFileSync(join(backend, 'generated', 'schema.manifest.json')));
  const functionManifest = JSON.parse(readFileSync(join(backend, 'generated', 'functions.manifest.json')));
  assert.equal(descriptor.identity.app, schemaManifest.appId);
  assert.equal(descriptor.identity.schema, schemaManifest.schemaHash);
  assert.equal(descriptor.identity.functions, functionManifest.bundleHash);
  assert.equal(descriptor.identity.descriptor, appDescriptorDigestV1(descriptor));
  assert.equal(descriptorSource, serializeAppDescriptorV1(descriptor));
  // Metro treats URL queries on local module specifiers as literal filename
  // text. The hydration graph stays content-addressed through portable real
  // filenames so Node and Metro resolve the same generated graph.
  const appBindingAliasSource = readFileSync(
    join(backend, 'generated', 'app.binding.mjs'),
    'utf8',
  );
  const appSource = readFileSync(join(backend, 'generated', 'app.mjs'), 'utf8');
  const apiSource = readFileSync(join(backend, 'generated', 'api.mjs'), 'utf8');
  for (const source of [appBindingAliasSource, appSource, apiSource]) {
    assert.doesNotMatch(source, /\?identity=/u);
  }
  const appBindingAliasImport = /\.\/app\.binding\.([0-9a-f]{64})\.mjs/u.exec(
    appBindingAliasSource,
  );
  const appBindingImport = /\.\/app\.binding\.([0-9a-f]{64})\.mjs/u.exec(appSource);
  assert(appBindingAliasImport, 'the stable binding module aliases a content-addressed binding filename');
  assert(appBindingImport, 'the app module imports a content-addressed binding filename');
  assert.equal(appBindingAliasImport[1], appBindingImport[1]);
  const contentAddressedAppBindingSource = readFileSync(
    join(backend, 'generated', `app.binding.${appBindingImport[1]}.mjs`),
    'utf8',
  );
  assert.doesNotMatch(contentAddressedAppBindingSource, /\?identity=/u);
  const descriptorImport = /\.\/app\.descriptor\.([0-9a-f]{64})\.json/u.exec(
    contentAddressedAppBindingSource,
  );
  assert(descriptorImport, 'the hydration module imports a content-addressed descriptor filename');
  assert.equal(
    readFileSync(
      join(backend, 'generated', `app.descriptor.${descriptorImport[1]}.json`),
      'utf8',
    ),
    descriptorSource,
  );
  assert.equal(
    /Stable compatibility alias/u.test(appBindingAliasSource),
    true,
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
  const appBindingAliasModule = await import(
    pathToFileURL(join(backend, 'generated', 'app.binding.mjs')).href
  );
  const apiModule = await import(pathToFileURL(join(backend, 'generated', 'api.mjs')).href);
  assert.strictEqual(appBindingAliasModule.app, appModule.app);
  assert.strictEqual(appBindingAliasModule.default, appModule.app);
  assert.strictEqual(appModule.default, appModule.app);
  assert.strictEqual(apiModule.app, appModule.app);
  assert.strictEqual(apiModule.default.listItems, appModule.app.api.queries.listItems);
  assert.strictEqual(apiModule.default.createItem, appModule.app.api.mutations.createItem);
  assert.strictEqual(apiModule.listItems, appModule.app.api.queries.listItems);
  assert.strictEqual(apiModule.createItem, appModule.app.api.mutations.createItem);
  assert.strictEqual(appModule.listItems, appModule.app.api.queries.listItems);
  assert.strictEqual(appModule.createItem, appModule.app.api.mutations.createItem);
  assert.strictEqual(
    appModule.app.surfaces.items.reads.rows.reference,
    appModule.app.api.queries.listItems,
  );
  assert.strictEqual(
    appModule.app.surfaces.items.mutations.create.reference,
    appModule.app.api.mutations.createItem,
  );
  assert.strictEqual(
    appModule.app.surfaces.items.assets.attachment.reference,
    appModule.app.api.assets.itemAttachment,
  );
  assert.strictEqual(appModule.app.commands.send.mutation, appModule.app.api.mutations.createWithAttachment);
  assert.strictEqual(appModule.app.commands.send.asset.intent, appModule.app.api.assets.commandAttachment);
  assert.strictEqual(appModule.app.commands.create.mutation, appModule.app.api.mutations.createItem);
  assert.strictEqual(appModule.app.surfaces.items.commands.send.reference, appModule.app.commands.send);
  assert(Object.isFrozen(appModule.app));

  const consumer = join(root, 'fixture', 'consumer.ts');
  writeFileSync(consumer, `
import legacyApi, { app, createItem as legacyCreateItem, listItems as legacyListItems } from './snapback/generated/api';
import generatedApp, { createItem, listItems } from './snapback/generated/app';
import type { FunctionArgs } from './snapback/generated/api';

const args: FunctionArgs<typeof createItem> = { group: 'typed', title: 'typed' };
type CreateSurfaceInput = NonNullable<typeof generatedApp.surfaces.items.mutations.create.__input>;
type SendSurfaceInput = NonNullable<typeof generatedApp.surfaces.items.commands.send.__input>;
type CreateCommandInput = NonNullable<typeof generatedApp.commands.create.__args>;
const surfaceInput: CreateSurfaceInput = { title: 'typed' };
const sendSurfaceInput: SendSurfaceInput = { title: 'typed' };
const createCommandInput: CreateCommandInput = { group: 'typed', title: 'typed' };
// @ts-expect-error bound group is removed from the member call input
const surfaceInputWithBoundParam: CreateSurfaceInput = { group: 'typed', title: 'typed' };
const query = generatedApp.api.queries.listItems;
const mutation = app.api.mutations.createItem;
const sameQuery: typeof query = legacyApi.listItems;
const sameMutation: typeof mutation = legacyApi.createItem;
const sameNamedQuery: typeof listItems = legacyListItems;
const sameNamedMutation: typeof createItem = legacyCreateItem;
// @ts-expect-error mutations do not appear in the query namespace
generatedApp.api.queries.createItem;
void args; void surfaceInput; void sendSurfaceInput; void createCommandInput; void surfaceInputWithBoundParam;
void sameQuery; void sameMutation; void sameNamedQuery; void sameNamedMutation;
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

  // @ref LLP 0210#d4--the-mapping-is-admitted-where-safe-the-remaining-refusal-teaches —
  // a required command child may narrow an optional mutation argument without
  // widening the mutation's directly callable contract.
  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, defineAssetUpload, defineCommand, defineMutation, insert, v } from '${defineUrl}';
export const imageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream'], maxBytes: 1024 },
  delivery: { kind: 'private-strict' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const sendMessage = defineMutation({
  auth: 'authenticated',
  args: {
    group: v.string(),
    title: v.string(),
    image: v.optional(v.assetRef({ upload: 'imageUpload' })),
  },
  plan: insert('items', { group: arg('group'), title: arg('title') }),
});
export const sendPhoto = defineCommand({
  mutation: sendMessage,
  assets: { image: { intent: imageUpload, mutationArg: 'image', optional: false } },
});
`);
  const narrowedGeneration = await generate(backend);
  assert.equal(narrowedGeneration.ok, true, JSON.stringify(narrowedGeneration.diagnostics));
  const narrowedDescriptor = JSON.parse(readDescriptor());
  assert.equal(narrowedDescriptor.commands.sendPhoto.asset.optional, false);
  assert.equal(
    narrowedDescriptor.api.mutations.sendMessage.argumentSchema.required.includes('image'),
    false,
  );
  const narrowedAppTypes = readFileSync(join(backend, 'generated', 'app.d.ts'), 'utf8');
  assert(narrowedAppTypes.includes(
    'CommandDescriptor<GeneratedApi["sendMessage"], "image", "image", false, GeneratedApi["imageUpload"]>',
  ));
  const narrowedConsumer = join(root, 'fixture', 'narrowed-consumer.ts');
  writeFileSync(narrowedConsumer, `
import generatedApp, { sendMessage } from './snapback/generated/app';
import type { FunctionArgs } from './snapback/generated/api';

type SendPhotoInput = NonNullable<typeof generatedApp.commands.sendPhoto.__args>;
const directMutationWithoutImage: FunctionArgs<typeof sendMessage> = {
  group: 'typed',
  title: 'typed',
};
const commandWithRequiredImage: SendPhotoInput = {
  group: 'typed',
  title: 'typed',
  image: { uri: 'file:///tmp/photo.bin', mimeType: 'application/octet-stream' },
};
// @ts-expect-error the command narrows the optional mutation argument to a required asset input
const commandWithoutImage: SendPhotoInput = { group: 'typed', title: 'typed' };
void directMutationWithoutImage; void commandWithRequiredImage; void commandWithoutImage;
`);
  const narrowedTypecheck = spawnSync(join(repoRoot, 'node_modules', '.bin', 'tsc'), [
    '--noEmit',
    '--strict',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    narrowedConsumer,
  ], { cwd: join(root, 'fixture'), encoding: 'utf8' });
  assert.equal(narrowedTypecheck.status, 0, `${narrowedTypecheck.stdout}\n${narrowedTypecheck.stderr}`);

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

  const borrowedCommandMutation = clone(descriptor);
  borrowedCommandMutation.commands.send.mutation.id = 'other-app:sendMessage';
  borrowedCommandMutation.identity.descriptor = appDescriptorDigestV1(borrowedCommandMutation);
  assert(hasCode(
    validateAppDescriptorV1(borrowedCommandMutation),
    'SNAPBACK_APP_DESCRIPTOR_REFERENCE_UNKNOWN',
  ));

  const unregisteredSurfaceCommand = clone(descriptor);
  unregisteredSurfaceCommand.surfaces.items.commands.send.reference.passthroughArgs.push('borrowed');
  unregisteredSurfaceCommand.identity.descriptor = appDescriptorDigestV1(unregisteredSurfaceCommand);
  assert(hasCode(
    validateAppDescriptorV1(unregisteredSurfaceCommand),
    'SNAPBACK_APP_DESCRIPTOR_REFERENCE_UNKNOWN',
  ));

  const malformedCommandInputs = clone(descriptor);
  malformedCommandInputs.commands.send.passthroughArgs = null;
  malformedCommandInputs.identity.descriptor = appDescriptorDigestV1(malformedCommandInputs);
  assert(hasCode(
    validateAppDescriptorV1(malformedCommandInputs),
    'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
  ));

  const unsafeOptionalCommandDescriptor = clone(descriptor);
  unsafeOptionalCommandDescriptor.api.mutations.createWithAttachment.argumentSchema.required.push(
    'attachment',
  );
  unsafeOptionalCommandDescriptor.commands.send.mutation.argumentSchema.required.push(
    'attachment',
  );
  unsafeOptionalCommandDescriptor.identity.descriptor = appDescriptorDigestV1(
    unsafeOptionalCommandDescriptor,
  );
  assert(hasCode(
    validateAppDescriptorV1(unsafeOptionalCommandDescriptor),
    'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
  ));

  const overdeepPortableScope = clone(descriptor);
  overdeepPortableScope.surfaces.items.commands.send.bindings.group = {
    kind: 'scope',
    fields: {
      nested: {
        kind: 'scope',
        fields: {
          leaf: { kind: 'literal', value: 'bounded' },
        },
      },
    },
  };
  overdeepPortableScope.identity.descriptor = appDescriptorDigestV1(overdeepPortableScope);
  assert(hasCode(
    validateAppDescriptorV1(overdeepPortableScope),
    'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
  ));

  const oversizedPortableSurface = clone(descriptor);
  oversizedPortableSurface.surfaces.items.reads = Object.fromEntries(Array.from(
    { length: SURFACE_MAX_MEMBERS },
    (_, index) => [`rows${index}`, clone(descriptor.surfaces.items.reads.rows)],
  ));
  oversizedPortableSurface.identity.descriptor = appDescriptorDigestV1(oversizedPortableSurface);
  assert(hasCode(
    validateAppDescriptorV1(oversizedPortableSurface),
    'SNAPBACK_APP_DESCRIPTOR_BUDGET_EXCEEDED',
  ));

  const prematureSurface = clone(descriptor);
  prematureSurface.surfaces.conversation = { artifactKind: 'surfaceDescriptor' };
  prematureSurface.identity.descriptor = appDescriptorDigestV1(prematureSurface);
  assert(hasCode(
    validateAppDescriptorV1(prematureSurface),
    'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
  ));

  assert(hasCode(
    validateAppDescriptorV1(descriptor, { maxBytes: 64 }),
    'SNAPBACK_APP_DESCRIPTOR_BUDGET_EXCEEDED',
  ));

  const insertionVariant = Object.fromEntries(Object.entries(descriptor).reverse());
  assert.equal(
    canonicalizeAppDescriptorV1(insertionVariant),
    canonicalizeAppDescriptorV1(descriptor),
    'JCS identity is independent of insertion order',
  );

  // Generation refusals preserve the prior descriptor publication.
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineLiveQuery } from '${defineUrl}';
export const listItems = defineLiveQuery({ table: 'items', args: { broken: 42 } });
`);
  await assertGenerationRefusedPreservingDescriptor('FUNCTION_INVALID_VALIDATOR');

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineLiveQuery, defineSurface, param, v } from '${defineUrl}';
export const listItems = defineLiveQuery({ table: 'items', args: { group: v.string() } });
export const items = defineSurface({
  params: { group: v.string() },
  reads: { rows: bind(listItems, { group: param('missing') }) },
});
`);
  await assertGenerationRefusedPreservingDescriptor('SNAPBACK_SURFACE_PARAMETER_UNKNOWN');

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineLiveQuery, defineSurface, param, v } from '${defineUrl}';
export const listItems = defineLiveQuery({ table: 'items', args: { group: v.string() } });
export const items = defineSurface({
  params: { group: v.number() },
  reads: { rows: bind(listItems, { group: param('group') }) },
});
`);
  await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_SURFACE_PARAMETER_TYPE_MISMATCH',
    { onlyExpectedError: true },
  );

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineLiveQuery, defineSurface, v } from '${defineUrl}';
export const listItems = defineLiveQuery({ table: 'items', args: { group: v.string() } });
export const items = defineSurface({
  reads: { rows: bind(listItems, {}) },
});
`);
  await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_SURFACE_REQUIRED_INPUT_UNBOUND',
    { onlyExpectedError: true },
  );

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineLiveQuery, defineSurface, param, v } from '${defineUrl}';
const hiddenItems = defineLiveQuery({ table: 'items', args: { group: v.string() } });
export const items = defineSurface({
  params: { group: v.string() },
  reads: { rows: bind(hiddenItems, { group: param('group') }) },
});
`);
  const unexportedSurfaceReference = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED',
    { onlyExpectedError: true },
  );
  assert.equal(unexportedSurfaceReference.binding, 'hiddenItems');
  assert.equal(unexportedSurfaceReference.builder, 'defineLiveQuery');
  assert.equal(unexportedSurfaceReference.definitionPath, 'hiddenItems');
  assert.deepEqual(unexportedSurfaceReference.sourceSpan, {
    file: 'functions.mjs',
    line: 3,
    column: 7,
  });

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineLiveQuery, defineSurface, param, v } from '${defineUrl}';
export const items = defineSurface({
  params: { group: v.string() },
  reads: {
    rows: bind(
      defineLiveQuery({ table: 'items', args: { group: v.string() } }),
      { group: param('group') },
    ),
  },
});
`);
  await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_SURFACE_REFERENCE_UNKNOWN',
    { onlyExpectedError: true },
  );

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineLiveQuery, defineSurface, input, v } from '${defineUrl}';
export const listItems = defineLiveQuery({ table: 'items', args: { group: v.string() } });
export const items = defineSurface({
  reads: { rows: bind(listItems, { group: input('group') }) },
});
`);
  const unsupportedInputMember = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_SURFACE_MEMBER_CLASS_UNSUPPORTED',
    { onlyExpectedError: true },
  );
  assert(unsupportedInputMember.message.includes(
    'input(...) is admitted only for mutation, command, and asset calls',
  ));

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineLiveQuery, defineSurface, param, v } from '${defineUrl}';
export const listItems = defineLiveQuery({ table: 'items', args: { group: v.string() } });
export const items = defineSurface({
  params: { group: v.string() },
  commands: { rows: bind(listItems, { group: param('group') }) },
});
`);
  const wrongCommandClass = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_SURFACE_MEMBER_CLASS_UNSUPPORTED',
    { onlyExpectedError: true },
  );
  assert(wrongCommandClass.message.includes('unsupported commands member class'));

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineCommand } from '${defineUrl}';
export const send = defineCommand({});
`);
  const zeroMutation = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_COMMAND_MUTATION_CARDINALITY_INVALID',
    { onlyExpectedError: true },
  );
  assert.equal(zeroMutation.mutations, 0);

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, defineCommand, defineMutation, insert, v } from '${defineUrl}';
export const first = defineMutation({
  auth: 'authenticated',
  args: { group: v.string(), title: v.string() },
  plan: insert('items', { group: arg('group'), title: arg('title') }),
});
export const second = defineMutation({
  auth: 'authenticated',
  args: { group: v.string(), title: v.string(), suffix: v.optional(v.string()) },
  plan: insert('items', { group: arg('group'), title: arg('title') }),
});
export const send = defineCommand({ mutation: [first, second] });
`);
  const manyMutations = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_COMMAND_MUTATION_CARDINALITY_INVALID',
    { onlyExpectedError: true },
  );
  assert.equal(manyMutations.mutations, 2);

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, defineAssetUpload, defineCommand, defineMutation, insert, v } from '${defineUrl}';
export const imageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream'], maxBytes: 1024 },
  delivery: { kind: 'private-strict' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const sendMessage = defineMutation({
  auth: 'authenticated',
  args: { group: v.string(), title: v.string(), image: v.optional(v.string()) },
  plan: insert('items', { group: arg('group'), title: arg('title') }),
});
export const send = defineCommand({
  mutation: sendMessage,
  assets: { image: { intent: imageUpload, mutationArg: 'image', optional: true } },
});
`);
  await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE',
    { onlyExpectedError: true },
  );

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, defineAssetUpload, defineCommand, defineMutation, insert, v } from '${defineUrl}';
export const imageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream'], maxBytes: 1024 },
  delivery: { kind: 'private-strict' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const sendMessage = defineMutation({
  auth: 'authenticated',
  args: { group: v.string(), title: v.string(), image: v.assetRef({ upload: 'imageUpload' }) },
  plan: insert('items', { group: arg('group'), title: arg('title') }),
});
export const send = defineCommand({
  mutation: sendMessage,
  assets: { image: { intent: imageUpload, mutationArg: 'image', optional: true } },
});
`);
  const unsafeOptionalChild = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE',
    { onlyExpectedError: true },
  );
  assert(unsafeOptionalChild.message.includes('make the child required'));
  assert(unsafeOptionalChild.message.includes('make the argument optional'));
  assert.deepEqual(unsafeOptionalChild.fixes, [
    {
      kind: 'make-command-asset-required',
      description: 'Make the child required by setting assets.image.optional to false.',
    },
    {
      kind: 'make-mutation-argument-optional',
      description: 'Make the argument optional with v.optional(v.assetRef({ upload: "imageUpload" })).',
    },
  ]);

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, defineAssetUpload, defineCommand, defineMutation, insert, v } from '${defineUrl}';
export const firstUpload = defineAssetUpload({
  args: {}, auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream'], maxBytes: 1024 },
  delivery: { kind: 'private-strict' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const secondUpload = defineAssetUpload({
  args: {}, auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream'], maxBytes: 1024 },
  delivery: { kind: 'private-strict' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const sendMessage = defineMutation({
  auth: 'authenticated',
  args: {
    group: v.string(),
    title: v.string(),
    first: v.optional(v.assetRef({ upload: 'firstUpload' })),
    second: v.optional(v.assetRef({ upload: 'secondUpload' })),
  },
  plan: insert('items', { group: arg('group'), title: arg('title') }),
});
export const send = defineCommand({
  mutation: sendMessage,
  assets: {
    first: { intent: firstUpload, mutationArg: 'first', optional: true },
    second: { intent: secondUpload, mutationArg: 'second', optional: true },
  },
});
`);
  await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_COMMAND_MULTI_ASSET_UNSUPPORTED',
    { onlyExpectedError: true },
  );

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, defineCommand, defineMutation, insert, v } from '${defineUrl}';
export const sendMessage = defineMutation({
  auth: 'authenticated',
  args: { group: v.string(), title: v.string(), principal: v.principal() },
  plan: insert('items', { group: arg('group'), title: arg('title') }),
});
export const send = defineCommand({ mutation: sendMessage });
`);
  await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_COMMAND_AUTHORITY_INPUT_REFUSED',
    { onlyExpectedError: true },
  );

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineLiveQuery, defineSurface, param, v } from '${defineUrl}';
export const shared = defineLiveQuery({ table: 'items', args: { group: v.string() } });
export const listItems = shared;
export const duplicateItems = shared;
export const items = defineSurface({
  params: { group: v.string() },
  reads: { rows: bind(shared, { group: param('group') }) },
});
`);
  await assertGenerationRefusedPreservingDescriptor('SNAPBACK_SURFACE_BINDING_AMBIGUOUS');

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineLiveQuery, defineSurface, param, v } from '${defineUrl}';
export const listItems = defineLiveQuery({ table: 'items', args: { principal: v.principal() } });
export const items = defineSurface({
  params: { principal: v.principal() },
  reads: { rows: bind(listItems, { principal: param('principal') }) },
});
`);
  await assertGenerationRefusedPreservingDescriptor('SNAPBACK_SURFACE_AUTH_BINDING_REFUSED');

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineSurface } from '${defineUrl}';
${Array.from(
    { length: SURFACE_MAX_PER_APP + 1 },
    (_, index) => `export const surface${index} = defineSurface({});`,
  ).join('\n')}
`);
  const perAppBudget = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_SURFACE_BUDGET_EXCEEDED',
    { onlyExpectedError: true },
  );
  assert.equal(perAppBudget.surfaces, SURFACE_MAX_PER_APP + 1);
  assert.equal(perAppBudget.maximum, SURFACE_MAX_PER_APP);
  assert(perAppBudget.message.includes(String(SURFACE_MAX_PER_APP)));

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineSurface, v } from '${defineUrl}';
export const items = defineSurface({
  params: {
${Array.from(
    { length: SURFACE_MAX_PARAMS + 1 },
    (_, index) => `    param${index}: v.string(),`,
  ).join('\n')}
  },
});
`);
  const paramBudget = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_SURFACE_BUDGET_EXCEEDED',
    { onlyExpectedError: true },
  );
  assert.equal(paramBudget.params, SURFACE_MAX_PARAMS + 1);
  assert.equal(paramBudget.maximum, SURFACE_MAX_PARAMS);

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineLiveQuery, defineSurface } from '${defineUrl}';
export const listItems = defineLiveQuery({ table: 'items', args: {} });
export const items = defineSurface({
  reads: {
${Array.from(
    { length: SURFACE_MAX_MEMBERS + 1 },
    (_, index) => `    rows${index}: bind(listItems, {}),`,
  ).join('\n')}
  },
});
`);
  const memberBudget = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_SURFACE_BUDGET_EXCEEDED',
    { onlyExpectedError: true },
  );
  assert.equal(memberBudget.members, SURFACE_MAX_MEMBERS + 1);
  assert.equal(memberBudget.maximum, SURFACE_MAX_MEMBERS);

  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, bind, defineAssetUpload, defineCommand, defineLiveQuery, defineMutation, defineSurface, insert, v } from '${defineUrl}';
export const rows = defineLiveQuery({ table: 'items', args: {}, auth: 'public' });
export const imageUpload = defineAssetUpload({
  args: {}, auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream'], maxBytes: 1024 },
  delivery: { kind: 'private-strict' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const sendMessage = defineMutation({
  auth: 'authenticated',
  args: { group: v.string(), title: v.string(), image: v.optional(v.assetRef({ upload: 'imageUpload' })) },
  plan: insert('items', { group: arg('group'), title: arg('title') }),
});
export const send = defineCommand({
  mutation: sendMessage,
  assets: { image: { intent: imageUpload, mutationArg: 'image', optional: true } },
});
export const items = defineSurface({
  reads: {
${Array.from(
    { length: SURFACE_MAX_MEMBERS },
    (_, index) => `    rows${index}: bind(rows, {}),`,
  ).join('\n')}
  },
  commands: { send: bind(send, { group: 'command', title: 'budget' }) },
});
`);
  const commandMemberBudget = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_SURFACE_BUDGET_EXCEEDED',
    { onlyExpectedError: true },
  );
  assert.equal(commandMemberBudget.members, SURFACE_MAX_MEMBERS + 1);
  assert.equal(commandMemberBudget.maximum, SURFACE_MAX_MEMBERS);

  const bindingNames = Array.from(
    { length: SURFACE_MAX_MEMBER_BINDINGS + 1 },
    (_, index) => `binding${index}`,
  );
  writeValidSources();
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineLiveQuery, defineSurface, v } from '${defineUrl}';
export const listItems = defineLiveQuery({
  table: 'items',
  args: {
${bindingNames.map((name) => `    ${name}: v.string(),`).join('\n')}
  },
});
export const items = defineSurface({
  reads: {
    rows: bind(listItems, {
${bindingNames.map((name) => `      ${name}: 'bounded',`).join('\n')}
    }),
  },
});
`);
  const memberBindingBudget = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_SURFACE_BUDGET_EXCEEDED',
    { onlyExpectedError: true },
  );
  assert.equal(memberBindingBudget.bindings, SURFACE_MAX_MEMBER_BINDINGS + 1);
  assert.equal(memberBindingBudget.maximum, SURFACE_MAX_MEMBER_BINDINGS);
  assert(memberBindingBudget.message.includes(String(SURFACE_MAX_MEMBER_BINDINGS)));

  const scopeFieldNames = Array.from(
    { length: SURFACE_MAX_SCOPE_RECORD_FIELDS + 1 },
    (_, index) => `field${index}`,
  );
  writeValidSources();
  writeFileSync(join(backend, 'surface-model.mjs'), `
import { allow, ephemeral, v } from '${defineUrl}';
export const typing = ephemeral.collection({
  scope: {
${scopeFieldNames.map((name) => `    ${name}: v.string(),`).join('\n')}
  },
  value: v.object({ active: v.boolean() }),
  ttlMs: 1000,
  maxTtlMs: 30_000,
  publish: allow.all(),
  subscribe: allow.all(),
});
`);
  writeFileSync(join(backend, 'schema.mjs'), `
import { defineEphemeral, defineSchema, defineTable, v } from '${defineUrl}';
import { typing } from './surface-model.mjs';
export default defineSchema(
  { items: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync() },
  { ephemeral: defineEphemeral({ typing }) },
);
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { bind, defineSurface } from '${defineUrl}';
import { typing } from './surface-model.mjs';
export const items = defineSurface({
  presence: {
    typing: bind(typing, {
      scope: {
${scopeFieldNames.map((name) => `        ${name}: 'bounded',`).join('\n')}
      },
    }),
  },
});
`);
  const scopeRecordBudget = await assertGenerationRefusedPreservingDescriptor(
    'SNAPBACK_SURFACE_BUDGET_EXCEEDED',
    { onlyExpectedError: true },
  );
  assert.equal(scopeRecordBudget.fields, SURFACE_MAX_SCOPE_RECORD_FIELDS + 1);
  assert.equal(scopeRecordBudget.maximum, SURFACE_MAX_SCOPE_RECORD_FIELDS);

  writeValidSources();
  writeFileSync(join(backend, 'schema.mjs'), `
import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from '${defineUrl}';
export default defineSchema(
  { items: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync() },
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
export const query = defineLiveQuery({ table: 'items', args: {} });
export const futureMember = { ...query, __snapbackDefinitionKind: 'surface' };
`);
  await assertGenerationRefusedPreservingDescriptor('SNAPBACK_CODEGEN_DEFINITION_RESERVED_FIELD');

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
  assert.equal(schema.properties.commands.$ref, '#/$defs/commandMap');
  assert.equal(schema.properties.surfaces.additionalProperties.$ref, '#/$defs/surfaceDescriptor');
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
