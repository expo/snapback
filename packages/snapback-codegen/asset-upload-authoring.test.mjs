// LLP 0044 L1-03: upload-intent authoring, typed asset references, and the
// sharing declaration — generation admission, refusals, and emitted artifacts.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const defineUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')).href;

async function runCase({ schema, functions, targetProfile }) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-codegen-assets-'));
  const appDir = join(root, 'asset-authoring-fixture');
  const dir = join(appDir, 'snapback');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(appDir, 'demo.snapback.json'), JSON.stringify({
    id: 'asset-authoring-fixture',
  }));
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  mkdirSync(join(dir, 'generated'), { recursive: true });
  mkdirSync(join(dir, 'generated-remote-service'), { recursive: true });
  const result = targetProfile
    ? await generate(dir, { targetProfile })
    : await generate(dir);
  return { dir, result };
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
  accept: { mediaTypes: ['application/pdf', 'application/octet-stream'], maxBytes: 10_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { dir, result } = await runCase({ schema, functions });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  // LLP 0044 §Ceremony floor: the bare `attachment` field derives a default
  // intent beside the explicit one.
  assert.equal(manifest.assetUploadIntents.length, 2);
  const derived = manifest.assetUploadIntents.find(
    (candidate) => candidate.name === '_assets.default.profiles.attachment',
  );
  assert.ok(derived, 'bare v.assetRef() derives a default intent');
  assert.equal(derived.delivery.kind, 'private-strict');
  assert.equal(derived.access.read, 'owner-only');
  assert.deepEqual(derived.image, { location: 'strip' });
  assert.deepEqual(derived.accept.mediaTypes, ['image/jpeg', 'image/png']);
  assert.equal(derived.authRequirement, 'authenticated');
  assert.equal(derived.handlerForm, 'module');
  assert.equal(derived.runtime.IbexModule.export, 'defaultAuthorizer');
  assert.match(derived.intentPolicyHash, /^sha256:[0-9a-f]{64}$/);
  const intent = manifest.assetUploadIntents.find(
    (candidate) => candidate.name === 'avatarUpload',
  );
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
  // The bare field is rewritten to its derived default restriction.
  assert.deepEqual(attachment.field_type, {
    AssetRef: { upload: '_assets.default.profiles.attachment' },
  });

  const api = readFileSync(join(dir, 'generated', 'api.mjs'), 'utf8');
  assert.ok(api.includes('"artifactKind": "assetUploadReference"'), 'api.mjs carries the upload reference');
  assert.ok(api.includes('"intentPolicyHash"'));
  assert.ok(
    api.includes('export const defaults ='),
    'api.mjs exposes the defaults subtree',
  );
  assert.ok(
    api.includes('"_assets.default.profiles.attachment"'),
    'the derived reference is present',
  );
  // The declaration surface agrees with the runtime module: explicit and
  // derived upload references are typed GeneratedApi members, and the
  // defaults subtree is typed per table/field — no app-side cast needed for
  // useSnapbackAssetUpload({ upload: api.<intent> }).
  const apiTypes = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');
  assert.ok(
    apiTypes.includes('avatarUpload: AssetUploadReference<"avatarUpload", Record<string, never>>;'),
    'api.d.ts declares the explicit upload reference on GeneratedApi',
  );
  assert.ok(
    apiTypes.includes('"_assets.default.profiles.attachment": AssetUploadReference<"_assets.default.profiles.attachment", Record<string, never>>;'),
    'api.d.ts declares the derived upload reference on GeneratedApi',
  );
  assert.ok(
    apiTypes.includes('profiles: { attachment: AssetUploadReference<"_assets.default.profiles.attachment", Record<string, never>> };'),
    'api.d.ts types the defaults subtree per table/field',
  );
  assert.ok(
    apiTypes.includes('export declare const defaults: GeneratedAssetUploadDefaults;'),
    'api.d.ts declares defaults with the generated interface',
  );
  // Sharing declared: no undeclared-sharing warning.
  assert.equal(codes(result).includes('SNAPBACK_ASSET_SHARING_UNDECLARED'), false);
}

// --- implementation identity metamorphics: root, helper closure, reads ----

{
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  profiles: defineTable({ ownerId: v.principal() }).sync(),
  teams: defineTable({ ownerId: v.principal() }).sync(),
});
`;
  const functions = ({
    helperBody = 'return ctx.auth.userId;',
    authorize = 'async (ctx) => ({ owner: ownerForAsset(ctx) })',
    reads = "['profiles']",
  } = {}) => `
