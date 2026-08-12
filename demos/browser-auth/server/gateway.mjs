import { createHash, createHmac, randomBytes } from 'node:crypto';

import { SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';

import {
  signFixtureAssertion,
  verifyExternalAssertion,
} from './external-assertion.mjs';

const FIXTURE_ISSUER = 'https://identity.fixture.invalid';
const FIXTURE_AUDIENCE = 'snapback-browser-auth-recipe';
const TRANSACTION_TTL_MS = 5 * 60_000;
const FIXTURE_IDENTITIES = Object.freeze({
  alice: Object.freeze({
    subject: 'fixture-alice-001',
    displayName: 'Alice Fixture',
    email: 'alice.before@fixture.invalid',
  }),
  bob: Object.freeze({
    subject: 'fixture-bob-002',
    displayName: 'Bob Fixture',
    email: 'bob@fixture.invalid',
  }),
});

const PUBLIC_ROUTES = Object.freeze(new Set([
  'GET /auth/session',
  'POST /auth/exchange',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /query/viewer',
]));

const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function cookieMap(request) {
  const values = new Map();
  for (const item of (request.headers.cookie ?? '').split(';')) {
    const split = item.indexOf('=');
    if (split > 0) values.set(item.slice(0, split).trim(), item.slice(split + 1));
  }
  return values;
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function redirect(response, location, cookies = []) {
  const headers = { location, 'cache-control': 'no-store' };
  if (cookies.length > 0) headers['set-cookie'] = cookies;
  response.writeHead(302, headers);
  response.end();
}

async function requestBytes(request, limit = 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error('request body exceeds browser-auth gateway limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

function clientFor(server, appId, id) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  return new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: `browser-auth-broker-${id}`,
    rqsStore: null,
  });
}

async function capturedChallenge(server, appId, email, id) {
  const client = clientFor(server, appId, id);
  try {
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
    if (
      !mailboxResponse.ok
      || mailbox.challengeId !== requested.challengeId
      || mailbox.canonicalAddress !== email
      || typeof mailbox.code !== 'string'
    ) throw new Error('local capture mailbox refused the broker challenge');
    return {
      client,
      exchange: Object.freeze({ challengeId: requested.challengeId, code: mailbox.code }),
      expiresAtMs: Math.min(requested.expiresAt, mailbox.expiresAt, Date.now() + TRANSACTION_TTL_MS),
    };
  } catch (error) {
    await client.closeAuth();
    throw error;
  }
}

function syntheticEmail(claims, secret) {
  // Mutable provider email never participates in principal identity. The
  // local email-code provider receives a stable opaque address derived only
  // from immutable issuer + subject.
  const digest = createHmac('sha256', secret)
    .update(`${claims.issuer}\0${claims.subject}`)
    .digest('hex');
  return `external-${digest.slice(0, 32)}@browser-auth.fixture.invalid`;
}

export function createBrowserAuthGateway({ server, api, appId, passwordOnly = false }) {
  if (!passwordOnly && (!server?.adminToken || !server?.impersonationCapability)) {
    throw new TypeError('browser-auth gateway requires local capture authorities');
  }
  if (typeof appId !== 'string' || appId.length === 0) {
    throw new TypeError('browser-auth gateway requires the generated app id');
  }
  const assertionSecret = randomBytes(32);
  const principalSecret = randomBytes(32);
  const authorizationTransactions = new Map();
  const fixtureCodes = new Map();
  const loginBootstraps = new Map();
  const facts = {
    bindings: [],
    bootstrapConsumes: 0,
    externalCodeConsumes: 0,
    publicRequests: [],
  };
  let selectedIdentity = { ...FIXTURE_IDENTITIES.alice };
  let logoutGate = null;
  const publicRoutes = passwordOnly
    ? new Set([...PUBLIC_ROUTES, 'POST /auth/password/signup', 'POST /auth/password/signin'])
    : PUBLIC_ROUTES;

  const prune = (nowMs = Date.now()) => {
    for (const collection of [authorizationTransactions, fixtureCodes, loginBootstraps]) {
      for (const [key, value] of collection) {
        if (value.expiresAtMs <= nowMs) collection.delete(key);
      }
    }
  };

  async function prepareBrowserLogin(claims) {
    const email = syntheticEmail(claims, principalSecret);
    const bindingSession = await capturedChallenge(server, appId, email, `binding-${randomToken(6)}`);
    let binding;
    try {
      const credential = await bindingSession.client.authExchange(bindingSession.exchange);
      await bindingSession.client.mutate(api.brokerEnsureFixtureUsers, { args: {} });
      binding = (await bindingSession.client.mutate(api.brokerBindPrincipal, {
        args: {
          externalIssuer: claims.issuer,
          externalSubject: claims.subject,
        },
      })).result;
      if (binding.principal !== credential.session.userId) {
        throw new Error('binding mutation returned a different principal');
      }
      facts.bindings.push(Object.freeze({
        principal: binding.principal,
        appUserId: binding.appUserId,
        issuer: binding.externalIssuer,
        subject: binding.externalSubject,
        observedEmailDigest: sha256(claims.email),
      }));
      await bindingSession.client.authLogout();
    } finally {
      await bindingSession.client.closeAuth();
    }

    const browserChallenge = await capturedChallenge(server, appId, email, `browser-${randomToken(6)}`);
    await browserChallenge.client.closeAuth();
    if (browserChallenge.expiresAtMs <= Date.now()) throw new Error('browser challenge expired before staging');
    return { binding, exchange: browserChallenge.exchange, expiresAtMs: browserChallenge.expiresAtMs };
  }

  async function proxyPublic(request, response, url) {
    const upstreamPath = url.pathname.slice('/__snapback'.length) || '/';
    const key = `${request.method.toUpperCase()} ${upstreamPath}`;
    if (!publicRoutes.has(key)) {
      facts.publicRequests.push({ key, outcome: 'refused' });
      sendJson(response, 403, {
        diagnostic: {
          code: 'SNAPBACK_BROWSER_AUTH_ROUTE_REFUSED',
          message: 'the browser-auth recipe forwards an exact public route allowlist',
        },
      });
      return;
    }
    if (key === 'POST /auth/logout' && logoutGate !== null) {
      const gate = logoutGate;
      logoutGate = null;
      gate.entered.resolve();
      await gate.release.promise;
    }
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await requestBytes(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || ['host', 'connection', 'content-length'].includes(name)) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const upstream = await fetch(`${server.baseUrl}${upstreamPath}${url.search}`, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    });
    facts.publicRequests.push({ key, outcome: upstream.status });
    const responseHeaders = {};
    for (const [name, value] of upstream.headers) {
      if (!['connection', 'content-length', 'transfer-encoding'].includes(name)) {
        responseHeaders[name] = value;
      }
    }
    response.writeHead(upstream.status, responseHeaders);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  }

  async function handle(request, response, next) {
    try {
      prune();
      const url = new URL(request.url ?? '/', 'http://browser-auth.local');
      const method = request.method?.toUpperCase() ?? 'GET';
      if (url.pathname.startsWith('/__snapback')) {
        await proxyPublic(request, response, url);
        return;
      }
      if (method === 'GET' && url.pathname === '/auth/start') {
        const state = randomToken(24);
        const nonce = randomToken(24);
        authorizationTransactions.set(state, {
          nonce,
          returnTarget: '/?login=complete',
          expiresAtMs: Date.now() + TRANSACTION_TTL_MS,
        });
        redirect(response, `/fixture/authorize?state=${encodeURIComponent(state)}&nonce=${encodeURIComponent(nonce)}`, [
          `browser-auth-state=${state}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=300`,
        ]);
        return;
      }
      if (method === 'GET' && url.pathname === '/fixture/authorize') {
        const state = url.searchParams.get('state') ?? '';
        const nonce = url.searchParams.get('nonce') ?? '';
        const transaction = authorizationTransactions.get(state);
        if (!transaction || transaction.nonce !== nonce) throw new Error('fixture authorization transaction was refused');
        const nowMs = Date.now();
        const assertion = signFixtureAssertion({
          issuer: FIXTURE_ISSUER,
          subject: selectedIdentity.subject,
          audience: FIXTURE_AUDIENCE,
          nonce,
          email: selectedIdentity.email,
          displayName: selectedIdentity.displayName,
          issuedAtMs: nowMs,
          expiresAtMs: nowMs + 60_000,
        }, assertionSecret);
        const code = randomToken(24);
        fixtureCodes.set(code, { assertion, expiresAtMs: nowMs + 60_000 });
        redirect(response, `/auth/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`);
        return;
      }
      if (method === 'GET' && url.pathname === '/auth/callback') {
        const state = url.searchParams.get('state') ?? '';
        const code = url.searchParams.get('code') ?? '';
        const transaction = authorizationTransactions.get(state);
        authorizationTransactions.delete(state);
        const codeEntry = fixtureCodes.get(code);
        fixtureCodes.delete(code);
        if (
          !transaction
          || !codeEntry
          || transaction.expiresAtMs <= Date.now()
          || codeEntry.expiresAtMs <= Date.now()
          || cookieMap(request).get('browser-auth-state') !== state
        ) throw new Error('external identity callback was refused');
        const claims = verifyExternalAssertion(codeEntry.assertion, {
          secret: assertionSecret,
          expectedIssuer: FIXTURE_ISSUER,
          expectedAudience: FIXTURE_AUDIENCE,
          expectedNonce: transaction.nonce,
        });
        facts.externalCodeConsumes += 1;
        const browserLogin = await prepareBrowserLogin(claims);
        const bootstrapToken = randomToken();
        loginBootstraps.set(bootstrapToken, {
          exchange: browserLogin.exchange,
          expiresAtMs: browserLogin.expiresAtMs,
        });
        redirect(response, transaction.returnTarget, [
          'browser-auth-state=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0',
          `browser-auth-bootstrap=${bootstrapToken}; HttpOnly; SameSite=Lax; Path=/api/auth/bootstrap; Max-Age=300`,
        ]);
        return;
      }
      if (method === 'POST' && url.pathname === '/api/auth/bootstrap') {
        const token = cookieMap(request).get('browser-auth-bootstrap') ?? '';
        const entry = loginBootstraps.get(token);
        loginBootstraps.delete(token);
        const clearCookie = 'browser-auth-bootstrap=; HttpOnly; SameSite=Lax; Path=/api/auth/bootstrap; Max-Age=0';
        if (!entry || entry.expiresAtMs <= Date.now()) {
          sendJson(response, token ? 401 : 204, token ? { error: 'login bootstrap was invalid' } : null, {
            'set-cookie': clearCookie,
          });
          return;
        }
        facts.bootstrapConsumes += 1;
        sendJson(response, 200, entry.exchange, { 'set-cookie': clearCookie });
        return;
      }
      next();
    } catch (error) {
      sendJson(response, 400, {
        diagnostic: {
          code: 'SNAPBACK_BROWSER_AUTH_GATEWAY_REFUSED',
          message: error?.message ?? String(error),
        },
      });
    }
  }

  return Object.freeze({
    plugin: {
      name: 'snapback-browser-auth-gateway',
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          void handle(request, response, next);
        });
      },
    },
    fixture: Object.freeze({
      issuer: FIXTURE_ISSUER,
      audience: FIXTURE_AUDIENCE,
      sign: (claims) => signFixtureAssertion(claims, assertionSecret),
      verify: (token, options) => verifyExternalAssertion(token, {
        secret: assertionSecret,
        expectedIssuer: FIXTURE_ISSUER,
        expectedAudience: FIXTURE_AUDIENCE,
        ...options,
      }),
    }),
    pauseNextLogout() {
      if (logoutGate !== null) throw new Error('logout gate is already armed');
      const gate = { entered: deferred(), release: deferred() };
      logoutGate = gate;
      return Object.freeze({
        entered: gate.entered.promise,
        release: () => gate.release.resolve(),
      });
    },
    selectFixtureIdentity(name, overrides = {}) {
      const selected = FIXTURE_IDENTITIES[name];
      if (!selected) throw new TypeError(`unknown fixture identity ${name}`);
      selectedIdentity = { ...selected, ...overrides };
    },
    snapshot() {
      return structuredClone(facts);
    },
  });
}
