import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
} from '../../../../packages/snapback-contract/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const snapbackRoot = join(here, '..', '..', 'snapback');
const generatedRoot = join(snapbackRoot, 'generated');
const gameId = 'game_1';
const retainedQueryKey = `myHand:${JSON.stringify({ gameId })}`;

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function mutateFixture(client, name, args, clientMutationId) {
  const authorityCapture = client.authCoordinator.capture();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.mutate(name, {
        args,
        clientMutationId,
        authorityCapture,
      });
    } catch (error) {
      const code = error?.code ?? error?.diagnostic?.code;
      if (code !== 'SNAPBACK_AUTH_RESERVATION_STALE' || attempt >= 2) throw error;
      // Reservation staleness is known-before-transaction. Re-enter through a
      // fresh coordinated read, but never reinterpret this fixture write under
      // a real authority successor.
      await client.currentAuthorizationScope();
      if (!client.authCoordinator.isCurrent(authorityCapture)) throw error;
    }
  }
}

const contractRuntime = {
  createContractMockQueryBoundary(initialRows) {
    const rows = new Map(Object.entries(initialRows));
    const listeners = new Map();
    return {
      current: (key) => rows.get(key) ?? [],
      query: (key, project = (value) => value) => project(rows.get(key) ?? []),
      write(key, update) {
        const next = update(rows.get(key) ?? []);
        rows.set(key, next);
        for (const listener of listeners.get(key) ?? []) listener(next);
        return next;
      },
      subscribe(key, listener) {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(listener);
        return () => listeners.get(key)?.delete(listener);
      },
    };
  },
  createBoundaryContractDataProvider(_manifest, boundary, options) {
    return {
      boundary,
      subscribe(name, args, observer) {
        observer({ status: 'ready', rows: options.queries[name](args, boundary) });
        return { dispose() {} };
      },
    };
  },
  createProviderQueryHandle() { return { dispose() {} }; },
  createProviderEphemeralHandle() { return { dispose() {} }; },
};

async function eventually(assertion, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await delay(25);
    }
  }
  throw new Error(`${message}: ${lastError?.message ?? 'timed out'}`);
}

async function mintSession(server, appId, email, clientStoreId) {
  const custodyState = { custody: {} };
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
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
  return { client, coordinator, credential, custodyState, clientStoreId };
}

async function contractOptions({
  session,
  store,
  schema,
  functions,
  artifacts,
  contractManifest,
  connectionId,
}) {
  const grant = await session.client.connectionGrant(connectionId);
  const versionStreamId = grant.authorizationInvalidation?.versionStream;
  assert.equal(typeof versionStreamId, 'string');
  return {
    runtime: contractRuntime,
    client: session.client,
    clientStore: store,
    manifest: contractManifest,
    artifactIndex: artifacts,
    schemaManifest: schema,
    functionManifest: functions,
    queryName: 'myHand',
    boundaryKey: 'hand',
    queryArgs: { gameId },
    connectionId,
    livePush: true,
    retainedIdentity: {
      appId: schema.appId,
      databaseId: 'card-game-acceptance',
      targetProfileId: schema.targetProfile,
      versionStreamId,
    },
  };
}

