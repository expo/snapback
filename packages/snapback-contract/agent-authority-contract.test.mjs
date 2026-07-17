// LLP 0055 G8: Contract consumes the same explicit AgentAuthorityFence custody
// as the headless kit, with a durable grant-tuple replay axis and a separate
// token/carrier publication axis.

import assert from 'node:assert/strict';

import {
  AgentAuthorityFence,
  createMemoryAgentAuthorityCustodyStorage,
} from '../../demos/_kit/agent-authority.mjs';
import { SnapbackClient } from '../../demos/_kit/client.mjs';
import {
  canonicalAgentAuthorityKey,
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
  createSnapbackClientStoreAuthParticipant,
  deriveServiceAuthorityInstanceId,
  snapbackAuthFingerprint,
} from './index.mjs';

const ACTOR = '018f0d90-7b01-7a22-8c33-445566778899';
const CREDENTIAL = '018f0d90-7b02-7a22-8c33-445566778899';
const GRANT_A = '018f0d90-7b03-7a22-8c33-445566778899';
const GRANT_B = '018f0d90-7b04-7a22-8c33-445566778899';
const TOKEN_A = '018f0d90-7b05-7a22-8c33-445566778899';
const TOKEN_B = '018f0d90-7b06-7a22-8c33-445566778899';
const TOKEN_C = '018f0d90-7b07-7a22-8c33-445566778899';
const EFFECTIVE_USER = '018f0d90-7b08-7a22-8c33-445566778899';
const AUTH_STREAM = '018f0d90-7b09-7a22-8c33-445566778899';

const credential = ({ grantId = GRANT_A, tokenId = TOKEN_A, bearerToken = 'agent-token-a' } = {}) => ({
  actorUserId: ACTOR,
  credentialId: CREDENTIAL,
  credentialGeneration: 4,
  grantId,
  tokenId,
  bearerToken,
});

const descriptor = (authorityInstanceId) => ({
  descriptorVersion: 1,
  authorityInstanceId,
  sessionGeneration: 0,
});

const descriptorFor = (value) => descriptor(deriveServiceAuthorityInstanceId(value));

const replaceValidated = (fence, value) => (
  fence.replaceCredentialValidated(fence.capture(), value, descriptorFor(value))
);

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  schemaVersion: 'snapback.v0',
  inputsHash: 'agent-contract-inputs',
  schemaHash: 'agent-contract-schema',
  bundleHash: 'agent-contract-bundle',
  capabilities: { derivedOptimisticOverlays: true, offlineReplay: true },
  queries: {
    listTodos: {
      name: 'listTodos',
      mode: 'live',
      defaultLive: true,
      reads: ['todos'],
    },
  },
  mutations: {
    createTodo: {
      optimistic: true,
      plan: {
        steps: [{
          Insert: {
            table: 'todos',
            values: {
              title: { Arg: 'title' },
              userId: 'AuthUserId',
            },
            bind_id_as: 'todoId',
          },
        }],
        return_value: { Binding: 'todoId' },
      },
    },
  },
};

const runtime = {
  createContractMockQueryBoundary(initialRows) {
    const rows = new Map(Object.entries(initialRows));
    return {
      current: (key) => rows.get(key) ?? [],
      query: (key, project = (value) => value) => project(rows.get(key) ?? []),
      write(key, update) {
        const next = update(rows.get(key) ?? []);
        rows.set(key, next);
        return next;
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
      mutate(name, args) {
        return options.mutations[name](args, boundary);
      },
    };
  },
};

const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
};

const pendingFor = async (store, capture) => {
  const authority = {
    authorityEpoch: capture.authorityEpoch,
    authorityKey: capture.authorityKey,
  };
  const queue = await store.captureMutationQueue(authority);
  return store.pendingMutations({
    ...authority,
    ...queue,
    authFingerprint: snapbackAuthFingerprint(EFFECTIVE_USER),
    schemaHash: manifest.schemaHash,
    inputsHash: manifest.inputsHash,
    targetProfileId: 'local-dev-sqlite-ibex',
    appId: 'agent-contract-app',
    databaseId: 'agent-contract-db',
    versionStreamId: 'agent-contract-stream',
  });
};

function makeAgentClient(authority) {
  const tagged = new WeakMap();
  const state = {
    online: true,
    rows: [{ _id: 'server-row', _version: 1, title: 'server' }],
    version: 1,
    deliveries: [],
    barrierRegistrations: 0,
  };
  const captureAndTag = (value) => {
    const capture = authority.capture();
    if (value && typeof value === 'object') tagged.set(value, capture);
    return value;
  };
  const currentDescriptor = () => descriptor(
    deriveServiceAuthorityInstanceId(authority.authority),
  );
  const offline = () => {
    throw new TypeError('network unavailable');
  };
  return {
    agentAuthority: authority,
    authorityFence: authority,
    authProtocols: {
      authClient: 1,
      authInvalidation: null,
      authorityDescriptor: 1,
      authorizedLease: null,
    },
    state,
    captureAuthority: () => authority.capture(),
    authorityCaptureFor: (value) => tagged.get(value) ?? null,
    registerAuthBarrierParticipant(participant) {
      state.barrierRegistrations += 1;
      return authority.registerParticipant(participant);
    },
    async authSession() {
      if (!state.online) offline();
      const authorityDescriptor = currentDescriptor();
      await authority.synchronizeValidated(authorityDescriptor);
      const capture = authority.capture();
      authority.bindHandshake(capture, authorityDescriptor);
      return {
        activeMode: 'sessions',
        authorizationStreamIncarnation: AUTH_STREAM,
        authority: {
          kind: 'servicePrincipal',
          userId: EFFECTIVE_USER,
          sessionId: null,
          isAuthenticated: true,
        },
        clientProtocols: {
          authClient: 1,
          authInvalidation: null,
          authorityDescriptor: 1,
          authorizedLease: null,
        },
        availability: {
          queuedReplay: { available: true },
          retainedReads: { available: false },
        },
        authorityDescriptor,
      };
    },
    async currentAuthorizationScope() {
      const session = await this.authSession();
      return {
        principalScope: {
          authMode: 'sessions',
          authorizationStreamIncarnation: AUTH_STREAM,
          userId: EFFECTIVE_USER,
        },
        authorityDescriptor: session.authorityDescriptor,
        queryAuthorization: {},
      };
    },
    async query() {
      if (!state.online) offline();
      return captureAndTag({
        rows: state.rows.map((row) => ({ ...row })),
        version: state.version,
      });
    },
    async mutate(name, request) {
      if (!state.online) offline();
      const capture = authority.capture();
      const { bearer } = authority.credentialFor(capture);
      state.deliveries.push({
        name,
        bearer,
        authorityKey: capture.authorityKey,
        authorityDescriptor: request.authorityDescriptor,
        clientMutationId: request.clientMutationId,
      });
      assert.equal(
        request.authorityDescriptor?.authorityInstanceId,
        currentDescriptor().authorityInstanceId,
      );
      state.version += 1;
      state.rows.push({
        _id: request.ctxLedger.ids[0],
        _version: state.version,
        title: request.args.title,
      });
      return captureAndTag({ version: state.version, changed_count: 1, result: null });
    },
  };
}

