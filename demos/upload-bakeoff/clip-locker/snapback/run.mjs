// Clip Locker — Snapback arm driver (LLP 0139 App C, frozen checklist).
// Headless: boots a sessions-mode server, drives the official JS asset
// client with an instrumented global fetch that (a) counts TUS PATCH
// payload bytes and (b) injects one deterministic connection drop when
// ~50% of the big clip has been transferred.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../../packages/snapback-client/index.mjs';
import { SnapbackAssetClient, createMemoryAssetTaskStore } from '../../../../packages/snapback-client/assets.mjs';
import { AuthCoordinator, createMemoryAuthCustodyStorage } from '../../../../packages/snapback-contract/index.mjs';
import { generate } from '../../../../packages/snapback-codegen/index.mjs';
import { importGeneratedModule } from '../../../../demos/_kit/generated-artifacts.mjs';
import { startServer } from '../../../../demos/_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const fixtures = join(here, '..', 'fixtures');
const results = { arm: 'snapback', startedAt: new Date().toISOString(), steps: {} };
const t0 = () => process.hrtime.bigint();
const ms = (a) => Number((process.hrtime.bigint() - a) / 1000000n);
const sha = (b) => createHash('sha256').update(b).digest('hex');

const bigBytes = await readFile(join(fixtures, 'clip-120mb.mp4'));
const smallBytes = await readFile(join(fixtures, 'clip-small.mp4'));
const geoBytes = await readFile(join(fixtures, 'clip-geo.mp4'));
const bigSha = sha(bigBytes);

const fileOf = (bytes, name, type = 'video/mp4') => ({
  size: bytes.length,
  name,
  type,
  slice: (s, e) => ({ arrayBuffer: async () => bytes.subarray(s ?? 0, e ?? bytes.length) }),
});

// --- instrumented fetch: PATCH byte accounting + one injected drop ---
const realFetch = globalThis.fetch;
const net = { patchBytes: 0, patches: 0, dropAtBytes: Infinity, dropped: false, count: true };
globalThis.fetch = async (url, init = {}) => {
  if ((init.method ?? 'GET') === 'PATCH' && init.body && net.count) {
    const size = init.body.byteLength ?? init.body.length ?? 0;
    if (!net.dropped && net.patchBytes + size > net.dropAtBytes) {
      net.dropped = true;
      throw new TypeError('fetch failed: simulated connection drop (bakeoff)');
    }
    net.patchBytes += size;
    console.error(`PATCH ${String(url).slice(-24)} offset=${init.headers?.["upload-offset"] ?? init.headers?.["Upload-Offset"] ?? "?"} size=${size} total=${net.patchBytes}`);
    net.patches += 1;
  }
  try {
    return await realFetch(url, init);
  } catch (error) {
    if (!String(error?.message ?? error).includes("simulated")) {
      console.error("REAL fetch failure:", url, String(error), "cause:", String(error?.cause ?? "none"));
    }
    throw error;
  }
};

// --- boot sessions server over the generated backend ---
const bootStart = t0();
const scratch = await mkdtemp(join(tmpdir(), 'clip-locker-snapback-'));
const backendRoot = join(scratch, 'app', 'snapback');
await cp(join(here, 'backend', 'snapback'), backendRoot, { recursive: true });
const generated = await generate(backendRoot);
assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
const schemaManifest = JSON.parse(await readFile(join(backendRoot, 'generated', 'schema.manifest.json'), 'utf8'));
const functionsManifest = JSON.parse(await readFile(join(backendRoot, 'generated', 'functions.manifest.json'), 'utf8'));
const carrier = join(scratch, 'startup-artifacts.json');
await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema: schemaManifest, functions: functionsManifest })}\n`, { mode: 0o600 });
const server = await startServer({ port: 0, db: join(scratch, 'clip.db'), cwd: repoRoot, startupArtifacts: carrier, captureImpersonationCapability: true });
const { default: api } = await importGeneratedModule(join(backendRoot, 'generated'), 'api.mjs');

const coordinator = new AuthCoordinator({
  appId: schemaManifest.appId,
  storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
  broadcastChannelFactory: null,
  hintStorage: null,
});
const client = new SnapbackClient(server.baseUrl, {
  authCoordinator: coordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: 'cliplockerarm0001',
});
const requested = await client.authRequestCode('owner@clip.test');
const mailbox = await (await realFetch(`${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`, {
  headers: { 'x-snapback-admin-token': server.adminToken, 'x-snapback-impersonation-capability': server.impersonationCapability },
})).json();
await client.authExchange({ challengeId: requested.challengeId, code: mailbox.code });
const custody = () => ({
  authorization: `Bearer ${coordinator.credentialFor(coordinator.capture()).bearer}`,
  'x-snapback-auth-client-protocol': '1',
});
results.steps.boot = { wallMs: ms(bootStart), ceremony: 'schema+intent+2 mutations, codegen, server boot, session mint' };

const taskStore = createMemoryAssetTaskStore();
const CHUNK_WORKAROUND = 2 * 1024 * 1024; // policy-gate ceiling; see issues/20260801-0044-policy-gate-caps-tus-chunks.md
const assets = new SnapbackAssetClient(client, { taskStore, chunkBytes: CHUNK_WORKAROUND });

const waitTerminal = (task, wanted) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timeout waiting for ${wanted}: ${JSON.stringify(task.snapshot())}`)), 900000);
  const check = (snap) => {
    if (snap.status === wanted) { clearTimeout(timer); resolve(snap); }
    else if (['ready', 'rejected', 'cancelled', 'failed'].includes(snap.status) && snap.status !== wanted) {
      clearTimeout(timer); reject(new Error(`terminal ${snap.status}: ${JSON.stringify(snap.diagnostic)}`));
    }
  };
  task.subscribe(check); check(task.snapshot());
});

