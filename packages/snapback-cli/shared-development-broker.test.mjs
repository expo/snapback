import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  createSharedDevelopmentVerifier,
  readSharedDevelopmentCallback,
  redeemSharedDevelopmentAuth,
  sharedDevelopmentAuthorizationUrl,
  startSharedDevelopmentAuth,
} from '@expo/snapback-client/shared-development-auth';

import {
  createSharedDevelopmentBroker,
  sharedDevelopmentAuthProjection,
  supervisedSharedAuthReturnTargets,
} from './shared-development-broker.mjs';
import { __test as expoDevTest } from './expo-dev.mjs';

const APP_ID = 'app-broker-fixture';
const METRO_PORT = 8081;

const BACKEND_ORIGIN = 'http://127.0.0.1:4287';
const INCARNATION = '018f0d90-7c21-7a22-8c33-445566778899';

/// The minimum protocol-v1 anonymous handshake the client accepts.
const anonymousHandshake = () => ({
  protocolVersion: 1,
  serverStartupNonce: 'shared-development-broker-test',
  authorizationStreamIncarnation: INCARNATION,
  transitionGeneration: 0,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: null,
    authorityDescriptor: 1,
    authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      reason: 'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_REQUIRED',
    },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
    },
    queuedReplay: { available: true, minimumAuthorityDescriptorProtocol: 1, reason: null },
  },
  provider: { key: 'local-password', available: true },
  transports: ['bearer'],
  authority: { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: INCARNATION,
    sessionGeneration: 0,
  },
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: APP_ID,
    schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
  },
  authorizedLease: null,
});

/// A capture-mailbox stand-in. The broker's completion path is the ordinary
/// email-code path, so this answers the deployment routes that path uses and
/// leaves every other request — including the broker's own HTTP server — to the
/// real fetch.
function installFakeDeployment() {
  const issued = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const target = new URL(typeof input === 'string' ? input : input.url);
    if (target.origin !== BACKEND_ORIGIN) return originalFetch(input, init);
    if (target.pathname === '/auth/session') {
      return Response.json(anonymousHandshake());
    }
    if (target.pathname === '/auth/request-code') {
      const body = JSON.parse(init.body);
      const challengeId = `challenge-${issued.length + 1}`;
      issued.push({ challengeId, address: body.email });
      return Response.json({ challengeId, expiresAt: 1_800_000_000_000 });
    }
    if (target.pathname === '/_snapback/api/auth/mailbox') {
      const challengeId = target.searchParams.get('challengeId');
      const record = issued.find((entry) => entry.challengeId === challengeId);
      // The carriers reach the mailbox as headers, never as URL material.
      assert.equal(init.headers['x-snapback-admin-token'], 'admin-token-fixture');
      assert.equal(init.headers['x-snapback-impersonation-capability'], 'impersonation-fixture');
      assert.equal(target.search.includes('admin-token-fixture'), false);
      return Response.json({
        challengeId,
        canonicalAddress: record.address,
        code: `code-for-${challengeId}`,
      });
    }
    throw new Error(`unexpected broker fetch to ${target.pathname}`);
  };
  return { issued, restore: () => { globalThis.fetch = originalFetch; } };
}