import { defineAssetUpload } from '${defineUrl}';
function ownerForAsset(ctx) { ${helperBody} }
export const avatarUpload = defineAssetUpload({
  auth: 'authenticated',
  reads: ${reads},
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  authorize: ${authorize},
});
export const unrelatedUpload = defineAssetUpload({
  auth: 'authenticated',
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const generateManifest = async (options) => {
    const { dir, result } = await runCase({ schema, functions: functions(options) });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    return JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  };
  const intent = (manifest, name) => manifest.assetUploadIntents.find(
    (candidate) => candidate.name === name,
  );

  const baseline = await generateManifest();
  const directBody = await generateManifest({
    authorize: `async (ctx) => {
      const owner = ownerForAsset(ctx);
      return { owner };
    }`,
  });
  const helperOnly = await generateManifest({
    helperBody: 'const owner = ctx.auth.userId; return owner;',
  });
  const readsOnly = await generateManifest({ reads: "['teams', 'profiles']" });
  const baselineIntent = intent(baseline, 'avatarUpload');
  const baselineUnrelated = intent(baseline, 'unrelatedUpload');

  for (const [change, manifest] of [
    ['direct authorizer body', directBody],
    ['reachable helper only', helperOnly],
    ['declared reads', readsOnly],
  ]) {
    const changedIntent = intent(manifest, 'avatarUpload');
    assert.notEqual(
      changedIntent.implementationHash,
      baselineIntent.implementationHash,
      `${change} moves implementationHash`,
    );
    assert.equal(
      changedIntent.intentPolicyHash,
      baselineIntent.intentPolicyHash,
      `${change} does not masquerade as an intent-policy change`,
    );
    assert.equal(
      intent(manifest, 'unrelatedUpload').implementationHash,
      baselineUnrelated.implementationHash,
      `${change} leaves an unrelated intent stable`,
    );
  }
  assert.notEqual(
    intent(helperOnly, 'avatarUpload').runtime.IbexModule.source,
    baselineIntent.runtime.IbexModule.source,
    'the helper-only fixture changes the spliced executable bytes',
  );
}

// --- via-references warning when a reachable table lacks the declaration ---

{
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  posts: defineTable({
    authorId: v.principal(),
    attachment: v.optional(v.assetRef({ upload: 'attachmentUpload' })),
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

// Location-bearing media without the media-specific location policy refuses
// at generation — there is no implicit fallback (LLP 0044 §Video location
// policy). Diagnostics name the block the accepted media types require.
{
  const { result } = await runCase({ schema: baseSchema, functions: `
import { defineAssetUpload } from '${defineUrl}';
export const photoUpload = defineAssetUpload({
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 1_000_000 },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
` });
  const diagnostic = result.diagnostics.find(
    (entry) => entry.code === 'SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED',
  );
  assert.ok(diagnostic, JSON.stringify(result.diagnostics));
  assert.match(diagnostic.message, /declare image\.location/);
  assert.doesNotMatch(diagnostic.message, /video\.location/);
  assert.deepEqual(diagnostic.policyFields, ['image.location']);
}

{
  const { result } = await runCase({ schema: baseSchema, functions: `
import { defineAssetUpload } from '${defineUrl}';
export const clipUpload = defineAssetUpload({
  accept: { mediaTypes: ['video/mp4'], maxBytes: 100_000_000 },
  image: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
` });
  const diagnostic = result.diagnostics.find(
    (entry) => entry.code === 'SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED',
  );
  assert.ok(diagnostic, JSON.stringify(result.diagnostics));
  assert.match(diagnostic.message, /declare video\.location/);
  assert.doesNotMatch(diagnostic.message, /image\.location/);
  assert.deepEqual(diagnostic.policyFields, ['video.location']);
}

{
  const { result } = await runCase({ schema: baseSchema, functions: `
import { defineAssetUpload } from '${defineUrl}';
export const mediaUpload = defineAssetUpload({
  accept: { mediaTypes: ['image/jpeg', 'video/mp4'], maxBytes: 100_000_000 },
  image: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
` });
  const diagnostic = result.diagnostics.find(
    (entry) => entry.code === 'SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED',
  );
  assert.ok(diagnostic, JSON.stringify(result.diagnostics));
  assert.match(diagnostic.message, /declare video\.location/);
  assert.deepEqual(diagnostic.policyFields, ['video.location']);
}

// Since the P-05 flip the local target advertises asset_image_finalization_v1,
// so a strip-declared image intent ADMITS on local — with declared variants.
{
  const { result, dir } = await runCase({
    schema: baseSchema,
    functions: `
import { defineAssetUpload } from '${defineUrl}';
export const photoUpload = defineAssetUpload({
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 1_000_000 },
  image: { location: 'strip', variants: [{ key: 'thumb', width: 128 }] },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`,
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const intent = manifest.assetUploadIntents.find((entry) => entry.name === 'photoUpload');
  // The video sibling is presence-only in the policy preimage. Pin the exact
  // pre-ruling image hash under this fixture's explicit portable app identity
  // so admitting it can never move existing image policy identity silently
  // (LLP 0044, 2026-08-03 amendment).
  assert.equal(
    intent.intentPolicyHash,
    'sha256:73595d19bd41bf5a3a72b53c4cedd302285064b644b0c2bfaab65a97cfb7db61',
  );
  assert.equal(Object.hasOwn(intent, 'video'), false);
  const api = readFileSync(join(dir, 'generated', 'api.mjs'), 'utf8');
  assert.ok(api.includes('"artifactKind": "assetUploadReference"'));
}

// A target without the fact still refuses strip — the remote-service profile
// withholds the image facts, and generation stays honest there.
{
  const { result } = await runCase({
    schema: baseSchema,
    functions: `
import { defineAssetUpload } from '${defineUrl}';
export const photoUpload = defineAssetUpload({
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 1_000_000 },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`,
    targetProfile: 'remote-service-sqlite-ibex',
  });
  assert.equal(result.ok, false, 'strip must refuse where the fact is absent');
  assert.ok(codes(result).includes('SNAPBACK_ASSET_INTENT_LOCATION_STRIP_UNSUPPORTED'));
}

// Since the W2d flip the local target advertises asset_video_finalization_v1,
// so a strip-declared video intent ADMITS on local.
{
  const { result, dir } = await runCase({
    schema: baseSchema,
    functions: `
import { defineAssetUpload } from '${defineUrl}';
export const clipUpload = defineAssetUpload({
  accept: { mediaTypes: ['video/mp4'], maxBytes: 100_000_000 },
  video: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`,
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const intent = manifest.assetUploadIntents.find((entry) => entry.name === 'clipUpload');
  assert.deepEqual(intent.video, { location: 'strip' });
  assert.equal(Object.hasOwn(intent, 'image'), false, 'video policy is not emitted as an image alias');
}

// A target without the video fact still refuses video strip.
{
  const { result } = await runCase({
    schema: baseSchema,
    functions: `
import { defineAssetUpload } from '${defineUrl}';
export const clipUpload = defineAssetUpload({
  accept: { mediaTypes: ['video/mp4'], maxBytes: 100_000_000 },
  video: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`,
    targetProfile: 'remote-service-sqlite-ibex',
  });
  assert.equal(result.ok, false, 'video strip must refuse where the fact is absent');
  assert.ok(codes(result).includes('SNAPBACK_ASSET_INTENT_LOCATION_STRIP_UNSUPPORTED'));
}

// Each media policy block is valid only for its own accepted media class.
await refusalCase(`
import { defineAssetUpload } from '${defineUrl}';
export const docUpload = defineAssetUpload({
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  image: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`, 'SNAPBACK_ASSET_INTENT_IMAGE_SPEC_INVALID');

await refusalCase(`
import { defineAssetUpload } from '${defineUrl}';
export const docUpload = defineAssetUpload({
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  video: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`, 'SNAPBACK_ASSET_INTENT_VIDEO_SPEC_INVALID');

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

// --- delivery-profile admission is manifest-keyed (W2b) --------------------

{
  // The local target declares all three profiles, so signed and public
  // intents admit.
  const functions = `
import { defineAssetUpload } from '${defineUrl}';
export const signedDoc = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-signed' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const publicDoc = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  delivery: { kind: 'public-immutable' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { dir, result } = await runCase({ schema: baseSchema, functions });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const kinds = manifest.assetUploadIntents.map((entry) => entry.delivery.kind).sort();
  assert.deepEqual(kinds, ['private-signed', 'public-immutable']);
}

{
  // A target with no assets facts block keeps its existing posture: the
  // profile check is skipped and the runtime refuses at attempt creation.
  // (When a hosted target grows an assets block, its declared list gates
  // here — the check is manifest-keyed, not hardcoded.)
  const functions = `
import { defineAssetUpload } from '${defineUrl}';
export const signedDoc = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-signed' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { result } = await runCase({
    schema: baseSchema,
    functions,
    targetProfile: 'remote-service-sqlite-ibex',
  });
  assert.equal(
    result.diagnostics.some((d) => d.code === 'SNAPBACK_ASSET_INTENT_DELIVERY_UNSUPPORTED'),
    false,
    'absent facts block skips the profile check by design',
  );
}

// --- lifecycle callbacks (W2c): contract-pinned mutation references --------

const callbackMutation = `
export const onAssetReady = defineJsMutation({
  args: { event: v.string(), assetId: v.string(), facts: v.json() },
  handler: async (ctx, args) => {
    await ctx.db.insert('callback_log', { event: args.event, assetId: args.assetId });
    return null;
  },
  writes: ['callback_log'],
});
`;
const callbackSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  callback_log: defineTable({
    event: v.optional(v.string()),
    assetId: v.optional(v.string()),
  }).sync(),
});
`;

{
  // Valid: on.ready names a declared mutation with exactly the callback
  // contract; the intent carries it and the policy hash moves.
  const functions = `
import { defineAssetUpload, defineJsMutation, v } from '${defineUrl}';
${callbackMutation}
export const docUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  on: { ready: 'onAssetReady' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { dir, result } = await runCase({ schema: callbackSchema, functions });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const intent = manifest.assetUploadIntents.find((entry) => entry.name === 'docUpload');
  assert.deepEqual(intent.on, { ready: 'onAssetReady' });
}

{
  // An unknown or non-mutation callback target refuses.
  const functions = `
import { defineAssetUpload } from '${defineUrl}';
export const docUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  on: { ready: 'noSuchMutation' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { result } = await runCase({ schema: callbackSchema, functions });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('SNAPBACK_ASSET_CALLBACK_INVALID'), JSON.stringify(result.diagnostics));
}

{
  // A mutation with any other args contract refuses: the callback shape is
  // closed — { event, assetId, facts } exactly.
  const functions = `
import { defineAssetUpload, defineJsMutation, v } from '${defineUrl}';
export const onAssetReady = defineJsMutation({
  args: { note: v.string() },
  handler: async () => null,
  writes: ['callback_log'],
});
export const docUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  on: { ready: 'onAssetReady' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { result } = await runCase({ schema: callbackSchema, functions });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('SNAPBACK_ASSET_CALLBACK_CONTRACT_INVALID'), JSON.stringify(result.diagnostics));
}

{
  // Sessions-mode schemas admit the same contract-pinned declaration. The
  // runtime supplies the per-app `asset-callbacks` service principal; codegen
  // still owns exact target/argument validation rather than inventing a
  // sessions-specific callback contract.
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  callback_log: defineTable({
    event: v.optional(v.string()),
    assetId: v.optional(v.string()),
  }).sync(),
}, { auth: { mode: 'sessions' } });
`;
  const functions = `
import { defineAssetUpload, defineJsMutation, v } from '${defineUrl}';
${callbackMutation}
export const docUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1_000_000 },
  on: { ready: 'onAssetReady' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;
  const { result } = await runCase({ schema, functions });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
}

// --- reference GC (W2c): schema-level opt-in, bounds, and the warning ------

{
  // Valid: the schema manifest carries the policy; enabling warns about the
  // json field that confers no protection.
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  posts: defineTable({
    photo: v.optional(v.assetRef()),
    metadata: v.optional(v.json()),
  }).sync(),
}, { assets: { referenceGc: { graceMs: 3_600_000 } } });
`;
  const functions = 'export {};\n';
  const { dir, result } = await runCase({ schema, functions });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'schema.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.assets, { referenceGc: { graceMs: 3_600_000 } });
  const warning = result.diagnostics.find(
    (d) => d.code === 'SNAPBACK_ASSET_REFERENCE_GC_UNPROTECTED_FIELDS',
  );
  assert.equal(warning?.severity, 'warning');
  assert.deepEqual(warning.details.jsonFields, ['posts.metadata']);
  assert.equal(warning.details.hasTypedAssetFields, true);
}

{
  // A grace outside the target's Enforced bounds refuses at generation.
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  posts: defineTable({ photo: v.optional(v.assetRef()) }).sync(),
}, { assets: { referenceGc: { graceMs: 10 } } });
`;
  const { result } = await runCase({ schema, functions: 'export {};\n' });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('SNAPBACK_ASSET_REFERENCE_GC_GRACE_INVALID'), JSON.stringify(result.diagnostics));
}

