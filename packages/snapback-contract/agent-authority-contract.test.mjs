// LLP 0055 G8: Contract consumes the same explicit AgentAuthorityFence custody
// as the headless kit, with a durable grant-tuple replay axis and a separate
// token/carrier publication axis.

import assert from 'node:assert/strict';

import {
  AgentAuthorityFence,
  createMemoryAgentAuthorityCustodyStorage,
} from '../../demos/_kit/agent-authority.mjs';
import {
  canonicalAgentAuthorityKey,
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
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
await authority.synchronize();
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
const orderedTransition = orderedFence.replaceCredential(credential({
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
  () => failedFence.replaceCredential(credential({ grantId: GRANT_B })),
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
const rotatedCapture = await authority.replaceCredential(credential({
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
const changedCapture = await authority.replaceCredential(credential({
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
  const predecessor = await writer.synchronize();
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
    writer.replaceCredential(credential({
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

console.log('PASS snapback-contract agent authority — durable rotation, tuple cut, terminal blank');
