import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '../..');
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const root = mkdtempSync(join(tmpdir(), 'snapback-media-result-types-'));
const backend = join(root, 'snapback');
const noMediaRoot = mkdtempSync(join(tmpdir(), 'snapback-no-media-result-types-'));
const noMediaBackend = join(noMediaRoot, 'snapback');
const positiveFixture = 'media-result-types.fixture.ts';
const negativeFixture = 'media-result-types.negative.fixture.ts';
const microProfile = (selectedOperations) => ({
  formatVersion: 'snapback.micro-profile-input.v1',
  profileName: 'media-result-types',
  packagingProfile: 'micro.v1',
  selectedOperations,
  modules: ['core', 'operations', 'authority-fence', 'live'],
  arm: 'local-dev',
  lane: 'poll',
  authProfileSet: [],
  custodyOwner: 'none',
  carriers: [],
  explicitNonclaims: [
    'admin',
    'assets',
    'capability-class',
    'ephemeral-state',
    'generic-storage',
    'hosted-carrier',
    'offline-replay',
    'optimistic-settlement',
    'query-groups',
    'retained-reads',
    'rqs',
    'sessions-auth',
  ],
});

try {
  mkdirSync(backend, { recursive: true });
  writeFileSync(join(root, 'demo.snapback.json'), JSON.stringify({ id: 'media-result-types' }));
  writeFileSync(join(backend, 'schema.mjs'), `
    import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
    export default defineSchema({
      profiles: defineTable({
        ownerId: v.principal(),
        displayName: v.string(),
        image: v.optional(v.media({
          intent: 'profileMediaUpload',
          policy: 'profile-image.v1',
          kinds: ['image'],
          delivery: 'primary',
          variants: ['primary'],
        })),
        featured: v.media({
          intent: 'profileMediaUpload',
          policy: 'profile-image.v1',
          kinds: ['image', 'video'],
          delivery: 'primary',
          variants: ['primary'],
        }),
      })
        .visibility({ kind: 'owner', field: 'ownerId' })
        .assetSharing({ kind: 'owner', field: 'ownerId' })
        .sync(),
    });
  `);
  writeFileSync(join(backend, 'functions.mjs'), `
    import { defineAssetUpload, defineJsMutation, defineLiveQuery, results, v } from ${JSON.stringify(defineUrl)};
    export const profileMediaUpload = defineAssetUpload({
      auth: 'authenticated',
      accept: { mediaTypes: ['image/jpeg', 'video/mp4'], maxBytes: 8_000_000 },
      delivery: { kind: 'private-strict' },
      access: { read: 'via-references' },
      image: { location: 'strip' },
      video: { location: 'strip' },
      authorize: async (ctx) => ({ owner: ctx.auth.userId }),
    });
    export const listProfiles = defineLiveQuery({
      table: 'profiles',
      args: {},
      auth: 'authenticated',
    });
    export const inviteMember = defineJsMutation({
      args: { userId: v.principal() },
      writes: ['profiles'],
      result: results.value(v.boolean()),
      auth: 'authenticated',
      handler: async () => true,
    });
  `);
  writeFileSync(join(backend, 'micro.profile.json'), JSON.stringify(microProfile(['listProfiles'])));

  const generated = await generate(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));

  const apiTypes = readFileSync(join(backend, 'generated', 'api.d.ts'), 'utf8');
  assert.match(
    apiTypes,
    /import type \{ MediaRef \} from '@expo\/snapback-client\/assets';/u,
    'media result types use the client-owned public MediaRef',
  );
  assert.match(
    apiTypes,
    /profiles: \{[^\n]+image: null \| string; featured: string \};/u,
    'the handler/storage model keeps the physical asset-id string',
  );
  assert.match(
    apiTypes,
    /"listProfiles": FunctionReference<[^\n]+"ownerId": Principal;[^\n]+"image": null \| MediaRef<"image">; "featured": MediaRef<"image" \| "video">/u,
    'the LiveQuery result is rendered from the projected result contract',
  );
  assert.match(
    apiTypes,
    /"inviteMember": FunctionReference<"inviteMember", 'Mutation', \{ userId: Principal \}/u,
    'principal operation arguments retain the Principal brand',
  );

  const microTypes = readFileSync(join(backend, 'generated', 'micro.d.ts'), 'utf8');
  assert.match(
    microTypes,
    /import type \{ MediaRef \} from '@expo\/snapback-client\/assets';/u,
    'a media-bearing Micro declaration imports MediaRef as a type',
  );
  assert.match(
    microTypes,
    /"featured": MediaRef<"image" \| "video">/u,
    'the Micro result narrows the required media field to the admitted kinds',
  );

  cpSync(join(packageDir, positiveFixture), join(backend, positiveFixture));
  cpSync(join(packageDir, negativeFixture), join(backend, negativeFixture));
  const compilerOptions = {
    strict: true,
    noEmit: true,
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    baseUrl: repoRoot,
    paths: {
      '@expo/snapback-react': [join(repoRoot, 'packages/snapback-react/index.d.mts')],
      '@expo/snapback-client': [join(repoRoot, 'packages/snapback-client/index.d.mts')],
      '@expo/snapback-client/assets': [join(repoRoot, 'packages/snapback-client/assets.d.mts')],
      '@expo/snapback-client/commands': [join(repoRoot, 'packages/snapback-client/commands.d.mts')],
      '@expo/snapback-client/micro/core': [join(repoRoot, 'packages/snapback-client/micro-core.d.mts')],
      '@expo/snapback-client/micro/live': [join(repoRoot, 'packages/snapback-client/micro-live.d.mts')],
      '@expo/snapback-client/*': [join(repoRoot, 'packages/snapback-client/*')],
      '@expo/snapback-codegen/ctx': [join(repoRoot, 'packages/snapback-codegen/ctx.d.mts')],
      '@expo/snapback-contract/*': [join(repoRoot, 'packages/snapback-contract/*')],
    },
  };
  const tscPath = join(packageDir, 'node_modules/.bin/tsc');
  const typecheck = (targetBackend, fixtureNames, configName) => {
    writeFileSync(join(targetBackend, configName), JSON.stringify({
      compilerOptions,
      files: fixtureNames,
    }));
    return spawnSync(tscPath, ['--project', configName], {
      cwd: targetBackend,
      encoding: 'utf8',
    });
  };

  const positive = typecheck(backend, [positiveFixture], 'tsconfig.media-result-positive.json');
  assert.equal(positive.status, 0, `${positive.stdout}\n${positive.stderr}`);

  const negative = typecheck(backend, [negativeFixture], 'tsconfig.media-result-negative.json');
  assert.notEqual(negative.status, 0, 'a physical storage string must not satisfy MediaRef');
  assert.match(
    `${negative.stdout}\n${negative.stderr}`,
    /TS2322/u,
    'the negative control fails at the generated storage/result type boundary',
  );

  const micro = typecheck(backend, ['generated/micro.d.ts'], 'tsconfig.media-result-micro.json');
  assert.equal(micro.status, 0, `${micro.stdout}\n${micro.stderr}`);

  mkdirSync(noMediaBackend, { recursive: true });
  writeFileSync(join(noMediaRoot, 'demo.snapback.json'), JSON.stringify({ id: 'no-media-result-types' }));
  writeFileSync(join(noMediaBackend, 'schema.mjs'), `
    import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
    export default defineSchema({
      notes: defineTable({ ownerId: v.principal(), body: v.string() })
        .visibility({ kind: 'owner', field: 'ownerId' })
        .sync(),
    });
  `);
  writeFileSync(join(noMediaBackend, 'functions.mjs'), `
    import { defineLiveQuery } from ${JSON.stringify(defineUrl)};
    export const listNotes = defineLiveQuery({ table: 'notes', args: {}, auth: 'authenticated' });
  `);
  writeFileSync(
    join(noMediaBackend, 'micro.profile.json'),
    JSON.stringify(microProfile(['listNotes'])),
  );
  const noMediaGenerated = await generate(noMediaBackend);
  assert.equal(noMediaGenerated.ok, true, JSON.stringify(noMediaGenerated.diagnostics));
  const noMediaApiTypes = readFileSync(join(noMediaBackend, 'generated', 'api.d.ts'), 'utf8');
  const noMediaMicroTypes = readFileSync(join(noMediaBackend, 'generated', 'micro.d.ts'), 'utf8');
  assert.doesNotMatch(noMediaApiTypes, /\bMediaRef\b/u);
  assert.doesNotMatch(noMediaMicroTypes, /\bMediaRef\b/u);
  const noMedia = typecheck(
    noMediaBackend,
    ['generated/api.d.ts', 'generated/micro.d.ts'],
    'tsconfig.no-media-result-types.json',
  );
  assert.equal(noMedia.status, 0, `${noMedia.stdout}\n${noMedia.stderr}`);

  console.log(`positive tsc: ${tscPath} --project tsconfig.media-result-positive.json: ok`);
  console.log(`negative tsc: ${tscPath} --project tsconfig.media-result-negative.json: failed as expected (TS2322)`);
  console.log(`media Micro declaration tsc: ${tscPath} --project tsconfig.media-result-micro.json: ok`);
  console.log(`no-media declarations tsc: ${tscPath} --project tsconfig.no-media-result-types.json: ok`);
  console.log('media result contract/storage-model divergence: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(noMediaRoot, { recursive: true, force: true });
}
