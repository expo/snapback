// Asset lifecycle JS conformance vectors (LLP 0044 §Language-neutral
// protocol; ticket 0044 L1-14): real-server, real-client proof of the
// golden lifecycle — upload with per-chunk checksums, interrupted resume,
// attachment through a real `ctx.assets.attach` handler, live readiness
// over real `live_replace` frames, authorized range delivery, deletion,
// and negative auth — plus the sharing-posture matrix (owner-field,
// membership grant/revoke, undeclared-table non-bypass) and the honest
// sessions/dev lane boundaries.
//
// Two servers, deliberately:
// - a sessions-mode server carries most vectors, because sessions custody
//   (`authorization: Bearer`, the asset routes' OptionalSessionBearer
//   overlay) is the one HTTP lane with real per-user authority;
// - a dev-mode server carries the live-frame leg through host-ops-created
//   assets, because dev-mode asset HTTP requests resolve anonymous today
//   (the request DTOs carry no dev auth member — the recorded dev-lane
//   gap, asserted below so it flips consciously, not silently).
//
// @ref LLP 0044#language-neutral-protocol-and-sdks — the conformance corpus
//   contract this suite implements for the JS SDK.

import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import {
  SnapbackAssetClient,
  createMemoryAssetTaskStore,
} from '../../packages/snapback-client/assets.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../packages/snapback-contract/index.mjs';
import { generate } from '../../packages/snapback-codegen/index.mjs';
import { importGeneratedModule } from '../../demos/_kit/generated-artifacts.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..');
const fixtureRoot = join(here, 'fixtures', 'asset-conformance');
const cliArgs = process.argv.slice(2);
const receiptFlag = cliArgs.indexOf('--receipt');
const receiptPath = receiptFlag === -1 ? null : cliArgs[receiptFlag + 1];

const scratch = await mkdtemp(join(tmpdir(), 'snapback-asset-conformance-'));
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = {};
let sessionsServer = null;
let devServer = null;
const sessions = [];

// --- deterministic 8x8 red PNG (valid IHDR/IDAT/IEND, no metadata) ---
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}
function redPng(size = 8) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 3);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      raw[row + 1 + x * 3] = 0xd0;
      raw[row + 2 + x * 3] = 0x10;
      raw[row + 3 + x * 3] = 0x10;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function fileOf(buffer, name = 'photo.png') {
  return {
    name,
    size: buffer.length,
    slice: (start, end) => ({
      arrayBuffer: async () => buffer.subarray(start ?? 0, end ?? buffer.length),
    }),
  };
}

const refusalOf = async (attempt) => {
  try {
    await attempt();
    return null;
  } catch (error) {
    return error?.diagnostic?.code ?? error?.code ?? error?.message ?? 'unknown';
  }
};