{
  // A target without the reference-GC facts refuses the declaration.
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  posts: defineTable({ photo: v.optional(v.assetRef()) }).sync(),
}, { assets: { referenceGc: { graceMs: 3_600_000 } } });
`;
  const { result } = await runCase({
    schema,
    functions: 'export {};\n',
    targetProfile: 'remote-service-sqlite-ibex',
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('SNAPBACK_ASSET_REFERENCE_GC_UNSUPPORTED'), JSON.stringify(result.diagnostics));
}

console.log('asset-upload-authoring.test.mjs passed');

// 0137 A1-f10: an accept entry trusted detection can never produce refuses at
// generation instead of admitting an intent no upload can ever satisfy.
{
  const { defineAssetUpload } = await import('./define.mjs');
  assert.throws(
    () => defineAssetUpload({
      args: {},
      auth: 'authenticated',
      accept: { mediaTypes: ['text/plain'], maxBytes: 1000 },
      delivery: { kind: 'private-strict' },
      authorize: async (ctx) => ({ owner: ctx.auth.userId }),
    }),
    /can never finalize/,
    'undetectable accept entries refuse at generation',
  );
  // Wildcards intersecting the detectable set stay admitted.
  defineAssetUpload({
    args: {},
    auth: 'authenticated',
    accept: { mediaTypes: ['image/*'], maxBytes: 1000 },
    delivery: { kind: 'private-strict' },
    image: { location: 'retain' },
    authorize: async (ctx) => ({ owner: ctx.auth.userId }),
  });
  console.log('undetectable-accept refusal assertions pass');
}

// 0137 A1: a defineAssetUpload exported from schema.mjs refuses with a named
// diagnostic instead of vanishing silently.
{
  const schema = `
