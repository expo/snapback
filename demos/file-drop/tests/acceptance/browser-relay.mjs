// file-drop / browser relay — the complete paved browser asset path, proven
// against a real Vite dev server and a real sessions-mode Snapback server:
// the stock @expo/snapback-vite relay forwards the whole author-facing
// `/assets/*` family (no app-owned proxy), sessions custody signs the browser
// in through the trusted-local mailbox seam (admin + impersonation carriers
// stay server-side), the generated upload reference is used exactly as typed
// (`api.photoUpload`, no cast), and the public rendition serves through the
// relay to a plain fetch. Closes
// issues/20260802-guide-gap-react-asset-vite-path.md.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer as createViteServer } from 'vite';
import { snapbackDev } from '@expo/snapback-vite';
import { SnapbackClient } from '@expo/snapback-client';
import { createAssetClient } from '@expo/snapback-client/assets';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';

import { importGeneratedModule, readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, '..', '..');
const repoRoot = join(demoRoot, '..', '..');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');

const suite = createSuite('file-drop / browser relay', { expectedChecks: 7 });
const cleanups = [];

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createNetServer();
    probe.once('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

await runAcceptance(suite, async () => {
  const schemaManifest = readGeneratedJson(generatedRoot, 'schema.manifest.json');
  const functionsManifest = readGeneratedJson(generatedRoot, 'functions.manifest.json');
  const carrier = join(mkdtempSync(join(tmpdir(), 'file-drop-relay-')), 'startup-artifacts.json');
  writeFileSync(
    carrier,
    `${JSON.stringify({ formatVersion: 1, schema: schemaManifest, functions: functionsManifest })}\n`,
    { mode: 0o600 },
  );
  const server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });
  cleanups.push(() => server.stop());

  // The browser-safe sessions seam the demo's vite.config.ts ships: a
  // trusted-local middleware reads the admin-gated dev mailbox server-side
  // and hands the page only the one-time code. Neither carrier is relayed.
  const mailboxSeam = {
    name: 'file-drop-test-mailbox',
    configureServer(viteDevServer) {
      viteDevServer.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/__snapmailbox')) return next();
        const challengeId = new URL(request.url, 'http://file-drop.local').searchParams.get('challengeId');
        const mailbox = await fetch(
          `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(challengeId ?? '')}`,
          {
            headers: {
              'x-snapback-admin-token': server.adminToken,
              'x-snapback-impersonation-capability': server.impersonationCapability,
            },
          },
        );
        response.statusCode = mailbox.status;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('cache-control', 'no-store');
        return response.end(await mailbox.text());
      });
    },
  };

  const vitePort = await freePort();
  const viteServer = await createViteServer({
    root: demoRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      mailboxSeam,
      snapbackDev({
        server: { mode: 'external', url: server.baseUrl },
        projectRoot: demoRoot,
        generatedRoots: ['snapback/generated'],
      }),
    ],
    server: { host: '127.0.0.1', port: vitePort, strictPort: true },
  });
  await viteServer.listen();
  cleanups.push(() => viteServer.close());
  const origin = `http://127.0.0.1:${vitePort}`;
  const appBaseUrl = `${origin}/__snapback`;

  await suite.check('relay-health', async () => {
    const health = await (await fetch(`${appBaseUrl}/health`)).json();
    assert.equal(health.ok, true);
    return { target: health.target };
  });

  await suite.check('relay-refuses-system-routes', async () => {
    const refused = await fetch(`${appBaseUrl}/_snapback/api/auth/mailbox?challengeId=x`);
    assert.equal(refused.status, 403);
    const body = await refused.json();
    assert.equal(body.diagnostic?.code, 'SNAPBACK_DEV_PROXY_ROUTE_REFUSED');
    return { code: body.diagnostic.code };
  });

  const coordinator = new AuthCoordinator({
    appId: schemaManifest.appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(appBaseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: 'file_drop_browser_relay',
  });
  const assets = createAssetClient(client);

  await suite.check('sessions-sign-in-via-mailbox-seam', async () => {
    const challenge = await client.authRequestCode('acceptance@snapdrop.local');
    const mailboxResponse = await fetch(
      `${origin}/__snapmailbox?challengeId=${encodeURIComponent(challenge.challengeId)}`,
    );
    assert.equal(mailboxResponse.status, 200);
    const mailbox = await mailboxResponse.json();
    const credential = await client.authExchange({
      challengeId: challenge.challengeId,
      code: mailbox.code,
    });
    assert.equal(typeof credential.session.userId, 'string');
    return { userId: credential.session.userId };
  });

  const connectionId = 'file_drop_browser_relay_conn';
  let observed = [];
  const live = await client.liveQuery(api.listPhotos, {
    connectionId,
    args: {},
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate: (rows) => { observed = rows; },
  });
  observed = live.rows;
  cleanups.push(() => client.releaseConnection(connectionId).catch(() => {}));
  cleanups.push(() => live.dispose());

  let finished = null;
  await suite.check('upload-ready-through-relay', async () => {
    const bytes = readFileSync(join(repoRoot, 'demos', 'party-wall', 'snapback', 'seed', 'balloons.png'));
    const file = new Blob([bytes], { type: 'image/png' });
    const task = assets.start({
      upload: api.photoUpload,
      file,
      declaredFilename: 'snapback-balloons.png',
      declaredContentType: 'image/png',
    });
    finished = await task.done;
    assert.equal(finished.status, 'ready', JSON.stringify(finished.diagnostic));
    return { assetId: finished.assetId };
  });

  let created = null;
  await suite.check('typed-attachment', async () => {
    created = await client.mutate(api.createPhoto, {
      args: { title: 'Snapback balloons', assetId: finished.assetId },
    });
    assert.equal(typeof created.result, 'string');
    return { photoId: created.result };
  });

  await suite.check('live-gallery-update', async () => {
    const deadline = Date.now() + 10_000;
    while (!observed.some((photo) => photo._id === created.result) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(
      observed.some((photo) => photo._id === created.result),
      'live gallery did not receive the photo over the relayed stream',
    );
    return { rows: observed.length };
  });

  await suite.check('public-image-delivery-through-relay', async () => {
    const delivered = await fetch(
      `${appBaseUrl}/assets/public/${encodeURIComponent(finished.assetId)}/display`,
    );
    assert.equal(delivered.status, 200);
    assert.match(delivered.headers.get('content-type') ?? '', /^image\//);
    assert.ok((await delivered.arrayBuffer()).byteLength > 0);
    return { assetId: finished.assetId };
  });
}, { cleanups });
