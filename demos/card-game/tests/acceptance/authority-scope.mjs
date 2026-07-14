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
const snapbackRoot = join(here, '..', '..', 'snapback');
const generatedRoot = join(snapbackRoot, 'generated');
const gameId = 'game_1';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function mintSession(server, appId, email, clientStoreId) {
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
    authorizedLeaseProtocol: 1,
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
  const credential = await client.authExchange({
    challengeId: requested.challengeId,
    code: mailbox.code,
  });
  return { client, coordinator, credential };
}

const scratch = await mkdtemp(join(tmpdir(), 'snapback-card-game-auth-'));
let server = null;
try {
  const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
  const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(carrier, `${JSON.stringify({
    formatVersion: 1,
    schema,
    functions,
  })}\n`, { mode: 0o600 });

  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });

  const ada = await mintSession(server, schema.appId, 'ada@card-game.test', 'card-game-ada');
  const grace = await mintSession(server, schema.appId, 'grace@card-game.test', 'card-game-grace');
  assert.notEqual(ada.credential.session.id, grace.credential.session.id);
  assert.notEqual(ada.credential.session.userId, grace.credential.session.userId);

  // Setup itself is authority-scoped: the authenticated mutation has no
  // owner argument and stamps every row from the prepared session principal.
  await Promise.all([
    ada.client.mutate('acceptHandCard', {
      args: { gameId, position: 1, card: 'ace-spades' },
    }),
    ada.client.mutate('acceptHandCard', {
      args: { gameId, position: 2, card: 'queen-hearts' },
    }),
    grace.client.mutate('acceptHandCard', {
      args: { gameId, position: 1, card: 'king-clubs' },
    }),
    grace.client.mutate('acceptHandCard', {
      args: { gameId, position: 2, card: 'ten-diamonds' },
    }),
  ]);

  const [adaResult, graceResult] = await Promise.all([
    ada.client.query('myHand', { args: { gameId } }),
    grace.client.query('myHand', { args: { gameId } }),
  ]);
  assert.deepEqual(adaResult.rows.map(({ card }) => card), ['ace-spades', 'queen-hearts']);
  assert.deepEqual(graceResult.rows.map(({ card }) => card), ['king-clubs', 'ten-diamonds']);
  assert.equal(
    adaResult.rows.some(({ card }) => graceResult.rows.some((row) => row.card === card)),
    false,
  );

  // Even beside a valid bearer, legacy body authority is rejected rather
  // than ignored or stamped over the server-derived session principal.
  const spoofResponse = await fetch(`${server.baseUrl}/query/myHand`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ada.coordinator.settledView().bearer}`,
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
    },
    body: JSON.stringify({
      args: { gameId },
      auth: SnapbackClient.auth(grace.credential.session.userId),
    }),
  });
  const spoof = await spoofResponse.json();
  assert.equal(spoofResponse.status, 400, JSON.stringify(spoof));
  assert.equal(spoof.diagnostic?.code, 'SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED');

  console.log('card-game real session authority-scope proof: ok');
} finally {
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}
