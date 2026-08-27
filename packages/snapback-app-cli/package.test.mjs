import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveServiceAuthorityInstanceId } from '@expo/snapback-client';
import {
  invokeAppFunction,
  runPackagedAgentJourney,
  subscribeAppFunction,
} from './index.mjs';

// Ticket issues/20260717-app-cli-client-core-package.md: the engine's client
// façade must have no ambient SNAPBACK_ADMIN_TOKEN pickup. Plant the env var
// for the whole journey and prove no request carries it.
const PLANTED_ADMIN_TOKEN = 'sbadm_planted_engine_token_do_not_transmit';
const previousAdminToken = process.env.SNAPBACK_ADMIN_TOKEN;
process.env.SNAPBACK_ADMIN_TOKEN = PLANTED_ADMIN_TOKEN;
const previousRqsDirectory = process.env.SNAPBACK_CLIENT_RQS_DIR;

const calls = [];
let created = false;
const ACTOR_ID = '018f0d90-7b31-7a22-8c33-445566778899';
const TOKEN_ID = '018f0d90-7b31-7a22-8c33-445566778811';
const GRANT_ID = '018f0d90-7b31-7a22-8c33-445566778812';
const CREDENTIAL_ID = '018f0d90-7b31-7a22-8c33-445566778813';
const AUTHORIZATION_INCARNATION = '018f0d90-7b31-7a22-8c33-445566778814';
const authorityInstanceId = deriveServiceAuthorityInstanceId({
  actorUserId: ACTOR_ID,
  credentialId: CREDENTIAL_ID,
  credentialGeneration: 1,
  grantId: GRANT_ID,
});
const handshake = {
  protocolVersion: 1,
  serverStartupNonce: 'app-cli-acceptance',
  authorizationStreamIncarnation: AUTHORIZATION_INCARNATION,
  transitionGeneration: 1,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: 1,
    authorityDescriptor: 1,
    authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
    },
    queuedReplay: {
      available: false,
      minimumAuthorityDescriptorProtocol: 1,
      reason: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
    },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: { kind: 'servicePrincipal', userId: ACTOR_ID, sessionId: null, isAuthenticated: true },
  authorityDescriptor: { descriptorVersion: 1, authorityInstanceId, sessionGeneration: 0 },
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: 'journey',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
  },
  authorizedLease: null,
};
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
  calls.push({
    path: request.url,
    body,
    authorization: request.headers.authorization ?? null,
    headers: { ...request.headers },
  });
  const send = (value) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  if (request.url === '/auth/agents/pair') return send({ pairingRequestId: body.pairingRequestId, status: 'pending' });
  if (request.url === '/auth/agents/token') return send({
    tokenId: TOKEN_ID,
    grantId: GRANT_ID,
    credentialId: CREDENTIAL_ID,
    credentialGeneration: 1,
    expiresAtMs: Date.now() + 60_000,
    grantExpiresAtMs: Date.now() + 60_000,
    scopes: [{ tier: 'query' }, { tier: 'mutation' }],
    token: 'sbagt_scoped_test_token',
  });
  if (request.url === '/auth/agents/token/release') {
    response.writeHead(204).end();
    return undefined;
  }
  if (request.url === '/auth/session') return send(handshake);
  if (request.url === '/mutation/createTodo') {
    created = true;
    return send({ result: { id: 'todo-1' }, changed_count: 1, version: 1 });
  }
  if (request.url === '/connection/open') return send({ connectionId: 'cli-grant', connectionToken: 'sct_cli' });
  if (request.url === '/live/listTodos/subscribe') {
    assert.equal(request.headers['x-snapback-connection-token'], 'sct_cli');
    return send({ subscription_id: 'sub-cli', snapshot: { version: 1, rows: created ? [{ id: 'todo-1' }] : [] } });
  }
  if (request.url === '/query/listTodosOnce') return send({ rows: created ? [{ id: 'todo-1' }] : [], version: 1 });
  response.writeHead(404).end();
});

