import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '../..');
const packageUrl = new URL('./define.mjs', import.meta.url).href;

const schemaSource = `
import { defineSchema, defineTable, v } from ${JSON.stringify(packageUrl)};
export const messages = defineTable({
  ownerId: v.principal(),
  body: v.string(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .assetSharing({ kind: 'owner', field: 'ownerId' })
  .sync();
export const publicMessages = defineTable({
  ownerId: v.principal(),
  body: v.string(),
})
  .visibility({ kind: 'public-read' })
  .sync();
export const messageRecipients = defineTable({
  ownerId: v.principal(),
  messageId: v.id('messages'),
  recipientId: v.principal(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .sync();
export default defineSchema({ messages, publicMessages, messageRecipients });
`;

const functionsSource = (overrides = '', uploadOverrides = '') => `
import { assetCollection, defineAssetUpload } from ${JSON.stringify(packageUrl)};
export const messageMedia = defineAssetUpload({
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'video/mp4'], maxBytes: 20_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: { location: 'strip' },
  video: { location: 'strip' },
  ${uploadOverrides}
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const attachments = assetCollection({
  ownerTable: 'messages',
  intent: 'messageMedia',
  maxItems: 8,
  order: 'manual',
  kinds: ['image', 'video'],
  grants: 'none',
  ${overrides}
});
`;

function fixture(functions = functionsSource()) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-media-collection-'));
  const backend = join(root, 'snapback');
  mkdirSync(backend, { recursive: true });
  writeFileSync(join(backend, 'schema.mjs'), schemaSource);
  writeFileSync(join(backend, 'functions.mjs'), functions);
  writeFileSync(join(backend, 'snapback.config.json'), JSON.stringify({
    appId: 'media-collection-authoring',
    targetProfile: 'local-dev-sqlite-ibex',
  }));
  return backend;
}

const happy = fixture();
const generated = await generate(happy);
assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
const schema = JSON.parse(readFileSync(join(happy, 'generated/schema.manifest.json'), 'utf8'));
assert.equal(schema.assetCollections.length, 1);
const collection = schema.assetCollections[0];
assert.equal(collection.format, 'snapback.asset-collection.v1');
assert.equal(collection.name, 'attachments');
assert.equal(collection.maxItems, 8);
assert.deepEqual(collection.kinds, ['image', 'video']);
assert.match(collection.generation, /^sha256:[0-9a-f]{64}$/u);
const child = schema.tables.find((table) => table.name === collection.childTable);
assert.ok(collection.childTable.startsWith('_snapback_asset_collection_'));
assert.deepEqual(child.fields.map(({ name }) => name), [
  'parentId',
  'parentIncarnation',
  'assetId',
  'kind',
  'policyGeneration',
  'ordinal',
]);
assert.deepEqual(child.fields[1].field_type.RelationIncarnation, {
  foreignKeyField: 'parentId',
  parentTable: 'messages',
});
assert.equal(child.fields[2].field_type.AssetRef.media.intent, 'messageMedia');
assert.ok(schema.requiredCapabilities.includes('assets.media-collection.v1'));

const functions = JSON.parse(readFileSync(join(happy, 'generated/functions.manifest.json'), 'utf8'));
for (const operation of ['Append', 'Replace', 'Remove', 'Reorder']) {
  const fn = functions.functions.find(({ name }) => name === `attachments${operation}`);
  assert.equal(
    fn.runtime.HostPlan.Mutation.steps[0].AssetCollection.operation,
    operation.toLowerCase(),
  );
  assert.deepEqual(fn.writeSetSummary.tables, [collection.childTable]);
  assert.ok(fn.requiredCapabilities.includes('assets.media-collection.v1'));
  assert.ok(fn.effectCeiling.hostOperations.includes('assetCollectionCommit'));
}
const list = functions.functions.find(({ name }) => name === 'attachmentsList');
assert.equal(list.runtime.HostPlan.BoundedChildrenQuery.take, 8);
assert.deepEqual(list.runtime.HostPlan.BoundedChildrenQuery.order, [
  { direction: 'Asc', field: 'ordinal' },
]);
const visible = list.resultContract.record.variants.find((variant) => (
  variant.fields.find(({ name }) => name === 'kind')?.value?.value === 'visible'
));
const listFields = visible.fields
  .find(({ name }) => name === 'children')
  .value.element.fields;
assert.equal(listFields.find(({ name }) => name === 'itemId').value.kind, 'id');
assert.equal(listFields.find(({ name }) => name === 'ordinal').value.kind, 'integer');
assert.equal(listFields.find(({ name }) => name === 'media').value.kind, 'mediaRef.v1');

