import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

import { deriveServiceAuthorityInstanceId } from '@expo/snapback-client';

import {
  acquireAgentAdmission,
  mintAgentToken,
  onboardAgentProfile,
  principalClient,
  readAgentProfile,
  selectPrincipal,
  writeAgentProfile,
} from './auth.mjs';

const ACTOR = '018f0d90-7b31-7a22-8c33-445566778899';
const EFFECTIVE = '018f0d90-7b31-7a22-8c33-445566778898';
const GRANT = '018f0d90-7b31-7a22-8c33-445566778897';
const CREDENTIAL = '018f0d90-7b31-7a22-8c33-445566778896';
const TOKEN = '018f0d90-7b31-7a22-8c33-445566778895';
const AGENT_SECRET = 'sbac_auth_test_credential';
const SCOPED_SECRET = 'sbagt_auth_test_scoped_token';

assert.deepEqual(await selectPrincipal({ env: { SNAPBACK_APP_SESSION_BEARER: 'sbs_ignored' } }), {
  principalClass: 'anonymous',
  source: 'default:anonymous',
});
assert.deepEqual(await selectPrincipal({ requested: 'auto', env: {} }), {
  principalClass: 'anonymous',
  source: 'auto:none',
});
assert.deepEqual(
  await selectPrincipal({ requested: 'auto', env: { SNAPBACK_APP_SESSION_BEARER: 'sbs_selected' } }),
  { principalClass: 'session', source: 'flag:session-bearer', bearerToken: 'sbs_selected' },
);
await assert.rejects(
  selectPrincipal({ requested: 'auto', env: {
    SNAPBACK_APP_SESSION_BEARER: 'sbs_selected',
    SNAPBACK_APP_AGENT_PROFILE: '/does/not/matter',
  } }),
  /source inventory is ambiguous/u,
);
await assert.rejects(
  selectPrincipal({ requested: 'auto', env: { SNAPBACK_APP_SESSION_BEARER: 'malformed' } }),
  (error) => error.code === 'SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID',
  'a live malformed source is terminal and never falls back to anonymous',
);

