// Party Wall / Snapback arm driver (LLP 0139 App B). Boots a sessions-mode
// server from this repository, runs the frozen checklist, prints evidence.
// The backend is the flagship demo's (demos/party-wall), copied verbatim
// minus seeds — this app IS that demo, which the diary discloses.
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
  const exchanged = await client.authExchange({ challengeId: requested.challengeId, code: mailbox.code });
  return { client, coordinator, userId: exchanged.session.userId };
}
const mutate = (s, name, args) => s.client.mutate(name, { args, clientMutationId: `pw-${Math.random().toString(36).slice(2)}`, authorityCapture: s.coordinator.capture() });
const fileOf = (buffer, name = 'photo.jpg', type = 'image/jpeg') => ({
  name, type, size: buffer.length,
  slice: (start, end) => ({ arrayBuffer: async () => buffer.subarray(start, end) }),
  arrayBuffer: async () => buffer,
});
const bearer = (s) => ({ authorization: `Bearer ${s.coordinator.credentialFor(s.coordinator.capture()).bearer}`, 'x-snapback-auth-client-protocol': '1' });
const waitFor = (predicate, label, timeoutMs = 15_000) => new Promise((resolve, reject) => {
  const start = Date.now();
  const tick = () => {
    const value = predicate();
    if (value) return resolve({ value, ms: Date.now() - start });
    if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${label}`));
    setTimeout(tick, 25);
  };
  tick();
});

try {
  const scratch = await mkdtemp(join(tmpdir(), 'party-wall-snapback-'));
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

  const ada = await mintSession(schemaManifest.appId, 'ada@party.test', 'pw-ada');
  const grace = await mintSession(schemaManifest.appId, 'grace@party.test', 'pw-grace');
  const mallory = await mintSession(schemaManifest.appId, 'mallory@party.test', 'pw-mallory');
  evidence.check1_identities = 'sessions mode; three bearer-custody identities (host, member, outsider)';

  const eventId = (await mutate(ada, api.createEvent, { title: 'Bakeoff Bash', emoji: '🎉', startsAt: 1754000000000, hostName: 'Ada' })).result;
  await mutate(ada, api.addGuest, { eventId, userId: grace.userId });

  // Check 2 — B subscribes FIRST, stream transport, poll fallback disabled.
  const feedLog = [];
  const authorizationEvents = [];
  const wall = await grace.client.liveQuery(api.eventWall, {
    connectionId: 'pw-grace-wall',
    args: { eventId },
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate: (rows) => feedLog.push({ at: Date.now(), captions: rows.map((r) => r.caption) }),
    onAuthorizationBoundary: (kind) => authorizationEvents.push({ at: Date.now(), kind: String(kind ?? 'boundary') }),
    authorityCapture: grace.coordinator.capture(),
  });

  const adaAssets = new SnapbackAssetClient(ada.client, { chunkBytes: 8192 });
  const graceAssets = new SnapbackAssetClient(grace.client, { chunkBytes: 8192 });
  const posted = [];
  for (let i = 0; i < 5; i += 1) {
    const task = adaAssets.start({ upload: api.photoUpload, args: {}, file: fileOf(gpsJpegBytes(), `burst-${i}.jpg`) });
    const ready = await task.done;
    assert.equal(ready.status, 'ready', JSON.stringify(ready.diagnostic ?? null));
    const postedAt = Date.now();
    await mutate(ada, api.createPost, { eventId, caption: `photo-${i}`, authorName: 'Ada', assetId: ready.assetId });
    const seen = await waitFor(
      () => feedLog.find((f) => f.captions.includes(`photo-${i}`)),
      `feed frame for photo-${i}`,
    );
    posted.push({ caption: `photo-${i}`, assetId: ready.assetId, pushMsFromPost: seen.value.at - postedAt });
  }
  // Thumbnail-readiness liveness, no polling: grace watches the last photo's
  // record over the reserved projection and sees the required thumb ready.
  const watch = await graceAssets.watchStore(posted[4].assetId);
  const thumbReady = await waitFor(
    () => {
      const record = watch.getSnapshot()?.record ?? watch.getSnapshot();
      return (record?.renditions ?? []).some((r) => r.variant === 'thumb' && r.ready) ? record : null;
    },
    'thumb readiness frame',
  );
  watch.dispose?.();
  evidence.check2_liveBurst = {
    mechanism: 'WebSocket live_replace frames (transport: stream, fallbackToPoll: false); readiness via the reserved _snapback.assetRecord projection over the same socket',
    perPhotoPushMs: posted.map((p) => p.pushMsFromPost),
    thumbReadinessObserved: Boolean(thumbReady.value),
    clientPolls: 0,
  };

  // Check 3 — outsider and signed-out.
  const malloryWall = await mallory.client.liveQuery(api.eventWall, {
    connectionId: 'pw-mallory-wall', args: { eventId },
    transport: 'stream', fallbackToPoll: false,
    authorityCapture: mallory.coordinator.capture(),
  });
  const thumbUrl = (s, assetId) => new SnapbackAssetClient(s.client).deliveryUrl(assetId, { variant: 'thumb' });
  const outsiderFetch = await fetch(thumbUrl(mallory, posted[0].assetId), { headers: bearer(mallory) });
  const anonymousFetch = await fetch(thumbUrl(mallory, posted[0].assetId));
  evidence.check3_outsider = {
    feedRows: malloryWall.rows.length,
    directFetchStatus: outsiderFetch.status,
    signedOutStatus: anonymousFetch.status,
    posture: 'membership-gated live query; private-strict per-request authorization on bytes',
  };
  await malloryWall.dispose?.();

  // Check 5 — delete propagates to the member's live view.
  const wallRows = await wall.poll();
  const doomed = wallRows.find((r) => r.caption === 'photo-0');
  const deletedAt = Date.now();
  await mutate(ada, api.deletePost, { postId: doomed._id });
  const dropFrame = await waitFor(
    () => feedLog.find((f) => f.at > deletedAt && !f.captions.includes('photo-0')),
    'post-delete frame without photo-0',
  );
  const deletedThumb = await fetch(thumbUrl(grace, posted[0].assetId), { headers: bearer(grace) });
  evidence.check5_delete = {
    pushMsFromDelete: dropFrame.value.at - deletedAt,
    memberBytesAfter: deletedThumb.status,
    bytesFate: 'unreferenced photo enters reference GC (declared graceMs 61s) and is reclaimed by the sweep; receipts retained',
  };

  // Check 6 — GPS on a served feed thumbnail.
  const gpsThumb = await fetch(thumbUrl(grace, posted[1].assetId), { headers: bearer(grace) });
  assert.equal(gpsThumb.status, 200);
  const thumbBytes = Buffer.from(await gpsThumb.arrayBuffer());
  evidence.check6_gps = { uploadedHadGps: true, servedThumbHasGps: hasGpsExif(thumbBytes) };

  // Check 4 — revocation propagation to the live view.
  const leftAt = Date.now();
  await mutate(grace, api.leaveEvent, { eventId });
  const blanked = await waitFor(
    () => feedLog.find((f) => f.at > leftAt && f.captions.length === 0) ?? authorizationEvents.find((e) => e.at > leftAt),
    'post-leave blank/boundary',
  );
  const revokedThumb = await fetch(thumbUrl(grace, posted[1].assetId), { headers: bearer(grace) });
  evidence.check4_revocation = {
    mechanism: 'authorization invalidation over the witnessed lane blanks the membership-gated subscription; delivery re-authorizes per request',
    pushMsFromLeave: blanked.value.at - leftAt,
    bytesAfterLeave: revokedThumb.status,
  };
  await wall.dispose?.();

  evidence.check7_authorizationModel = {
    artifacts: 'eventMembers .membership declaration (roles/transitions) + .assetSharing({kind: membership}) on events and posts + membership-gated defineLiveQuery',
    photoReadAuthority: 'via-references through the sharing declaration — no handler code re-implements it',
  };
  evidence.check8_ceremony = {
    concepts: ['membership table + transitions', 'assetRef field', 'assetSharing(membership)', 'upload intent', 'attach in mutation', 'membership-gated live query', 'sessions auth'],
    note: 'backend reused verbatim from the flagship demo (3 authored files); disclosed in the diary',
  };
  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
} finally {
  if (server) await server.stop().catch(() => {});
}
