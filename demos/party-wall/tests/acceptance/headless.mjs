// Party Wall — headless acceptance suite (the required surface).
//
// The first demo consumer of the full LLP 0044 asset story, driven over a
// real sessions-mode server with real bearer custody: seeded fixtures ingest
// through the trusted path, a host uploads a GPS-stripped photo with required
// variants and attaches it through the canonical `ctx.assets.attach` handler,
// the wall updates live, membership joins grant `via-references` reads and
// leaves revoke them, covers deliver public-immutable, signed URLs act as
// bounded bearers, and deletion walks the referenced-refusal → cascade path.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
      clientStoreId: `store-${email}`,
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
    assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
    const credential = await client.authExchange({
      challengeId: requested.challengeId,
      code: mailbox.code,
    });
    cleanups.push(() => client.dispose?.());
    return {
      client,
      coordinator,
      credential,
      userId: credential.session.userId,
      assets: new SnapbackAssetClient(client),
      bearer: () => coordinator.credentialFor(coordinator.capture()).bearer,
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

  await suite.check('seed fixtures ingest through the trusted path and install', async () => {
    const fixtures = gen('seed.asset-fixtures.artifact.json');
    for (const fixture of fixtures.fixtures) {
      const bytes = readFileSync(join(backendDir, fixture.file));
      await hostOp(
        'asset.ensureSeedFixture',
        {
          fixtureId: fixture.id,
          upload: fixture.upload,
          sourceDigest: fixture.sourceDigest,
          mediaType: fixture.mediaType,
          fileName: fixture.file.split('/').pop(),
          bytesBase64: bytes.toString('base64'),
        },
        pat.userId,
      );
    }
    const seedArtifact = gen('seed.artifact.json');
    const ensure = await fetch(`${server.baseUrl}/_snapback/api/app/seed/ensure-v1`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-snapback-admin-token': server.adminToken,
      },
      body: JSON.stringify({
        formatVersion: 'snapback.seed-install-request.v1',
        operationId: '01982c7a-7c00-7000-8000-000000000001',
        artifact: seedArtifact,
        requestedMode: 'sessions',
        assetFixtures: gen('seed.asset-fixtures.artifact.json'),
      }),
    });
    const ensured = await ensure.json();
    assert.equal(ensure.status, 200, JSON.stringify(ensured));
    const seededEvent = await pat.client.query(api.getEvent, {
      args: { eventId: 'seed-gallery' },
      authorityCapture: pat.coordinator.capture(),
    });
    const row = seededEvent.rows?.[0] ?? seededEvent.result;
    assertEqual(row.title, 'Sample Gallery', 'seeded event installs');
    suiteAssert(typeof row.cover === 'string' && row.cover.length > 0, 'seeded cover resolved to an asset id');
    seededPhotoId = null;
  });

  await suite.check('seeded photos serve to their owner and refuse a stranger', async () => {
    const inspected = await hostOp('asset.list', { state: 'ready' }, pat.userId);
    const assets = inspected.assets ?? inspected.rows ?? inspected;
    suiteAssert(Array.isArray(assets) && assets.length >= 4, `expected >=4 ready assets, got ${JSON.stringify(assets).slice(0, 200)}`);
    seededPhotoId = assets.find((a) => (a.intent ?? a.upload) === 'photoUpload')?.assetId ?? assets[0].assetId;
    suiteAssert(seededPhotoId, 'seeded photo id');
    const owner = await authorizedFetch(pat, `/assets/records/${seededPhotoId}/bytes/thumb`);
    assert.equal(owner.status, 200, 'owner delivery');
    const stranger = await authorizedFetch(eve, `/assets/records/${seededPhotoId}/bytes/thumb`);
    suiteAssert(stranger.status === 403 || stranger.status === 404, `stranger delivery must refuse, got ${stranger.status}`);
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
    const rows = await wall.poll();
    assertEqual(rows.map((r) => [r.caption, r.photoId]), [['Balloons up!', photoAssetId]], 'live wall row');
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
    const anonymous = await fetch(`${server.baseUrl}/assets/public/${finished.assetId}/card`);
    assert.equal(anonymous.status, 200, 'anonymous public delivery');
    suiteAssert(
      (anonymous.headers.get('cache-control') ?? '').includes('immutable'),
      `immutable cache posture, got ${anonymous.headers.get('cache-control')}`,
    );
  });

  await suite.check('a signed URL is a bounded bearer for a private photo', async () => {
    const issued = await authorizedFetch(ada, `/assets/records/${photoAssetId}/signed-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant: 'thumb', ttlMs: 60000 }),
    });
    const body = await issued.json();
    assert.equal(issued.status, 200, JSON.stringify(body));
    const bare = await fetch(`${server.baseUrl}${body.url}`);
    assert.equal(bare.status, 200, 'signed URL serves without a session');
    const foreign = await authorizedFetch(eve, `/assets/records/${photoAssetId}/signed-url`, {
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

  await suite.check('deleting the post clears the edge; the asset then deletes and stops serving', async () => {
    const posts = await ada.client.liveQuery(api.eventWall, {
      connectionId: 'ada_wall_2',
      args: { eventId },
      authorityCapture: ada.coordinator.capture(),
    });
    const postId = posts.rows[0]._id;
    await mutate(ada, api.deletePost, { postId });
    // Reference GC (graceMs 61s) would reclaim this asset on the runner's
    // sweep; the runner is disabled for determinism, so the demo proves the
    // edge-cleared state by the now-admissible explicit delete instead.
    const deleted = await authorizedFetch(ada, `/assets/records/${photoAssetId}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200, 'unreferenced delete succeeds');
    const after = await authorizedFetch(ada, `/assets/records/${photoAssetId}/bytes/thumb`);
    suiteAssert(after.status === 403 || after.status === 404, 'deleted asset stops serving');
  });
});

for (const cleanup of cleanups.reverse()) {
  try {
    await cleanup();
  } catch {
    // best-effort teardown
  }
}