const scratch = await mkdtemp(join(tmpdir(), 'snapback-card-game-auth-'));
let server = null;
let acceptancePhase = 'startup';
const surfaces = new Set();
const sessions = [];
const originalDateNow = Date.now;
const trackSurface = async (options) => {
  const surface = await createSnapbackContractSurface(options);
  surfaces.add(surface);
  return surface;
};
const disposeSurface = async (surface) => {
  if (!surface) return;
  surfaces.delete(surface);
  await surface.dispose();
};
try {
  const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
  const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
  const artifacts = await readJson(join(generatedRoot, 'artifacts.json'));
  const contractManifest = await readJson(join(generatedRoot, 'contract-data.manifest.json'));
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

  acceptancePhase = 'mint Ada session';
  const ada = await mintSession(server, schema.appId, 'ada@card-game.test', 'card-game-ada');
  acceptancePhase = 'mint Grace session';
  const grace = await mintSession(server, schema.appId, 'grace@card-game.test', 'card-game-grace');
  sessions.push(ada, grace);
  assert.notEqual(ada.credential.session.id, grace.credential.session.id);
  assert.notEqual(ada.credential.session.userId, grace.credential.session.userId);

  // Setup itself is authority-scoped: the authenticated mutation has no
  // owner argument and stamps every row from the prepared session principal.
  // The scenario proves authority isolation, not reservation contention, so
  // install its fixture serially: concurrent protected writes may legitimately
  // make a one-shot authorization reservation stale before SQLite begins.
  acceptancePhase = 'install hidden-hand fixture';
  for (const [client, clientMutationId, args] of [
    [ada.client, 'cm_card_game_ada_1', { gameId, position: 1, card: 'ace-spades' }],
    [ada.client, 'cm_card_game_ada_2', { gameId, position: 2, card: 'queen-hearts' }],
    [grace.client, 'cm_card_game_grace_1', { gameId, position: 1, card: 'king-clubs' }],
    [grace.client, 'cm_card_game_grace_2', { gameId, position: 2, card: 'ten-diamonds' }],
  ]) {
    await mutateFixture(client, 'acceptHandCard', args, clientMutationId);
  }

  acceptancePhase = 'query principal-isolated hands';
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
  acceptancePhase = 'reject legacy body authority';
  const adaCapture = ada.coordinator.capture();
  const adaBearer = ada.coordinator.credentialFor(adaCapture).bearer;
  const spoofResponse = await fetch(`${server.baseUrl}/query/myHand`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adaBearer}`,
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

  const adaStore = createMemorySnapbackClientStore();
  const graceStoreState = {};
  const graceStore = createMemorySnapbackClientStore({ state: graceStoreState });
  acceptancePhase = 'create Contract surface options';
  const adaOptions = await contractOptions({
    session: ada,
    store: adaStore,
    schema,
    functions,
    artifacts,
    contractManifest,
    connectionId: 'card-game-ada-live',
  });
  const graceOptions = await contractOptions({
    session: grace,
    store: graceStore,
    schema,
    functions,
    artifacts,
    contractManifest,
    connectionId: 'card-game-grace-live',
  });
  acceptancePhase = 'start authenticated Contract surfaces';
  const adaSurface = await trackSurface(adaOptions);
  const graceSurface = await trackSurface(graceOptions);
  await Promise.all([adaSurface.flush(), graceSurface.flush()]);
  assert.equal(adaSurface.livePush, true);
  assert.equal(graceSurface.livePush, true);
  await eventually(() => {
    assert.equal(adaSurface.connection(), 'live');
    assert.equal(graceSurface.connection(), 'live');
  }, 'authenticated live sockets did not establish');
  assert.deepEqual(
    adaSurface.boundary.current('hand').map(({ card }) => card),
    ['ace-spades', 'queen-hearts'],
  );
  assert.deepEqual(
    graceSurface.boundary.current('hand').map(({ card }) => card),
    ['king-clubs', 'ten-diamonds'],
  );

  acceptancePhase = 'publish live hidden-hand mutation';
  await mutateFixture(
    ada.client,
    'acceptHandCard',
    { gameId, position: 3, card: 'jack-spades' },
    'cm_card_game_ada_3',
  );
  await eventually(() => {
    assert.equal(adaSurface.connection(), 'live');
    assert.equal(graceSurface.connection(), 'live');
    assert.deepEqual(
      adaSurface.boundary.current('hand').map(({ card }) => card),
      ['ace-spades', 'queen-hearts', 'jack-spades'],
    );
    assert.deepEqual(
      graceSurface.boundary.current('hand').map(({ card }) => card),
      ['king-clubs', 'ten-diamonds'],
    );
  }, 'live hidden-hand fanout did not settle');
  await Promise.all([adaSurface.flush(), graceSurface.flush()]);

  // Logout crosses the shared AuthCoordinator barrier. Contract must blank
  // the live hidden-hand boundary before the credential transition returns.
  acceptancePhase = 'logout and blank predecessor surface';
  await ada.client.authLogout();
  assert.deepEqual(adaSurface.boundary.current('hand'), []);
  assert.deepEqual(
    graceSurface.boundary.current('hand').map(({ card }) => card),
    ['king-clubs', 'ten-diamonds'],
  );

  const retainedState = await graceStore.snapshot();
  const clientDeadlineMs = retainedState.queryAuthorization[retainedQueryKey]?.clientDeadlineMs;
  assert.equal(Number.isSafeInteger(clientDeadlineMs), true);
  assert.equal(clientDeadlineMs > Date.now(), true);

  // Exercise the independent principal/data and authority-instance/queue axes
  // on a clone of Grace's real, lease-bearing store. The original durable
  // bytes remain untouched for the cold-process AuthorizedLease proof below.
  const authorityStore = createMemorySnapbackClientStore({
    state: structuredClone(retainedState),
  });
  let authorityCapture = await authorityStore.authorityScope();
  const graceScope = await grace.client.currentAuthorizationScope();
  const authorityState = await authorityStore.snapshot();
  const queueCapture = await authorityStore.captureMutationQueue(authorityCapture);
  const queuedReady = await authorityStore.enqueueMutation({
    id: 'cm_ready_grace',
    function: 'signalReady',
    args: { gameId, ready: true },
    ctxLedger: { version: 1, ids: ['signal_grace'], now: 1 },
    authorityDescriptor: graceScope.authorityDescriptor,
    ...authorityCapture,
    ...queueCapture,
    ...authorityState.artifactScope,
    cursor: structuredClone(authorityState.retained[retainedQueryKey].cursor),
  });
  assert.equal(queuedReady.function, 'signalReady');
  assert.deepEqual(queuedReady.authorityDescriptor, graceScope.authorityDescriptor);

  // Credential refresh rotates the bearer without changing the session's
  // public authority descriptor, so the queued write remains runnable.
  const refreshedCredential = await grace.client.authRefresh();
  assert.equal(refreshedCredential.superseded, undefined);
  const refreshedGraceScope = await grace.client.currentAuthorizationScope();
  assert.equal(
    refreshedGraceScope.authorityDescriptor.authorityInstanceId,
    graceScope.authorityDescriptor.authorityInstanceId,
  );
  assert.deepEqual(
    refreshedGraceScope.authorityDescriptor,
    graceScope.authorityDescriptor,
  );
  await authorityStore.scopeAuthorization(refreshedGraceScope, authorityCapture);
  const refreshedQueueCapture = await authorityStore.captureMutationQueue(authorityCapture);
  assert.deepEqual(
    (await authorityStore.pendingMutations({
      ...authorityCapture,
      ...refreshedQueueCapture,
    })).map(({ id }) => id),
    ['cm_ready_grace'],
  );

  // A separately minted session for the same user keeps the principal-owned
  // rows, but its new authority instance must strand the predecessor queue.
  const graceSuccessor = await mintSession(
    server,
    schema.appId,
    'grace@card-game.test',
    'card-game-grace-successor',
  );
  sessions.push(graceSuccessor);
  assert.equal(graceSuccessor.credential.session.userId, grace.credential.session.userId);
  assert.notEqual(graceSuccessor.credential.session.id, grace.credential.session.id);
  const graceSuccessorScope = await graceSuccessor.client.currentAuthorizationScope();
  assert.notEqual(
    graceSuccessorScope.authorityDescriptor.authorityInstanceId,
    refreshedGraceScope.authorityDescriptor.authorityInstanceId,
  );
  const graceSuccessorCapture = graceSuccessor.coordinator.capture();
  await authorityStore.transitionAuthority({
    expectedEpoch: authorityCapture.authorityEpoch,
    nextEpoch: authorityCapture.authorityEpoch + 1,
    nextAuthorityKey: graceSuccessorCapture.authorityKey,
    queueTransition: 'strand-rerecordable',
    transitionReason: 'same_principal_new_session',
    retainPrincipalData: true,
    nextPrincipalScope: graceSuccessorScope.principalScope,
  });
  authorityCapture = {
    authorityEpoch: authorityCapture.authorityEpoch + 1,
    authorityKey: graceSuccessorCapture.authorityKey,
  };
  await authorityStore.scopeAuthorization(graceSuccessorScope, authorityCapture);
  const successorState = await authorityStore.snapshot();
  assert.deepEqual(
    successorState.retained[retainedQueryKey].rows.map(({ card }) => card),
    ['king-clubs', 'ten-diamonds'],
  );
  const successorQueueCapture = await authorityStore.captureMutationQueue(authorityCapture);
  assert.deepEqual(
    await authorityStore.pendingMutations({
      ...authorityCapture,
      ...successorQueueCapture,
    }),
    [],
  );
  const strandedReady = await authorityStore.strandedMutations(authorityCapture);
  assert.equal(strandedReady.length, 1);
  assert.equal(strandedReady[0].id, 'cm_ready_grace');
  assert.equal(strandedReady[0].reason, 'same_principal_new_session');
  assert.equal(strandedReady[0].rerecordable, true);
  assert.equal(strandedReady[0].replayable, false);

  // A different server-resolved principal owns a different retained namespace;
  // the prior user's hidden rows are physically deleted on the switch.
  const adaSuccessor = await mintSession(
    server,
    schema.appId,
    'ada@card-game.test',
    'card-game-ada-successor',
  );
  sessions.push(adaSuccessor);
  assert.equal(adaSuccessor.credential.session.userId, ada.credential.session.userId);
  assert.notEqual(adaSuccessor.credential.session.userId, grace.credential.session.userId);
  const adaSuccessorScope = await adaSuccessor.client.currentAuthorizationScope();
  const adaSuccessorCapture = adaSuccessor.coordinator.capture();
  await authorityStore.transitionAuthority({
    expectedEpoch: authorityCapture.authorityEpoch,
    nextEpoch: authorityCapture.authorityEpoch + 1,
    nextAuthorityKey: adaSuccessorCapture.authorityKey,
    queueTransition: 'delete',
    transitionReason: 'principal_changed',
    retainPrincipalData: false,
    nextPrincipalScope: adaSuccessorScope.principalScope,
  });
  authorityCapture = {
    authorityEpoch: authorityCapture.authorityEpoch + 1,
    authorityKey: adaSuccessorCapture.authorityKey,
  };
  await authorityStore.scopeAuthorization(adaSuccessorScope, authorityCapture);
  const switchedState = await authorityStore.snapshot();
  assert.equal(switchedState.retained[retainedQueryKey], undefined);
  assert.equal(switchedState.queryAuthorization[retainedQueryKey], undefined);

  await disposeSurface(adaSurface);
  await disposeSurface(graceSurface);
  await server.stop();

  // Prove cold-process boot: retain only the durable custody and client-store
  // bytes, then construct new wrappers, coordinator, and client after the
  // server is already gone. No process-local registration, task tail, or
  // handshake projection crosses this boundary.
  const coldGraceCoordinator = new AuthCoordinator({
    appId: schema.appId,
    storage: createMemoryAuthCustodyStorage({ state: grace.custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const coldGraceClient = new SnapbackClient(server.baseUrl, {
    authCoordinator: coldGraceCoordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: grace.clientStoreId,
  });
  sessions.push({ client: coldGraceClient, coordinator: coldGraceCoordinator });
  const coldGraceStore = createMemorySnapbackClientStore({ state: graceStoreState });
  const coldGraceOptions = {
    ...graceOptions,
    client: coldGraceClient,
    clientStore: coldGraceStore,
  };
  const offlineSurface = await trackSurface(coldGraceOptions);
  assert.equal(offlineSurface.retained(), true);
  assert.equal(offlineSurface.connection(), 'stale');
  assert.deepEqual(
    offlineSurface.boundary.current('hand').map(({ card }) => card),
    ['king-clubs', 'ten-diamonds'],
  );
  await disposeSurface(offlineSurface);

  // The exact equality boundary is expired. Store validation deletes the
  // hidden rows before the unavailable network path can fall back to them.
  Date.now = () => clientDeadlineMs;
  await assert.rejects(
    () => trackSurface(coldGraceOptions),
    /fetch failed|ECONNREFUSED/,
  );
  const expiredState = await coldGraceStore.snapshot();
  assert.equal(expiredState.retained[retainedQueryKey], undefined);
  assert.equal(expiredState.queryAuthorization[retainedQueryKey]?.lease, null);

  acceptancePhase = 'complete';
  console.log('card-game real session live/authorized-retention proof: ok');
} catch (error) {
  console.error(`card-game authority-scope failed during: ${acceptancePhase}`);
  throw error;
} finally {
  Date.now = originalDateNow;
  for (const surface of [...surfaces]) {
    try { await disposeSurface(surface); } catch { /* preserve the primary failure */ }
  }
  for (const session of sessions) {
    try { await session.client.closeAuth(); } catch { /* preserve the primary failure */ }
  }
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}
