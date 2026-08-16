import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';
import { v } from './define.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '../..');
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;

assert.throws(
  () => v.media({ intent: 'imageUpload', policy: 'p1', kinds: ['image', 'image'] }),
  /kinds repeats image/,
);
assert.throws(
  () => v.media({ intent: 'imageUpload', policy: 'p1', kinds: ['document'] }),
  /unsupported kind document/,
);
assert.throws(
  () => v.media({ intent: '', policy: 'p1', kinds: ['image'] }),
  /intent must name an upload-intent binding/,
);
assert.throws(
  () => v.media({ intent: 'imageUpload', policy: 'p1', kinds: ['image'], kind: 'image' }),
  /unknown.*kind/,
);

async function fixtureCase() {
  const root = mkdtempSync(join(tmpdir(), 'snapback-media-field-'));
  const fixture = join(root, 'media-profile');
  cpSync(join(repoRoot, 'tests/acceptance/fixtures/media-profile'), fixture, { recursive: true });
  mkdirSync(join(fixture, 'snapback', 'generated'), { recursive: true });
  mkdirSync(join(fixture, 'snapback', 'generated-remote-service'), { recursive: true });
  const result = await generate(join(fixture, 'snapback'));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return join(fixture, 'snapback', 'generated');
}

const generated = await fixtureCase();
const schema = JSON.parse(readFileSync(join(generated, 'schema.manifest.json'), 'utf8'));
const image = schema.tables[0].fields.find((field) => field.name === 'image');
assert.equal(image.optional, true);
assert.deepEqual(image.field_type, {
  AssetRef: {
    upload: 'profileImageUpload',
    media: {
      intent: 'profileImageUpload',
      policy: 'profile-image.v1',
      kinds: ['image'],
      delivery: 'primary',
      variants: ['primary'],
      classificationProfile: 'detected-content-type.v1',
      retentionClass: 'media-reference.v1',
      targetCapability: 'assets.media-ref-projection.v1',
    },
  },
});

const functions = JSON.parse(readFileSync(join(generated, 'functions.manifest.json'), 'utf8'));
const list = functions.functions.find((fn) => fn.name === 'listProfiles');
const imageResult = list.resultContract.document.fields.find((field) => field.name === 'image');
const mediaNode = imageResult.value.variants.find((variant) => variant.kind === 'mediaRef.v1');
assert.deepEqual(mediaNode, {
  kind: 'mediaRef.v1',
  sourceTable: 'profiles',
  sourceField: 'image',
  sourceFieldGeneration: mediaNode.sourceFieldGeneration,
  optional: true,
  classMTreatment: 'class-m.none.v1',
  uploadIntent: 'profileImageUpload',
  policyGeneration: 'profile-image.v1',
  kinds: ['image'],
  delivery: 'primary',
  variants: ['primary'],
  classificationProfile: 'detected-content-type.v1',
  retentionClass: 'media-reference.v1',
});
assert.match(mediaNode.sourceFieldGeneration, /^sha256:[0-9a-f]{64}$/u);
assert.ok(list.requiredCapabilities.includes('assets.media-ref-projection.v1'));
assert.equal(
  list.requiredCapabilities.includes('single_table_v1'),
  false,
  'media projection is outside the current one-table RQS class',
);

const rotatedRoot = mkdtempSync(join(tmpdir(), 'snapback-media-rotation-'));
const backend = join(rotatedRoot, 'backend');
mkdirSync(join(backend, 'generated'), { recursive: true });
mkdirSync(join(backend, 'generated-remote-service'), { recursive: true });
writeFileSync(join(rotatedRoot, 'demo.snapback.json'), JSON.stringify({ id: 'media-rotation' }));
const schemaSource = (kinds) => `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  profiles: defineTable({ image: v.optional(v.media({ intent: 'profileImageUpload', policy: 'profile-image.v1', kinds: ${JSON.stringify(kinds)} })) })
    .visibility({ kind: 'public-read' })
    .sync(),
});
`;
writeFileSync(join(backend, 'functions.mjs'), `
import { defineAssetUpload, defineLiveQuery } from ${JSON.stringify(defineUrl)};
export const profileImageUpload = defineAssetUpload({ accept: { mediaTypes: ['image/jpeg'], maxBytes: 1000 }, delivery: { kind: 'private-strict' }, image: { location: 'strip' }, authorize: async (ctx) => ({ owner: ctx.auth.userId }) });
export const listProfiles = defineLiveQuery({ table: 'profiles', args: {}, auth: 'public' });
`);
writeFileSync(join(backend, 'schema.mjs'), schemaSource(['image']));
const firstGeneration = await generate(backend);
assert.equal(firstGeneration.ok, true, JSON.stringify(firstGeneration.diagnostics));
const firstHash = JSON.parse(readFileSync(join(backend, 'generated/functions.manifest.json')))
  .functions.find((fn) => fn.name === 'listProfiles').resultContractHash;
writeFileSync(join(backend, 'schema.mjs'), schemaSource(['image', 'file']));
const secondGeneration = await generate(backend);
assert.equal(secondGeneration.ok, true, JSON.stringify(secondGeneration.diagnostics));
const secondHash = JSON.parse(readFileSync(join(backend, 'generated/functions.manifest.json')))
  .functions.find((fn) => fn.name === 'listProfiles').resultContractHash;
assert.notEqual(firstHash, secondHash, 'admitted-kind edits rotate the result contract hash');

writeFileSync(join(backend, 'functions.mjs'), `
import { defineAction, results, v } from ${JSON.stringify(defineUrl)};
export const leakProfile = defineAction({ args: {}, result: results.value(v.doc('profiles')), handler: async () => null });
`);
const action = await generate(backend);
assert.equal(action.ok, false);
assert.ok(action.diagnostics.some(({ code }) => code === 'SNAPBACK_MEDIA_PROJECTION_SNAPSHOT_UNAVAILABLE'));

console.log('media field validation 4, lowering 1, contract/hash/RQS 5, action refusal 1: ok');