const directory = await mkdtemp(join(tmpdir(), 'snapback-app-cli-'));
// Exercise the default durable-store path without inheriting another local
// client's writer lease or capability facts. The bounded rm retry only covers
// the query-triggered capability commit that may still be settling at teardown.
process.env.SNAPBACK_CLIENT_RQS_DIR = join(directory, 'rqs');
try {
  await writeFile(join(directory, 'artifacts.json'), JSON.stringify({
    artifactKind: 'artifactIndex',
    appId: 'journey',
    schemaVersion: 'snapback.v0',
    schemaHash: 'sha256:journey-schema',
    bundleHash: 'sha256:test',
    inputsHash: 'journey-inputs',
  }));
  await writeFile(join(directory, 'functions.manifest.json'), JSON.stringify({
    artifactKind: 'functionManifest',
    appId: 'journey',
    bundleHash: 'sha256:test',
    functions: [
      { id: 'journey:createTodo', name: 'createTodo', kind: 'Mutation' },
      { id: 'journey:listTodos', name: 'listTodos', kind: 'LiveQuery' },
      { id: 'journey:listTodosOnce', name: 'listTodosOnce', kind: 'Query' },
    ],
  }));
  await mkdir(join(directory, 'operations'));
  for (const name of ['createTodo', 'listTodos', 'listTodosOnce']) {
    await writeFile(join(directory, 'operations', `${name}.args.schema.json`), JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: name === 'createTodo' ? { title: { type: 'string' } } : {},
      required: name === 'createTodo' ? ['title'] : [],
    }));
  }
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const result = await runPackagedAgentJourney({
    baseUrl: `http://127.0.0.1:${address.port}`,
    artifactsDirectory: directory,
    credential: 'sbagc_test',
    pairingRequestId: 'pair-1',
    pairingCode: '123456',
    requestedScopes: [{ tier: 'query' }, { tier: 'mutation' }],
    actorUserId: ACTOR_ID,
    mutation: { name: 'createTodo', args: { title: 'from agent' } },
    liveQuery: { name: 'listTodos', args: {} },
    verifyQuery: { name: 'listTodosOnce', args: {} },
  });
  assert.equal(result.appId, 'journey');
  assert.deepEqual(result.subscribed.snapshot.rows, [{ id: 'todo-1' }]);
  assert.deepEqual(result.verified.rows, [{ id: 'todo-1' }]);
  assert.equal(JSON.stringify(result).includes('sbagt_scoped_test_token'), false);
  // @ref LLP 0043#target-settlement-ledger-capability-gate-2026-08-12 —
  // queue:'auto' must freshly inspect the target's replay capability before
  // mutation dispatch. Persisted evidence is only the transport-unavailable
  // enqueue fallback, so this probe deliberately precedes the first mutation
  // instead of trusting a boot cache. This mock serves no /inspect route, so
  // the probe answers 404: a rule-(b) durable negative that drops queue:'auto'
  // to online-only. The journey still succeeds and the assertion still fails
  // if the probe stops being issued, but no target identity is learned here.
  assert.deepEqual(calls.map(({ path }) => path), [
    '/auth/agents/pair',
    '/auth/agents/token',
    '/inspect',
    '/auth/session',
    '/mutation/createTodo',
    '/auth/session',
    '/connection/open',
    '/auth/session',
    '/live/listTodos/subscribe',
    '/auth/session',
    '/query/listTodosOnce',
    '/auth/agents/token/release',
  ]);
  // @ref LLP 0059#connection-bound-authority — opening a live connection
  // exchanges the bearer for a scoped connection grant; the subscription
  // request must not keep transmitting the broader bearer.
  const liveCall = calls.find(({ path }) => path === '/live/listTodos/subscribe');
  assert.equal(
    liveCall.authorization,
    null,
    'connection-token live requests must not duplicate the bearer',
  );
  assert.equal(
    calls
      .slice(2)
      .filter(({ path }) => !['/live/listTodos/subscribe', '/auth/agents/token/release'].includes(path))
      .every(({ authorization }) => authorization === 'Bearer sbagt_scoped_test_token'),
    true,
    'ordinary agent requests retain the scoped bearer',
  );
  assert.deepEqual(calls.at(-1).body, { token: 'sbagt_scoped_test_token' });
  // @ref LLP 0062#position-among-existing-surfaces — with the admin token
  // planted in the environment, no engine request of any kind carries it:
  // the façade has no ambient pickup and no admin request path.
  for (const call of calls) {
    const serialized = JSON.stringify(call);
    assert.equal(
      serialized.includes(PLANTED_ADMIN_TOKEN),
      false,
      `engine request to ${call.path} must not carry the planted admin token`,
    );
    assert.equal(
      'x-snapback-admin-token' in call.headers,
      false,
      `engine request to ${call.path} must not carry an admin token header`,
    );
  }
  // @ref LLP 0062#1-engine-plus-data-never-program-source--served-or-generated —
  // call-time generation binding: the loaded index carries the complete
  // artifact identity, so every ordinary call and the live establishment must
  // assert it on the wire (the resolved 20260801-llp0012 ask's client half).
  const expectedGeneration = {
    schemaVersion: 'snapback.v0',
    appId: 'journey',
    schemaHash: 'sha256:journey-schema',
    bundleHash: 'sha256:test',
    inputsHash: 'journey-inputs',
  };
  for (const path of ['/mutation/createTodo', '/query/listTodosOnce', '/live/listTodos/subscribe']) {
    const call = calls.find((entry) => entry.path === path);
    assert.deepEqual(
      call.body.expectedGeneration,
      expectedGeneration,
      `${path} must assert the generated artifact identity`,
    );
  }
  const selectorCalls = [];
  const selectorClient = Object.freeze({
    query: async (ref) => selectorCalls.push(['query', ref]),
    mutate: async (ref) => selectorCalls.push(['mutation', ref]),
    action: async (ref) => selectorCalls.push(['action', ref]),
    subscribeLive: async (ref) => selectorCalls.push(['liveQuery', ref]),
  });
  const emptyArgsSchema = Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({}),
  });
  const selectorArtifacts = Object.freeze({
    generation: expectedGeneration,
    functions: Object.freeze([
      ['readOnce', 'query'],
      ['watchRows', 'liveQuery'],
      ['writeOnce', 'mutation'],
      ['callEffect', 'action'],
    ].map(([name, kind]) => Object.freeze({ name, kind, argsSchema: emptyArgsSchema }))),
  });
  await invokeAppFunction(selectorClient, selectorArtifacts, 'readOnce');
  await invokeAppFunction(selectorClient, selectorArtifacts, 'writeOnce');
  await invokeAppFunction(selectorClient, selectorArtifacts, 'callEffect');
  await subscribeAppFunction(selectorClient, selectorArtifacts, 'watchRows');
  assert.deepEqual(selectorCalls, [
    ['query', {
      artifactKind: 'functionReference', name: 'readOnce', kind: 'Query', expectedGeneration,
      argumentSchema: emptyArgsSchema,
    }],
    ['mutation', {
      artifactKind: 'functionReference', name: 'writeOnce', kind: 'Mutation', expectedGeneration,
      argumentSchema: emptyArgsSchema,
    }],
    ['action', {
      artifactKind: 'functionReference', name: 'callEffect', kind: 'Action', expectedGeneration,
      argumentSchema: emptyArgsSchema,
    }],
    ['liveQuery', {
      artifactKind: 'functionReference', name: 'watchRows', kind: 'LiveQuery', expectedGeneration,
      argumentSchema: emptyArgsSchema,
    }],
  ]);
  const callsBeforeMismatch = selectorCalls.length;
  await assert.rejects(
    () => invokeAppFunction(selectorClient, selectorArtifacts, 'watchRows'),
    (error) => error?.code === 'SNAPBACK_APP_CLI_CALL_REQUIRES_ORDINARY_FUNCTION',
  );
  await assert.rejects(
    () => subscribeAppFunction(selectorClient, selectorArtifacts, 'readOnce'),
    (error) => error?.code === 'SNAPBACK_APP_CLI_SUBSCRIBE_REQUIRES_LIVE_QUERY',
  );
  assert.equal(selectorCalls.length, callsBeforeMismatch, 'verb mismatches refuse before transport');
  console.log('package.test.mjs: packaged discover/pair/mutate/subscribe/verify journey passes');
  console.log('package.test.mjs: planted SNAPBACK_ADMIN_TOKEN never left the engine');
  console.log('package.test.mjs: every call family asserted the artifact generation');
  console.log('package.test.mjs: generated selectors preserve all four nominal reference kinds');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  if (previousAdminToken === undefined) delete process.env.SNAPBACK_ADMIN_TOKEN;
  else process.env.SNAPBACK_ADMIN_TOKEN = previousAdminToken;
  if (previousRqsDirectory === undefined) delete process.env.SNAPBACK_CLIENT_RQS_DIR;
  else process.env.SNAPBACK_CLIENT_RQS_DIR = previousRqsDirectory;
}