async function listening(broker) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://broker.local');
    void broker.handle(request, response, url).then((handled) => {
      if (handled) return;
      response.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    close: () => new Promise((resolve, reject) => {
      server.closeAllConnections?.();
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function broker(overrides = {}) {
  return createSharedDevelopmentBroker({
    appId: APP_ID,
    serverOrigin: BACKEND_ORIGIN,
    adminToken: 'admin-token-fixture',
    impersonationCapability: 'impersonation-fixture',
    returnTargets: supervisedSharedAuthReturnTargets(METRO_PORT),
    ...overrides,
  });
}

test('return targets are derived from the supervised client port, not configured', () => {
  assert.deepEqual(supervisedSharedAuthReturnTargets(8081), [
    'exp://127.0.0.1:8081/--/auth/shared',
    'exp://localhost:8081/--/auth/shared',
    'http://127.0.0.1:8081/auth/shared',
    'http://localhost:8081/auth/shared',
  ]);
  // Expo Go delivers the exp:// deep link with no app-owned native build.
  assert.throws(
    () => supervisedSharedAuthReturnTargets(0),
    (error) => error.reason === 'return-target-invalid',
  );
});

test('the projection is credential-free and names its own nonclaim', () => {
  const projection = sharedDevelopmentAuthProjection(broker(), 'http://127.0.0.1:4300');
  assert.equal(projection.available, true);
  assert.equal(projection.origin, 'http://127.0.0.1:4300');
  assert.equal(projection.identityRealm, 'rehearsal');
  assert.equal(projection.userLimit, 100);
  assert.match(projection.nonclaim, /not Apple or Google logins/u);
  const serialized = JSON.stringify(projection);
  for (const secret of ['admin-token-fixture', 'impersonation-fixture', 'token', 'secret']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test('staging and production are not admitted, and the projection says why', () => {
  for (const deploymentProfile of ['staging', 'production']) {
    const instance = broker({ deploymentProfile });
    assert.equal(instance.available, false);
    const projection = sharedDevelopmentAuthProjection(instance, 'http://127.0.0.1:4300');
    assert.equal(projection.available, false);
    assert.equal(projection.reason, `deployment-not-admitted:${deploymentProfile}`);
  }
  const absent = sharedDevelopmentAuthProjection(null, null);
  assert.equal(absent.reason, 'no-broker');
});

test('an unadmitted broker handles nothing rather than serving a refusal page', async () => {
  const instance = broker({ deploymentProfile: 'production' });
  assert.equal(await instance.handle({}, {}, new URL('http://x/v1/shared/start')), false);
});

test('the supervised broker completes one browser round trip into an external code', async () => {
  const deployment = installFakeDeployment();
  const server = await listening(broker());
  try {
    const { verifier, codeChallenge } = await createSharedDevelopmentVerifier();
    const started = await startSharedDevelopmentAuth(server.origin, {
      appId: APP_ID,
      provider: 'apple',
      returnTo: supervisedSharedAuthReturnTargets(METRO_PORT)[0],
      codeChallenge,
    });

    // The authorization page is same-origin, script-free, and posts back here.
    const authorizeUrl = sharedDevelopmentAuthorizationUrl(server.origin, started);
    const page = await fetch(authorizeUrl);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('content-security-policy').includes("form-action 'self'"), true);
    const html = await page.text();
    assert.equal(html.includes('<script'), false);
    assert.match(html, /not a real Apple account/u);

    const completion = await fetch(
      `${server.origin}/v1/shared/complete?transaction=${encodeURIComponent(started.transactionId)}`,
      { method: 'POST', redirect: 'manual' },
    );
    assert.equal(completion.status, 303);
    const { code } = readSharedDevelopmentCallback(completion.headers.get('location'), started);

    const redeemed = await redeemSharedDevelopmentAuth(server.origin, {
      appId: APP_ID,
      code,
      verifier,
    });
    // Exactly the short-lived external completion plus the entry facts.
    assert.deepEqual(Object.keys(redeemed).sort(), ['entry', 'exchange']);
    assert.equal(typeof redeemed.exchange.challengeId, 'string');
    assert.equal(typeof redeemed.exchange.code, 'string');
    assert.equal(redeemed.entry.adapter, 'snapback-shared-browser');
    assert.equal(redeemed.entry.identityRealm, 'rehearsal');
    assert.equal(redeemed.entry.providerInstallationId, `shared-development:${APP_ID}:apple:v1`);

    // The mailbox address the broker used is derived, unresolvable, and holds
    // no personal data.
    assert.equal(deployment.issued.length, 1);
    assert.match(deployment.issued[0].address, /^snapback-rehearsal-[0-9a-f]{40}@shared-development\.invalid$/u);

    // Replay of the same code finds nothing.
    await assert.rejects(
      redeemSharedDevelopmentAuth(server.origin, { appId: APP_ID, code, verifier }),
      (error) => error.reason === 'completion-code-unavailable',
    );
  } finally {
    await server.close();
    deployment.restore();
  }
});

test('the callback carries no provider token and no session credential', async () => {
  const server = await listening(broker());
  try {
    const { codeChallenge } = await createSharedDevelopmentVerifier();
    const started = await startSharedDevelopmentAuth(server.origin, {
      appId: APP_ID,
      provider: 'google',
      returnTo: supervisedSharedAuthReturnTargets(METRO_PORT)[0],
      codeChallenge,
    });
    const completion = await fetch(
      `${server.origin}/v1/shared/complete?transaction=${encodeURIComponent(started.transactionId)}`,
      { method: 'POST', redirect: 'manual' },
    );
    const location = new URL(completion.headers.get('location'));
    assert.deepEqual([...location.searchParams.keys()].sort(), ['code', 'state']);
    assert.equal(location.toString().startsWith('exp://127.0.0.1:8081/--/auth/shared?'), true);
  } finally {
    await server.close();
  }
});

test('a return target outside the derived allowlist is refused', async () => {
  const server = await listening(broker());
  try {
    const { codeChallenge } = await createSharedDevelopmentVerifier();
    await assert.rejects(
      startSharedDevelopmentAuth(server.origin, {
        appId: APP_ID,
        provider: 'apple',
        returnTo: 'https://evil.example/auth/shared',
        codeChallenge,
      }),
      (error) => error.reason === 'return-target-not-allowlisted',
    );
  } finally {
    await server.close();
  }
});

test('non-shared paths are left to the host listener and wrong methods refuse', async () => {
  const server = await listening(broker());
  try {
    assert.equal((await fetch(`${server.origin}/_snapback/expo/v1/bootstrap`)).status, 404);
    const wrongMethod = await fetch(`${server.origin}/v1/shared/start`);
    assert.equal(wrongMethod.status, 400);
    assert.equal((await wrongMethod.json()).diagnostic.details.reason, 'method-not-allowed');
    const unknown = await fetch(`${server.origin}/v1/shared/nope`);
    assert.equal((await unknown.json()).diagnostic.details.reason, 'route-unknown');
  } finally {
    await server.close();
  }
});

test('an oversized request body refuses instead of being buffered', async () => {
  const server = await listening(broker());
  try {
    const response = await fetch(`${server.origin}/v1/shared/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: APP_ID, padding: 'x'.repeat(80 * 1024) }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).diagnostic.details.reason, 'request-too-large');
  } finally {
    await server.close();
  }
});

// The broker mints rehearsal identities through the supervisor's mechanical
// impersonation capability, which it reads from the `<ready-file>.impersonation`
// sibling and nowhere else.
test('the impersonation capability is matched by what it names, not how it is spelled', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-impersonation-'));
  after(() => rmSync(scratch, { recursive: true, force: true }));
  const real = join(scratch, 'real');
  const link = join(scratch, 'link');
  mkdirSync(real);
  symlinkSync(real, link, 'dir');
  const readyFile = join(real, 'dev.ready.json');
  writeFileSync(readyFile, '{}');
  writeFileSync(`${readyFile}.impersonation`, 'impersonation-capability\n');

  // The server pins the real directory before publishing; a caller reaching the
  // same file through a symlinked directory still names the same sibling. Every
  // macOS temporary directory is reached that way, so a lexical comparison
  // refuses the supervisor's own capability.
  assert.equal(
    expoDevTest.readSupervisedImpersonationCapability(
      { impersonationCapabilityFile: `${readyFile}.impersonation` },
      join(link, 'dev.ready.json'),
    ),
    'impersonation-capability',
  );
  // A descriptor naming any other file is still a refusal, not a file read.
  writeFileSync(join(real, 'elsewhere.impersonation'), 'other-capability\n');
  assert.throws(
    () => expoDevTest.readSupervisedImpersonationCapability(
      { impersonationCapabilityFile: join(real, 'elsewhere.impersonation') },
      readyFile,
    ),
    (error) => error.code === 'SNAPBACK_DEV_IMPERSONATION_CAPABILITY_UNAVAILABLE',
  );
  assert.throws(
    () => expoDevTest.readSupervisedImpersonationCapability({}, readyFile),
    (error) => error.code === 'SNAPBACK_DEV_IMPERSONATION_CAPABILITY_UNAVAILABLE',
  );
});

// The browser is the component that enforces this, so these assertions are on
// response headers rather than on a round trip: Node fetch would pass either
// way. See issues/20260826-shared-broker-refuses-expo-web-cors.md.
test('a supervised web client origin is admitted exactly, and nothing else is', async () => {
  const server = await listening(broker());
  try {
    const webOrigin = 'http://127.0.0.1:8081';
    // The preflight the browser sends before a JSON POST.
    const preflight = await fetch(`${server.origin}/v1/shared/start`, {
      method: 'OPTIONS',
      headers: {
        origin: webOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), webOrigin);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type');
    assert.equal(preflight.headers.get('vary'), 'Origin');

    // The call itself, and its refusals, carry the same projection.
    const refused = await fetch(`${server.origin}/v1/shared/start`, {
      method: 'POST',
      headers: { origin: webOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ appId: APP_ID, provider: 'apple' }),
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.headers.get('access-control-allow-origin'), webOrigin);

    // An origin the supervisor never derived gets no projection at all, and
    // the route refuses it before doing any work.
    for (const foreign of ['http://127.0.0.1:9999', 'https://evil.example', 'http://localhost:8082']) {
      const blocked = await fetch(`${server.origin}/v1/shared/start`, {
        method: 'OPTIONS',
        headers: { origin: foreign, 'access-control-request-method': 'POST' },
      });
      assert.equal(blocked.headers.get('access-control-allow-origin'), null, foreign);
      assert.notEqual(blocked.status, 204, foreign);
    }

    // CORS does not stop a foreign page from sending a simple request; it only
    // hides the response. A text/plain POST therefore has to fail before body
    // parsing and transaction creation, not merely omit the response header.
    const foreignPost = await fetch(`${server.origin}/v1/shared/start`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
      body: JSON.stringify({
        appId: APP_ID,
        provider: 'apple',
        returnTo: `http://127.0.0.1:${METRO_PORT}/auth/shared`,
        codeChallenge: 'x'.repeat(43),
      }),
    });
    assert.equal(foreignPost.status, 400);
    assert.equal(foreignPost.headers.get('access-control-allow-origin'), null);
    assert.equal(
      (await foreignPost.json()).diagnostic.details.reason,
      'origin-not-allowlisted',
    );

    // An `exp://` return target is not an admitted browser origin.
    const deepLinkOrigin = await fetch(`${server.origin}/v1/shared/start`, {
      method: 'OPTIONS',
      headers: { origin: 'exp://127.0.0.1:8081', 'access-control-request-method': 'POST' },
    });
    assert.equal(deepLinkOrigin.headers.get('access-control-allow-origin'), null);

    // Native clients send no Origin at all and are unaffected.
    const native = await fetch(`${server.origin}/v1/shared/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: APP_ID, provider: 'apple' }),
    });
    assert.equal(native.status, 400);
    assert.equal(native.headers.get('access-control-allow-origin'), null);
  } finally {
    await server.close();
  }
});

// The completion is a 303 to the app's own origin, and `form-action` governs
// where a submission may end up, redirects included. A policy of `'self'` alone
// silently blocks that redirect in the browser while every server-side check
// still passes, so this asserts the header rather than the round trip.
test('the authorization page permits the completion redirect it depends on', async () => {
  const server = await listening(broker());
  try {
    const started = await (await fetch(`${server.origin}/v1/shared/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appId: APP_ID,
        provider: 'apple',
        returnTo: `http://127.0.0.1:${METRO_PORT}/auth/shared`,
        codeChallenge: 'x'.repeat(43),
      }),
    })).json();
    const page = await fetch(`${server.origin}${started.authorizationPath}`);
    assert.equal(page.status, 200);
    const policy = page.headers.get('content-security-policy');
    const formAction = /form-action ([^;]+)/u.exec(policy)?.[1] ?? '';
    assert.match(formAction, /'self'/u);
    assert.match(formAction, new RegExp(`http://127\\.0\\.0\\.1:${METRO_PORT}`, 'u'));
    assert.match(formAction, new RegExp(`http://localhost:${METRO_PORT}`, 'u'));
    // Still closed: no wildcard, and the exp:// deep-link target is not a form
    // destination a browser could post to.
    assert.doesNotMatch(formAction, /\*/u);
    assert.doesNotMatch(formAction, /exp:/u);
    assert.match(policy, /default-src 'none'/u);
    assert.match(policy, /frame-ancestors 'none'/u);
  } finally {
    await server.close();
  }
});
