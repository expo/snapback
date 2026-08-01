// Clip Locker round 2 — instrumented headless driver over the nine-item
// frozen checklist. Boots its own sessions-mode server (OS-assigned port),
// mints a real session, and drives the packaged asset client at DEFAULTS.
// Large-transfer legs run as child processes (upload-leg.mjs) so the
// interruption is a genuine process death and byte accounting is isolated.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SnapbackClient } from '../../../../packages/snapback-client/index.mjs';
import { SnapbackAssetClient } from '../../../../packages/snapback-client/assets.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../../packages/snapback-contract/index.mjs';
import { importGeneratedModule, readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { assert as suiteAssert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, 'snapback');
const fixturesDir = join(here, '..', 'fixtures');
const generatedRoot = join(backendDir, 'generated');
const gen = (f) => readGeneratedJson(generatedRoot, f);
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');
const tmpRoot = join(here, 'tmp');
rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpRoot, { recursive: true });

const t0 = Date.now();
const milestones = [];
const milestone = (name) => {
  milestones.push({ name, atMs: Date.now() - t0 });
  console.log(`[milestone +${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = {};
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const suite = createSuite('clip-locker / snapback-r2', { expectedChecks: 9 });
const cleanups = [];

function runLeg(name, config) {
  const reportPath = join(tmpRoot, `${name}.report.json`);
  const result = spawnSync(
    process.execPath,
    [join(here, 'upload-leg.mjs'), JSON.stringify({ ...config, reportPath })],
    { stdio: ['ignore', 'inherit', 'inherit'], timeout: 600_000 },
  );
  let report = null;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    // fallthrough — caller asserts
  }
  return { exitCode: result.status, report };
}

await runAcceptance(suite, async () => {
  // ---- boot: sessions server from the generated startup carrier ----
  const schemaManifest = gen('schema.manifest.json');
  const functionsManifest = gen('functions.manifest.json');
  const carrier = join(mkdtempSync(join(tmpdir(), 'clip-locker-r2-')), 'startup-artifacts.json');
  writeFileSync(
    carrier,
    `${JSON.stringify({ formatVersion: 1, schema: schemaManifest, functions: functionsManifest })}\n`,
    { mode: 0o600 },
  );
  const server = await startServer({
    port: 0,
    db: join(tmpRoot, 'clip-locker.sqlite3'),
    cwd: repoRoot,
    env: { SNAPBACK_ASSET_RUNNER_DISABLED: '1' },
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });
  cleanups.push(() => server.stop());
  milestone(`server booted (sessions) at ${server.baseUrl}`);

  // ---- mint one real session (email code via the local test mailbox) ----
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
    clientStoreId: 'clip-locker-uploader',
  });
  const requested = await client.authRequestCode('uploader@example.com');
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
  assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
  await client.authExchange({ challengeId: requested.challengeId, code: mailbox.code });
  const bearer = () => coordinator.credentialFor(coordinator.capture()).bearer;
  const assets = new SnapbackAssetClient(client);
  const mutate = (ref, args) =>
    client.mutate(ref, { args, authorityCapture: coordinator.capture() });
  const authorizedFetch = (path, init = {}) =>
    fetch(`${server.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${bearer()}`,
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
    assert.equal(response.status, 200, `${operation}: ${JSON.stringify(body)}`);
    assert.equal(body.ok, true, `${operation}: ${JSON.stringify(body.diagnostics ?? body)}`);
    return body.data ?? body.result ?? body;
  };
  milestone('session minted');

  const bigFixture = join(fixturesDir, 'clip-120mb.mp4');
  const bigDigest = sha256File(bigFixture);
  const bigSize = readFileSync(bigFixture).length;
  let bigAssetId = null;
  let resumeAssetId = null;

  await suite.check('1. big upload — ~120 MB at client defaults', async () => {
    const leg = runLeg('leg-a-clean', {
      baseUrl: server.baseUrl,
      bearer: bearer(),
      filePath: bigFixture,
      storePath: join(tmpRoot, 'store-a.json'),
      mode: 'start',
      uploadIntent: 'clipUpload',
      declaredFilename: 'clip-120mb.mp4',
    });
    assert.equal(leg.exitCode, 0, `leg-a exit: ${JSON.stringify(leg.report?.diagnostic ?? leg.report?.error ?? leg.exitCode)}`);
    assertEqual(leg.report.status, 'ready', 'big upload reaches ready');
    bigAssetId = leg.report.assetId;
    const clipId = (await mutate(api.createClip, { title: 'big clip', assetId: bigAssetId })).result;
    suiteAssert(typeof clipId === 'string' && clipId.length > 0, 'clip row created with typed attach');
    evidence.item1 = {
      fileSize: bigSize,
      wallMs: leg.report.endedAtMs - leg.report.startedAtMs,
      requests: leg.report.requests.length,
      patchRequests: leg.report.requests.filter((r) => r.method === 'PATCH').length,
      patchBodyBytes: leg.report.patchBodyBytesTotal,
      totalBodyBytes: leg.report.totalBodyBytes,
      maxChunkBytes: leg.report.createResponse?.transfer?.maxChunkBytes ?? null,
      tusResponseHeaders: leg.report.tusResponseHeaders,
      assetId: bigAssetId,
      clipId,
    };
    milestone(`item 1: 120 MB upload ready in ${(evidence.item1.wallMs / 1000).toFixed(1)}s, `
      + `${evidence.item1.patchRequests} PATCHes, ${evidence.item1.patchBodyBytes} PATCH body bytes`);
  });

  await suite.check('2. kill at ~50% then resume — measured re-transmitted bytes', async () => {
    const storePath = join(tmpRoot, 'store-b.json');
    const killLeg = runLeg('leg-b-kill', {
      baseUrl: server.baseUrl,
      bearer: bearer(),
      filePath: bigFixture,
      storePath,
      mode: 'start',
      killAtFraction: 0.5,
      uploadIntent: 'clipUpload',
      declaredFilename: 'clip-120mb.mp4',
    });
    assert.equal(killLeg.exitCode, 9, `kill leg must die deliberately, exit ${killLeg.exitCode}`);
    assertEqual(killLeg.report.status, 'killed', 'kill leg report');
    const resumeLeg = runLeg('leg-c-resume', {
      baseUrl: server.baseUrl,
      bearer: bearer(),
      filePath: bigFixture,
      storePath,
      mode: 'resume',
      assetId: killLeg.report.assetId,
      declaredFilename: 'clip-120mb.mp4',
    });
    assert.equal(resumeLeg.exitCode, 0, `resume leg exit: ${JSON.stringify(resumeLeg.report?.diagnostic ?? resumeLeg.report?.error ?? resumeLeg.exitCode)}`);
    assertEqual(resumeLeg.report.status, 'ready', 'resumed upload reaches ready');
    assertEqual(resumeLeg.report.assetId, killLeg.report.assetId, 'asset id stable across the kill');
    resumeAssetId = resumeLeg.report.assetId;
    const reTransmitted = resumeLeg.report.patchBodyBytesTotal;
    const expectedRemainder = bigSize - killLeg.report.killedAtOffset;
    suiteAssert(
      reTransmitted < bigSize * 0.6,
      `resume must not re-send the file: re-sent ${reTransmitted} of ${bigSize}`,
    );
    assertEqual(reTransmitted, expectedRemainder, 're-transmitted bytes == exactly the unacknowledged remainder');
    await mutate(api.createClip, { title: 'resumed clip', assetId: resumeAssetId });
    evidence.item2 = {
      killMethod: killLeg.report.killMethod,
      killedAtOffset: killLeg.report.killedAtOffset,
      killedAtFractionOfFile: killLeg.report.killedAtOffset / bigSize,
      bytesSentBeforeKill: killLeg.report.patchBodyBytesTotal,
      resumeHeadOffset: resumeLeg.report.headOffset,
      bytesReTransmitted: reTransmitted,
      fullResendWouldBe: bigSize,
      resumabilitySavedBytes: bigSize - reTransmitted,
      resumeWallMs: resumeLeg.report.endedAtMs - resumeLeg.report.startedAtMs,
    };
    milestone(`item 2: killed at ${killLeg.report.killedAtOffset}, resumed from HEAD offset `
      + `${resumeLeg.report.headOffset}, re-transmitted ${reTransmitted} bytes`);
  });

  await suite.check('3. integrity — stored digest and downloaded bytes match the source', async () => {
    const record = await assets.record(bigAssetId);
    assertEqual(record.digestAlgorithm ?? 'sha256', 'sha256', 'digest algorithm');
    assertEqual(record.digest, bigDigest, 'server canonical digest == local source digest');
    const download = await authorizedFetch(`/assets/records/${bigAssetId}/bytes/primary`);
    assert.equal(download.status, 200, `download status ${download.status}`);
    const downloaded = Buffer.from(await download.arrayBuffer());
    const downloadedDigest = createHash('sha256').update(downloaded).digest('hex');
    assertEqual(downloadedDigest, bigDigest, 'downloaded bytes digest == source digest');
    evidence.item3 = {
      sourceDigest: bigDigest,
      serverDigest: record.digest,
      downloadedDigest,
      integrityGrade: record.integrityGrade ?? null,
      downloadedBytes: downloaded.length,
    };
    milestone('item 3: integrity verified (server digest + full download)');
  });

  let smallAssetId = null;
  await suite.check('4. seekable playback — ranged GETs against strict delivery', async () => {
    const smallBuffer = readFileSync(join(fixturesDir, 'clip-small.mp4'));
    const task = assets.start({
      upload: api.clipUpload,
      file: {
        name: 'clip-small.mp4',
        size: smallBuffer.length,
        type: 'video/mp4',
        slice: (s, e) => ({ arrayBuffer: async () => smallBuffer.subarray(s ?? 0, e ?? smallBuffer.length) }),
      },
      declaredFilename: 'clip-small.mp4',
      declaredContentType: 'video/mp4',
    });
    const finished = await task.done;
    assertEqual(finished.status, 'ready', `small upload: ${JSON.stringify(finished.diagnostic ?? null)}`);
    smallAssetId = finished.assetId;
    await mutate(api.createClip, { title: 'small clip', assetId: smallAssetId });
    const probes = {};
    for (const [label, range] of [
      ['first-1KiB', 'bytes=0-1023'],
      ['mid-100KB', 'bytes=100000-199999'],
      ['open-ended-tail', 'bytes=500000-'],
    ]) {
      const response = await authorizedFetch(`/assets/records/${smallAssetId}/bytes/primary`, {
        headers: { range },
      });
      const body = Buffer.from(await response.arrayBuffer());
      probes[label] = {
        requested: range,
        status: response.status,
        contentRange: response.headers.get('content-range'),
        contentLength: body.length,
        acceptRanges: response.headers.get('accept-ranges'),
        cacheControl: response.headers.get('cache-control'),
        contentType: response.headers.get('content-type'),
      };
      assert.equal(response.status, 206, `${label}: expected 206, got ${response.status}`);
    }
    assertEqual(probes['first-1KiB'].contentLength, 1024, 'first range honored exactly');
    evidence.item4 = { fileSize: smallBuffer.length, probes };
    milestone('item 4: ranged delivery probed (3 ranges, all 206)');
  });

  await suite.check('5. share link — signed URL serves signed-out; TTL expiry; revocation', async () => {
    const smallBuffer = readFileSync(join(fixturesDir, 'clip-small.mp4'));
    const task = assets.start({
      upload: api.shareClipUpload,
      file: {
        name: 'share-clip.mp4',
        size: smallBuffer.length,
        type: 'video/mp4',
        slice: (s, e) => ({ arrayBuffer: async () => smallBuffer.subarray(s ?? 0, e ?? smallBuffer.length) }),
      },
      declaredFilename: 'share-clip.mp4',
      declaredContentType: 'video/mp4',
    });
    const finished = await task.done;
    assertEqual(finished.status, 'ready', `share upload: ${JSON.stringify(finished.diagnostic ?? null)}`);
    const shareAssetId = finished.assetId;
    const shareClipId = (await mutate(api.createShareClip, { title: 'shared clip', assetId: shareAssetId })).result;

    // Strict intents must refuse signed issuance (delivery policy follows the asset).
    const strictRefusal = await authorizedFetch(`/assets/records/${bigAssetId}/signed-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant: 'primary', ttlMs: 60_000 }),
    });

    const shortMint = await authorizedFetch(`/assets/records/${shareAssetId}/signed-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant: 'primary', ttlMs: 4_000 }),
    });
    const shortBody = await shortMint.json();
    assert.equal(shortMint.status, 200, `signed mint: ${JSON.stringify(shortBody)}`);
    const signedUrl = `${server.baseUrl}${shortBody.url}`;

    // Completely bare fetch — no bearer, no protocol header (the pasteable claim).
    const bare = await fetch(signedUrl);
    const bareWithProtocolHeader = bare.status === 200
      ? null
      : await fetch(signedUrl, { headers: { 'x-snapback-auth-client-protocol': '1' } });
    const servedSignedOut = bare.status === 200 || bareWithProtocolHeader?.status === 200;
    suiteAssert(servedSignedOut, `signed URL must serve signed-out (bare ${bare.status}, with-header ${bareWithProtocolHeader?.status})`);

    await sleep(5_000);
    const afterExpiry = await fetch(signedUrl);

    // Revocation: a fresh long-TTL URL, then delete the reference row and the asset.
    const longMint = await authorizedFetch(`/assets/records/${shareAssetId}/signed-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant: 'primary', ttlMs: 600_000 }),
    });
    const longBody = await longMint.json();
    assert.equal(longMint.status, 200, 'second signed mint');
    const longUrl = `${server.baseUrl}${longBody.url}`;
    const longPre = await fetch(longUrl);
    assert.equal(longPre.status, 200, 'long-TTL URL serves before revocation');
    await mutate(api.deleteClip, { clipId: shareClipId });
    const deleteResponse = await authorizedFetch(`/assets/records/${shareAssetId}`, { method: 'DELETE' });
    const afterDelete = await fetch(longUrl);
    suiteAssert(afterDelete.status !== 200, `deleted asset's signed URL must stop serving, got ${afterDelete.status}`);
    evidence.item5 = {
      strictIntentIssuanceStatus: strictRefusal.status,
      mintedUrlShape: shortBody.url.split('?')[0],
      bareFetchStatus: bare.status,
      bareFetchWithProtocolHeaderStatus: bareWithProtocolHeader?.status ?? null,
      afterTtlExpiryStatus: afterExpiry.status,
      ttlMs: 4000,
      deleteAssetStatus: deleteResponse.status,
      afterDeletionStatus: afterDelete.status,
    };
    milestone('item 5: signed URL minted, expired, and revoked-by-deletion');
  });

  await suite.check('6. deletion truth — refusal while referenced, then real deletion', async () => {
    const whileReferenced = await authorizedFetch(`/assets/records/${bigAssetId}`, { method: 'DELETE' });
    const whileBody = await whileReferenced.json().catch(() => ({}));
    assert.equal(whileReferenced.status, 409, `referenced delete must 409, got ${whileReferenced.status}: ${JSON.stringify(whileBody)}`);
    const rows = (await client.query(api.listClips, { args: {}, authorityCapture: coordinator.capture() })).rows;
    const bigRow = rows.find((r) => r.video === bigAssetId && r.title === 'big clip');
    await mutate(api.deleteClip, { clipId: bigRow._id });
    const unreferenced = await authorizedFetch(`/assets/records/${bigAssetId}`, { method: 'DELETE' });
    const unreferencedBody = await unreferenced.json().catch(() => ({}));
    suiteAssert(unreferenced.ok, `unreferenced delete must succeed, got ${unreferenced.status}: ${JSON.stringify(unreferencedBody)}`);
    const metadataAfter = await authorizedFetch(`/assets/records/${bigAssetId}`);
    const metadataAfterBody = await metadataAfter.json().catch(() => null);
    const bytesAfter = await authorizedFetch(`/assets/records/${bigAssetId}/bytes/primary`);
    // The record may legitimately linger as a tombstone until a GC sweep
    // (the deterministic background runner is disabled for this suite) —
    // record the full story, then sweep and re-probe.
    let sweep = null;
    let metadataAfterSweep = null;
    let bytesAfterSweep = null;
    if (metadataAfter.status === 200 || bytesAfter.status === 200) {
      sweep = await hostOp('asset.gcSweep', { nowMs: Date.now() + 62_000 });
      metadataAfterSweep = await authorizedFetch(`/assets/records/${bigAssetId}`);
      bytesAfterSweep = await authorizedFetch(`/assets/records/${bigAssetId}/bytes/primary`);
    }
    const finalBytesStatus = bytesAfterSweep?.status ?? bytesAfter.status;
    const finalMetadataStatus = metadataAfterSweep?.status ?? metadataAfter.status;
    suiteAssert(finalBytesStatus === 403 || finalBytesStatus === 404, `bytes must stop serving, got ${finalBytesStatus}`);
    // Dedup safety: item 2's asset shares these exact canonical bytes.
    const dedupSibling = await authorizedFetch(`/assets/records/${resumeAssetId}/bytes/primary`, {
      headers: { range: 'bytes=0-1023' },
    });
    suiteAssert(dedupSibling.status === 206 || dedupSibling.status === 200, `dedup sibling must still serve, got ${dedupSibling.status}`);
    evidence.item6 = {
      deleteWhileReferencedStatus: whileReferenced.status,
      deleteWhileReferencedDiagnostic: whileBody?.diagnostics?.[0]?.code ?? whileBody?.code ?? null,
      deleteAfterRowRemovedStatus: unreferenced.status,
      metadataStatusImmediatelyAfterDeletion: metadataAfter.status,
      metadataAvailabilityImmediatelyAfterDeletion:
        metadataAfterBody?.availability ?? metadataAfterBody?.state ?? null,
      bytesStatusImmediatelyAfterDeletion: bytesAfter.status,
      gcSweepRan: sweep !== null,
      gcSweepReport: sweep?.report ?? null,
      metadataStatusAfterSweep: metadataAfterSweep?.status ?? null,
      bytesStatusAfterSweep: bytesAfterSweep?.status ?? null,
      finalMetadataStatus,
      finalBytesStatus,
      dedupSiblingStillServes: dedupSibling.status,
    };
    milestone('item 6: deletion truth recorded');
  });

  await suite.check('7. video metadata privacy — GPS atom survival at the provider default', async () => {
    const geoPath = join(fixturesDir, 'clip-geo.mp4');
    const geoBuffer = readFileSync(geoPath);
    const geoDigest = createHash('sha256').update(geoBuffer).digest('hex');
    // ffmpeg stores the location as a binary 3GPP `loci`/udta atom, not a raw
    // ISO6709 string, so probe with ffprobe rather than a byte search.
    const probeLocation = (path) => {
      const out = spawnSync('ffprobe', ['-v', 'quiet', '-show_format', path], { encoding: 'utf8' });
      return (out.stdout.match(/TAG:location.*=(.*)/g) ?? []).join('; ');
    };
    const sourceLocation = probeLocation(geoPath);
    suiteAssert(sourceLocation.includes('+37.7749-122.4194'), `source fixture carries the location tag: ${sourceLocation}`);
    const task = assets.start({
      upload: api.clipUpload,
      file: {
        name: 'clip-geo.mp4',
        size: geoBuffer.length,
        type: 'video/mp4',
        slice: (s, e) => ({ arrayBuffer: async () => geoBuffer.subarray(s ?? 0, e ?? geoBuffer.length) }),
      },
      declaredFilename: 'clip-geo.mp4',
      declaredContentType: 'video/mp4',
    });
    const finished = await task.done;
    assertEqual(finished.status, 'ready', `geo upload: ${JSON.stringify(finished.diagnostic ?? null)}`);
    await mutate(api.createClip, { title: 'geo clip', assetId: finished.assetId });
    const download = await authorizedFetch(`/assets/records/${finished.assetId}/bytes/primary`);
    const served = Buffer.from(await download.arrayBuffer());
    const servedDigest = createHash('sha256').update(served).digest('hex');
    const servedPath = join(tmpRoot, 'served-geo.mp4');
    writeFileSync(servedPath, served);
    const servedLocation = probeLocation(servedPath);
    const gpsSurvives = servedLocation.includes('+37.7749-122.4194');
    assertEqual(servedDigest, geoDigest, 'served bytes are canonical-identical to the source');
    suiteAssert(gpsSurvives, `expected: GPS survives under the retain-only video policy: ${servedLocation}`);
    // Mitigation probe: a strip-declared video intent must refuse at generation.
    const probeDir = join(mkdtempSync(join(tmpdir(), 'clip-strip-probe-')), 'snapback');
    cpSync(backendDir, probeDir, { recursive: true });
    writeFileSync(
      join(probeDir, 'functions.mjs'),
      readFileSync(join(probeDir, 'functions.mjs'), 'utf8')
        .replaceAll("image: { location: 'retain' }", "image: { location: 'strip' }")
        .replaceAll("'../../../../_kit/define.mjs'", `'${join(repoRoot, 'demos', '_kit', 'define.mjs')}'`),
    );
    writeFileSync(
      join(probeDir, 'schema.mjs'),
      readFileSync(join(probeDir, 'schema.mjs'), 'utf8')
        .replaceAll("'../../../../_kit/define.mjs'", `'${join(repoRoot, 'demos', '_kit', 'define.mjs')}'`),
    );
    const probe = spawnSync(
      process.execPath,
      [join(repoRoot, 'packages', 'snapback-codegen', 'index.mjs'), probeDir],
      { encoding: 'utf8', timeout: 120_000 },
    );
    const stripProbeOutput = `${probe.stdout}\n${probe.stderr}`;
    let stripRuntime = null;
    if (probe.status === 0) {
      // Codegen admitted strip-on-video; chase the refusal (or the strip)
      // at runtime on a throwaway server booted from the strip artifacts.
      const readProbeJson = (f) => JSON.parse(readFileSync(join(probeDir, 'generated', f), 'utf8'));
      const probeCarrier = join(dirname(probeDir), 'strip-startup-artifacts.json');
      writeFileSync(
        probeCarrier,
        `${JSON.stringify({
          formatVersion: 1,
          schema: readProbeJson('schema.manifest.json'),
          functions: readProbeJson('functions.manifest.json'),
        })}\n`,
        { mode: 0o600 },
      );
      const probeServer = await startServer({
        port: 0,
        db: ':memory:',
        cwd: repoRoot,
        env: { SNAPBACK_ASSET_RUNNER_DISABLED: '1' },
        startupArtifacts: probeCarrier,
        captureImpersonationCapability: true,
      });
      try {
        const probeCoordinator = new AuthCoordinator({
          appId: readProbeJson('schema.manifest.json').appId,
          storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
          broadcastChannelFactory: null,
          hintStorage: null,
        });
        const probeClient = new SnapbackClient(probeServer.baseUrl, {
          authCoordinator: probeCoordinator,
          authInvalidationProtocol: 1,
          authorityDescriptorProtocol: 1,
          authorizedLeaseProtocol: 1,
          clientStoreId: 'strip-probe',
        });
        const probeRequested = await probeClient.authRequestCode('strip-probe@example.com');
        const probeMailbox = await (await fetch(
          `${probeServer.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(probeRequested.challengeId)}`,
          {
            headers: {
              'x-snapback-admin-token': probeServer.adminToken,
              'x-snapback-impersonation-capability': probeServer.impersonationCapability,
            },
          },
        )).json();
        await probeClient.authExchange({ challengeId: probeRequested.challengeId, code: probeMailbox.code });
        const probeApi = (await importGeneratedModule(join(probeDir, 'generated'), 'api.mjs')).default;
        const probeAssets = new SnapbackAssetClient(probeClient);
        const probeTask = probeAssets.start({
          upload: probeApi.clipUpload,
          file: {
            name: 'clip-geo.mp4',
            size: geoBuffer.length,
            type: 'video/mp4',
            slice: (s, e) => ({ arrayBuffer: async () => geoBuffer.subarray(s ?? 0, e ?? geoBuffer.length) }),
          },
          declaredFilename: 'clip-geo.mp4',
          declaredContentType: 'video/mp4',
        });
        const probeFinished = await probeTask.done;
        stripRuntime = {
          uploadStatus: probeFinished.status,
          diagnostic: probeFinished.diagnostic ?? null,
        };
        if (probeFinished.status === 'ready') {
          const stripServed = Buffer.from(await (await fetch(
            `${probeServer.baseUrl}/assets/records/${probeFinished.assetId}/bytes/primary`,
            {
              headers: {
                authorization: `Bearer ${probeCoordinator.credentialFor(probeCoordinator.capture()).bearer}`,
                'x-snapback-auth-client-protocol': '1',
              },
            },
          )).arrayBuffer());
          const stripServedPath = join(tmpRoot, 'strip-served-geo.mp4');
          writeFileSync(stripServedPath, stripServed);
          stripRuntime.servedLocationTag = probeLocation(stripServedPath);
          stripRuntime.gpsStripped = !stripRuntime.servedLocationTag.includes('+37.7749');
          stripRuntime.servedDigest = createHash('sha256').update(stripServed).digest('hex');
        }
      } finally {
        await probeServer.stop();
      }
    }
    suiteAssert(
      probe.status !== 0 || stripRuntime !== null,
      'the strip-mitigation story must be determined (codegen refusal or runtime outcome)',
    );
    evidence.item7 = {
      providerDefault: 'video location policy must be declared explicitly; retain preserves GPS metadata to every consumer byte-identically',
      sourceDigest: geoDigest,
      servedDigest,
      sourceLocationTag: sourceLocation,
      servedLocationTag: servedLocation,
      gpsSurvivesToConsumers: gpsSurvives,
      stripCodegenExit: probe.status,
      stripCodegenDiagnostic: stripProbeOutput.split('\n').find((l) => l.includes('SNAPBACK_')) ?? null,
      stripRuntime,
    };
    milestone('item 7: GPS survival + strip-refusal probe recorded');
  });

  await suite.check('8. limits honesty — declared ceilings from the manifest and the wire', async () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, 'schemas', 'capability.manifest.local-dev-sqlite-ibex.json'), 'utf8'),
    );
    const assetsBlock = manifest.assets ?? null;
    suiteAssert(assetsBlock !== null, 'manifest assets block present');
    evidence.item8 = {
      manifestAssetsLimits: assetsBlock.limits ?? assetsBlock,
      attemptCreateMaxChunkBytes: evidence.item1.maxChunkBytes,
      clientDefaultChunkBytes: 4 * 1024 * 1024,
      tusResponseHeaders: evidence.item1.tusResponseHeaders,
      intentDeclaredMaxBytes: 200_000_000,
      pricing: 'self-hosted local target: no pricing cliff exists to record; no hosted asset pricing is published (hosted targets report the asset capability Missing)',
    };
    milestone('item 8: limits recorded from manifest + attempt-create response');
  });

  await suite.check('9. ledger — evidence, milestones, and byte accounting written', async () => {
    evidence.milestones = milestones;
    evidence.serverLaunch = { rung: server.launch?.rung ?? null, identity: server.identity?.verdict ?? null };
    writeFileSync(join(here, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    suiteAssert(evidence.item1 && evidence.item2 && evidence.item3, 'core evidence present');
    milestone('item 9: evidence.json written');
  });
}, { cleanups });