// ---- 1+2: big upload, kill at ~50%, resume; measure re-transfer ----
const wall = t0();
net.dropAtBytes = Math.floor(bigBytes.length / 2);
const firstTry = assets.start({ upload: api.clipUpload, file: fileOf(bigBytes, 'clip-120mb.mp4') });
await waitTerminal(firstTry, 'failed').catch((e) => { results.steps.interrupt = { outcome: String(e).slice(0, 200) }; });
results.steps.interrupt = {
  ...(results.steps.interrupt ?? {}),
  plannedDropAtBytes: net.dropAtBytes,
  transferredBeforeDrop: net.patchBytes,
  taskStatusAfterDrop: firstTry.snapshot().status,
};
net.dropAtBytes = Infinity; net.dropped = false;

const resumeStart = t0();
const resumed = assets.resumePersisted({ assetId: firstTry.snapshot().assetId, file: fileOf(bigBytes, 'clip-120mb.mp4') });
assert.ok(resumed, 'persisted resume fact must exist after interruption');
const done = await waitTerminal(resumed, 'ready');
results.steps.bigUpload = {
  wallMsTotal: ms(wall),
  wallMsResumeLeg: ms(resumeStart),
  fileBytes: bigBytes.length,
  patchBytesTotal: net.patchBytes,
  bytesRetransmitted: net.patchBytes - bigBytes.length,
  patches: net.patches,
  integrityBasis: done.integrityBasis ?? null,
  assetId: done.assetId,
};

