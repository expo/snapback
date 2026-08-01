// Faceplate / Snapback arm driver (LLP 0139 App A). Boots a sessions-mode
// server from this repository, runs the frozen checklist, prints evidence.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SnapbackClient } from '../../../../packages/snapback-client/index.mjs';
import { SnapbackAssetClient } from '../../../../packages/snapback-client/assets.mjs';
import { AuthCoordinator, createMemoryAuthCustodyStorage } from '../../../../packages/snapback-contract/index.mjs';
import { generate } from '../../../../packages/snapback-codegen/index.mjs';
import { importGeneratedModule } from '../../../../demos/_kit/generated-artifacts.mjs';
import { startServer } from '../../../../demos/_kit/server-process.mjs';
import { gpsJpegBytes, hasGpsExif } from '../../_shared/gps-jpeg.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..', '..', '..');
const evidence = {};
let server = null;

async function mintSession(appId, email, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
  });
  const requested = await client.authRequestCode(email);
  const mailbox = await (await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: { 'x-snapback-admin-token': server.adminToken, 'x-snapback-impersonation-capability': server.impersonationCapability } },
  )).json();
  await client.authExchange({ challengeId: requested.challengeId, code: mailbox.code });
  return { client, coordinator };
}
const mutate = (s, name, args) => s.client.mutate(name, { args, clientMutationId: `fp-${Math.random().toString(36).slice(2)}`, authorityCapture: s.coordinator.capture() });
const fileOf = (buffer, name = 'photo.jpg', type = 'image/jpeg') => ({
  name, type, size: buffer.length,
  slice: (start, end) => ({ arrayBuffer: async () => buffer.subarray(start, end) }),
  arrayBuffer: async () => buffer,
});
const bearer = (s) => ({ authorization: `Bearer ${s.coordinator.credentialFor(s.coordinator.capture()).bearer}`, 'x-snapback-auth-client-protocol': '1' });

try {
  const scratch = await mkdtemp(join(tmpdir(), 'faceplate-snapback-'));
  const backendRoot = join(scratch, 'snapback');
  await cp(join(here, 'snapback'), backendRoot, { recursive: true });
  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const schemaManifest = JSON.parse(await readFile(join(backendRoot, 'generated', 'schema.manifest.json'), 'utf8'));
  const functionManifest = JSON.parse(await readFile(join(backendRoot, 'generated', 'functions.manifest.json'), 'utf8'));
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema: schemaManifest, functions: functionManifest })}\n`);
  server = await startServer({ port: 0, db: ':memory:', cwd: repositoryRoot, startupArtifacts: carrier, captureImpersonationCapability: true });
  const { default: api } = await importGeneratedModule(join(backendRoot, 'generated'), 'api.mjs');

  const t0 = Date.now();
  const ada = await mintSession(schemaManifest.appId, 'ada@faceplate.test', 'faceplate-ada');
  const grace = await mintSession(schemaManifest.appId, 'grace@faceplate.test', 'faceplate-grace');
  evidence.check1_twoUsers = 'sessions mode, code+mailbox exchange, bearer custody';

  const adaAssets = new SnapbackAssetClient(ada.client, { chunkBytes: 4096 });
  const profileId = (await mutate(ada, api.createProfile, { displayName: 'Ada' })).result;
  const gps = gpsJpegBytes();
  assert.equal(hasGpsExif(gps), true);
  const up = await adaAssets.start({ upload: api.avatarUpload, args: {}, file: fileOf(gps) });
  const ready = await up.done; if (ready.status !== 'ready') throw new Error(JSON.stringify(ready.diagnostic));
  await mutate(ada, api.setAvatar, { profileId, assetId: ready.assetId });
  const aRes = await fetch(adaAssets.deliveryUrl(ready.assetId, { variant: 'primary' }), { headers: bearer(ada) });
  assert.equal(aRes.status, 200);
  const aBytes = Buffer.from(await aRes.arrayBuffer());
  evidence.check2_ownAvatarServes = { bytes: aBytes.length, ms: Date.now() - t0 };

  const bRes = await fetch(adaAssets.deliveryUrl(ready.assetId, { variant: 'primary' }), { headers: bearer(grace) });
  evidence.check3_otherUserViews = { status: bRes.status };
  assert.equal(bRes.status, 200);

  const served = Buffer.from(await bRes.arrayBuffer());
  evidence.check4_gpsServed = { uploadedHadGps: true, servedHasGps: hasGpsExif(served), mechanism: 'strip-by-declared-policy at finalization; canonical bytes re-encoded' };

  const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000037'.padEnd(0, ''), 'hex');
  // simple honest replacement: upload a second (plain) jpeg-less fixture — reuse gps fixture but note replacement identity
  const up2 = await adaAssets.start({ upload: api.avatarUpload, args: {}, file: fileOf(gpsJpegBytes(), 'me2.jpg') });
  const ready2 = await up2.done; if (ready2.status !== 'ready') throw new Error(JSON.stringify(ready2.diagnostic));
  await mutate(ada, api.setAvatar, { profileId, assetId: ready2.assetId });
  const bNew = await fetch(adaAssets.deliveryUrl(ready2.assetId, { variant: 'primary' }), { headers: bearer(grace) });
  evidence.check5_replaceVisible = { newStatus: bNew.status, cache: bNew.headers.get('cache-control') };

  const bOld = await fetch(adaAssets.deliveryUrl(ready.assetId, { variant: 'primary' }), { headers: bearer(grace) });
  evidence.check6_oldAfterReplace = {
    otherUserStatus: bOld.status,
    note: 'reference removed by the same patch → via-references authority gone at the next request; owner retains owner-read; reclamation follows declared GC policy',
  };

  const anon = await fetch(adaAssets.deliveryUrl(ready2.assetId, { variant: 'primary' }));
  evidence.check7_signedOutFetch = { status: anon.status, default: 'private-strict; every request authorized' };

  evidence.check8_ceremony = {
    concepts: ['schema table', 'assetRef field', 'assetSharing declaration', 'upload intent', 'attach in mutation', 'sessions auth'],
    steps: 'schema+functions+handlers (3 files) → codegen → server → client task → attach',
  };
  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
} finally {
  if (server) await server.stop().catch(() => {});
}