const authorityStorage = createMemoryAgentAuthorityCustodyStorage();
const authority = new AgentAuthorityFence(credential(), {
  storage: authorityStorage,
  custodyId: 'agent:contract-main',
});
await authority.synchronizeValidated(descriptorFor(credential()));
const keyA = authority.capture().authorityKey;
assert.match(keyA, /^sha256:[0-9a-f]{64}$/);
assert.equal(keyA, 'sha256:53904370b9f9cf1f73c126b94a0f59e781c24f703baa2167118c473246451046');
assert.equal(keyA, canonicalAgentAuthorityKey(credential()));
assert.equal(
  deriveServiceAuthorityInstanceId(credential()),
  '49082da1-0362-7c7d-bb41-1f6e925b688f',
  'JS service descriptor derivation stays byte-for-byte aligned with the Rust fixture',
);
assert.equal(
  keyA,
  canonicalAgentAuthorityKey(credential({ tokenId: TOKEN_B, bearerToken: 'rotated-secret' })),
  'token churn is not part of durable replay identity',
);
assert.notEqual(
  keyA,
  canonicalAgentAuthorityKey(credential({ grantId: GRANT_B })),
  'the durable grant tuple is part of replay identity',
);

const orderedFence = new AgentAuthorityFence(credential());
const barrierOrder = [];
orderedFence.registerParticipant({
  name: 'ordered-agent-participant',
  quiesce() { barrierOrder.push('quiesce'); },
  blank() {
    assert.deepEqual(barrierOrder, ['quiesce']);
    barrierOrder.push('blank');
  },
  clearMemory() {
    assert.deepEqual(barrierOrder, ['quiesce', 'blank']);
    barrierOrder.push('clearMemory');
  },
  async commitDurable() { barrierOrder.push('commitDurable'); },
  async resume() { barrierOrder.push('resume'); },
});
assert.throws(
  () => orderedFence.registerParticipant({ async quiesce() {} }),
  /quiesce\(\) must be synchronous/,
  'agent barriers refuse participants that cannot quiesce before synchronous blank',
);
const orderedTransition = replaceValidated(orderedFence, credential({
  grantId: GRANT_B,
  tokenId: TOKEN_C,
  bearerToken: 'ordered-token',
}));
assert.deepEqual(
  barrierOrder.slice(0, 3),
  ['quiesce', 'blank', 'clearMemory'],
  'the visibility cut is synchronous and ordered',
);
await orderedTransition;
await orderedFence.synchronize();
assert.deepEqual(
  barrierOrder,
  ['quiesce', 'blank', 'clearMemory', 'commitDurable', 'resume'],
);

const failedFence = new AgentAuthorityFence(credential());
const failedBarrierOrder = [];
const failedCapture = failedFence.capture();
failedFence.registerParticipant({
  quiesce() {
    failedBarrierOrder.push('failing-quiesce');
    throw new Error('injected quiesce failure');
  },
  blank() { failedBarrierOrder.push('failing-blank'); },
  clearMemory() { failedBarrierOrder.push('failing-clear'); },
});
failedFence.registerParticipant({
  quiesce() { failedBarrierOrder.push('following-quiesce'); },
  blank() { failedBarrierOrder.push('following-blank'); },
  clearMemory() { failedBarrierOrder.push('following-clear'); },
});
assert.throws(
  () => replaceValidated(failedFence, credential({ grantId: GRANT_B })),
  /injected quiesce failure/,
  'the first participant failure is surfaced after fail-closed blanking',
);
assert.deepEqual(failedBarrierOrder, [
  'failing-quiesce',
  'following-quiesce',
  'failing-blank',
  'following-blank',
  'failing-clear',
  'following-clear',
]);
assert.equal(
  failedFence.isCurrent(failedCapture),
  false,
  'a failed barrier remains publication-closed even though the credential did not change',
);

const client = makeAgentClient(authority);
const store = createMemorySnapbackClientStore();
const surface = await createSnapbackContractSurface({
  runtime,
  client,
  clientStore: store,
  userId: EFFECTIVE_USER,
  manifest,
  queryName: 'listTodos',
  boundaryKey: 'todos',
  livePush: false,
  artifactIndex: { appId: 'agent-contract-app' },
  schemaManifest: {
    schemaHash: manifest.schemaHash,
    targetProfile: 'local-dev-sqlite-ibex',
  },
  retainedIdentity: {
    databaseId: 'agent-contract-db',
    versionStreamId: 'agent-contract-stream',
  },
});

assert.deepEqual(await store.authorityScope(), { authorityEpoch: 0, authorityKey: keyA });
assert.deepEqual(surface.boundary.current('todos').map((row) => row._id), ['server-row']);
assert.equal(
  client.state.barrierRegistrations,
  2,
  'Contract registers both its physical store and surface through the public client hook',
);

client.state.online = false;
const queuedA = await surface.links.createTodo({ title: 'survives token rotation' });
assert.equal(queuedA.queued, true);
assert.equal((await pendingFor(store, authority.capture())).length, 1);

