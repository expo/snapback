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
const positiveFixture = 'media-result-types.fixture.ts';
const negativeFixture = 'media-result-types.negative.fixture.ts';

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
          intent: 'profileImageUpload',
          policy: 'profile-image.v1',
          kinds: ['image'],
          delivery: 'primary',
          variants: ['primary'],
        })),
      })
        .visibility({ kind: 'owner', field: 'ownerId' })
        .assetSharing({ kind: 'owner', field: 'ownerId' })
        .sync(),
    });
  `);
  writeFileSync(join(backend, 'functions.mjs'), `
    import { defineAssetUpload, defineLiveQuery } from ${JSON.stringify(defineUrl)};
    export const profileImageUpload = defineAssetUpload({
      auth: 'authenticated',
      accept: { mediaTypes: ['image/jpeg'], maxBytes: 8_000_000 },
      delivery: { kind: 'private-strict' },
      access: { read: 'via-references' },
      image: { location: 'strip' },
      authorize: async (ctx) => ({ owner: ctx.auth.userId }),
    });
    export const listProfiles = defineLiveQuery({
      table: 'profiles',
      args: {},
      auth: 'authenticated',
    });
  `);

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
    /profiles: \{[^\n]+image: null \| string \};/u,
    'the handler/storage model keeps the physical asset-id string',
  );
  assert.match(
    apiTypes,
    /"listProfiles": FunctionReference<[^\n]+"image": null \| MediaRef<"image">/u,
    'the LiveQuery result is rendered from the projected result contract',
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
      '@expo/snapback-client/*': [join(repoRoot, 'packages/snapback-client/*')],
      '@expo/snapback-codegen/ctx': [join(repoRoot, 'packages/snapback-codegen/ctx.d.mts')],
      '@expo/snapback-contract/*': [join(repoRoot, 'packages/snapback-contract/*')],
    },
  };
  const tscPath = join(packageDir, 'node_modules/.bin/tsc');
  const typecheck = (fixtureName, configName) => {
    writeFileSync(join(backend, configName), JSON.stringify({
      compilerOptions,
      files: [fixtureName],
    }));
    return spawnSync(tscPath, ['--project', configName], {
      cwd: backend,
      encoding: 'utf8',
    });
  };

  const positive = typecheck(positiveFixture, 'tsconfig.media-result-positive.json');
  assert.equal(positive.status, 0, `${positive.stdout}\n${positive.stderr}`);

  const negative = typecheck(negativeFixture, 'tsconfig.media-result-negative.json');
  assert.notEqual(negative.status, 0, 'a physical storage string must not satisfy MediaRef');
  assert.match(
    `${negative.stdout}\n${negative.stderr}`,
    /TS2345/u,
    'the negative control fails on the string-to-MediaRef argument boundary',
  );

  console.log(`positive tsc: ${tscPath} --project tsconfig.media-result-positive.json: ok`);
  console.log(`negative tsc: ${tscPath} --project tsconfig.media-result-negative.json: failed as expected (TS2345)`);
  console.log('media result contract/storage-model divergence: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