// ---- 3: integrity — download back through a signed URL, digest ----
net.count = false;
const issueFor = async (assetId, body) => {
  const r = await realFetch(`${server.baseUrl}/assets/records/${encodeURIComponent(assetId)}/signed-url`, {
    method: 'POST', headers: { ...custody(), 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const bigIssue = await issueFor(done.assetId, { variant: 'primary', ttlMs: 600000 });
assert.equal(bigIssue.status, 200, JSON.stringify(bigIssue.body));
const downloaded = await realFetch(`${server.baseUrl}${bigIssue.body.url}`);
assert.equal(downloaded.status, 200);
const downloadedBytes = Buffer.from(await downloaded.arrayBuffer());
results.steps.integrity = {
  sourceSha256: bigSha,
  storedSha256: sha(downloadedBytes),
  matches: sha(downloadedBytes) === bigSha,
  note: 'strip-declared video: canonical bytes may lawfully differ if location atoms were blanked; big fixture carries no location, so digests must match',
};

// ---- 4: range playback on the small clip ----
const small = assets.start({ upload: api.clipUpload, file: fileOf(smallBytes, 'clip-small.mp4') });
const smallDone = await waitTerminal(small, 'ready');
const smallIssue = await issueFor(smallDone.assetId, { variant: 'primary', ttlMs: 600000 });
const ranged = await realFetch(`${server.baseUrl}${smallIssue.body.url}`, { headers: { range: 'bytes=100-4099' } });
const suffix = await realFetch(`${server.baseUrl}${smallIssue.body.url}`, { headers: { range: 'bytes=-1024' } });
results.steps.range = {
  status: ranged.status,
  contentRange: ranged.headers.get('content-range'),
  bytes: (await ranged.arrayBuffer()).byteLength,
  suffixStatus: suffix.status,
  suffixContentRange: suffix.headers.get('content-range'),
  cacheControl: ranged.headers.get('cache-control'),
};
assert.equal(ranged.status, 206);
assert.equal(results.steps.range.bytes, 4000);

// ---- 5: share link TTL + revocation ----
const shortIssue = await issueFor(smallDone.assetId, { variant: 'primary', ttlMs: 1500 });
assert.equal(shortIssue.status, 200);
const freshServe = await realFetch(`${server.baseUrl}${shortIssue.body.url}`);
await new Promise((r) => setTimeout(r, 2100));
const expiredServe = await realFetch(`${server.baseUrl}${shortIssue.body.url}`);
results.steps.share = {
  headerlessServeStatus: freshServe.status,
  afterTtlStatus: expiredServe.status,
  ttlMsRequested: 1500,
};
assert.equal(freshServe.status, 200, 'pasteable: zero Snapback headers');
assert.ok(expiredServe.status >= 400, 'expired signed URL refuses');

// ---- 6: deletion truth (attach → referenced refusal → clear → delete) ----
const saved = await client.mutate(api.saveClip.name, {
  args: { title: 'the clip', assetId: smallDone.assetId },
  authorityCapture: coordinator.capture(),
  clientMutationId: 'cm_clip_save_1',
});
const clipRowId = saved.result;
const refusedDelete = await realFetch(`${server.baseUrl}/assets/records/${encodeURIComponent(smallDone.assetId)}`, { method: 'DELETE', headers: custody() });
const refusedBody = await refusedDelete.json();
await client.mutate(api.clearClip.name, { args: { clipId: clipRowId }, authorityCapture: coordinator.capture(), clientMutationId: 'cm_clip_clear_1' });
const okDelete = await realFetch(`${server.baseUrl}/assets/records/${encodeURIComponent(smallDone.assetId)}`, { method: 'DELETE', headers: custody() });
const longIssueBeforeDelete = smallIssue.body.url;
const afterDeleteServe = await realFetch(`${server.baseUrl}${longIssueBeforeDelete}`);
const afterDeleteIssue = await issueFor(smallDone.assetId, { variant: 'primary', ttlMs: 60000 });
results.steps.deletion = {
  referencedDeleteStatus: refusedDelete.status,
  referencedDeleteCode: refusedBody?.diagnostics?.[0]?.code ?? refusedBody?.code ?? null,
  deleteAfterClearStatus: okDelete.status,
  outstandingSignedUrlAfterDelete: afterDeleteServe.status,
  newIssuanceAfterDelete: afterDeleteIssue.status,
  note: 'outstanding signed URL dies at origin because validation recomputes the lifecycle generation',
};
assert.ok(refusedDelete.status >= 400);
assert.ok(afterDeleteServe.status >= 400, 'origin revocation on delete');

// ---- 7: video metadata privacy (geo clip through the strip intent) ----
const geo = assets.start({ upload: api.clipUpload, file: fileOf(geoBytes, 'clip-geo.mp4') });
const geoOutcome = await waitTerminal(geo, 'ready').then(
  (snap) => ({ status: 'ready', snap }),
  (e) => ({ status: 'refused', error: String(e).slice(0, 300) }),
);
if (geoOutcome.status === 'ready') {
  const geoIssue = await issueFor(geoOutcome.snap.assetId, { variant: 'primary', ttlMs: 60000 });
  const geoServed = Buffer.from(await (await realFetch(`${server.baseUrl}${geoIssue.body.url}`)).arrayBuffer());
  const geoOut = join(scratch, 'geo-served.mp4');
  await writeFile(geoOut, geoServed);
  results.steps.geoPrivacy = {
    outcome: 'ready',
    servedBytes: geoServed.length,
    sourceBytes: geoBytes.length,
    digestChanged: sha(geoServed) !== sha(geoBytes),
    servedPath: geoOut,
  };
} else {
  results.steps.geoPrivacy = { outcome: 'refused', error: geoOutcome.error };
}

// ---- 8: limits honesty (from the capability manifest, not marketing) ----
const manifest = JSON.parse(await readFile(join(repoRoot, "schemas", "capability.manifest.local-dev-sqlite-ibex.json"), "utf8"));
results.steps.limits = {
  source: 'capability manifest (server-declared)',
  assets: manifest.assets ?? null,
};

results.finishedAt = new Date().toISOString();
await writeFile(join(here, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
await server.stop?.();
process.exit(0);