client.state.online = true;
const rotatedCapture = await replaceValidated(authority, credential({
  tokenId: TOKEN_B,
  bearerToken: 'agent-token-b',
}));
assert.equal(rotatedCapture.authorityEpoch, 0);
assert.equal(rotatedCapture.authorityKey, keyA);
await authority.synchronize();
await waitFor(
  () => surface.boundary.current('todos').length > 0,
  'same-tuple token rotation did not resume the Contract boundary',
);
assert.deepEqual(await surface.reconnect(), { replayed: 1, failed: 0 });
assert.equal((await pendingFor(store, authority.capture())).length, 0);
assert.equal(client.state.deliveries.length, 1);
assert.equal(client.state.deliveries[0].bearer, 'agent-token-b');
assert.equal(client.state.deliveries[0].authorityKey, keyA);
assert.equal(
  client.state.deliveries[0].authorityDescriptor.authorityInstanceId,
  deriveServiceAuthorityInstanceId(credential()),
);

client.state.online = false;
const queuedB = await surface.links.createTodo({ title: 'must not cross grant tuple' });
assert.equal(queuedB.queued, true);
assert.equal((await pendingFor(store, authority.capture())).length, 1);

client.state.online = true;
const changedCapture = await replaceValidated(authority, credential({
  grantId: GRANT_B,
  tokenId: TOKEN_C,
  bearerToken: 'agent-token-c',
}));
assert.equal(changedCapture.authorityEpoch, 1);
assert.notEqual(changedCapture.authorityKey, keyA);
assert.deepEqual(surface.boundary.current('todos'), [], 'tuple change blanks synchronously');
await authority.synchronize();
assert.deepEqual(await store.authorityScope(), {
  authorityEpoch: 1,
  authorityKey: changedCapture.authorityKey,
});
assert.equal(
  (await pendingFor(store, changedCapture)).length,
  0,
  'tuple change deletes predecessor work',
);
await waitFor(
  () => surface.boundary.current('todos').length > 0,
  'changed-tuple successor did not resume from a fresh snapshot',
);

const terminalCapture = authority.capture();
const terminal = authority.terminate(terminalCapture);
assert.equal(terminal.accepted, true);
await terminal.settlement;
assert.deepEqual(
  surface.boundary.current('todos'),
  [],
  'terminal scoped-token/grant loss synchronously blanks Contract',
);
assert.throws(
  () => surface.links.createTodo({ title: 'must stay blank' }),
  (error) => error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
);

surface.dispose();

await assert.rejects(
  () => createSnapbackContractSurface({
    runtime,
    client: makeAgentClient(new AgentAuthorityFence(credential())),
    clientStore: createMemorySnapbackClientStore(),
    userId: EFFECTIVE_USER,
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    livePush: false,
  }),
  (error) => error?.code === 'SNAPBACK_CONTRACT_AGENT_DURABLE_CUSTODY_REQUIRED',
  'agent-backed offline replay refuses process-local authority epochs',
);

// A process can crash after custody entered `clearing` but before its physical
// store participant ran. Fresh Contract construction must register that store
// before validated custody recovery, replay the exact transition, and only
// then settle/open the successor.
{
  const recoveryStorage = createMemoryAgentAuthorityCustodyStorage();
  const recoveryStore = createMemorySnapbackClientStore();
  const writer = new AgentAuthorityFence(credential(), {
    storage: recoveryStorage,
    custodyId: 'agent:contract-clearing-recovery',
  });
  const predecessor = await writer.synchronizeValidated(descriptorFor(credential()));
  await recoveryStore.bindAuthority({
    authorityEpoch: predecessor.authorityEpoch,
    authorityKey: predecessor.authorityKey,
    authMode: 'sessions',
  });
  writer.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {
      throw new Error('injected crash before client-store participant');
    },
  });
  await assert.rejects(
    replaceValidated(writer, credential({
      grantId: GRANT_B,
      tokenId: TOKEN_C,
      bearerToken: 'recovery-successor-token',
    })),
    /injected crash before client-store participant/,
  );
  assert.equal(
    recoveryStorage.snapshot('agent:contract-clearing-recovery').phase,
    'clearing',
  );
  assert.deepEqual(await recoveryStore.authorityScope(), {
    authorityEpoch: predecessor.authorityEpoch,
    authorityKey: predecessor.authorityKey,
  });

  const recoveryFence = new AgentAuthorityFence(credential({
    grantId: GRANT_B,
    tokenId: TOKEN_C,
    bearerToken: 'recovery-successor-token',
  }), {
    storage: recoveryStorage,
    custodyId: 'agent:contract-clearing-recovery',
  });
  const recoveryClient = makeAgentClient(recoveryFence);
  const recoveredSurface = await createSnapbackContractSurface({
    runtime,
    client: recoveryClient,
    clientStore: recoveryStore,
    userId: EFFECTIVE_USER,
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    livePush: false,
    artifactIndex: { appId: 'agent-contract-app' },
    schemaManifest: {
      schemaHash: manifest.schemaHash,
      targetProfile: 'local-dev-sqlite-ibex',
    },
    retainedIdentity: {
      databaseId: 'agent-contract-recovery-db',
      versionStreamId: 'agent-contract-recovery-stream',
    },
  });
  const recovered = recoveryFence.capture();
  assert.equal(recoveryStorage.snapshot('agent:contract-clearing-recovery').phase, 'settled');
  assert.deepEqual(await recoveryStore.authorityScope(), {
    authorityEpoch: recovered.authorityEpoch,
    authorityKey: recovered.authorityKey,
  });
  assert.equal(recovered.authorityEpoch, predecessor.authorityEpoch + 1);
  await recoveredSurface.dispose();
}

