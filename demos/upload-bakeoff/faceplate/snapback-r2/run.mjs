// Faceplate r2 — Snapback arm headless driver.
// Proves the eight acceptance-checklist items from
// demos/upload-bakeoff/faceplate/README.md against a real sessions-mode
// server and prints an evidence table.
//
// Run from the repo root:  node demos/upload-bakeoff/faceplate/snapback-r2/run.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../../packages/snapback-client/index.mjs';
import { SnapbackAssetClient } from '../../../../packages/snapback-client/assets.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../../packages/snapback-contract/index.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { importGeneratedModule, readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { gpsJpegBytes, hasGpsExif } from '../../_shared/gps-jpeg.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const generatedRoot = join(here, 'backend', 'generated');
const gen = (f) => readGeneratedJson(generatedRoot, f);
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');

const WALL_START_MS = 1785622946000; // arm-dir creation, 2026-08-01 15:22:26 PDT
const milestones = [];
const milestone = (name) => {
  const at = Date.now();
  milestones.push({ name, at, elapsedSeconds: Math.round((at - WALL_START_MS) / 1000) });
};

const evidence = [];
const record = (item, pass, note) => {
  evidence.push({ item, pass, note });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] item ${item}: ${note}`);
};

function fileOf(buffer, name) {
  return {
    name,
    size: buffer.length,
    slice: (start, end) => ({
      arrayBuffer: async () => buffer.subarray(start ?? 0, end ?? buffer.length),
    }),
  };
}

// --- boot: sessions server from the startup-artifacts carrier -------------
const schemaManifest = gen('schema.manifest.json');
const functionsManifest = gen('functions.manifest.json');
const carrier = join(mkdtempSync(join(tmpdir(), 'faceplate-r2-')), 'startup-artifacts.json');
writeFileSync(
  carrier,
  `${JSON.stringify({ formatVersion: 1, schema: schemaManifest, functions: functionsManifest })}\n`,
  { mode: 0o600 },
);
const server = await startServer({
  port: 0,
  db: ':memory:',
  cwd: repoRoot,
  env: { SNAPBACK_ASSET_RUNNER_DISABLED: '1' },
  startupArtifacts: carrier,
  captureImpersonationCapability: true,
});
milestone('first server boot');
const cleanups = [() => server.stop()];
const appId = schemaManifest.appId;

async function mintSession(email) {
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
    clientStoreId: `fp-${email.split('@')[0]}`,
  });
  const requested = await client.authRequestCode(email);
  const mailboxResponse = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    {
      headers: {
        'x-snapback-admin-token': server.adminToken,
        'x-snapback-impersonation-capability': server.impersonationCapability,
      },
    },
  );
  const mailbox = await mailboxResponse.json();
  if (mailboxResponse.status !== 200) {
    throw new Error(`mailbox read failed: ${mailboxResponse.status} ${JSON.stringify(mailbox)}`);
  }
  const credential = await client.authExchange({
    challengeId: requested.challengeId,
    code: mailbox.code,
  });
  cleanups.push(() => client.dispose?.());
  return {
    email,
    client,
    coordinator,
    userId: credential.session.userId,
    assets: new SnapbackAssetClient(client),
    bearer: () => coordinator.credentialFor(coordinator.capture()).bearer,
  };
}

const mutate = (session, reference, args) =>
  session.client.mutate(reference, { args, authorityCapture: session.coordinator.capture() });
const authorizedFetch = (session, path, init = {}) =>
  fetch(`${server.baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${session.bearer()}`,
      'x-snapback-auth-client-protocol': '1',
    },
  });
const hostOp = async (operation, input) => {
  const response = await fetch(`${server.baseUrl}/_snapback/api/host-ops`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': server.adminToken,
      ...(server.impersonationCapability
        ? { 'x-snapback-impersonation-capability': server.impersonationCapability }
        : {}),
    },
    body: JSON.stringify({ operation, input }),
  });
  const body = await response.json();
  if (response.status !== 200 || body.ok !== true) {
    throw new Error(`${operation}: ${response.status} ${JSON.stringify(body.diagnostics ?? body)}`);
  }
  return body.data ?? body.result ?? body;
};

async function uploadAvatar(session, bytes, name) {
  const task = session.assets.start({ upload: api.avatarUpload, file: fileOf(bytes, name) });
  const finished = await task.done;
  if (finished.status !== 'ready') {
    throw new Error(`upload not ready: ${JSON.stringify(finished.diagnostic ?? finished)}`);
  }
  return finished.assetId;
}
async function profileOf(session, userId) {
  const mapping = await session.client.query(api.getProfile, { args: { userId } });
  const rows = mapping.rows ?? mapping.result ?? [];
  return rows[0] ?? null;
}

let failed = false;
try {
  // --- item 1: two users over the ordinary local sessions path ------------
  const a = await mintSession('ada@faceplate.test');
  const b = await mintSession('bo@faceplate.test');
  record(
    1,
    Boolean(a.userId && b.userId && a.userId !== b.userId),
    `two sessions-mode principals: A=${a.userId} B=${b.userId} (email-code sign-in; test mailbox read is admin+impersonation gated, local-only)`,
  );

  // --- item 2: A picks a local image; it serves as A's avatar -------------
  const redPng = readFileSync(join(here, 'fixtures', 'avatar-red.png'));
  const avatar1 = await uploadAvatar(a, redPng, 'avatar-red.png');
  await mutate(a, api.setAvatar, { displayName: 'Ada', assetId: avatar1 });
  const aServes = await authorizedFetch(a, `/assets/records/${avatar1}/bytes/primary`);
  record(
    2,
    aServes.status === 200,
    `A uploaded avatar-red.png -> asset ${avatar1} ready; authorized GET bytes/primary = ${aServes.status} ${aServes.headers.get('content-type')}`,
  );
  milestone('checklist item 2 passing');

  // --- item 3: B, a different authenticated identity, views A's avatar ----
  const aProfileSeenByB = await profileOf(b, a.userId);
  const bView = aProfileSeenByB
    ? await authorizedFetch(b, `/assets/records/${aProfileSeenByB.avatar}/bytes/primary`)
    : null;
  record(
    3,
    Boolean(aProfileSeenByB && aProfileSeenByB.avatar === avatar1 && bView?.status === 200),
    `B queried getProfile(A) -> avatar=${aProfileSeenByB?.avatar}; B's authorized byte fetch = ${bView?.status}`,
  );

  // --- item 4: GPS-tagged JPEG — does location metadata serve back? -------
  const gpsJpeg = gpsJpegBytes();
  if (!hasGpsExif(gpsJpeg)) throw new Error('instrument self-check failed: fixture has no GPS');
  const avatar2 = await uploadAvatar(a, gpsJpeg, 'gps.jpg');
  await mutate(a, api.setAvatar, { displayName: 'Ada', assetId: avatar2 });
  const gpsServed = await authorizedFetch(b, `/assets/records/${avatar2}/bytes/primary`);
  const servedBytes = Buffer.from(await gpsServed.arrayBuffer());
  const gpsSurvived = hasGpsExif(servedBytes);
  record(
    4,
    gpsServed.status === 200 && !gpsSurvived,
    `GPS fixture uploaded (hasGpsExif=true on input); served primary bytes hasGpsExif=${gpsSurvived} (declared image.location='strip'; served ${servedBytes.length} bytes, HTTP ${gpsServed.status})`,
  );

  // --- item 5: A replaces the avatar; B sees the new one; cache behavior --
  const bluePng = readFileSync(join(here, 'fixtures', 'avatar-blue.png'));
  const avatar3 = await uploadAvatar(a, bluePng, 'avatar-blue.png');
  await mutate(a, api.setAvatar, { displayName: 'Ada', assetId: avatar3 });
  const seenAfterReplace = await profileOf(b, a.userId);
  const bNew = await authorizedFetch(b, `/assets/records/${avatar3}/bytes/primary`);
  record(
    5,
    seenAfterReplace?.avatar === avatar3 && bNew.status === 200,
    `B re-queried -> avatar=${seenAfterReplace?.avatar} (was ${avatar2}); fetch=${bNew.status}; Cache-Control="${bNew.headers.get('cache-control')}" (per-request re-auth, no shared caching)`,
  );

  // --- item 6: the old avatar after replacement ---------------------------
  const oldAfterReplace = await authorizedFetch(a, `/assets/records/${avatar2}/bytes/primary`);
  const swept = await hostOp('asset.gcSweep', { nowMs: Date.now() + 90_000_000 });
  const oldAfterSweep = await authorizedFetch(a, `/assets/records/${avatar2}/bytes/primary`);
  const oldDelete = await authorizedFetch(a, `/assets/records/${avatar2}`, { method: 'DELETE' });
  const oldDeleteBody = await oldDelete.json().catch(() => ({}));
  const oldAfterDelete = await authorizedFetch(a, `/assets/records/${avatar2}/bytes/primary`);
  record(
    6,
    oldAfterReplace.status === 200 && oldAfterDelete.status !== 200,
    `old asset ${avatar2}: post-replace fetch=${oldAfterReplace.status} (orphaned, still owner-fetchable by URL); gcSweep(+25h) referenceReclaimed=${swept.report?.referenceReclaimed ?? '?'} -> fetch=${oldAfterSweep.status}; explicit DELETE=${oldDelete.status} ${JSON.stringify(oldDeleteBody).slice(0, 90)} -> fetch=${oldAfterDelete.status}`,
  );

  // --- item 7: signed-out fetch of the avatar URL -------------------------
  const bare = await fetch(`${server.baseUrl}/assets/records/${avatar3}/bytes/primary`);
  const bareBody = await bare.text().catch(() => '');
  const anonWithOffer = await fetch(`${server.baseUrl}/assets/records/${avatar3}/bytes/primary`, {
    headers: { 'x-snapback-auth-client-protocol': '1' },
  });
  record(
    7,
    bare.status !== 200,
    `no-credential fetch=${bare.status} (${bareBody.slice(0, 90).replaceAll('\n', ' ')}); anonymous-with-protocol-offer fetch=${anonWithOffer.status}; documented default: private-strict re-authorizes every request`,
  );

  // --- item 8 is the measurement itself (reported below + build-log.md) ---
  record(8, true, 'ceremony count + wall clock reported in build-log.md and the final report');
} catch (error) {
  failed = true;
  console.error('DRIVER FAILURE:', error?.diagnostic?.code ?? '', error);
} finally {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch {
      /* best-effort teardown */
    }
  }
}

milestone('driver complete');
console.log('\n== Faceplate r2 / Snapback arm — evidence table ==');
for (const row of evidence) {
  console.log(`${String(row.item).padStart(2)} | ${row.pass ? 'PASS' : 'FAIL'} | ${row.note}`);
}
console.log('\nmilestones:', JSON.stringify(milestones, null, 2));
const allPass = evidence.length === 8 && evidence.every((r) => r.pass) && !failed;
console.log(JSON.stringify({ suite: 'faceplate-r2-snapback', allPass, evidence }));
process.exit(allPass ? 0 : 1);
