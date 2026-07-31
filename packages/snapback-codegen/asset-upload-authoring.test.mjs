// LLP 0044 L1-03: upload-intent authoring, typed asset references, and the
// sharing declaration — generation admission, refusals, and emitted artifacts.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const defineUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')).href;

async function runCase({ schema, functions }) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-assets-'));
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  mkdirSync(join(dir, 'generated'), { recursive: true });
  return { dir, result: await generate(dir) };
}

const codes = (result) => result.diagnostics.map((d) => d.code);

// --- valid: intent + restricted assetRef + sharing declaration -------------

{
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  profiles: defineTable({
    ownerId: v.principal(),
    avatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
    attachment: v.assetRef(),
  })
    .assetSharing({ kind: 'owner', field: 'ownerId' })
    .sync(),
});
`;
  const functions = `
import { defineAssetUpload, v } from '${defineUrl}';
export const avatarUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: ['profiles'],
  accept: { mediaTypes: ['application/pdf', 'text/plain'], maxBytes: 10_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { dir, result } = await runCase({ schema, functions });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  assert.equal(manifest.assetUploadIntents.length, 1);
  const intent = manifest.assetUploadIntents[0];
  assert.equal(intent.name, 'avatarUpload');
  assert.match(intent.id, /:avatarUpload$/);
  assert.match(intent.intentPolicyHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(intent.implementationHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(intent.authRequirement, 'authenticated');
  assert.equal(intent.delivery.kind, 'private-strict');
  assert.equal(intent.access.read, 'via-references');
  assert.equal(intent.handlerForm, 'inline');
  assert.ok(intent.runtime.IbexModule.source.includes('__snapbackHandlers'));
  // Functions and intents share one exported-name namespace; the intent is
  // not in functions[] (it is not callable).
  assert.equal(manifest.functions.some((fn) => fn.name === 'avatarUpload'), false);

  const schemaManifest = JSON.parse(readFileSync(join(dir, 'generated', 'schema.manifest.json'), 'utf8'));
  const profiles = schemaManifest.tables.find((table) => table.name === 'profiles');
  assert.deepEqual(profiles.assetSharing, { kind: 'owner', field: 'ownerId' });
  const avatar = profiles.fields.find((field) => field.name === 'avatar');
  assert.deepEqual(avatar.field_type, { AssetRef: { upload: 'avatarUpload' } });
  assert.equal(avatar.optional, true);
  const attachment = profiles.fields.find((field) => field.name === 'attachment');
  assert.deepEqual(attachment.field_type, { AssetRef: {} });

  const api = readFileSync(join(dir, 'generated', 'api.mjs'), 'utf8');
  assert.ok(api.includes('"artifactKind": "assetUploadReference"'), 'api.mjs carries the upload reference');
  assert.ok(api.includes('"intentPolicyHash"'));
  // Sharing declared: no undeclared-sharing warning.
  assert.equal(codes(result).includes('SNAPBACK_ASSET_SHARING_UNDECLARED'), false);
}

// --- via-references warning when a reachable table lacks the declaration ---

{
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  posts: defineTable({
    authorId: v.principal(),
    attachment: v.optional(v.assetRef()),
  }).sync(),
});
`;
  const functions = `
import { defineAssetUpload } from '${defineUrl}';
export const attachmentUpload = defineAssetUpload({
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { result } = await runCase({ schema, functions });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const warning = result.diagnostics.find((d) => d.code === 'SNAPBACK_ASSET_SHARING_UNDECLARED');
  assert.ok(warning, 'expected the deployment warning');
  assert.deepEqual(warning.details.tables, ['posts']);
}

// --- refusals --------------------------------------------------------------

const baseSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ notes: defineTable({ body: v.string() }).sync() });
`;

async function refusalCase(functions, expectedCode) {
  const { result } = await runCase({ schema: baseSchema, functions });
  assert.equal(result.ok, false, `expected refusal ${expectedCode}`);
  assert.ok(
    codes(result).includes(expectedCode),
    `expected ${expectedCode}, got ${JSON.stringify(codes(result))}`,
  );
}

// Location-bearing media without a declared location policy refuses at
// generation — there is no implicit fallback (LLP 0044).
await refusalCase(`
import { defineAssetUpload } from '${defineUrl}';
export const photoUpload = defineAssetUpload({
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 1_000_000 },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`, 'SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED');

// 'strip' requires the image-finalization capability no v1 target advertises.
await refusalCase(`
import { defineAssetUpload } from '${defineUrl}';
export const photoUpload = defineAssetUpload({
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 1_000_000 },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`, 'SNAPBACK_ASSET_INTENT_LOCATION_STRIP_UNSUPPORTED');

// A strip-declared video intent refuses on every v1 target.
await refusalCase(`
import { defineAssetUpload } from '${defineUrl}';
export const clipUpload = defineAssetUpload({
  accept: { mediaTypes: ['video/mp4'], maxBytes: 100_000_000 },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`, 'SNAPBACK_ASSET_INTENT_LOCATION_STRIP_UNSUPPORTED');

// An image policy without any image/video media type is an authoring error.
await refusalCase(`
import { defineAssetUpload } from '${defineUrl}';
export const docUpload = defineAssetUpload({
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  image: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`, 'SNAPBACK_ASSET_INTENT_IMAGE_SPEC_INVALID');

// --- explicit retain admits location-bearing media on a lifecycle target ---

{
  const functions = `
import { defineAssetUpload } from '${defineUrl}';
export const photoUpload = defineAssetUpload({
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 1_000_000 },
  image: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { result } = await runCase({ schema: baseSchema, functions });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
}

// --- a restriction naming an undeclared intent refuses ---------------------

{
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  notes: defineTable({ file: v.optional(v.assetRef({ upload: 'missingIntent' })) }).sync(),
});
`;
  const functions = 'export const nothing = 1;\n';
  const { result } = await runCase({ schema, functions });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('SNAPBACK_ASSET_INTENT_UNKNOWN'), JSON.stringify(codes(result)));
}

// --- variants: required is an optional boolean, canonical when absent -----

{
  const functions = `
import { defineAssetUpload } from '${defineUrl}';
export const gallery = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 1_000_000 },
  image: {
    location: 'retain',
    variants: [
      { key: 'thumb', width: 128, required: true },
      { key: 'display', width: 1024 },
    ],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { dir, result } = await runCase({ schema: baseSchema, functions });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const intent = manifest.assetUploadIntents.find((entry) => entry.name === 'gallery');
  const variants = intent.image.variants;
  assert.deepEqual(variants[0], { key: 'thumb', width: 128, required: true });
  // Absence is canonical: no `required` member at all, so pre-existing
  // intent policy hashes are unchanged by the field's introduction.
  assert.deepEqual(variants[1], { key: 'display', width: 1024 });
}

{
  const functions = `
import { defineAssetUpload } from '${defineUrl}';
export const gallery = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 1_000_000 },
  image: { location: 'retain', variants: [{ key: 'thumb', width: 128, required: 'yes' }] },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { result } = await runCase({ schema: baseSchema, functions });
  assert.equal(result.ok, false, 'a non-boolean required must refuse');
}

console.log('asset-upload-authoring.test.mjs passed');