// Fresh terminal deletion uses the real format-6 store participant with a
// nullable predecessor epoch. Even when custody was reset while the physical
// store survived at an older 7/B epoch with private residue, the exact-key
// terminal callback clears it before deletion settles; crash recovery replays
// the exact transition safely.
{
  const value = credential({
    grantId: GRANT_B,
    tokenId: TOKEN_B,
    bearerToken: 'fresh-terminal-token',
  });
  const custodyId = 'agent:contract-fresh-terminal';
  const custodyState = { custody: {} };
  const custodyStorage = createMemoryAgentAuthorityCustodyStorage({ state: custodyState });
  const clientStore = createMemorySnapbackClientStore();
  const authorityKey = canonicalAgentAuthorityKey(value);
  const storeAuthority = { authorityEpoch: 7, authorityKey };
  await clientStore.bindAuthority({ ...storeAuthority, authMode: 'sessions' });
  const queue = await clientStore.captureMutationQueue(storeAuthority);
  await clientStore.putRetainedQuery('fresh-terminal-private', {
    ...storeAuthority,
    rows: [{ secret: 'fresh-terminal-retained' }],
  });
  await clientStore.enqueueMutation({
    id: 'cm_fresh_terminal_private',
    function: 'writeFreshTerminalPrivate',
    authFingerprint: 'auth:fresh-terminal',
    ...storeAuthority,
    ...queue,
  });

  const realParticipant = createSnapbackClientStoreAuthParticipant(clientStore);
  const failing = new AgentAuthorityFence(value, {
    storage: custodyStorage,
    custodyId,
  });
  failing.registerParticipant({
    ...realParticipant,
    async commitTerminalDurable(context) {
      assert.equal(context.expectedEpoch, null);
      assert.equal(context.nextEpoch, 0);
      await realParticipant.commitTerminalDurable(context);
      throw new Error('injected crash after fresh terminal store commit');
    },
  });
  const failed = failing.terminateValidatedCredential(
    failing.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await assert.rejects(failed.settlement, /fresh terminal store commit/);
  assert.equal(custodyStorage.snapshot(custodyId), null);
  assert(
    Object.keys(custodyState.custody).some((partition) => (
      partition.startsWith('snapback.agent-terminal-witness.v1:')
    )),
    'terminal witness persists before a failing local purge callback',
  );
  const cleared = await clientStore.snapshot();
  assert.equal(JSON.stringify(cleared).includes('fresh-terminal-retained'), false);
  assert.equal(JSON.stringify(cleared).includes('cm_fresh_terminal_private'), false);

  const restartedValue = { ...value, tokenId: TOKEN_C, bearerToken: 'fresh-terminal-restart' };
  const restarted = new AgentAuthorityFence(restartedValue, {
    storage: custodyStorage,
    custodyId,
  });
  restarted.registerParticipant(realParticipant);
  await assert.rejects(
    restarted.synchronizeValidated(descriptorFor(restartedValue)),
    (error) => error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
  );
  assert.equal(custodyStorage.snapshot(custodyId).phase, 'settled');
  assert.equal(custodyStorage.snapshot(custodyId).status, 'deleted');
  assert.deepEqual(await clientStore.authorityScope(), {
    authorityEpoch: null,
    authorityKey: null,
  });

  // The terminal purge invalidates every delayed B store capture by leaving
  // the store unbound. A distinct, custody-proven successor must nevertheless
  // be able to advance the deleted primary tombstone and bind that clean store
  // in the same barrier.
  const successorValue = credential();
  const successor = new AgentAuthorityFence(successorValue, {
    storage: custodyStorage,
    custodyId,
  });
  successor.registerParticipant(realParticipant);
  const successorCapture = await successor.synchronizeValidated(
    descriptorFor(successorValue),
  );
  assert.equal(successorCapture.authorityEpoch, 1);
  assert.equal(successorCapture.authorityKey, canonicalAgentAuthorityKey(successorValue));
  assert.deepEqual(await clientStore.authorityScope(), {
    authorityEpoch: successorCapture.authorityEpoch,
    authorityKey: successorCapture.authorityKey,
  });
  assert.equal(custodyStorage.snapshot(custodyId).status, 'active');
  assert.deepEqual(successor.capture(), successorCapture);
}

// A failed A→B transition can leave the primary clearing while the ordinary
// store participant has already rebound to B. Scheduled terminal recovery
// purges once before replay, and again after replay can repopulate B. The
// second cut is required on both successful recovery and a later participant
// failure during that replay.
for (const failRecovery of [false, true]) {
  const custodyId = `agent:contract-terminal-clearing-recovery-${failRecovery ? 'failure' : 'success'}`;
  const custodyStorage = createMemoryAgentAuthorityCustodyStorage();
  const clientStore = createMemorySnapbackClientStore();
  const valueA = credential();
  const valueB = credential({
    grantId: GRANT_B,
    tokenId: TOKEN_B,
    bearerToken: `clearing-recovery-${failRecovery}`,
  });
  const keyA = canonicalAgentAuthorityKey(valueA);
  const keyB = canonicalAgentAuthorityKey(valueB);
  await clientStore.bindAuthority({ authorityEpoch: 0, authorityKey: keyA, authMode: 'sessions' });
  const realParticipant = createSnapbackClientStoreAuthParticipant(clientStore);

  const interrupted = new AgentAuthorityFence(valueA, { storage: custodyStorage, custodyId });
  await interrupted.synchronizeValidated(descriptorFor(valueA));
  interrupted.registerParticipant(realParticipant);
  interrupted.registerParticipant({
    quiesce() {},
    blank() {},
    clearMemory() {},
    async commitDurable() {
      throw new Error('injected A-to-B failure after client-store commit');
    },
    async resume() {},
  });
  await assert.rejects(
    replaceValidated(interrupted, valueB),
    /injected A-to-B failure after client-store commit/,
  );
  const clearing = custodyStorage.snapshot(custodyId);
  assert.equal(clearing.phase, 'clearing');
  assert.equal(clearing.status, 'active');
  assert.deepEqual(await clientStore.authorityScope(), {
    authorityEpoch: 1,
    authorityKey: keyB,
  });
  await clientStore.putRetainedQuery('clearing-recovery-private', {
    authorityEpoch: 1,
    authorityKey: keyB,
    rows: [{ secret: 'clearing-recovery-secret' }],
  });

  const terminalFence = new AgentAuthorityFence(valueB, { storage: custodyStorage, custodyId });
  terminalFence.registerParticipant(realParticipant);
  if (failRecovery) {
    terminalFence.registerParticipant({
      quiesce() {},
      blank() {},
      clearMemory() {},
      async commitDurable() {
        throw new Error('injected terminal recovery failure after B rebind');
      },
      async resume() {},
    });
  }
  const terminal = terminalFence.terminateValidatedCredential(
    terminalFence.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  if (failRecovery) {
    await assert.rejects(
      terminal.settlement,
      /injected terminal recovery failure after B rebind/,
    );
  } else {
    await terminal.settlement;
    assert.equal(custodyStorage.snapshot(custodyId).status, 'deleted');
  }
  const purged = await clientStore.snapshot();
  assert.equal(purged.terminallyUnbound, true);
  assert.equal(JSON.stringify(purged).includes('clearing-recovery-secret'), false);
  await assert.rejects(
    clientStore.captureMutationQueue({ authorityEpoch: 1, authorityKey: keyB }),
    (error) => error?.code === 'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE',
  );
}

// Replaying a terminal verdict against an already-terminal exact primary still
// purges a same-key physical store that survived at another local epoch. The
// exhausted form performs the same purge before preserving its terminal error.
for (const terminalPhase of ['settled', 'exhausted']) {
  const custodyId = `agent:contract-already-terminal-${terminalPhase}`;
  const custodyState = { custody: {} };
  const custodyStorage = createMemoryAgentAuthorityCustodyStorage({ state: custodyState });
  const value = credential({
    grantId: GRANT_B,
    tokenId: TOKEN_B,
    bearerToken: `already-terminal-${terminalPhase}`,
  });
  const original = new AgentAuthorityFence(value, { storage: custodyStorage, custodyId });
  await original.synchronizeValidated(descriptorFor(value));
  const firstDeletion = original.terminateValidatedCredential(
    original.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await firstDeletion.settlement;
  if (terminalPhase === 'exhausted') {
    const deleted = custodyState.custody[custodyId];
    custodyState.custody[custodyId] = {
      ...deleted,
      revision: deleted.revision + 1,
      phase: 'exhausted',
      status: 'deleted',
      transition: null,
    };
  }

  const clientStore = createMemorySnapbackClientStore();
  const authorityKey = canonicalAgentAuthorityKey(value);
  const staleScope = { authorityEpoch: 7, authorityKey };
  await clientStore.bindAuthority({ ...staleScope, authMode: 'sessions' });
  await clientStore.putRetainedQuery(`already-terminal-${terminalPhase}`, {
    ...staleScope,
    rows: [{ secret: `already-terminal-secret-${terminalPhase}` }],
  });

  const replay = new AgentAuthorityFence(value, { storage: custodyStorage, custodyId });
  replay.registerParticipant(createSnapbackClientStoreAuthParticipant(clientStore));
  const repeatedDeletion = replay.terminateValidatedCredential(
    replay.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  if (terminalPhase === 'exhausted') {
    await assert.rejects(
      repeatedDeletion.settlement,
      (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED',
    );
  } else {
    await repeatedDeletion.settlement;
  }
  assert.deepEqual(await clientStore.authorityScope(), {
    authorityEpoch: null,
    authorityKey: null,
  });
  assert.equal(
    JSON.stringify(await clientStore.snapshot()).includes(`already-terminal-secret-${terminalPhase}`),
    false,
  );
}

// Once an exact terminal verdict has begun, local Contract custody is
// delete-only even when the durable primary has no representable successor
// counter. The side witness and exhausted primary may preserve the diagnostic;
// neither authority/revision boundary may preserve bound private bytes.
for (const {
  name,
  inject,
  expectedCode,
} of [
  {
    name: 'authority-epoch',
    inject: (record) => ({
      ...record,
      authorityEpoch: Number.MAX_SAFE_INTEGER - 1,
    }),
    expectedCode: 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
  },
  {
    name: 'revision',
    inject: (record) => ({
      ...record,
      revision: Number.MAX_SAFE_INTEGER - 2,
    }),
    expectedCode: 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
  },
]) {
  const custodyId = `agent:contract-terminal-${name}-exhaustion`;
  const custodyState = { custody: {} };
  const custodyStorage = createMemoryAgentAuthorityCustodyStorage({ state: custodyState });
  const value = credential({
    grantId: GRANT_B,
    tokenId: TOKEN_B,
    bearerToken: `terminal-${name}-exhaustion`,
  });
  const seed = new AgentAuthorityFence(value, { storage: custodyStorage, custodyId });
  await seed.synchronizeValidated(descriptorFor(value));
  custodyState.custody[custodyId] = inject(custodyState.custody[custodyId]);

  const replay = new AgentAuthorityFence(value, { storage: custodyStorage, custodyId });
  const capture = await replay.synchronizeValidated(descriptorFor(value));
  const clientStore = createMemorySnapbackClientStore();
  await clientStore.bindAuthority({
    authorityEpoch: capture.authorityEpoch,
    authorityKey: capture.authorityKey,
    authMode: 'sessions',
  });
  await clientStore.putRetainedQuery(`terminal-${name}-private`, {
    authorityEpoch: capture.authorityEpoch,
    authorityKey: capture.authorityKey,
    rows: [{ secret: `terminal-${name}-secret` }],
  });
  replay.registerParticipant(createSnapbackClientStoreAuthParticipant(clientStore));
  const terminal = replay.terminateValidatedCredential(
    replay.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await assert.rejects(terminal.settlement, (error) => error?.code === expectedCode);
  const exhausted = custodyStorage.snapshot(custodyId);
  assert.equal(exhausted.phase, 'exhausted');
  assert.equal(exhausted.status, 'deleted');
  assert.deepEqual(await clientStore.authorityScope(), {
    authorityEpoch: null,
    authorityKey: null,
  });
  assert.equal(
    JSON.stringify(await clientStore.snapshot()).includes(`terminal-${name}-secret`),
    false,
  );
}

// Witness storage failure is still a terminal confidentiality cut. It blocks
// durable settlement, but cannot leave the exact B client store readable.
{
  const custodyId = 'agent:contract-terminal-witness-io-failure';
  const base = createMemoryAgentAuthorityCustodyStorage();
  const value = credential({
    grantId: GRANT_B,
    tokenId: TOKEN_B,
    bearerToken: 'terminal-witness-io-failure',
  });
  const seed = new AgentAuthorityFence(value, { storage: base, custodyId });
  const capture = await seed.synchronizeValidated(descriptorFor(value));
  const predecessor = base.snapshot(custodyId);
  const failingStorage = {
    partitionOwnership: base.partitionOwnership,
    async withOwnership(partition, operation) {
      return base.withOwnership(partition, (owner) => operation(Object.freeze({
        ...owner,
        async withPartition(childPartition, childOperation) {
          if (childPartition.startsWith('snapback.agent-terminal-witness.v1:')) {
            throw new Error('injected terminal witness storage failure');
          }
          return owner.withPartition(childPartition, childOperation);
        },
      })));
    },
  };
  const clientStore = createMemorySnapbackClientStore();
  await clientStore.bindAuthority({
    authorityEpoch: capture.authorityEpoch,
    authorityKey: capture.authorityKey,
    authMode: 'sessions',
  });
  await clientStore.putRetainedQuery('terminal-witness-io-private', {
    authorityEpoch: capture.authorityEpoch,
    authorityKey: capture.authorityKey,
    rows: [{ secret: 'terminal-witness-io-secret' }],
  });
  const terminalFence = new AgentAuthorityFence(value, {
    storage: failingStorage,
    custodyId,
  });
  terminalFence.registerParticipant(createSnapbackClientStoreAuthParticipant(clientStore));
  const terminal = terminalFence.terminateValidatedCredential(
    terminalFence.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await assert.rejects(terminal.settlement, /injected terminal witness storage failure/);
  assert.deepEqual(base.snapshot(custodyId), predecessor);
  assert.deepEqual(await clientStore.authorityScope(), {
    authorityEpoch: null,
    authorityKey: null,
  });
  assert.equal(
    JSON.stringify(await clientStore.snapshot()).includes('terminal-witness-io-secret'),
    false,
  );
}

// A peer may retain an in-memory active B capture after another B owner has
// already settled the shared tombstone. Its idempotent terminal call still
// purges exact local B and recognizes the peer tombstone as success.
{
  const custodyStorage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:contract-stale-local-peer-deleted';
  const value = credential({
    grantId: GRANT_B,
    tokenId: TOKEN_B,
    bearerToken: 'stale-local-peer-b',
  });
  const winner = new AgentAuthorityFence(value, { storage: custodyStorage, custodyId });
  const stalePeer = new AgentAuthorityFence(value, { storage: custodyStorage, custodyId });
  await winner.synchronizeValidated(descriptorFor(value));
  const staleCapture = await stalePeer.synchronizeValidated(descriptorFor(value));

  const clientStore = createMemorySnapbackClientStore();
  const authorityKey = canonicalAgentAuthorityKey(value);
  const localScope = { authorityEpoch: 7, authorityKey };
  await clientStore.bindAuthority({ ...localScope, authMode: 'sessions' });
  await clientStore.putRetainedQuery('stale-peer-private', {
    ...localScope,
    rows: [{ secret: 'stale-peer-secret' }],
  });
  stalePeer.registerParticipant(createSnapbackClientStoreAuthParticipant(clientStore));

  const winnerDeletion = winner.terminateValidatedCredential(
    winner.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await winnerDeletion.settlement;
  const primaryTombstone = custodyStorage.snapshot(custodyId);
  const peerDeletion = stalePeer.terminate(staleCapture, {
    authorityDisposition: 'durableDelete',
  });
  await peerDeletion.settlement;
  assert.deepEqual(custodyStorage.snapshot(custodyId), primaryTombstone);
  assert.deepEqual(await clientStore.authorityScope(), {
    authorityEpoch: null,
    authorityKey: null,
  });
  assert.equal(JSON.stringify(await clientStore.snapshot()).includes('stale-peer-secret'), false);
}

// Unregistering immediately after the synchronous terminal cut cannot remove a
// participant from the barrier's mandatory exact-key purge snapshot.
{
  const custodyStorage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:contract-terminal-unregister-race';
  const value = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
  const fence = new AgentAuthorityFence(value, { storage: custodyStorage, custodyId });
  const capture = await fence.synchronizeValidated(descriptorFor(value));
  const clientStore = createMemorySnapbackClientStore();
  await clientStore.bindAuthority({
    authorityEpoch: capture.authorityEpoch,
    authorityKey: capture.authorityKey,
    authMode: 'sessions',
  });
  await clientStore.putRetainedQuery('terminal-unregister-private', {
    authorityEpoch: capture.authorityEpoch,
    authorityKey: capture.authorityKey,
    rows: [{ secret: 'terminal-unregister-secret' }],
  });
  const unregister = fence.registerParticipant(
    createSnapbackClientStoreAuthParticipant(clientStore),
  );
  const deletion = fence.terminate(capture, { authorityDisposition: 'durableDelete' });
  const removing = unregister();
  await Promise.all([deletion.settlement, removing]);
  assert.deepEqual(await clientStore.authorityScope(), {
    authorityEpoch: null,
    authorityKey: null,
  });
  assert.equal(
    JSON.stringify(await clientStore.snapshot()).includes('terminal-unregister-secret'),
    false,
  );
}

// The closed/fresh terminal schedule snapshots its participants synchronously;
// unregistering while the schedule yields before its first custody read cannot
// skip the store purge.
{
  const custodyStorage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:contract-fresh-terminal-unregister-race';
  const value = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
  const fence = new AgentAuthorityFence(value, { storage: custodyStorage, custodyId });
  const clientStore = createMemorySnapbackClientStore();
  const authorityKey = canonicalAgentAuthorityKey(value);
  await clientStore.bindAuthority({ authorityEpoch: 0, authorityKey, authMode: 'sessions' });
  await clientStore.putRetainedQuery('fresh-terminal-unregister-private', {
    authorityEpoch: 0,
    authorityKey,
    rows: [{ secret: 'fresh-terminal-unregister-secret' }],
  });
  const unregister = fence.registerParticipant(
    createSnapbackClientStoreAuthParticipant(clientStore),
  );
  const deletion = fence.terminateValidatedCredential(
    fence.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  const removing = unregister();
  await Promise.all([deletion.settlement, removing]);
  assert.deepEqual(await clientStore.authorityScope(), {
    authorityEpoch: null,
    authorityKey: null,
  });
  assert.equal(
    JSON.stringify(await clientStore.snapshot()).includes('fresh-terminal-unregister-secret'),
    false,
  );
}

// A classified terminal B may discover that shared primary custody currently
// belongs to A. The terminal witness preserves A byte-for-byte, while the real
// physical-store participant purges only a local store still keyed to B.
{
  const custodyStorage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:contract-mismatched-primary-local-purge';
  const a = credential();
  const primaryA = new AgentAuthorityFence(a, { storage: custodyStorage, custodyId });
  await primaryA.synchronizeValidated(descriptorFor(a));
  const primaryBefore = custodyStorage.snapshot(custodyId);

  const b = credential({
    grantId: GRANT_B,
    tokenId: TOKEN_B,
    bearerToken: 'mismatched-primary-b',
  });
  const localStore = createMemorySnapbackClientStore();
  const localAuthority = {
    authorityEpoch: 0,
    authorityKey: canonicalAgentAuthorityKey(b),
  };
  await localStore.bindAuthority({ ...localAuthority, authMode: 'sessions' });
  const localQueue = await localStore.captureMutationQueue(localAuthority);
  await localStore.putRetainedQuery('stale-b-private', {
    ...localAuthority,
    rows: [{ secret: 'stale-b-retained' }],
  });
  await localStore.enqueueMutation({
    id: 'cm_stale_b_private',
    function: 'writeStaleBPrivate',
    authFingerprint: 'auth:stale-b',
    ...localAuthority,
    ...localQueue,
  });
  const primaryStore = createMemorySnapbackClientStore();
  const primaryStoreAuthority = {
    authorityEpoch: primaryBefore.authorityEpoch,
    authorityKey: primaryBefore.authorityKey,
  };
  await primaryStore.bindAuthority({ ...primaryStoreAuthority, authMode: 'sessions' });
  await primaryStore.putRetainedQuery('active-a-private', {
    ...primaryStoreAuthority,
    rows: [{ secret: 'active-a-retained' }],
  });

  const terminalB = new AgentAuthorityFence(b, { storage: custodyStorage, custodyId });
  terminalB.registerParticipant(createSnapbackClientStoreAuthParticipant(localStore));
  terminalB.registerParticipant(createSnapbackClientStoreAuthParticipant(primaryStore));
  const deletion = terminalB.terminateValidatedCredential(
    terminalB.credentialOfferForHandshake(),
    { authorityDisposition: 'durableDelete' },
  );
  await deletion.settlement;
  assert.deepEqual(custodyStorage.snapshot(custodyId), primaryBefore);
  const purged = await localStore.snapshot();
  assert.equal(JSON.stringify(purged).includes('stale-b-retained'), false);
  assert.equal(JSON.stringify(purged).includes('cm_stale_b_private'), false);
  assert.deepEqual(await localStore.authorityScope(), {
    authorityEpoch: null,
    authorityKey: null,
  });
  const preservedAStore = await primaryStore.snapshot();
  assert.equal(JSON.stringify(preservedAStore).includes('active-a-retained'), true);
  assert.deepEqual(await primaryStore.authorityScope(), primaryStoreAuthority);
}

// If terminal B wins while an initially unbound store is between an already-
// active A boot and direct bind, B records a bind fence. Contract consumes it
// only through a generation-CAS same-epoch adoption proven by current A.
{
  const custodyStorage = createMemoryAgentAuthorityCustodyStorage();
  const custodyId = 'agent:contract-terminal-bind-race';
  const a = credential();
  const primaryA = new AgentAuthorityFence(a, { storage: custodyStorage, custodyId });
  await primaryA.synchronizeValidated(descriptorFor(a));
  const primaryBefore = custodyStorage.snapshot(custodyId);
  const client = makeAgentClient(primaryA);
  const store = createMemorySnapbackClientStore();

  const b = credential({
    grantId: GRANT_B,
    tokenId: TOKEN_B,
    bearerToken: 'terminal-bind-race-b',
  });
  const terminalB = new AgentAuthorityFence(b, { storage: custodyStorage, custodyId });
  terminalB.registerParticipant(createSnapbackClientStoreAuthParticipant(store));
  let injected = false;
  const racingStore = Object.freeze({
    ...store,
    async bindAuthority(options) {
      if (!injected) {
        injected = true;
        const deletion = terminalB.terminateValidatedCredential(
          terminalB.credentialOfferForHandshake(),
          { authorityDisposition: 'durableDelete' },
        );
        await deletion.settlement;
      }
      return store.bindAuthority(options);
    },
  });

  const surface = await createSnapbackContractSurface({
    runtime,
    client,
    clientStore: racingStore,
    userId: EFFECTIVE_USER,
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    livePush: false,
    artifactIndex: { appId: 'agent-contract-app' },
    schemaManifest: {
      schemaHash: manifest.schemaHash,
      targetProfile: 'local-dev-sqlite-ibex',
    },
    retainedIdentity: {
      databaseId: 'agent-contract-bind-race-db',
      versionStreamId: 'agent-contract-bind-race-stream',
    },
  });
  assert.equal(injected, true);
  assert.deepEqual(custodyStorage.snapshot(custodyId), primaryBefore);
  assert.deepEqual(await store.authorityScope(), {
    authorityEpoch: primaryBefore.authorityEpoch,
    authorityKey: primaryBefore.authorityKey,
  });
  const activeCapture = primaryA.capture();
  assert.equal(activeCapture.authorityEpoch, primaryBefore.authorityEpoch);
  assert.equal(activeCapture.authorityKey, primaryBefore.authorityKey);
  await surface.dispose();
}

const delegatedAuthority = new AgentAuthorityFence(credential());
await assert.rejects(
  () => createSnapbackContractSurface({
    runtime,
    client: makeAgentClient(delegatedAuthority),
    userId: ACTOR,
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    livePush: false,
  }),
  (error) => error?.code === 'SNAPBACK_CONTRACT_SERVICE_PRINCIPAL_USER_MISMATCH',
  'delegated service-principal surfaces reject caller-supplied actor identity in place of the effective user',
);

await assert.rejects(
  () => createSnapbackContractSurface({
    runtime,
    client: {
      authProtocols: { authClient: 1 },
      async query() { return { rows: [] }; },
    },
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
  }),
  /requires browser or agent authority custody/,
  'Contract must not fall back to unfenced browser or bearer authority',
);

// A real kit client owns a second process-local monotonic fence in addition to
// AgentAuthorityFence. If that identity exhausts while a Contract query is in
// flight, the captured result must return through the client publication gate;
// a direct coordinator comparison would otherwise publish private predecessor
// rows because the underlying AgentAuthorityFence is still current.
{
  const value = credential();
  const authority = new AgentAuthorityFence(value);
  const client = new SnapbackClient('http://stub', {
    agentAuthority: authority,
    authCounterCeiling: 1,
  });
  const authorityDescriptor = descriptorFor(value);
  const sessionProjection = {
    activeMode: 'sessions',
    authorizationStreamIncarnation: AUTH_STREAM,
    authority: {
      kind: 'servicePrincipal',
      userId: EFFECTIVE_USER,
      sessionId: null,
      isAuthenticated: true,
    },
    clientProtocols: {
      authClient: 1,
      authInvalidation: null,
      authorityDescriptor: 1,
      authorizedLease: null,
    },
    availability: {
      queuedReplay: { available: true },
      retainedReads: { available: false },
    },
    authorityDescriptor,
  };
  client.authSession = async () => {
    await authority.synchronizeValidated(authorityDescriptor);
    const capture = authority.capture();
    authority.bindHandshake(capture, authorityDescriptor);
    return sessionProjection;
  };
  client.currentAuthorizationScope = async () => ({
    principalScope: {
      authMode: 'sessions',
      authorizationStreamIncarnation: AUTH_STREAM,
      userId: EFFECTIVE_USER,
    },
    authorityDescriptor,
    queryAuthorization: {},
  });
  let queryEntered;
  let releaseQuery;
  const entered = new Promise((resolve) => { queryEntered = resolve; });
  const released = new Promise((resolve) => { releaseQuery = resolve; });
  client.query = async () => {
    queryEntered();
    await released;
    return { rows: [{ _id: 'private-predecessor', title: 'secret' }], version: 1 };
  };
  const exposedRows = [];
  const guardedRuntime = {
    ...runtime,
    createContractMockQueryBoundary(initialRows) {
      const rows = new Map(Object.entries(initialRows));
      return {
        current: (key) => rows.get(key) ?? [],
        query: (key, project = (entry) => entry) => project(rows.get(key) ?? []),
        write(key, update) {
          const next = update(rows.get(key) ?? []);
          rows.set(key, next);
          if (next.some?.((row) => row?._id === 'private-predecessor')) {
            exposedRows.push(...next);
          }
          return next;
        },
      };
    },
  };

  client.clearAuthSession();
  const creating = createSnapbackContractSurface({
    runtime: guardedRuntime,
    client,
    userId: EFFECTIVE_USER,
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    livePush: false,
  });
  await entered;
  assert.throws(
    () => client.clearAuthSession(),
    (error) => error?.code === 'SNAPBACK_CLIENT_AUTH_SESSION_GENERATION_EXHAUSTED',
  );
  releaseQuery();
  await assert.rejects(
    creating,
    (error) => error?.code === 'SNAPBACK_CLIENT_AUTH_SESSION_GENERATION_EXHAUSTED',
  );
  assert.deepEqual(exposedRows, [], 'the in-flight predecessor result never reaches the boundary');
  await client.closeAuth();
}

// A split transport/Contract coordinator has no sound capture bridge: transport
// values are fenced by A while Contract would compare them under B. Reject the
// configuration before any auth request or app-visible mutation can begin.
{
  const value = credential();
  const clientAuthority = new AgentAuthorityFence(value);
  const client = new SnapbackClient('http://stub', { agentAuthority: clientAuthority });
  const clientCapture = clientAuthority.capture();
  const explicitCapture = Object.freeze({
    authorityEpoch: clientCapture.authorityEpoch + 10,
    custodyRevision: 1,
    authorityKey: `sha256:${'e'.repeat(64)}`,
  });
  const explicitCoordinator = {
    authority: {
      kind: 'session',
      authMode: 'sessions',
      userId: EFFECTIVE_USER,
    },
    async synchronize() { return explicitCapture; },
    capture() { return explicitCapture; },
    isCurrent(candidate) { return candidate === explicitCapture; },
    async compareAndCommit(candidate, commit) {
      return candidate === explicitCapture
        ? { committed: true, value: commit() }
        : { committed: false };
    },
    registerParticipant() { return async () => {}; },
  };
  client.query = async () => ({ rows: [], version: 1 });
  client.currentAuthorizationScope = async () => ({
    principalScope: {
      authMode: 'sessions',
      authorizationStreamIncarnation: AUTH_STREAM,
      userId: EFFECTIVE_USER,
    },
    queryAuthorization: {},
  });
  await assert.rejects(
    () => createSnapbackContractSurface({
      runtime,
      client,
      authCoordinator: explicitCoordinator,
      manifest,
      queryName: 'listTodos',
      boundaryKey: 'todos',
      livePush: false,
    }),
    (error) => error?.code === 'SNAPBACK_CONTRACT_AUTH_COORDINATOR_MISMATCH',
  );
  client.authCoordinator = explicitCoordinator;
  await assert.rejects(
    () => createSnapbackContractSurface({
      runtime,
      client,
      manifest,
      queryName: 'listTodos',
      boundaryKey: 'todos',
      livePush: false,
    }),
    (error) => error?.code === 'SNAPBACK_CONTRACT_AUTH_COORDINATOR_MISMATCH',
  );
  await client.closeAuth();
}

console.log('PASS snapback-contract agent authority — durable rotation, tuple cut, terminal blank');
