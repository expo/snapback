// Party Wall — headless acceptance suite (the required surface).
//
// The first demo consumer of the full LLP 0044 asset story, driven over a
// real sessions-mode server with real bearer custody: seeded fixtures ingest
// through the trusted path, a host uploads a GPS-stripped photo with required
// variants and attaches it through the canonical `ctx.assets.attach` handler,
// the wall updates live, membership joins grant `via-references` reads and
// leaves revoke them, covers deliver public-immutable, signed URLs act as
// bounded bearers, and deletion walks the referenced-refusal → receipted
// on-demand reference-GC path.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SnapbackClient } from '../../../../packages/snapback-client/index.mjs';
import { SnapbackAssetClient } from '../../../../packages/snapback-client/assets.mjs';
import { cpSync, mkdtempSync as mkdtempSync2 } from 'node:fs';
import { generate } from '../../../../packages/snapback-codegen/index.mjs';
import { asUser } from '../../../_kit/as-user.mjs';
import { importGeneratedModule, readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import {
  assert as suiteAssert,
  assertEqual,
  createSuite,
  eventually,
  runAcceptance,
} from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generatedRoot = join(backendDir, 'generated');
const gen = (f) => readGeneratedJson(generatedRoot, f);
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');

const suite = createSuite('party-wall / headless', { expectedChecks: 12 });
const cleanups = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fileOf(buffer, name = 'photo.png') {
  return {
    name,
    size: buffer.length,
    slice: (start, end) => ({
      arrayBuffer: async () => buffer.subarray(start ?? 0, end ?? buffer.length),
    }),
  };
}

await runAcceptance(suite, async () => {
  const schemaManifest = gen('schema.manifest.json');
  const functionsManifest = gen('functions.manifest.json');
  const carrier = join(mkdtempSync(join(tmpdir(), 'party-wall-')), 'startup-artifacts.json');
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
  cleanups.push(() => server.stop());
  const appId = schemaManifest.appId;

  async function mintSession(email) {
    const session = await asUser(server, appId, email, {
      clientStoreId: `pw-${email.split('@')[0]}`,
    });
    cleanups.push(session.dispose);
    return {
      ...session,
      assets: new SnapbackAssetClient(session.client),
      bearer: () => session.coordinator.credentialFor(session.coordinator.capture()).bearer,
    };
  }

  const mutate = async (session, reference, args) =>
    session.client.mutate(reference, { args, authorityCapture: session.coordinator.capture() });
  const hostOp = async (operation, input, userId = null) => {
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
  };
  const refusalOf = async (attempt) => {
    try {
      await attempt();
      return null;
    } catch (error) {
      return error?.diagnostic?.code ?? error?.code ?? error?.message ?? 'unknown';
    }
  };
  const authorizedFetch = (session, path, init = {}) =>
    fetch(`${server.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${session.bearer()}`,
        'x-snapback-auth-client-protocol': '1',
      },
    });

  let ada, grace, eve, pat;
  let devServer = null;
  let devSeed = null;
  let eventId = null;
  let photoAssetId = null;
  let seededPhotoId = null;

  await suite.check('boot: the sessions server starts from the startup carrier', async () => {
    const health = await fetch(`${server.baseUrl}/_snapback/api/health`).then((r) => r.json());
    suiteAssert(health.ok !== false, 'server health');
    ada = await mintSession('ada@example.com');
    grace = await mintSession('grace@example.com');
    eve = await mintSession('eve@example.com');
    pat = await mintSession('pat@example.com');
  });

  await suite.check('seed fixtures ingest through the trusted path and install (dev sibling)', async () => {
    // Host-op impersonation is refused wholesale in sessions mode
    // (SNAPBACK_AUTH_POLICY_UNAVAILABLE — by design), so the operator-lane
    // seed-fixture flow runs on a dev-mode sibling of the same app: same
    // schema and functions, auth mode patched to dev. Diary finding 3.
    const devRoot = join(mkdtempSync2(join(tmpdir(), 'party-wall-dev-')), 'snapback');
    cpSync(backendDir, devRoot, { recursive: true });
    for (const module of ['schema.mjs', 'functions.mjs']) {
      const source = readFileSync(join(devRoot, module), 'utf8');
      writeFileSync(
        join(devRoot, module),
        source
          .replace("auth: { mode: 'sessions' }", "auth: { mode: 'dev' }")
          .replace("'../../_kit/define.mjs'", "'@expo/snapback-codegen/define'"),
      );
    }
    const generatedDev = await generate(devRoot);
    assert.equal(generatedDev.ok, true, JSON.stringify(generatedDev.diagnostics));
    devServer = await startServer({ port: 0, db: ':memory:', cwd: repoRoot, env: { SNAPBACK_ASSET_RUNNER_DISABLED: '1' } });
    cleanups.push(() => devServer.stop());
    const readDevJson = (f) => JSON.parse(readFileSync(join(devRoot, 'generated', f), 'utf8'));
    const devAdmin = new SnapbackClient(devServer.baseUrl, { adminToken: devServer.adminToken });
    const schemaLoad = await devAdmin.loadSchema(readDevJson('schema.manifest.json'));
    assertEqual(
      schemaLoad.diagnostics.filter((d) => d.severity === 'Error' || d.severity === 'Fatal'),
      [],
      'dev schema errors',
    );
    await devAdmin.loadFunctions(readDevJson('functions.manifest.json'));
    const devHostOp = async (operation, input, userId = null) => {
      const response = await fetch(`${devServer.baseUrl}/_snapback/api/host-ops`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-snapback-admin-token': devServer.adminToken,
        },
        body: JSON.stringify({ operation, input, ...(userId ? { userId } : {}) }),
      });
      const body = await response.json();
      assert.equal(response.status, 200, `${operation}: ${JSON.stringify(body)}`);
      assert.equal(body.ok, true, `${operation}: ${JSON.stringify(body.diagnostics ?? body)}`);
      return body.data ?? body.result ?? body;
    };
    const fixtures = readDevJson('seed.asset-fixtures.artifact.json');
    for (const fixture of fixtures.fixtures) {
      const bytes = readFileSync(join(backendDir, fixture.file));
      await devHostOp(
        'asset.ensureSeedFixture',
        {
          fixtureId: fixture.id,
          upload: fixture.upload,
          sourceDigest: fixture.sourceDigest,
          mediaType: fixture.mediaType,
          fileName: fixture.file.split('/').pop(),
          bytesBase64: bytes.toString('base64'),
        },
        'user_pat',
      );
    }
    const ensure = await fetch(`${devServer.baseUrl}/_snapback/api/app/seed/ensure-v1`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-snapback-admin-token': devServer.adminToken,
      },
      body: JSON.stringify({
        formatVersion: 'snapback.seed.install-request.v1',
        operationId: '01982c7a-7c00-7000-8000-000000000001',
        artifact: readDevJson('seed.artifact.json'),
        requestedMode: 'dev',
        assetFixtures: fixtures,
      }),
    });
    const ensured = await ensure.json();
    assert.equal(ensure.status, 200, JSON.stringify(ensured));
    devSeed = { devHostOp, readDevJson, devRoot };
  });

  await suite.check('seeded assets are ready with variants and resolve into rows', async () => {
    const listed = await devSeed.devHostOp('asset.list', { state: 'ready' }, 'user_pat');
    const assets = listed.assets ?? listed.rows ?? listed;
    suiteAssert(Array.isArray(assets) && assets.length >= 4, `expected >=4 ready assets, got ${JSON.stringify(assets).slice(0, 300)}`);
    const photo = assets.find((a) => (a.intentName ?? a.asset?.intentName) === 'photoUpload') ?? assets[0];
    const inspected = await devSeed.devHostOp('asset.inspect', { assetId: photo.assetId }, 'user_pat');
    const record = inspected.record ?? inspected;
    suiteAssert(JSON.stringify(record).includes('thumb'), `seeded photo carries its thumb variant: ${JSON.stringify(record).slice(0, 300)}`);
    const inspectedJson = JSON.stringify(inspected);
    const stagingHits = [...inspectedJson.matchAll(/.{20}staging.{30}/g)].map((m) => m[0]);
    console.log('staging occurrences:', JSON.stringify(stagingHits.slice(0, 5)));
    suiteAssert(!/staging[-_]?key|staging\/[A-Za-z0-9]/.test(inspectedJson), `inspect output carries no staging keys: ${stagingHits.join(' | ')}`);
    const devClient = new SnapbackClient(devServer.baseUrl, { adminToken: devServer.adminToken });
    const devApi = (await importGeneratedModule(join(devSeed.devRoot, 'generated'), 'api.mjs')).default;
    const mapping = await devClient.query(devApi.eventWall, {
      args: { eventId: 'seed-gallery' },
      userId: 'user_pat',
    });
    const rows = mapping.rows ?? mapping.result ?? [];
    assertEqual(rows.length, 3, `three seeded photo posts, got ${JSON.stringify(rows).slice(0, 300)}`);
    suiteAssert(rows.every((r) => typeof r.photo === 'string' && r.photo.length > 0), 'placeholders resolved to asset ids');
  });

  await suite.check('host creates an event and uploads a photo to ready', async () => {
    const created = await mutate(ada, api.createEvent, {
      title: 'Rooftop Party',
      emoji: '🎉',
      startsAt: 1789600000000,
      hostName: 'Ada',
    });
    eventId = created.result;
    suiteAssert(typeof eventId === 'string' && eventId.length > 0, 'event id');
    const photoPng = readFileSync(join(backendDir, 'seed', 'balloons.png'));
    const task = ada.assets.start({ upload: api.photoUpload, file: fileOf(photoPng) });
    const finished = await task.done;
    assertEqual(finished.status, 'ready', `upload ready: ${JSON.stringify(finished.diagnostic ?? null)}`);
    photoAssetId = finished.assetId;
    const record = await ada.assets.record(photoAssetId);
    suiteAssert(
      (record.renditions ?? []).some((r) => r.variant === 'thumb' && r.ready),
      `required thumb variant ready: ${JSON.stringify(record.renditions ?? null)}`,
    );
    suiteAssert(record.media?.placeholder?.value, 'server ThumbHash placeholder present');
  });

  await suite.check('the canonical handler attach lands the post on the live wall', async () => {
    const wall = await ada.client.liveQuery(api.eventWall, {
      connectionId: 'ada_wall',
      args: { eventId },
      authorityCapture: ada.coordinator.capture(),
    });
    assertEqual(wall.rows, [], 'wall starts empty');
    await mutate(ada, api.createPost, {
      eventId,
      caption: 'Balloons up!',
      authorName: 'Ada',
      assetId: photoAssetId,
    });
    // @ref LLP 0200#21-settlement-is-decoupled-from-subscriber-work — served
    // fan-out runs after mutation settlement, so one immediate drain races the
    // scheduler. Poll until the authorization-backed replacement is ready.
    const rows = await eventually(async () => {
      const polled = await wall.poll();
      assertEqual(
        polled.map((r) => [r.caption, r.photo]),
        [['Balloons up!', photoAssetId]],
        'live wall row',
      );
      return polled;
    }, 'party-wall live replacement');
    assertEqual(rows.map((r) => [r.caption, r.photo]), [['Balloons up!', photoAssetId]], 'live wall row');
  });

  await suite.check('membership grant: joining makes the photo readable', async () => {
    const before = await authorizedFetch(grace, `/assets/records/${photoAssetId}/bytes/thumb`);
    suiteAssert(before.status === 403 || before.status === 404, `pre-join delivery must refuse, got ${before.status}`);
    await mutate(ada, api.addGuest, { eventId, userId: grace.userId });
    const after = await authorizedFetch(grace, `/assets/records/${photoAssetId}/bytes/thumb`);
    assert.equal(after.status, 200, 'post-join delivery');
    assert.equal(after.headers.get('cache-control')?.includes('no-store'), true, 'strict no-store');
    const record = await grace.assets.record(photoAssetId);
    suiteAssert(record.media?.placeholder?.value, 'member reads metadata incl. placeholder');
  });

  await suite.check('membership revoke: leaving takes the photo away', async () => {
    await mutate(grace, api.leaveEvent, { eventId });
    const after = await authorizedFetch(grace, `/assets/records/${photoAssetId}/bytes/thumb`);
    suiteAssert(after.status === 403 || after.status === 404, `post-leave delivery must refuse, got ${after.status}`);
    const metadata = await refusalOf(() => grace.assets.record(photoAssetId));
    suiteAssert(metadata !== null, 'post-leave metadata refused');
  });

  await suite.check('a never-member sees nothing: wall gated, asset refused', async () => {
    const wall = await eve.client.liveQuery(api.eventWall, {
      connectionId: 'eve_wall',
      args: { eventId },
      authorityCapture: eve.coordinator.capture(),
    });
    assertEqual(wall.rows, [], 'membership-gated wall is empty for eve');
    const delivery = await authorizedFetch(eve, `/assets/records/${photoAssetId}/bytes/thumb`);
    suiteAssert(delivery.status === 403 || delivery.status === 404, 'asset refused for eve');
  });

  await suite.check('the cover publishes public-immutable and serves without auth', async () => {
    const coverPng = readFileSync(join(backendDir, 'seed', 'cover-sunset.png'));
    const task = ada.assets.start({ upload: api.coverUpload, file: fileOf(coverPng, 'cover.png') });
    const finished = await task.done;
    assertEqual(finished.status, 'ready', 'cover upload ready');
    await mutate(ada, api.setCover, { eventId, assetId: finished.assetId });
    // Sessions-mode servers refuse ANY request without the auth-client
    // protocol header — including the "public" asset lane, which therefore
    // is not URL-pasteable (no plain <img src>, no CDN pull). Recorded as a
    // finding + ticket; the suite sends the header to prove the lane
    // itself.
    const anonymous = await fetch(`${server.baseUrl}/assets/public/${finished.assetId}/card`, {
      headers: { 'x-snapback-auth-client-protocol': '1' },
    });
    assert.equal(
      anonymous.status,
      200,
      `anonymous public delivery: ${anonymous.status} ${await anonymous.text().catch(() => '')}`,
    );
    suiteAssert(
      (anonymous.headers.get('cache-control') ?? '').includes('immutable'),
      `immutable cache posture, got ${anonymous.headers.get('cache-control')}`,
    );
  });

  await suite.check('a signed URL is a bounded bearer; strict photos refuse issuance', async () => {
    const strict = await authorizedFetch(ada, `/assets/records/${photoAssetId}/signed-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant: 'thumb', ttlMs: 60000 }),
    });
    assert.equal(strict.status, 422, `strict issuance must refuse, got ${strict.status}`);
    const sharePng = readFileSync(join(backendDir, 'seed', 'confetti.png'));
    const shareTask = ada.assets.start({ upload: api.sharePhotoUpload, file: fileOf(sharePng, 'share.png') });
    const share = await shareTask.done;
    assertEqual(share.status, 'ready', 'share upload ready');
    const issued = await authorizedFetch(ada, `/assets/records/${share.assetId}/signed-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant: 'thumb', ttlMs: 60000 }),
    });
    const body = await issued.json();
    assert.equal(issued.status, 200, JSON.stringify(body));
    const bare = await fetch(`${server.baseUrl}${body.url}`, {
      headers: { 'x-snapback-auth-client-protocol': '1' },
    });
    assert.equal(bare.status, 200, 'signed URL serves without a session');
    const foreign = await authorizedFetch(eve, `/assets/records/${share.assetId}/signed-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant: 'thumb' }),
    });
    suiteAssert(foreign.status === 403 || foreign.status === 404, 'foreign issuance refused');
  });

  await suite.check('explicit delete refuses while the post references the photo', async () => {
    const refused = await authorizedFetch(ada, `/assets/records/${photoAssetId}`, { method: 'DELETE' });
    const body = await refused.json().catch(() => ({}));
    assert.equal(refused.status, 409, `referenced delete must 409, got ${refused.status}: ${JSON.stringify(body)}`);
  });

  await suite.check('deleting the post clears the edge; an on-demand GC sweep reclaims the photo', async () => {
    const posts = await ada.client.liveQuery(api.eventWall, {
      connectionId: 'ada_wall_2',
      args: { eventId },
      authorityCapture: ada.coordinator.capture(),
    });
    const postId = posts.rows[0]._id;
    await mutate(ada, api.deletePost, { postId });
    const sweepNowMs = Date.now() + 62_000;
    const swept = await hostOp('asset.gcSweep', { nowMs: sweepNowMs });
    assert.equal(swept.nowMs, sweepNowMs, 'operator sweep echoes its injected clock');
    // The earlier signed-bearer exercise intentionally leaves another ready,
    // unreferenced asset behind, so this app-wide sweep may reclaim both.
    // Prove the target specifically by its post-sweep delivery refusal below.
    suiteAssert(swept.report.referenceReclaimed >= 1, `reference GC report: ${JSON.stringify(swept)}`);
    const after = await authorizedFetch(ada, `/assets/records/${photoAssetId}/bytes/thumb`);
    suiteAssert(after.status === 403 || after.status === 404, 'GC-reclaimed asset stops serving');
  });
});

for (const cleanup of cleanups.reverse()) {
  try {
    await cleanup();
  } catch {
    // best-effort teardown
  }
}
