import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import { generate } from './index.mjs';

const defineUrl = new URL('./define.mjs', import.meta.url).href;

const schema = `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export const messages = defineTable({ ownerId: v.principal(), text: v.string() })
  .visibility({ kind: 'owner', field: 'ownerId' })
  .assetSharing({ kind: 'owner', field: 'ownerId' })
  .sync();
export default defineSchema({ messages });
`;

const functions = (commandOverrides = '') => `
import {
  assetCollection, assetSharing, defineAssetUpload, defineJsMutation,
  defineMediaCommand, results, v,
} from ${JSON.stringify(defineUrl)};
export const messageMedia = defineAssetUpload({
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'video/mp4'], maxBytes: 20_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: { location: 'strip' },
  video: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const attachments = assetCollection({
  ownerTable: 'messages', intent: 'messageMedia', maxItems: 8,
  order: 'manual', kinds: ['image', 'video'], grants: 'none',
});
export const sendMessageMutation = defineJsMutation({
  auth: 'authenticated',
  args: {
    text: v.string(),
    assetIds: v.array(v.assetRef({ upload: 'messageMedia' }), { maxItems: 8 }),
  },
  writes: ['messages'],
  opaqueWritePosture: 'conservative-v1',
  declaredTableCeiling: ['messages'],
  result: results.value(v.object({ _id: v.id('messages') })),
  handler: async (ctx, args) => ({
    // @ref LLP 0264#d3-owner-inserts-are-host-stamped
    _id: await ctx.db.insert('messages', { text: args.text }),
  }),
});
export const sendMessage = defineMediaCommand({
  media: { input: 'media', intent: 'messageMedia', minItems: 0, maxItems: 8, kinds: ['image', 'video'] },
  mutation: sendMessageMutation,
  mapping: {
    passthrough: ['text'], assetsToMutationArg: 'assetIds',
    parentResultPath: '_id', collection: 'attachments', operation: 'append',
  },
  sharing: assetSharing.none(),
  ${commandOverrides}
});
`;

function fixture(source = functions()) {
  const backend = join(mkdtempSync(join(tmpdir(), 'snapback-media-command-')), 'snapback');
  mkdirSync(backend, { recursive: true });
  writeFileSync(join(backend, 'schema.mjs'), schema);
  writeFileSync(join(backend, 'functions.mjs'), source);
  writeFileSync(join(backend, 'snapback.config.json'), JSON.stringify({
    appId: 'media-command-authoring',
    targetProfile: 'local-dev-sqlite-ibex',
  }));
  return backend;
}

const happy = fixture();
const result = await generate(happy);
assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
const functionManifest = JSON.parse(readFileSync(join(happy, 'generated/functions.manifest.json')));
const target = functionManifest.functions.find(({ name }) => name === 'sendMessageMutation');
assert.equal(target.mediaCommandBindings.length, 1);
const [binding] = target.mediaCommandBindings;
assert.equal(binding.format, 'snapback.media-command-binding.v1');
assert.match(binding.identity, /^sha256:[0-9a-f]{64}$/u);
assert.equal(binding.targetMutation.name, 'sendMessageMutation');
assert.deepEqual(binding.passthroughArgs, ['text']);
assert.deepEqual(binding.parentResultPath, ['_id']);
assert.deepEqual(binding.itemIdentityPlan, {
  format: 'snapback:asset-collection-item-id:v1', operation: 'append', order: 'input',
});
assert.equal(binding.collection.name, 'attachments');
assert.equal(binding.sharing.kind, 'none');
assert.deepEqual(binding.taskProfile, { concurrency: 3 });
assert.ok(target.requiredCapabilities.includes('assets.media-command.v1'));

const app = JSON.parse(readFileSync(join(happy, 'generated/app.descriptor.json')));
assert.equal(app.api.mutations.sendMessageMutation, undefined, 'command-only target is not directly generated');
assert.equal(app.commands.sendMessage.kind, 'media-command.v1');
assert.equal(app.commands.sendMessage.binding.identity, binding.identity);
assert.deepEqual(app.commands.sendMessage.intent, app.api.assets.messageMedia);
const appDescriptorSchema = JSON.parse(readFileSync(join(
  dirname(fileURLToPath(import.meta.url)),
  'app-descriptor.schema.json',
)));
const validateAppDescriptor = new Ajv2020({ allErrors: true, strict: false })
  .compile(appDescriptorSchema);
