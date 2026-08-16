// Card-game acceptance for LLP 0043's JS-arm sessions-custody queue. This
// demo owns a real sessions-mode auth provider; public-dashboard does not, so
// the ratified session replacement and cross-principal rows live here.
//
// @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — capture-at-enqueue,
//   strand-on-instance-change, and cross-principal privacy deletion.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asUser } from '../../../_kit/as-user.mjs';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../../packages/snapback-contract/index.mjs';
import { createFileRqsResumeStore } from '../../../../packages/snapback-client/rqs-store-file.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const generatedRoot = join(here, '..', '..', 'snapback', 'generated');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const scratch = await mkdtemp(join(tmpdir(), 'snapback-offline-sessions-custody-'));
const dbPath = join(scratch, 'card-game.db');
const store = createFileRqsResumeStore({
  directory: join(scratch, 'rqs'),
  identity: 'offline-sessions-custody',
  clientStoreId: 'offline-sessions-custody',
});
await store.whenLockSettled();

const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
const carrier = join(scratch, 'startup-artifacts.json');
await writeFile(carrier, `${JSON.stringify({
  formatVersion: 1,
  schema,
  functions,
})}\n`, { mode: 0o600 });

const port = await freePort();
let server = null;
const bootServer = async () => {
  server = await startServer({
    port,
    bindPortExactly: true,
    db: dbPath,
    cwd: repoRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });
  return server;
};

const clientForCustody = (custodyState, rqsStore = store) => {
  const coordinator = new AuthCoordinator({
    appId: schema.appId,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: 'offline-sessions-custody',
    rqsStore,
  });
  return { client, coordinator, custodyState };
};

async function mintSession(email, { rqsStore = null } = {}) {
  const custodyState = { custody: {} };
  return asUser(server, schema.appId, email, {
    clientStoreId: 'offline-sessions-custody',
    custodyState,
    clientOptions: { rqsStore },
  });
}

const suite = createSuite('card-game / offline sessions custody (JS arm)', {
  expectedChecks: 3,
});

const clients = new Set();
const track = (session) => {
  clients.add(session.client);
  return session;
};
const closeClient = async (client) => {
  clients.delete(client);
  await client.closeAuth();
};