const created = fixture(functionsSource("order: 'created',"));
const createdGenerated = await generate(created);
assert.equal(createdGenerated.ok, true, JSON.stringify(createdGenerated.diagnostics));
const createdSchema = JSON.parse(readFileSync(join(created, 'generated/schema.manifest.json'), 'utf8'));
assert.equal(createdSchema.assetCollections[0].order, 'created');
assert.equal(createdSchema.assetCollections[0].operations.reorder, undefined);
const createdFunctions = JSON.parse(readFileSync(join(created, 'generated/functions.manifest.json'), 'utf8'));
assert.equal(
  createdFunctions.functions.some(({ name }) => name === 'attachmentsReorder'),
  false,
);

const fullSharing = fixture(functionsSource(`
  grants: {
    ceiling: {
      none: { kind: 'none' },
      owner: { kind: 'owner-only' },
      activeRecipients: { kind: 'recipients', state: 'active', maxRecipients: 4 },
      pendingDerived: {
        kind: 'derived',
        state: 'pending',
        maxRecipients: 4,
        function: 'attachmentsRecipients',
        table: 'messageRecipients',
        parentField: 'messageId',
        principalField: 'recipientId',
      },
      command: { kind: 'inherit-command' },
    },
    default: 'none',
  },
`, 'grants: true,'));
const fullSharingGenerated = await generate(fullSharing);
assert.equal(fullSharingGenerated.ok, true, JSON.stringify(fullSharingGenerated.diagnostics));
const fullSharingSchema = JSON.parse(
  readFileSync(join(fullSharing, 'generated/schema.manifest.json'), 'utf8'),
);
assert.deepEqual(
  fullSharingSchema.assetCollections[0].sharing.ceiling.map(({ name, kind }) => [name, kind]),
  [
    ['none', 'none'],
    ['owner', 'owner-only'],
    ['activeRecipients', 'recipients'],
    ['pendingDerived', 'derived'],
    ['command', 'inherit-command'],
  ],
);
const fullSharingFunctions = JSON.parse(
  readFileSync(join(fullSharing, 'generated/functions.manifest.json'), 'utf8'),
);
const sharingAppend = fullSharingFunctions.functions.find(({ name }) => name === 'attachmentsAppend');
const sharingStep = sharingAppend.runtime.HostPlan.Mutation.steps[0].AssetCollection;
assert.equal(sharingStep.sharingArg, 'sharing');
assert.equal(sharingStep.defaultSharingPlan, 'none');
assert.deepEqual(sharingStep.sharingDerivationTables, ['messageRecipients']);
assert.equal(sharingStep.sharingGrantCapable, true);
assert.ok(sharingAppend.effectCeiling.hostOperations.includes('assetGrantCommit'));
assert.ok(sharingAppend.readSetSummary.tables.includes('messageRecipients'));
const sharingArg = sharingAppend.argsContract.fields.find(({ name }) => name === 'sharing');
assert.equal(sharingArg.required, false);
assert.equal(sharingArg.value.kind, 'union');
const derivation = fullSharingFunctions.functions.find(
  ({ name }) => name === 'attachmentsRecipients',
);
assert.equal(derivation.runtime.HostPlan.Query.table, 'messageRecipients');
assert.equal(derivation.runtime.HostPlan.Query.limit, 5);
assert.deepEqual(derivation.runtime.HostPlan.Query.filters, [{
  field: 'messageId',
  op: 'Eq',
  value: { Arg: 'parentId' },
}]);