assert.equal(validateAppDescriptor(app), true, JSON.stringify(validateAppDescriptor.errors));
const lifecycle = JSON.parse(readFileSync(join(happy, 'generated/client-lifecycle.v1.json')));
const lifecycleCommand = lifecycle.commands.find(({ name }) => name === 'sendMessage');
assert.equal(lifecycleCommand.runtimeDiscriminant, 'media-command.v1');
assert.deepEqual(lifecycleCommand.states, [
  'validating', 'uploading', 'committing',
  'committed', 'failed', 'cancelled', 'ambiguous',
]);
const apiTypes = readFileSync(join(happy, 'generated/api.d.ts'), 'utf8');
const publicApi = /export interface GeneratedApi \{([\s\S]*?)\n\}\nexport interface GeneratedCommandTargets/u.exec(apiTypes)?.[1];
const commandTargets = /export interface GeneratedCommandTargets \{([\s\S]*?)\n\}/u.exec(apiTypes)?.[1];
assert.ok(publicApi);
assert.ok(commandTargets);
assert.doesNotMatch(publicApi, /sendMessageMutation/u);
assert.match(commandTargets, /sendMessageMutation/u);
const appTypes = readFileSync(join(happy, 'generated/app.d.ts'), 'utf8');
assert.match(appTypes, /MediaCommandDescriptor<GeneratedCommandTargets\["sendMessageMutation"\]/u);
const apiEnvelope = JSON.parse(readFileSync(join(happy, 'generated/api-envelope.members.json')));
assert.doesNotMatch(apiEnvelope.declarations.appBindings, /sendMessageMutation/u);

const invalid = await generate(fixture(functions().replace(
  "parentResultPath: '_id'",
  "parentResultPath: 'missing'",
)));
assert.equal(invalid.ok, false);
const diagnostic = invalid.diagnostics.find(({ code }) => (
  code === 'SNAPBACK_MEDIA_COMMAND_PARENT_RESULT_PATH_INVALID'
));
assert.ok(diagnostic, JSON.stringify(invalid.diagnostics));
assert.equal(diagnostic.definitionPath, 'sendMessage.mapping.parentResultPath');
assert.equal(diagnostic.sourceSpan.file, 'functions.mjs');
assert.equal(typeof diagnostic.details.remediation, 'string');

const missingOperation = await generate(fixture(functions().replace(
  ", operation: 'append'",
  '',
)));
assert.equal(missingOperation.ok, false);
const operationDiagnostic = missingOperation.diagnostics.find(({ code }) => (
  code === 'SNAPBACK_MEDIA_COMMAND_OPERATION_INVALID'
));
assert.ok(operationDiagnostic, JSON.stringify(missingOperation.diagnostics));
assert.equal(operationDiagnostic.definitionPath, 'sendMessage.mapping.operation');

const recipientsSource = functions()
  .replace(
    "image: { location: 'strip' },",
    "image: { location: 'strip' }, grants: true,",
  )
  .replace(
    "order: 'manual', kinds: ['image', 'video'], grants: 'none',",
    "order: 'manual', kinds: ['image', 'video'], grants: { ceiling: { none: { kind: 'none' }, direct: { kind: 'recipients', state: 'active', maxRecipients: 4 } }, default: 'none' },",
  )
  .replace(
    "collection: 'attachments', operation: 'append',",
    "collection: 'attachments', operation: 'append', principals: { input: 'recipients', minItems: 1, maxItems: 4 },",
  )
  .replace('sharing: assetSharing.none()', "sharing: assetSharing.recipients({ state: 'active', maxRecipients: 4 })");
const recipients = fixture(recipientsSource);
const recipientsResult = await generate(recipients);
assert.equal(recipientsResult.ok, true, JSON.stringify(recipientsResult.diagnostics));
const recipientsManifest = JSON.parse(
  readFileSync(join(recipients, 'generated/functions.manifest.json')),
);
assert.deepEqual(
  recipientsManifest.functions.find(({ name }) => name === 'sendMessageMutation')
    .mediaCommandBindings[0].principalInput,
  { input: 'recipients', minItems: 1, maxItems: 4 },
);

const missingPrincipalInput = await generate(fixture(recipientsSource.replace(
  ", principals: { input: 'recipients', minItems: 1, maxItems: 4 }",
  '',
)));
assert.equal(missingPrincipalInput.ok, false);
assert.ok(missingPrincipalInput.diagnostics.some(({ code, definitionPath }) => (
  code === 'SNAPBACK_MEDIA_COMMAND_PRINCIPAL_INPUT_INVALID'
  && definitionPath === 'sendMessage.mapping.principals'
)));

const danglingPrincipalInput = await generate(fixture(functions().replace(
  "collection: 'attachments', operation: 'append',",
  "collection: 'attachments', operation: 'append', principals: { input: 'recipients', minItems: 1, maxItems: 4 },",
)));
assert.equal(danglingPrincipalInput.ok, false);
assert.ok(danglingPrincipalInput.diagnostics.some(({ code, definitionPath }) => (
  code === 'SNAPBACK_MEDIA_COMMAND_PRINCIPAL_INPUT_INVALID'
  && definitionPath === 'sendMessage.mapping.principals'
)));

const declaration = await generate(fixture(functions('callback: () => null,')));
assert.equal(declaration.ok, false);
const declarationDiagnostic = declaration.diagnostics.find(({ code }) => (
  code === 'SNAPBACK_MEDIA_COMMAND_DECLARATION_INVALID'
));
assert.ok(declarationDiagnostic, JSON.stringify(declaration.diagnostics));
assert.equal(declarationDiagnostic.definitionPath, 'sendMessage.callback');

console.log('media command authoring tests passed');