try {
  await bootServer();
  const firstAda = track(await mintSession('ada-offline-custody@card-game.test', {
    rqsStore: store,
  }));

  await runAcceptance(suite, async () => {
    let currentAda = firstAda;

    await suite.check('cold-process same-authority replay is durable-before-send and exactly-once', async () => {
      await server.stop();
      const queued = await currentAda.client.mutate('acceptHandCard', {
        args: { gameId: 'game_1', position: 20, card: 'cold-replay-card' },
      });
      assertEqual(queued.status, 'queued', 'offline mutation queued');
      const durableBeforeSend = await store.outboxPending();
      assertEqual(durableBeforeSend.length, 1, 'record persisted before any send can succeed');
      assertEqual(durableBeforeSend[0].id, queued.clientMutationId, 'durable identity');
      const storedDescriptor = structuredClone(durableBeforeSend[0].authorityDescriptor);
      const custodyState = currentAda.custodyState;
      await closeClient(currentAda.client);

      await bootServer();
      currentAda = track(clientForCustody(custodyState));
      await currentAda.client.authSession();
      const replay = await currentAda.client.replayQueuedMutations();
      assertEqual(replay.replayed, 1, 'fresh client drains predecessor durable intent');
      await currentAda.client.replayQueuedMutations();
      const hand = await currentAda.client.query('myHand', { args: { gameId: 'game_1' } });
      assertEqual(
        hand.rows.filter(({ card }) => card === 'cold-replay-card').length,
        1,
        'duplicate drain does not duplicate execution',
      );
      return {
        durableBeforeSend: true,
        clientMutationId: queued.clientMutationId,
        authorityInstanceId: storedDescriptor.authorityInstanceId,
      };
    });

    await suite.check('same-user replacement strands and explicit rerecord mints a new intent', async () => {
      await server.stop();
      const predecessor = await currentAda.client.mutate('acceptHandCard', {
        args: { gameId: 'game_1', position: 21, card: 'rerecorded-card' },
      });
      assertEqual(predecessor.status, 'queued', 'predecessor queued offline');
      await closeClient(currentAda.client);

      await bootServer();
      const replacementMint = await mintSession('ada-offline-custody@card-game.test');
      assertEqual(
        replacementMint.credential.session.userId,
        firstAda.credential.session.userId,
        'replacement is the same principal',
      );
      assert(
        replacementMint.credential.authorityDescriptor.authorityInstanceId
          !== firstAda.credential.authorityDescriptor.authorityInstanceId,
        'replacement session has a new authority instance',
      );
      const replacementState = replacementMint.custodyState;
      await replacementMint.client.closeAuth();
      currentAda = track(clientForCustody(replacementState));
      await currentAda.client.authSession();

      const stranded = await currentAda.client.strandedMutations();
      assertEqual(stranded.length, 1, 'old instance is visible as stranded');
      assertEqual(stranded[0].clientMutationId, predecessor.clientMutationId, 'predecessor id');
      const successorId = await currentAda.client.reRecordStrandedMutation(
        predecessor.clientMutationId,
      );
      assert(successorId !== predecessor.clientMutationId, 'rerecord mints a new id');
      const hand = await currentAda.client.query('myHand', { args: { gameId: 'game_1' } });
      assertEqual(
        hand.rows.filter(({ card }) => card === 'rerecorded-card').length,
        1,
        'new intent settles once under replacement session',
      );
      return {
        predecessorClientMutationId: predecessor.clientMutationId,
        successorClientMutationId: successorId,
        strandedReason: stranded[0].reason,
      };
    });

    await suite.check('user switch privacy-deletes predecessor queue with diagnostic count', async () => {
      await server.stop();
      const privateQueued = await currentAda.client.mutate('acceptHandCard', {
        args: { gameId: 'game_1', position: 22, card: 'must-never-cross-principals' },
      });
      assertEqual(privateQueued.status, 'queued', 'predecessor private mutation queued');
      // Every fenced disposition in the shared store belongs to the
      // predecessor principal: the settled rows from the two checks above
      // plus this pending intent. The cross-principal boundary deletes them
      // all — settled cohorts carry args and settlement claims — and reports
      // exactly that count (ruled: delete-with-diagnostic-count).
      const predecessorFenced = (await store.outboxRecords())
        .filter((record) => record.principalScope != null);
      assert(predecessorFenced.length >= 1, 'predecessor fenced records exist');
      assert(
        predecessorFenced.some((record) => record.status === 'settled'),
        'predecessor settled cohort present at the boundary',
      );
      await closeClient(currentAda.client);

      await bootServer();
      const graceMint = await mintSession('grace-offline-custody@card-game.test');
      assert(
        graceMint.credential.session.userId !== firstAda.credential.session.userId,
        'successor is a different principal',
      );
      const graceState = graceMint.custodyState;
      await graceMint.client.closeAuth();
      const grace = track(clientForCustody(graceState));
      await grace.client.authSession();

      const diagnostic = grace.client.outboxDiagnostics.find((entry) => (
        entry.code === 'SNAPBACK_OFFLINE_MUTATIONS_DELETED_AUTHORITY_CHANGE'
      ));
      assertEqual(
        diagnostic?.deleted,
        predecessorFenced.length,
        'privacy deletion reports only the count',
      );
      assertEqual((await grace.client.outboxStatus()).pending, 0, 'successor sees no pending intent');
      assertEqual((await grace.client.strandedMutations()).length, 0, 'successor sees no tombstone');
      assertEqual((await store.outboxRecords()).some((record) => (
        record.id === privateQueued.clientMutationId
      )), false, 'payload-bearing predecessor record is gone');
      return { deleted: diagnostic.deleted, successorVisibleRecords: 0 };
    });
  });
} finally {
  for (const client of [...clients]) {
    try { await closeClient(client); } catch { /* teardown */ }
  }
  try { await server?.stop(); } catch { /* teardown */ }
  try { await store.close(); } catch { /* teardown */ }
  await rm(scratch, { recursive: true, force: true });
}
