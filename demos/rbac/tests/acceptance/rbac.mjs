import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../../packages/snapback-contract/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const generatedRoot = join(here, '..', '..', 'snapback', 'generated');
const scratch = await mkdtemp(join(tmpdir(), 'snapback-rbac-demo-'));
const sessions = [];
let server = null;

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function mintSession(appId, email, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    clientStoreId,
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
  await client.authExchange({ challengeId: requested.challengeId, code: mailbox.code });
  const session = { client, coordinator };
  sessions.push(session);
  return session;
}

try {
  const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
  const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, { mode: 0o600 });

  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });

  const alice = await mintSession(schema.appId, 'alice@rbac.test', 'rbac-alice');
  const bob = await mintSession(schema.appId, 'bob@rbac.test', 'rbac-bob');
  const eve = await mintSession(schema.appId, 'eve@rbac.test', 'rbac-eve');

  await alice.client.mutate('joinApp', { args: {} });
  await alice.client.mutate('postAnnouncement', { args: { message: 'members only' } });

  const [aliceLive, bobLive] = await Promise.all([
    alice.client.subscribeLive('listAnnouncements', {
      connectionId: 'rbac-alice-live',
      authorizationNamespace: {
        clientStoreId: 'rbac-alice',
        queryKey: 'listAnnouncements:{}',
        queryInstanceId: 1,
      },
    }),
    bob.client.subscribeLive('listAnnouncements', {
      connectionId: 'rbac-bob-live',
      authorizationNamespace: {
        clientStoreId: 'rbac-bob',
        queryKey: 'listAnnouncements:{}',
        queryInstanceId: 1,
      },
    }),
  ]);
  assert.deepEqual(aliceLive.snapshot.rows.map(({ message }) => message), ['members only']);
  assert.deepEqual(bobLive.snapshot.rows, [], 'a non-member live subscription starts empty');

  const [aliceRows, bobRows] = await Promise.all([
    alice.client.query('listAnnouncements', { args: {} }),
    bob.client.query('listAnnouncements', { args: {} }),
  ]);
  assert.deepEqual(aliceRows.rows.map(({ message }) => message), ['members only']);
  assert.deepEqual(bobRows.rows, [], 'a non-member cannot see existing rows');

  await assert.rejects(
    () => bob.client.mutate('postAnnouncement', { args: { message: 'not yet' } }),
    (error) => error?.diagnostic?.code === 'SNAPBACK_AUTH_PERMISSION_DENIED',
    'ctx.permissions must deny a non-member with the invariant role diagnostic',
  );

  await bob.client.mutate('joinApp', { args: {} });
  await bob.client.mutate('postAnnouncement', { args: { message: 'hello from bob' } });
  assert.deepEqual(
    (await bob.client.query('listAnnouncements', { args: {} })).rows.map(({ message }) => message),
    ['members only', 'hello from bob'],
  );

  await assert.rejects(
    () => eve.client.mutate('rawJoin', { args: {} }),
    (error) => error?.diagnostic?.code === 'SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED',
    'raw ctx.db membership writes must remain closed below the handler',
  );
  assert.deepEqual(
    (await eve.client.query('listAnnouncements', { args: {} })).rows,
    [],
    'a refused raw write grants no authority',
  );

  console.log('rbac generated authoring and enforcement proof: ok');
} finally {
  for (const { client, coordinator } of sessions) {
    try { await client.closeAuth(); } catch { /* preserve the primary failure */ }
    try { await coordinator.close(); } catch { /* preserve the primary failure */ }
  }
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}
