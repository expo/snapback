// LLP 0109 §17 (W2f): seed asset fixtures — artifact emission, digest
// identity, intent binding, and placeholder placement validation.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

import { generate } from './index.mjs';
import { buildSeedAssetFixturesV1, seedAssetFixturesDigest } from './seed-artifact.mjs';

const defineUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')).href;

const SCHEMA = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  posts: defineTable({
    title: v.string(),
    photo: v.optional(v.assetRef({ upload: 'photoUpload' })),
  })
    .visibility({ kind: 'public-read' })
    .assetSharing({ kind: 'public-read' })
    .sync(),
});
`;
const FUNCTIONS = `
import { defineAssetUpload } from '${defineUrl}';
export const photoUpload = defineAssetUpload({
  accept: { mediaTypes: ['application/octet-stream'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-strict' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`;

async function runCase({ seed, seedAssets, fixtureFiles }) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-seed-assets-'));
  writeFileSync(join(dir, 'schema.mjs'), SCHEMA);
  writeFileSync(join(dir, 'functions.mjs'), FUNCTIONS);
  if (seed) writeFileSync(join(dir, 'seed.json'), JSON.stringify(seed));
  if (seedAssets) writeFileSync(join(dir, 'seed-assets.json'), JSON.stringify(seedAssets));
  for (const [path, bytes] of Object.entries(fixtureFiles ?? {})) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  mkdirSync(join(dir, 'generated'), { recursive: true });
  return { dir, result: await generate(dir) };
}

const codes = (result) => result.diagnostics.map((d) => d.code);

// --- unit: builder digest identity and refusals ----------------------------

{
  const digests = new Map([['seed-assets/a.bin', 'a'.repeat(64)]]);
  const artifact = buildSeedAssetFixturesV1(
    { fixtures: [{ id: 'a', upload: 'photoUpload', file: 'seed-assets/a.bin', mediaType: 'application/octet-stream' }] },
    'app',
    digests,
  );
  assert.equal(artifact.formatVersion, 'snapback.seed-asset-fixtures.v1');
  assert.equal(artifact.fixtures[0].sourceDigest, `sha256:${'a'.repeat(64)}`);
  const body = { formatVersion: artifact.formatVersion, appId: 'app', fixtures: artifact.fixtures };
  assert.equal(artifact.fixturesDigest, seedAssetFixturesDigest(body), 'digest recomputes');
  for (const bad of [
    { fixtures: [{ id: 'a', upload: 'u', file: '../escape.bin', mediaType: 'x/y' }] },
    { fixtures: [{ id: 'bad id!', upload: 'u', file: 'f.bin', mediaType: 'x/y' }] },
    { fixtures: [
      { id: 'a', upload: 'u', file: 'seed-assets/a.bin', mediaType: 'x/y' },
      { id: 'a', upload: 'u', file: 'seed-assets/a.bin', mediaType: 'x/y' },
    ] },
    { fixtures: [] },
  ]) {
    assert.throws(() => buildSeedAssetFixturesV1(bad, 'app', digests));
  }
}

// --- e2e: artifact emitted, placeholder validated --------------------------

{
  const bytes = Buffer.from('fixture-bytes');
  const { dir, result } = await runCase({
    seed: {
      seedVersion: '2026-07-31.1',
      tables: { posts: [{ _id: 'welcome', title: 'Welcome', photo: { $assetFixture: 'welcome-photo' } }] },
    },
    seedAssets: { fixtures: [{ id: 'welcome-photo', upload: 'photoUpload', file: 'seed-assets/welcome.bin', mediaType: 'application/octet-stream' }] },
    fixtureFiles: { 'seed-assets/welcome.bin': bytes },
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const artifact = JSON.parse(readFileSync(join(dir, 'generated', 'seed.asset-fixtures.artifact.json'), 'utf8'));
  assert.equal(artifact.fixtures[0].sourceDigest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  const pkg = JSON.parse(readFileSync(join(dir, 'generated', 'package.json'), 'utf8'));
  assert.equal(pkg.exports['./seed-assets'], './seed.asset-fixtures.artifact.json');
}

// --- refusals: undeclared fixture, wrong placement, wrong intent -----------

{
  const { result } = await runCase({
    seed: {
      seedVersion: '2026-07-31.1',
      tables: { posts: [{ _id: 'w', title: 'W', photo: { $assetFixture: 'missing' } }] },
    },
    seedAssets: { fixtures: [{ id: 'other', upload: 'photoUpload', file: 'seed-assets/o.bin', mediaType: 'application/octet-stream' }] },
    fixtureFiles: { 'seed-assets/o.bin': Buffer.from('x') },
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('SNAPBACK_SEED_ASSET_FIXTURE_UNKNOWN'), codes(result).join(','));
}

{
  const { result } = await runCase({
    seed: {
      seedVersion: '2026-07-31.1',
      tables: { posts: [{ _id: 'w', title: { $assetFixture: 'welcome-photo' } }] },
    },
    seedAssets: { fixtures: [{ id: 'welcome-photo', upload: 'photoUpload', file: 'seed-assets/w.bin', mediaType: 'application/octet-stream' }] },
    fixtureFiles: { 'seed-assets/w.bin': Buffer.from('x') },
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('SNAPBACK_SEED_ASSET_FIXTURE_PLACEMENT_INVALID'), codes(result).join(','));
}

{
  const { result } = await runCase({
    seedAssets: { fixtures: [{ id: 'w', upload: 'nope', file: 'seed-assets/w.bin', mediaType: 'application/octet-stream' }] },
    fixtureFiles: { 'seed-assets/w.bin': Buffer.from('x') },
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('SNAPBACK_SEED_ASSET_FIXTURES_INVALID'), codes(result).join(','));
}

console.log('seed-asset-fixtures.test.mjs passed');