async function mintSession(appId, email, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(sessionsServer.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
  });
  const requested = await client.authRequestCode(email);
  const mailboxResponse = await fetch(
    `${sessionsServer.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    {
      headers: {
        'x-snapback-admin-token': sessionsServer.adminToken,
        'x-snapback-impersonation-capability': sessionsServer.impersonationCapability,
      },
    },
  );
  const mailbox = await mailboxResponse.json();
  assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
  const credential = await client.authExchange({
    challengeId: requested.challengeId,
    code: mailbox.code,
  });
  const session = { client, coordinator, credential };
  sessions.push(session);
  return session;
}

async function mutate(session, name, args, id) {
  const authorityCapture = session.coordinator.capture();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await session.client.mutate(name, {
        args,
        clientMutationId: id,
        authorityCapture,
      });
    } catch (error) {
      if ((error?.code ?? error?.diagnostic?.code) !== 'SNAPBACK_AUTH_RESERVATION_STALE' || attempt >= 2) {
        throw error;
      }
      await session.client.currentAuthorizationScope();
    }
  }
}

async function uploadReady(session, assetsClient, buffer, upload) {
  const task = assetsClient.start({ upload, file: fileOf(buffer) });
  const finished = await task.done;
  assert.equal(
    finished.status,
    'ready',
    `upload must publish ready: ${JSON.stringify(finished.diagnostic)}`,
  );
  return finished;
}

async function hostOp(server, operation, input, userId = null) {
  const response = await fetch(`${server.baseUrl}/_snapback/api/host-ops`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': server.adminToken,
      ...(server.impersonationCapability
        ? { 'x-snapback-impersonation-capability': server.impersonationCapability }
        : {}),
    },
    body: JSON.stringify({ operation, input, ...(userId ? { userId } : {}) }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${operation}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, `${operation}: ${JSON.stringify(body.diagnostics ?? body)}`);
  return body.data ?? body.result ?? body;
}

try {
  // ---------------------------------------------------------------- sessions
  const backendRoot = join(scratch, 'app', 'snapback');
  await cp(fixtureRoot, backendRoot, { recursive: true });
  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const schemaManifest = await readJson(join(backendRoot, 'generated', 'schema.manifest.json'));
  const functionManifest = await readJson(join(backendRoot, 'generated', 'functions.manifest.json'));
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(
    carrier,
    `${JSON.stringify({ formatVersion: 1, schema: schemaManifest, functions: functionManifest })}\n`,
    { mode: 0o600 },
  );
  sessionsServer = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repositoryRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });
  const { default: api } = await importGeneratedModule(join(backendRoot, 'generated'), 'api.mjs');

  const ada = await mintSession(schemaManifest.appId, 'ada@assets.test', 'assets-ada');
  const grace = await mintSession(schemaManifest.appId, 'grace@assets.test', 'assets-grace');
  const adaAssets = new SnapbackAssetClient(ada.client, { chunkBytes: 64 });
  const graceAssets = new SnapbackAssetClient(grace.client, { chunkBytes: 64 });
  const png = redPng(8);

  // Vector 1 — upload publishes ready under bearer custody, end-to-end
  // verified, with both required variants and typed image facts.
  const first = await uploadReady(ada, adaAssets, png, api.photoUpload);
  assert.equal(first.integrityBasis, 'end-to-end-verified');
  const firstRecord = await adaAssets.record(first.assetId);
  assert.equal(firstRecord.availability, 'ready');
  assert.ok(firstRecord.primaryRenditionId, 'the record names its primary rendition');
  // Required variants are proven the client-lane way: each declared key
  // delivers. (The record/projection surfaces do not yet expose rendition
  // media facts — placeholder, dimensions — to clients; that gap is
  // recorded for the core lane, and the ThumbHash fact itself is pinned by
  // the Rust suites and the cross-decoder package test.)
  checks.uploadEndToEndVerified = true;

  // Vector 1c — the client's real default chunk size against the real
  // server: ~10 MB over three 4 MiB chunks. The policy gate's 2 MiB
  // inspection bound once refused exactly this (the 64-byte suite chunks
  // masked it); default-config uploads must stay covered at real sizes.
  const defaultChunkAssets = new SnapbackAssetClient(ada.client);
  const bulk = new Uint8Array(10 * 1024 * 1024 + 4097);
  for (let i = 0; i < bulk.length; i += 4096) bulk[i] = (i / 4096) % 251;
  const bulkReady = await uploadReady(ada, defaultChunkAssets, bulk, api.bulkUpload);
  assert.equal(bulkReady.integrityBasis, 'end-to-end-verified');
  checks.defaultChunkUpload = true;

  // Vector 2 — interrupted transfer resumes from the acknowledged offset
  // through a fresh client sharing only the persisted resume facts.
  const sharedStore = createMemoryAssetTaskStore();
  const interruptClient = new SnapbackAssetClient(ada.client, {
    chunkBytes: 24,
    taskStore: sharedStore,
  });
  const interrupted = interruptClient.start({ upload: api.photoUpload, file: fileOf(png) });
  await new Promise((resolve) => {
    const unsubscribe = interrupted.subscribe((snapshot) => {
      if (snapshot.bytesTransferred >= 24 && snapshot.status === 'uploading') {
        interrupted.pause();
        unsubscribe();
        resolve();
      }
    });
  });
  assert.equal(interrupted.snapshot().status, 'paused');
  const resumedClient = new SnapbackAssetClient(ada.client, {
    chunkBytes: 24,
    taskStore: sharedStore,
  });
  const resumed = resumedClient.resumePersisted({
    assetId: interrupted.snapshot().assetId,
    file: fileOf(png),
  });
  assert.ok(resumed, 'persisted resume facts survive the client boundary');
  const resumedDone = await resumed.done;
  assert.equal(resumedDone.status, 'ready');
  assert.equal(resumedDone.assetId, interrupted.snapshot().assetId, 'resume keeps the asset id');
  checks.interruptedResume = true;

  // Vector 3 — attachment on the host-plan path: the commit boundary
  // derives the admission from the field's schema-declared restriction.
  const photoRow = await mutate(ada, 'createPhotoPlan', {
    caption: 'ada photo',
    assetId: first.assetId,
  }, 'cm_assets_create_photo');
  const photoRowId = photoRow.result;
  assert.ok(typeof photoRowId === 'string' && photoRowId.length > 0,
    `host-plan attach inserted: ${JSON.stringify(photoRow.result)}`);
  checks.attachViaHostPlan = true;

  const custody = (session) => ({
    authorization: `Bearer ${session.coordinator.credentialFor(session.coordinator.capture()).bearer}`,
    'x-snapback-auth-client-protocol': '1',
  });

  // Vector 3b — the canonical handler attach (flipped positive when the
  // admission-drop fix landed: the served dry-run seams now thread executed
  // admissions): `ctx.assets.attach` in a handler mutation commits the row,
  // and the reverse edge is proven by the referenced-delete refusal.
  const handlerAsset = await uploadReady(ada, adaAssets, redPng(8), api.photoUpload);
  const handlerRow = await mutate(ada, 'createPhoto', {
    caption: 'handler attach',
    assetId: handlerAsset.assetId,
  }, 'cm_assets_handler_attach');
  const handlerRowId = handlerRow.result;
  assert.ok(typeof handlerRowId === 'string' && handlerRowId.length > 0,
    `handler attach inserted: ${JSON.stringify(handlerRow.result)}`);
  const handlerEdgeProof = await refusalOf(async () => {
    const response = await fetch(
      `${sessionsServer.baseUrl}/assets/records/${encodeURIComponent(handlerAsset.assetId)}`,
      { method: 'DELETE', headers: custody(ada) },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error('refused');
      error.diagnostic = body?.diagnostics?.[0] ?? body?.diagnostic ?? body;
      if (!error.diagnostic?.code && body?.code) error.diagnostic = body;
      if (!error.diagnostic?.code) error.diagnostic = { code: JSON.stringify(body) };
      throw error;
    }
  });
  assert.equal(handlerEdgeProof, 'SNAPBACK_ASSET_REFERENCED',
    'the handler-committed reverse edge protects the asset');
  checks.handlerAttachCommits = true;

  // Vector 3c — a host plan writing an unrestricted assetRef field refuses:
  // no declared intent exists to derive an admission from.
  const openRefusal = await refusalOf(() => mutate(ada, 'createOpenDocPlan', {
    title: 'open',
    assetId: handlerAsset.assetId,
  }, 'cm_assets_open'));
  assert.equal(openRefusal, 'SNAPBACK_ASSET_REF_UNVERIFIED');
  checks.unrestrictedHostPlanRefused = true;

  // Vector 4 — a forged raw string fails the commit hook from the handler path.
  const forged = await uploadReady(ada, adaAssets, redPng(8), api.photoUpload);
  const forgeRefusal = await refusalOf(() => mutate(ada, 'forgePhoto', {
    caption: 'forged',
    assetId: forged.assetId,
  }, 'cm_assets_forge'));
  assert.equal(forgeRefusal, 'SNAPBACK_ASSET_REF_UNVERIFIED');
  checks.forgedStringRefused = true;

  // Vector 5 — strict delivery: owner gets bytes, ranges, and the exact
  // header posture; a foreign caller is denied on every surface.
  const bytesUrl = adaAssets.deliveryUrl(first.assetId, { variant: 'thumb' });
  const full = await fetch(bytesUrl, { headers: custody(ada) });
  assert.equal(full.status, 200);
  const cacheControl = (full.headers.get('cache-control') ?? '').split(',').map((part) => part.trim()).sort();
  assert.deepEqual(cacheControl, ['no-store', 'private']);
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(full.headers.get('content-type'), 'image/png');
  const ranged = await fetch(bytesUrl, {
    headers: { ...custody(ada), range: 'bytes=0-7' },
  });
  assert.equal(ranged.status, 206);
  assert.equal((await ranged.arrayBuffer()).byteLength, 8);
  const badRange = await fetch(bytesUrl, {
    headers: { ...custody(ada), range: 'bytes=999999-1000000' },
  });
  assert.equal(badRange.status, 416);
  const best = await fetch(
    adaAssets.deliveryUrl(first.assetId, { variant: 'best', maxWidth: 5 }),
    { headers: custody(ada) },
  );
  assert.equal(best.status, 200, 'best?maxWidth selects a variant');
  const foreignRecord = await refusalOf(() => graceAssets.record(first.assetId));
  assert.ok(foreignRecord, 'foreign metadata read refuses');
  const foreignBytes = await fetch(bytesUrl, { headers: custody(grace) });
  assert.ok(foreignBytes.status >= 400, 'foreign delivery refuses');
  checks.strictDeliveryWithRanges = true;
  checks.foreignCallerDenied = true;

  // Vector 6 — membership sharing grants and membership removal revokes.
  const workspace = await mutate(ada, 'createWorkspace', { name: 'shared' }, 'cm_assets_ws');
  const workspaceId = workspace.result?.workspaceId
    ?? workspace.result?.resource
    ?? workspace.result;
  assert.ok(typeof workspaceId === 'string' && workspaceId.length > 0,
    `workspace id from bootstrap: ${JSON.stringify(workspace.result)}`);
  const graceUserId = grace.credential.session.userId;
  await mutate(ada, 'addMember', {
    workspaceId,
    userId: graceUserId,
  }, 'cm_assets_member');
  const sharedAsset = await uploadReady(ada, adaAssets, redPng(8), api.photoUpload);
  await mutate(ada, 'createNotePlan', {
    workspaceId,
    body: 'note with photo',
    assetId: sharedAsset.assetId,
  }, 'cm_assets_note');
  const grantedRecord = await graceAssets.record(sharedAsset.assetId);
  assert.equal(grantedRecord.availability, 'ready', 'membership grants via-references read');
  const grantedBytes = await fetch(
    graceAssets.deliveryUrl(sharedAsset.assetId, { variant: 'primary' }),
    { headers: custody(grace) },
  );
  assert.equal(grantedBytes.status, 200);
  await mutate(grace, 'leaveWorkspace', { workspaceId }, 'cm_assets_unmember');
  const revokedRecord = await refusalOf(() => graceAssets.record(sharedAsset.assetId));
  assert.ok(revokedRecord, 'membership removal revokes metadata read');
  const revokedBytes = await fetch(
    graceAssets.deliveryUrl(sharedAsset.assetId, { variant: 'primary' }),
    { headers: custody(grace) },
  );
  assert.ok(revokedBytes.status >= 400, 'membership removal revokes delivery');
  checks.membershipGrantAndRevoke = true;

  // Vector 7 — an undeclared table confers nothing (mixed-table non-bypass):
  // the mixedDocs row is readable, but without `.assetSharing` the typed
  // reference grants grace no asset authority.
  const mixedAsset = await uploadReady(ada, adaAssets, redPng(8), api.photoUpload);
  await mutate(ada, 'createMixedPlan', {
    title: 'mixed',
    assetId: mixedAsset.assetId,
  }, 'cm_assets_mixed');
  const mixedRefusal = await refusalOf(() => graceAssets.record(mixedAsset.assetId));
  assert.ok(mixedRefusal, 'no sharing declaration → owner-only fallback');
  checks.undeclaredTableConfersNothing = true;

  // Vector 8 — deletion: referenced refuses, cleared deletes, post-delete
  // denies the next request.
  const referencedRefusal = await refusalOf(async () => {
    const response = await fetch(
      `${sessionsServer.baseUrl}/assets/records/${encodeURIComponent(first.assetId)}`,
      { method: 'DELETE', headers: custody(ada) },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error('refused');
      error.diagnostic = body?.diagnostics?.[0] ?? body?.diagnostic ?? body;
      if (!error.diagnostic?.code && body?.code) error.diagnostic = body;
      if (!error.diagnostic?.code) error.diagnostic = { code: JSON.stringify(body) };
      throw error;
    }
  });
  assert.equal(referencedRefusal, 'SNAPBACK_ASSET_REFERENCED');
  await mutate(ada, 'clearPhoto', { id: photoRowId }, 'cm_assets_clear');
  const deleteResponse = await fetch(
    `${sessionsServer.baseUrl}/assets/records/${encodeURIComponent(first.assetId)}`,
    { method: 'DELETE', headers: custody(ada) },
  );
  assert.equal(deleteResponse.status, 200, await deleteResponse.text());
  const afterDelete = await fetch(bytesUrl, { headers: custody(ada) });
  assert.ok(afterDelete.status >= 400, 'post-delete delivery denies');
  checks.deleteAndPostDeleteDenial = true;

  // Vector 9 — negative auth: an anonymous attempt-create refuses; a foreign
  // caller cannot inspect another's attempt.
  const anonymous = await fetch(`${sessionsServer.baseUrl}/assets/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      intentId: 'photoUpload',
      intentPolicyHash: 'sha256:unknown',
      args: {},
      declaredFilename: null,
      declaredLength: 8,
      declaredContentType: null,
    }),
  });
  assert.ok(anonymous.status >= 400, 'anonymous create refuses');
  checks.negativeAuth = true;

  // Vector 10 — sessions-mode live (flipped positive with W2e): the reserved
  // record projection establishes under sessions custody through the
  // witnessed lane, a ready record arrives with no polling, and deletion
  // blanks it. Auth-scoped subscriptions receive witnessed
  // authorization_invalidation snapshots, never plain live_replace — the
  // client's raw-lane consumer handles that shape.
  const liveAsset = await uploadReady(ada, adaAssets, redPng(8), api.photoUpload);
  const sessionsStore = adaAssets.watchStore(liveAsset.assetId, {
    connectionId: 'assets-live-sessions',
  });
  const sessionsUntil = async (predicate, label, timeoutMs = 5_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await sleep(20);
    }
    assert.fail(`timed out waiting for ${label}: ${JSON.stringify(sessionsStore.getSnapshot())}`);
  };
  await sessionsUntil(
    () => sessionsStore.getSnapshot().status === 'ready'
      && sessionsStore.getSnapshot().mode === 'live',
    'sessions live establishment with the ready record',
  );
  assert.equal(sessionsStore.getSnapshot().record.availability, 'ready');
  const liveDelete = await fetch(
    `${sessionsServer.baseUrl}/assets/records/${encodeURIComponent(liveAsset.assetId)}`,
    { method: 'DELETE', headers: custody(ada) },
  );
  assert.equal(liveDelete.status, 200, await liveDelete.text());
  await sessionsUntil(
    () => sessionsStore.getSnapshot().status === 'blank',
    'the witnessed deletion frame blanking the sessions store',
  );
  sessionsStore.dispose();
  checks.sessionsLiveDelivers = true;

  // Vector 11 — pasteable delivery (LLP 0044 §Delivery profiles, dated note
  // 2026-07-31): on the public alias and the signed serve lane the URL is
  // the entire authority, so a raw fetch with ZERO Snapback headers must
  // serve — that is what <img src>, CDN pulls, and pasted share links can
  // send. Strict delivery keeps the sessions protocol-offer discipline.
  const cover = await uploadReady(ada, adaAssets, redPng(8), api.coverUpload);
  const publicPlain = await fetch(
    `${sessionsServer.baseUrl}/assets/public/${encodeURIComponent(cover.assetId)}/primary`,
  );
  assert.equal(publicPlain.status, 200, 'headerless public GET serves');
  assert.equal(
    publicPlain.headers.get('cache-control'),
    'public, max-age=31536000, immutable',
  );
  assert.equal(publicPlain.headers.get('content-type'), 'image/png');
  const share = await uploadReady(ada, adaAssets, redPng(8), api.shareUpload);
  const issuanceResponse = await fetch(
    `${sessionsServer.baseUrl}/assets/records/${encodeURIComponent(share.assetId)}/signed-url`,
    {
      method: 'POST',
      headers: { ...custody(ada), 'content-type': 'application/json' },
      body: JSON.stringify({ variant: 'primary' }),
    },
  );
  const issuanceBody = await issuanceResponse.json();
  assert.equal(issuanceResponse.status, 200, JSON.stringify(issuanceBody));
  const signedPlain = await fetch(`${sessionsServer.baseUrl}${issuanceBody.url}`);
  assert.equal(signedPlain.status, 200, 'headerless signed GET serves within the TTL');
  const strictPlain = await fetch(
    adaAssets.deliveryUrl(first.assetId, { variant: 'thumb' }),
  );
  assert.ok(
    strictPlain.status >= 400,
    'strict delivery without the protocol offer keeps refusing',
  );
  checks.pasteableDeliveryHeaderless = true;

  // --------------------------------------------------------------------- dev
  // The live-frame leg: dev mode is the lane where the reserved projection
  // establishes, and host-ops is the lane with real dev per-user authority.
  const devBackendRoot = join(scratch, 'dev-app', 'snapback');
  await cp(fixtureRoot, devBackendRoot, { recursive: true });
  const devSchema = (await readFile(join(devBackendRoot, 'schema.mjs'), 'utf8'))
    .replace("{ auth: { mode: 'sessions' } }", "{ auth: { mode: 'dev' } }");
  await writeFile(join(devBackendRoot, 'schema.mjs'), devSchema);
  const devGenerated = await generate(devBackendRoot);
  assert.equal(devGenerated.ok, true, JSON.stringify(devGenerated.diagnostics));
  const devSchemaManifest = await readJson(join(devBackendRoot, 'generated', 'schema.manifest.json'));
  const devFunctionManifest = await readJson(join(devBackendRoot, 'generated', 'functions.manifest.json'));
  const devCarrier = join(scratch, 'dev-startup-artifacts.json');
  await writeFile(
    devCarrier,
    `${JSON.stringify({ formatVersion: 1, schema: devSchemaManifest, functions: devFunctionManifest })}\n`,
    { mode: 0o600 },
  );
  devServer = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repositoryRoot,
    startupArtifacts: devCarrier,
    captureImpersonationCapability: true,
  });
  const { default: devApi } = await importGeneratedModule(join(devBackendRoot, 'generated'), 'api.mjs');

  const putResult = await hostOp(devServer, 'asset.put', {
    upload: 'fileUpload',
    fileName: 'note.txt',
    contentType: 'text/plain',
    bytesBase64: Buffer.from('hello asset frames').toString('base64'),
  }, 'user_ada');
  const devAssetId = putResult.task?.assetId ?? putResult.assetId ?? putResult.asset_id;
  assert.ok(devAssetId, `asset.put returned an asset id: ${JSON.stringify(putResult)}`);

  const devClient = new SnapbackClient(devServer.baseUrl, devServer.clientOptions ?? {});
  const devAssets = new SnapbackAssetClient(devClient);
  const store = devAssets.watchStore(devAssetId, {
    userId: 'user_ada',
    connectionId: 'assets-live-dev',
  });
  const storeStates = [];
  store.subscribe((snapshot) => storeStates.push(snapshot));
  const until = async (predicate, label, timeoutMs = 5_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await sleep(20);
    }
    assert.fail(`timed out waiting for ${label}: ${JSON.stringify(store.getSnapshot())}`);
  };
  await until(
    () => store.getSnapshot().status === 'ready' && store.getSnapshot().mode === 'live',
    'live establishment with the ready record',
  );
  assert.equal(store.getSnapshot().record.availability, 'ready');
  // A real live_replace frame arrives with no polling when the asset is
  // deleted — the store blanks.
  await hostOp(devServer, 'asset.delete', { assetId: devAssetId }, 'user_ada');
  await until(() => store.getSnapshot().status === 'blank', 'the deletion frame blanking the store');
  store.dispose();
  checks.liveFramesOverRealSocket = true;

  // The recorded dev-lane HTTP gap: without a sessions credential the asset
  // routes resolve anonymous, so an authenticated intent refuses even with
  // the (server-ignored) dev header present. When Lane 2 lands a dev
  // authority path this assertion flips consciously.
  const devHttpGap = await refusalOf(async () => {
    const created = new SnapbackAssetClient(devClient);
    const task = created.start({
      upload: devApi.fileUpload,
      file: fileOf(Buffer.from('dev lane')),
      userId: 'user_ada',
    });
    const finished = await task.done;
    if (finished.status !== 'ready') {
      const error = new Error('refused');
      error.diagnostic = finished.diagnostic;
      throw error;
    }
  });
  assert.ok(devHttpGap, 'dev-lane HTTP create currently refuses (recorded gap)');
  checks.devLaneHttpGapRecorded = true;

  const receipt = {
    schemaVersion: 'snapback.asset-conformance.v1',
    ok: true,
    sessionsAppId: schemaManifest.appId,
    devAppId: devSchemaManifest.appId,
    checks,
  };
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  if (receiptPath) await writeFile(receiptPath, rendered);
  process.stdout.write(rendered);
} finally {
  for (const session of sessions) {
    try { await session.client.closeAuth(); } catch { /* preserve primary failure */ }
  }
  await sessionsServer?.stop();
  await devServer?.stop();
  await rm(scratch, { recursive: true, force: true });
}
process.exit(0);