const invalidCases = [
  ['SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_UNKNOWN', 'ownerTable', "ownerTable: 'missing',"],
  ['SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_INELIGIBLE', 'ownerTable', "ownerTable: 'publicMessages',"],
  ['SNAPBACK_MEDIA_COLLECTION_MAX_ITEMS_INVALID', 'maxItems', 'maxItems: 33,'],
  ['SNAPBACK_MEDIA_COLLECTION_ORDER_INVALID', 'order', "order: 'alphabetical',"],
  ['SNAPBACK_MEDIA_COLLECTION_KINDS_INVALID', 'kinds', "kinds: ['document'],"],
  ['SNAPBACK_MEDIA_COLLECTION_DUPLICATE_POLICY_INVALID', 'kinds', "kinds: ['image', 'image'],"],
  ['SNAPBACK_MEDIA_COLLECTION_INTENT_UNKNOWN', 'intent', "intent: 'missingIntent',"],
  ['SNAPBACK_MEDIA_COLLECTION_INTENT_KIND_INCOMPATIBLE', 'kinds', "kinds: ['audio'],"],
  [
    'SNAPBACK_MEDIA_COLLECTION_SHARING_PLAN_INVALID',
    'grants',
    "grants: { ceiling: { broad: { kind: 'everyone' } }, default: 'broad' },",
  ],
  [
    'SNAPBACK_MEDIA_COLLECTION_SHARING_DEFAULT_INVALID',
    'grants',
    "grants: { ceiling: { none: { kind: 'none' } }, default: 'missing' },",
  ],
  [
    'SNAPBACK_MEDIA_COLLECTION_SHARING_GRANTS_UNDECLARED',
    'grants',
    "grants: { ceiling: { none: { kind: 'none' }, direct: { kind: 'recipients', state: 'active', maxRecipients: 4 } }, default: 'none' },",
  ],
  [
    'SNAPBACK_MEDIA_COLLECTION_SHARING_DERIVATION_INVALID',
    'grants',
    "grants: { ceiling: { derived: { kind: 'derived', state: 'active', maxRecipients: 4, function: 'derive', table: 'messages', parentField: 'missing', principalField: 'ownerId' } }, default: 'derived' },",
  ],
];
for (const [code, property, override] of invalidCases) {
  const result = await generate(fixture(functionsSource(override)));
  assert.equal(result.ok, false, `${code} unexpectedly generated`);
  const diagnostic = result.diagnostics.find((candidate) => candidate.code === code);
  assert.ok(diagnostic, `${code}: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(diagnostic.definitionPath, `attachments.${property}`);
  assert.equal(diagnostic.sourceSpan.file, 'functions.mjs');
  assert.equal(typeof diagnostic.details.remediation, 'string');
  assert.ok(diagnostic.details.remediation.length > 0);
}

const invalidDeclaration = await generate(fixture(functionsSource('unexpected: true,')));
assert.equal(invalidDeclaration.ok, false);
const invalidDeclarationDiagnostic = invalidDeclaration.diagnostics.find(({ code }) => (
  code === 'SNAPBACK_MEDIA_COLLECTION_DECLARATION_INVALID'
));
assert.ok(invalidDeclarationDiagnostic, JSON.stringify(invalidDeclaration.diagnostics));
assert.equal(invalidDeclarationDiagnostic.definitionPath, 'attachments.unexpected');
assert.equal(invalidDeclarationDiagnostic.sourceSpan.file, 'functions.mjs');
assert.ok(invalidDeclarationDiagnostic.details.remediation.length > 0);

const invalidIdentifier = await generate(fixture(
  functionsSource().replace('export const attachments =', 'export const $attachments ='),
));
assert.equal(invalidIdentifier.ok, false);
const invalidIdentifierDiagnostic = invalidIdentifier.diagnostics.find(({ code }) => (
  code === 'SNAPBACK_MEDIA_COLLECTION_INVALID_IDENTIFIER'
));
assert.ok(invalidIdentifierDiagnostic, JSON.stringify(invalidIdentifier.diagnostics));
assert.equal(invalidIdentifierDiagnostic.definitionPath, '$attachments');
assert.equal(invalidIdentifierDiagnostic.sourceSpan.file, 'functions.mjs');

const collisionSource = `${functionsSource()}
export const attachmentsAppend = defineMutation({
  plan: insert('messages', { ownerId: lit('collision'), body: lit('collision') }),
});
`.replace(
  'import { assetCollection, defineAssetUpload }',
  'import { assetCollection, defineAssetUpload, defineMutation, insert, lit }',
);
const collision = await generate(fixture(collisionSource));
assert.equal(collision.ok, false);
const collisionDiagnostic = collision.diagnostics.find(({ code }) => (
  code === 'SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_COLLISION'
));
assert.ok(collisionDiagnostic, JSON.stringify(collision.diagnostics));
assert.equal(collisionDiagnostic.definitionPath, 'attachments');
assert.equal(collisionDiagnostic.sourceSpan.file, 'functions.mjs');
assert.ok(collisionDiagnostic.details.remediation.length > 0);

const rawWriteSource = `${functionsSource()}
export const forgeCollection = defineMutation({
  plan: insert(${JSON.stringify(collection.childTable)}, {
    parentId: lit('message-1'),
    parentIncarnation: lit('forged'),
    assetId: lit('asset-1'),
    kind: lit('image'),
    policyGeneration: lit('forged'),
    ordinal: lit(0),
  }),
});
`.replace(
  'import { assetCollection, defineAssetUpload }',
  'import { assetCollection, defineAssetUpload, defineMutation, insert, lit }',
);
const rawWrite = await generate(fixture(rawWriteSource));
assert.equal(rawWrite.ok, false);
const rawWriteDiagnostic = rawWrite.diagnostics.find(({ code }) => (
  code === 'SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_REFUSED'
));
assert.ok(rawWriteDiagnostic, JSON.stringify(rawWrite.diagnostics));
assert.equal(rawWriteDiagnostic.definitionPath, 'forgeCollection');
assert.equal(rawWriteDiagnostic.sourceSpan.file, 'functions.mjs');
assert.ok(rawWriteDiagnostic.details.remediation.length > 0);

assert.equal(resolve(repoRoot, 'packages/snapback-codegen'), packageDir);
console.log(`media collection lowering 1, generated operations 5, refusal attribution ${invalidCases.length + 4}: ok`);