import { defineSchema, defineTable, defineAssetUpload, v } from '${defineUrl}';
export const strayUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/pdf'], maxBytes: 1000 },
  delivery: { kind: 'private-strict' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export default defineSchema({
  docs: defineTable({ title: v.string() }).sync(),
});
`;
  const { result } = await runCase({ schema, functions: 'export {};\n' });
  assert.equal(result.ok, false, 'schema-module intent must refuse generation');
  assert.ok(
    codes(result).includes('SNAPBACK_ASSET_INTENT_IN_SCHEMA_MODULE'),
    `named diagnostic present: ${JSON.stringify(codes(result))}`,
  );
  console.log('schema-module intent refusal assertions pass');
}

// --- ceremony amendment: upload:null stays unrestricted; derived strip
// refuses off-local (LLP 0044 §Ceremony floor, 2026-08-01) ----------------

{
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  docs: defineTable({ file: v.optional(v.assetRef({ upload: null })) }).sync(),
});
`;
  const { dir, result } = await runCase({ schema, functions: '' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  assert.equal(manifest.assetUploadIntents ?? undefined, undefined, 'upload: null derives nothing');
  const schemaManifest = JSON.parse(readFileSync(join(dir, 'generated', 'schema.manifest.json'), 'utf8'));
  const file = schemaManifest.tables.find((t) => t.name === 'docs').fields.find((f) => f.name === 'file');
  assert.deepEqual(file.field_type, { AssetRef: {} }, 'unrestricted marker never reaches the manifest');
  console.log('upload:null unrestricted assertions pass');
}

{
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  posts: defineTable({ photo: v.optional(v.assetRef()) }).sync(),
});
`;
  const { result } = await runCase({ schema, functions: '', targetProfile: 'remote-service-sqlite-ibex' });
  assert.equal(result.ok, false, 'derived strip intent must refuse without image finalization');
  assert.ok(codes(result).includes('SNAPBACK_ASSET_INTENT_LOCATION_STRIP_UNSUPPORTED'));
  console.log('derived-default strip refusal assertions pass');
}