// @ref LLP 0062#4-auth-the-existing-model-projected--with-explicit-selection
// — the positive custody fixture must satisfy the real unsafe-ancestor rule,
// including on CI runners whose checkout parent is intentionally shared.
const privateTestRoot = resolve(
  process.env.SNAPBACK_APP_CLI_TEST_PRIVATE_ROOT ?? process.cwd(),
);
const scratch = await mkdtemp(join(privateTestRoot, '.auth-test-'));
await chmod(scratch, 0o700);
const authorityRoot = join(scratch, 'authority');
const profilePath = join(scratch, 'profile.json');
const calls = [];
let mintTupleMismatch = false;
let shortLifetime = false;
let mintSequence = 0;
let redirectHits = 0;
const issuedByBearer = new Map();
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'));
  calls.push({ path: request.url, body, authorization: request.headers.authorization ?? null });
  const send = (status, value, headers = {}) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(value === null ? '' : JSON.stringify(value));
  };
  if (request.url === '/auth/agents/pair') return send(200, { pairingRequestId: body.pairingRequestId, status: 'pending' });
  if (request.url === '/auth/agents/token') {
    const sequence = mintSequence;
    mintSequence += 1;
    const tokenId = sequence === 0
      ? TOKEN
      : `018f0d90-7b31-7a22-8c33-${String(445566778895 - sequence).padStart(12, '0')}`;
    const token = sequence === 0 ? SCOPED_SECRET : `${SCOPED_SECRET}_${sequence}`;
    issuedByBearer.set(token, tokenId);
    return send(200, {
      tokenId,
      grantId: GRANT,
      actorUserId: mintTupleMismatch ? EFFECTIVE : ACTOR,
      effectiveUserId: EFFECTIVE,
      credentialId: CREDENTIAL,
      credentialGeneration: 1,
      expiresAtMs: Date.now() + 120_000,
      expiresInMs: shortLifetime ? 80 : 120_000,
      grantExpiresAtMs: null,
      scopes: [{ tier: 'query' }],
      token,
    });
  }
  if (request.url === '/auth/agents/token/release') return send(204, null);
  if (request.url === '/auth/session') {
    const bearer = request.headers.authorization?.replace(/^Bearer /u, '') ?? '';
    const tokenId = issuedByBearer.get(bearer);
    if (tokenId === undefined) return send(401, { diagnostic: { code: 'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID' } });
    return send(200, {
      protocolVersion: 1,
      serverStartupNonce: 'auth-test-startup',
      authorizationStreamIncarnation: '018f0d90-7b31-7a22-8c33-445566778894',
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
      authority: { kind: 'servicePrincipal', userId: ACTOR, sessionId: null, isAuthenticated: true },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId: deriveServiceAuthorityInstanceId({
          actorUserId: ACTOR,
          credentialId: CREDENTIAL,
          credentialGeneration: 1,
          grantId: GRANT,
        }),
        sessionGeneration: 0,
      },
      deploymentIdentity: {
        schemaVersion: 'snapback.v1',
        authMode: 'sessions',
        appId: 'auth-test',
        schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
        bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
        inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
      },
      authorizedLease: null,
    });
  }
  if (request.url === '/redirect-token') return send(307, null, { location: '/redirect-sentinel' });
  if (request.url === '/redirect-sentinel') {
    redirectHits += 1;
    return send(500, null);
  }
  return send(404, { diagnostic: { code: 'SNAPBACK_TEST_UNEXPECTED' } });
});

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await writeAgentProfile(profilePath, {
    targetOrigin: origin,
    appId: 'auth-test',
    grantId: GRANT,
    actorUserId: ACTOR,
    effectiveUserId: EFFECTIVE,
    credentialId: CREDENTIAL,
    credentialGeneration: 1,
    credential: { kind: 'env', name: 'AUTH_TEST_AGENT_CREDENTIAL' },
  });
  const profile = await readAgentProfile(profilePath);
  assert.equal('token' in profile, false);
  assert.deepEqual(profile.credential, { kind: 'env', name: 'AUTH_TEST_AGENT_CREDENTIAL' });

  const selected = await selectPrincipal({ requested: 'agent', agentProfile: profilePath, env: {} });
  const surface = {
    appId: 'auth-test',
    appCliDescriptor: {
      capabilityId: 'app-cli.target',
      principalClasses: ['anonymous', 'dev', 'session', 'agent'],
      servesEnvelopes: true,
      acceptsGenerationAssertions: true,
      perGrantTokenCap: 4,
    },
  };
  const invocation = await principalClient(origin, surface, selected, {
    env: { AUTH_TEST_AGENT_CREDENTIAL: AGENT_SECRET },
    authorityRoot,
  });
  assert.equal(invocation.client.agentAuthority.authority.actorUserId, ACTOR);
  assert.equal(invocation.tokenExpiresInMs, 120_000);
  await invocation.close();
  assert.deepEqual(calls.slice(-2).map(({ path }) => path), [
    '/auth/agents/token',
    '/auth/agents/token/release',
  ]);
  assert.equal(calls.at(-1).body.token, SCOPED_SECRET);
  assert.equal(calls.every(({ authorization }) => authorization === null), true);

  mintTupleMismatch = true;
  await assert.rejects(
    principalClient(origin, surface, selected, {
      env: { AUTH_TEST_AGENT_CREDENTIAL: AGENT_SECRET },
      authorityRoot,
    }),
    (error) => error.code === 'SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID',
  );
  mintTupleMismatch = false;
  assert.equal(calls.at(-1).path, '/auth/agents/token/release', 'mismatch cleanup releases its minted carrier');

  const first = await acquireAgentAdmission({
    root: join(scratch, 'admission'), origin, appId: 'auth-test', grantId: GRANT,
    capacity: 3, waitMs: 10, leaseMs: 5_000,
  });
  await assert.rejects(
    acquireAgentAdmission({
      root: join(scratch, 'admission'), origin, appId: 'auth-test', grantId: GRANT,
      capacity: 3, waitMs: 10, leaseMs: 5_000,
    }),
    (error) => error.code === 'SNAPBACK_APP_CLI_AGENT_ADMISSION_TIMEOUT',
  );
  await first.release();
  await (await acquireAgentAdmission({
    root: join(scratch, 'admission'), origin, appId: 'auth-test', grantId: GRANT,
    capacity: 3, waitMs: 10, leaseMs: 5_000,
  })).release();

  const pairedPath = join(scratch, 'paired', 'profile.json');
  const paired = await onboardAgentProfile({
    origin,
    appId: 'auth-test',
    profilePath: pairedPath,
    credential: AGENT_SECRET,
    credentialReference: { kind: 'env', name: 'AUTH_TEST_AGENT_CREDENTIAL' },
    pairingRequestId: 'pairing-request',
    pairingCode: '123456',
    requestedScopes: [{ tier: 'query' }],
    pollMs: 1,
  });
  assert.equal(paired.grantId, GRANT);
  assert.equal(calls.find(({ path }) => path === '/auth/agents/pair').body.pairingCode, '123456');
  assert.equal(calls.at(-1).path, '/auth/agents/token/release', 'pairing token is released immediately');
  assert.equal((await readFile(pairedPath, 'utf8')).includes(AGENT_SECRET), false);
  assert.equal((await readFile(pairedPath, 'utf8')).includes(SCOPED_SECRET), false);

  shortLifetime = true;
  const renewing = await principalClient(origin, surface, selected, {
    env: { AUTH_TEST_AGENT_CREDENTIAL: AGENT_SECRET },
    authorityRoot,
  });
  await renewing.client.authSession();
  const predecessor = renewing.client.agentAuthority.capture().tokenId;
  const renewalDeadline = Date.now() + 1_000;
  while (renewing.client.agentAuthority.capture().tokenId === predecessor
    && Date.now() < renewalDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.notEqual(
    renewing.client.agentAuthority.capture().tokenId,
    predecessor,
    'mid-invocation renewal validates and installs a successor carrier',
  );
  await renewing.close();
  shortLifetime = false;

  await chmod(profilePath, 0o644);
  await assert.rejects(
    readAgentProfile(profilePath),
    (error) => error.code === 'SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID',
  );

  await assert.rejects(
    principalClient('http://example.com', surface, selected, {
      env: { AUTH_TEST_AGENT_CREDENTIAL: AGENT_SECRET },
      authorityRoot,
    }),
    (error) => error.code === 'SNAPBACK_APP_CLI_AGENT_ORIGIN_UNSAFE',
    'non-loopback targets refuse before presenting a durable agent credential',
  );

  // Direct lifecycle transport uses redirect: terminal semantics. This path
  // is deliberately reached through the public helper with a redirected
  // token route installed temporarily by addressing a server whose token
  // route itself redirects.
  const redirectServer = createServer((request, response) => {
    if (request.url === '/auth/agents/token') {
      response.writeHead(307, { location: `${origin}/redirect-sentinel` }).end();
    } else response.writeHead(500).end();
  });
  await new Promise((resolve) => redirectServer.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      mintAgentToken(`http://127.0.0.1:${redirectServer.address().port}`, {
        credential: AGENT_SECRET,
        grantId: GRANT,
      }),
      (error) => error.code === 'SNAPBACK_APP_CLI_TRANSPORT_FAILED',
    );
    assert.equal(redirectHits, 0, 'redirect target never receives the credential body');
  } finally {
    await new Promise((resolve) => redirectServer.close(resolve));
  }

  console.log('auth.test.mjs: principal selection, custody, agent release, admission, and redirect fences pass');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
