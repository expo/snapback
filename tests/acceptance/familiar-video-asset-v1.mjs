// Familiar-profile asset acceptance: a top-level module declares a video
// intent, codegen exposes it through the same two-segment API namespace as
// queries and mutations, and the official asset client uploads and reads back
// real MP4 bytes through a sessions-mode server.
//
// @ref LLP 0253#explicit-asset-intents--2026-08-15 — Familiar names canonical
//   non-derived asset intents as `<module>.<export>` without weakening policy.

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackAssetClient } from '../../packages/snapback-client/assets.mjs';
import { generate } from '../../packages/snapback-codegen/index.mjs';
import { asUser } from '../../demos/_kit/as-user.mjs';
import { importGeneratedModule } from '../../demos/_kit/generated-artifacts.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..');
const fixtureRoot = join(here, 'fixtures', 'familiar-video-asset');
const scratch = await mkdtemp(join(tmpdir(), 'snapback-familiar-video-asset-'));
let server = null;
let session = null;

function box(kind, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(kind, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

// The same bounded ISO-BMFF shape as the Rust video finalizer fixtures:
// isom/mp42 ftyp, one duration and one 640x480 track, then media bytes.
function smallMp4() {
  const ftyp = Buffer.concat([
    Buffer.from('isom', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('isommp42', 'ascii'),
  ]);
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(2000, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(640 << 16, 76);
  tkhd.writeUInt32BE(480 << 16, 80);
  const moov = box('moov', Buffer.concat([
    box('mvhd', mvhd),
    box('trak', box('tkhd', tkhd)),
  ]));
  return Buffer.concat([box('ftyp', ftyp), moov, box('mdat', Buffer.alloc(32, 0x5a))]);
}

function fileOf(bytes) {
  return {
    name: 'familiar-profile.mp4',
    type: 'video/mp4',
    size: bytes.length,
    slice: (start, end) => ({
      arrayBuffer: async () => bytes.subarray(start ?? 0, end ?? bytes.length),
    }),
  };
}

try {
  const backendRoot = join(scratch, 'snapback');
  await cp(fixtureRoot, backendRoot, { recursive: true });
  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));

  const schemaManifest = JSON.parse(
    await readFile(join(backendRoot, 'generated', 'schema.manifest.json'), 'utf8'),
  );
  const functionsManifest = JSON.parse(
    await readFile(join(backendRoot, 'generated', 'functions.manifest.json'), 'utf8'),
  );
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(
    carrier,
    `${JSON.stringify({ formatVersion: 1, schema: schemaManifest, functions: functionsManifest })}\n`,
    { mode: 0o600 },
  );
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repositoryRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });
  session = await asUser(server, schemaManifest.appId, 'owner@familiar-video.test', {
    clientStoreId: 'familiar-video-owner',
  });
  const generatedApi = await importGeneratedModule(join(backendRoot, 'generated'), 'api.mjs');
  const { api } = generatedApi;
  assert.strictEqual(api.media.videoUpload, generatedApi.app.api.assets['media.videoUpload']);

  const source = smallMp4();
  const assets = new SnapbackAssetClient(session.client, { chunkBytes: 64 });
  const finished = await assets.start({
    upload: api.media.videoUpload,
    file: fileOf(source),
  }).done;
  assert.equal(finished.status, 'ready', JSON.stringify(finished.diagnostic));
  assert.equal(finished.integrityBasis, 'end-to-end-verified');

  const record = await assets.record(finished.assetId);
  assert.equal(record.availability, 'ready');
  const bearer = session.coordinator.credentialFor(session.coordinator.capture()).bearer;
  const response = await fetch(
    assets.deliveryUrl(finished.assetId, { variant: 'primary' }),
    {
      headers: {
        authorization: `Bearer ${bearer}`,
        'x-snapback-auth-client-protocol': '1',
      },
    },
  );
  const returned = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200, returned.toString('utf8'));
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(returned, source);

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'snapback.familiar-video-asset-acceptance.v1',
    ok: true,
    intent: 'media.videoUpload',
    bytes: source.length,
  }, null, 2)}\n`);
} finally {
  await session?.dispose();
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}
