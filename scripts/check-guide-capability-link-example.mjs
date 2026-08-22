#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from '../packages/snapback-codegen/index.mjs';
import { startServer } from '../demos/_kit/server-process.mjs';

const TOKEN_PATTERN = /^sbl_[A-Za-z0-9_-]{43}$/u;
const UNAVAILABLE = 'SNAPBACK_CAPABILITY_LINK_UNAVAILABLE';
const FIXTURE_TOKEN = 'sbl_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..');
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY ?? join(repositoryRoot, 'target', 'debug', 'snapback'),
);

function resolveCapabilityTarget(rawUrl, {
  serverOrigin,
  webOrigin,
  expoScheme,
}) {
  let incoming;
  try {
    incoming = new URL(rawUrl);
  } catch {
    return null;
  }
  if (incoming.username || incoming.password || incoming.search || incoming.hash) return null;

  const expectedWebOrigin = new URL(webOrigin).origin;
  const expectedServerOrigin = new URL(serverOrigin).origin;
  let token = null;
  if (incoming.origin === expectedServerOrigin) {
    token = incoming.pathname.match(/^\/capability-links\/(sbl_[A-Za-z0-9_-]{43})$/u)?.[1] ?? null;
  } else if (incoming.origin === expectedWebOrigin) {
    token = incoming.pathname.match(/^\/share\/(sbl_[A-Za-z0-9_-]{43})$/u)?.[1] ?? null;
  } else if (
    incoming.protocol === `${expoScheme}:`
    && incoming.hostname === 'share'
  ) {
    token = incoming.pathname.match(/^\/(sbl_[A-Za-z0-9_-]{43})$/u)?.[1] ?? null;
  }
  if (!TOKEN_PATTERN.test(token ?? '')) return null;
  return new URL(`/capability-links/${token}`, serverOrigin).href;
}

export function toExpoCapabilityUrl(serverUrl, options) {
  const target = resolveCapabilityTarget(serverUrl, options);
  if (target === null || !/^[a-z][a-z0-9+.-]*$/u.test(options.expoScheme)) {
    throw new TypeError('capability server URL or Expo scheme is invalid');
  }
  const token = new URL(target).pathname.split('/').at(-1);
  return `${options.expoScheme}://share/${token}`;
}

async function requestCapability(fetchImpl, url, method, args) {
  const response = await fetchImpl(url, {
    method,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify({ args }) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return Object.freeze({
      ok: false,
      code: payload?.diagnostic?.code ?? 'REQUEST_FAILED',
    });
  }
  return Object.freeze({ ok: true, payload });
}

// @ref LLP 0204#d94--shareable-capability-links — the app keeps the URL
// bearer only in this volatile closure; GET previews and POST invokes never
// turn it into a principal, session, credential, or durable application row.
export async function openCapabilityLink(rawUrl, options) {
  let target = resolveCapabilityTarget(rawUrl, options);
  if (target === null) return Object.freeze({ status: 'invalid-link' });

  let previewRequest = await requestCapability(options.fetchImpl, target, 'GET');
  if (!previewRequest.ok) {
    target = null;
    return Object.freeze({
      status: previewRequest.code === UNAVAILABLE ? 'unavailable' : 'request-failed',
      code: previewRequest.code,
    });
  }
  let preview = previewRequest.payload;
  let terminal = null;

  const snapshot = () => Object.freeze(terminal ?? { status: 'ready', preview });
  const refresh = async () => {
    if (target === null) return snapshot();
    previewRequest = await requestCapability(options.fetchImpl, target, 'GET');
    if (!previewRequest.ok) {
      terminal = Object.freeze({
        status: previewRequest.code === UNAVAILABLE ? 'unavailable' : 'request-failed',
        code: previewRequest.code,
      });
      target = null;
    } else {
      preview = previewRequest.payload;
    }
    return snapshot();
  };

  return Object.freeze({
    snapshot,
    refresh,
    async invoke(args = {}) {
      if (target === null) return Object.freeze({ invoked: false, state: snapshot() });
      const invokeTarget = `${target}/invoke`;
      const result = await requestCapability(options.fetchImpl, invokeTarget, 'POST', args);
      if (!result.ok && result.code === UNAVAILABLE) {
        terminal = Object.freeze({ status: 'unavailable', code: result.code });
        target = null;
      } else if (result.ok && preview.remainingUses === 1) {
        terminal = Object.freeze({ status: 'used' });
        target = null;
      } else {
        await refresh();
      }
      return Object.freeze({ invoked: true, result, state: snapshot() });
    },
  });
}

// Expo Router calls this from app/+native-intent.tsx before it creates route
// state. The secret target stays in this process-local, one-use handoff while
// the router sees only a changing non-secret sequence. No additive Linking
// listener receives the token.
let nativeCapabilityHandoffSequence = 0;
let pendingNativeCapabilityTarget = null;

export function redirectCapabilitySystemPath({ path }, options) {
  const target = resolveCapabilityTarget(path, options);
  if (target !== null) {
    nativeCapabilityHandoffSequence += 1;
    const handoffSequence = String(nativeCapabilityHandoffSequence);
    pendingNativeCapabilityTarget = Object.freeze({ handoffSequence, target });
    return `/shared/${handoffSequence}`;
  }
  if (typeof path === 'string' && path.includes('sbl_')) return '/invalid-link';
  return path;
}

export function takePendingNativeCapabilityTarget(handoffSequence) {
  if (pendingNativeCapabilityTarget?.handoffSequence !== String(handoffSequence)) return null;
  const { target } = pendingNativeCapabilityTarget;
  pendingNativeCapabilityTarget = null;
  return target;
}

// Read and scrub the web URL before analytics, logging hooks, or third-party
// subresources mount. The returned string exists only long enough to open the
// volatile controller above.
export function consumeWebCapabilityLocation(windowLike) {
  const rawUrl = windowLike.location.href;
  windowLike.history.replaceState(null, '', '/shared');
  return rawUrl;
}

// The issuer-side route is an exact HTTP surface today; no first-party client
// convenience wrapper ships yet. Call only from an owner that already holds
// the signed-in session bearer, and release that bearer with its normal
// custody lifecycle.
export async function mintShareLink(
  fetchImpl,
  serverOrigin,
  sessionBearer,
  { functionName = 'listTodos', expiresInMs = 3_600_000, uses = 1 } = {},
) {
  const response = await fetchImpl(new URL('/capability-links', serverOrigin), {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: {
      authorization: `Bearer ${sessionBearer}`,
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
    },
    body: JSON.stringify({
      function: functionName,
      pinnedArgs: {},
      callerArgs: [],
      expiresInMs,
      uses,
    }),
  });
  if (!response.ok) throw new Error('capability-link mint failed');
  const minted = await response.json();
  return Object.freeze({
    id: minted.id,
    serverUrl: new URL(minted.url, serverOrigin).href,
    expiresAtMs: minted.expiresAtMs,
    remainingUses: minted.remainingUses,
  });
}

export async function revokeShareLink(fetchImpl, serverOrigin, sessionBearer, id) {
  const response = await fetchImpl(
    new URL(`/capability-links/${encodeURIComponent(id)}`, serverOrigin),
    {
      method: 'DELETE',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: {
        authorization: `Bearer ${sessionBearer}`,
        'x-snapback-auth-client-protocol': '1',
      },
    },
  );
  if (response.status !== 204) throw new Error('capability-link revoke failed');
}

function assertRequestControls(init, { bearer }) {
  assert.equal(init.credentials, 'omit');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(new Headers(init.headers).has('authorization'), bearer);
}

function assertResponseControls(response, label) {
  assert.match(response.headers.get('cache-control') ?? '', /(?:^|,)\s*no-store(?:,|$)/u, label);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer', label);
}

async function responseJson(response) {
  return response.json().catch(() => null);
}

async function mintSignedInSession(server) {
  const protocolHeaders = {
    'content-type': 'application/json',
    'x-snapback-auth-client-protocol': '1',
    'x-snapback-auth-invalidation-protocol': '1',
    'x-snapback-authority-descriptor-protocol': '1',
    'x-snapback-authorized-lease-protocol': '1',
  };
  const request = await fetch(`${server.baseUrl}/auth/request-code`, {
    method: 'POST',
    headers: protocolHeaders,
    body: JSON.stringify({ email: 'guide-capability-link@example.test' }),
  });
  const challenge = await responseJson(request);
  assert.equal(request.status, 200, JSON.stringify(challenge));
  const mailboxResponse = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(challenge.challengeId)}`,
    {
      headers: {
        'x-snapback-admin-token': server.adminToken,
        'x-snapback-impersonation-capability': server.impersonationCapability,
      },
    },
  );
  const mailbox = await responseJson(mailboxResponse);
  assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
  const exchange = await fetch(`${server.baseUrl}/auth/exchange`, {
    method: 'POST',
    headers: protocolHeaders,
    body: JSON.stringify({ challengeId: challenge.challengeId, code: mailbox.code }),
  });
  const credential = await responseJson(exchange);
  assert.equal(exchange.status, 200, JSON.stringify(credential));
  assert.equal(typeof credential.token, 'string');
  return credential.token;
}

async function logoutSignedInSession(server, sessionBearer) {
  const response = await fetch(`${server.baseUrl}/auth/logout`, {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: {
      authorization: `Bearer ${sessionBearer}`,
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
    },
    body: '{}',
  });
  assert.equal(response.status, 204, JSON.stringify(await responseJson(response)));
}

function injectExpiredBoundary(databasePath, id, nowMs) {
  const database = new DatabaseSync(databasePath);
  try {
    const changed = database.prepare(`
      UPDATE _snapback_capability_links
      SET expires_at_ms = ?
      WHERE id = ? AND status = 'active'
    `).run(nowMs - 1, id);
    assert.equal(changed.changes, 1, 'expiry fixture must target exactly one active real link');
  } finally {
    database.close();
  }
}

async function realBackendAcceptance() {
  assert.equal(
    existsSync(runtimeBinary),
    true,
    `native Snapback runtime missing at ${runtimeBinary}; set SNAPBACK_RUNTIME_BINARY`,
  );
  const scratch = await mkdtemp(join(tmpdir(), 'snapback-guide-capability-link-'));
  const backendRoot = join(scratch, 'app', 'snapback');
  const databasePath = join(scratch, 'capability-link.sqlite3');
  let server = null;
  try {
    await mkdir(backendRoot, { recursive: true });
    const defineUrl = pathToFileURL(join(repositoryRoot, 'packages', 'snapback-codegen', 'define.mjs')).href;
    await writeFile(join(backendRoot, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  todos: defineTable({ title: v.string() })
    .visibility({ kind: 'public-read' })
    .index('by_title', ['title'])
    .sync(),
}, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: {
    enabled: true,
    functions: {
      listTodos: { expose: true, since: 'v1' },
      listProtectedTodos: { expose: true, since: 'v1' },
    },
    origins: ['https://example.com:8443'],
  },
});
`);
    await writeFile(join(backendRoot, 'functions.mjs'), `
import { defineLiveQuery, eq, lit } from ${JSON.stringify(defineUrl)};
export const listTodos = defineLiveQuery({
  table: 'todos',
  index: 'by_title',
  filter: [eq('title', lit('fixed'))],
  auth: 'public',
  authorityIndependent: true,
});
export const listProtectedTodos = defineLiveQuery({
  table: 'todos',
  index: 'by_title',
  filter: [eq('title', lit('fixed'))],
  auth: 'authenticated',
});
`);
    const generated = await generate(backendRoot);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const readGenerated = async (name) => JSON.parse(
      await readFile(join(generated.outDir, name), 'utf8'),
    );
    const schema = await readGenerated('schema.manifest.json');
    const functions = await readGenerated('functions.manifest.json');
    const startupArtifacts = join(scratch, 'startup-artifacts.json');
    await writeFile(startupArtifacts, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, {
      mode: 0o600,
    });
    server = await startServer({
      port: 0,
      db: databasePath,
      cwd: repositoryRoot,
      serverBinary: runtimeBinary,
      startupArtifacts,
      captureImpersonationCapability: true,
    });
    assert.equal(server.reused, false);
    const sessionBearer = await mintSignedInSession(server);
    const options = {
      serverOrigin: server.baseUrl,
      webOrigin: 'https://app.example',
      expoScheme: 'messtimate',
    };
    const observed = [];
    const checkedFetch = async (url, init) => {
      const address = String(url);
      const bearer = new URL(address).pathname === '/capability-links'
        || init.method === 'DELETE';
      assertRequestControls(init, { bearer });
      observed.push({ method: init.method, path: new URL(address).pathname, bearer });
      const response = await fetch(url, init);
      assertResponseControls(response, `${init.method} ${new URL(address).pathname}`);
      return response;
    };

    const protectedMint = await checkedFetch(
      new URL('/capability-links', server.baseUrl),
      {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: {
          authorization: `Bearer ${sessionBearer}`,
          'content-type': 'application/json',
          'x-snapback-auth-client-protocol': '1',
        },
        body: JSON.stringify({
          function: 'listProtectedTodos',
          pinnedArgs: {},
          callerArgs: [],
          expiresInMs: 3_600_000,
          uses: 1,
        }),
      },
    );
    assert.equal(protectedMint.status, 403);
    assert.equal(
      (await responseJson(protectedMint))?.diagnostic?.code,
      'SNAPBACK_CAPABILITY_LINK_FUNCTION_NOT_ANONYMOUS',
      'issuer authority on an exposed protected function is not a v1 mint gate',
    );

    const repeatable = await mintShareLink(
      checkedFetch,
      server.baseUrl,
      sessionBearer,
      { uses: 2 },
    );
    assert.equal(JSON.stringify(repeatable).includes(sessionBearer), false);
    const repeatedLanding = async () => {
      const response = await checkedFetch(repeatable.serverUrl, {
        method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      });
      const body = await responseJson(response);
      assert.equal(response.status, 200, JSON.stringify(body));
      return body;
    };
    assert.equal((await repeatedLanding()).remainingUses, 2);
    assert.equal((await repeatedLanding()).remainingUses, 2, 'repeated GET must remain inert');
    const invoke = async (url) => {
      const response = await checkedFetch(`${url}/invoke`, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args: {} }),
      });
      return { response, body: await responseJson(response) };
    };
    assert.equal((await invoke(repeatable.serverUrl)).response.status, 200);
    assert.equal((await repeatedLanding()).remainingUses, 1);
    assert.equal((await invoke(repeatable.serverUrl)).response.status, 200);
    const replay = await invoke(repeatable.serverUrl);
    assert.equal(replay.response.status, 404);
    assert.equal(replay.body?.diagnostic?.code, UNAVAILABLE, 'server must refuse replay');

    const expiring = await mintShareLink(checkedFetch, server.baseUrl, sessionBearer);
    injectExpiredBoundary(databasePath, expiring.id, Date.now());
    const expired = await checkedFetch(expiring.serverUrl, {
      method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    assert.equal(expired.status, 404);
    assert.equal((await responseJson(expired))?.diagnostic?.code, UNAVAILABLE);

    const revocable = await mintShareLink(checkedFetch, server.baseUrl, sessionBearer);
    await revokeShareLink(checkedFetch, server.baseUrl, sessionBearer, revocable.id);
    const revoked = await checkedFetch(revocable.serverUrl, {
      method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    assert.equal(revoked.status, 404);
    assert.equal((await responseJson(revoked))?.diagnostic?.code, UNAVAILABLE);

    const controllerLink = await mintShareLink(checkedFetch, server.baseUrl, sessionBearer);
    for (const [method, suffix, body] of [
      ['GET', '', undefined],
      ['POST', '/invoke', JSON.stringify({ args: {} })],
    ]) {
      const tokenRequestWithAuthorization = await fetch(`${controllerLink.serverUrl}${suffix}`, {
        method,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: {
          authorization: `Bearer ${sessionBearer}`,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        body,
      });
      assertResponseControls(tokenRequestWithAuthorization, `${method} token Authorization refusal`);
      assert.equal(tokenRequestWithAuthorization.status, 404);
      assert.equal(
        (await responseJson(tokenRequestWithAuthorization))?.diagnostic?.code,
        UNAVAILABLE,
        `token ${method} must refuse every Authorization header`,
      );
    }
    const controller = await openCapabilityLink(controllerLink.serverUrl, {
      ...options,
      fetchImpl: checkedFetch,
    });
    assert.equal(controller.snapshot().status, 'ready');
    assert.equal(JSON.stringify(controller.snapshot()).includes('sbl_'), false);
    assert.equal((await controller.invoke()).state.status, 'used');
    const callsBeforeLocalReplay = observed.length;
    assert.equal((await controller.invoke()).invoked, false);
    assert.equal(observed.length, callsBeforeLocalReplay, 'terminal UI replay performs no request');

    const expoUrl = toExpoCapabilityUrl(controllerLink.serverUrl, options);
    const firstHandoffPath = redirectCapabilitySystemPath({ path: expoUrl }, options);
    assert.match(firstHandoffPath, /^\/shared\/\d+$/u);
    assert.equal(firstHandoffPath.includes('sbl_'), false);
    const firstHandoffSequence = firstHandoffPath.split('/').at(-1);
    const handedOff = takePendingNativeCapabilityTarget(firstHandoffSequence);
    assert.equal(handedOff, controllerLink.serverUrl);
    assert.equal(
      takePendingNativeCapabilityTarget(firstHandoffSequence),
      null,
      'native handoff is one-use',
    );

    const warmStartLink = await mintShareLink(checkedFetch, server.baseUrl, sessionBearer);
    const warmStartPath = redirectCapabilitySystemPath(
      { path: toExpoCapabilityUrl(warmStartLink.serverUrl, options) },
      options,
    );
    assert.match(warmStartPath, /^\/shared\/\d+$/u);
    assert.notEqual(warmStartPath, firstHandoffPath, 'a second intent changes the clean route');
    assert.equal(warmStartPath.includes('sbl_'), false);
    assert.equal(
      takePendingNativeCapabilityTarget(warmStartPath.split('/').at(-1)),
      warmStartLink.serverUrl,
      'a second intent while already shared reaches the warm screen',
    );
    assert.equal(
      redirectCapabilitySystemPath({ path: `messtimate://share/${FIXTURE_TOKEN}?leak=1` }, options),
      '/invalid-link',
    );

    const webOrder = [];
    const windowLike = {
      location: { href: `https://app.example/share/${FIXTURE_TOKEN}` },
      history: { replaceState() { webOrder.push('scrub'); } },
    };
    const raw = consumeWebCapabilityLocation(windowLike);
    webOrder.push('open');
    assert.equal(raw.endsWith(FIXTURE_TOKEN), true);
    assert.deepEqual(webOrder, ['scrub', 'open']);

    for (const rejected of [
      `https://app.example/share/${FIXTURE_TOKEN}?campaign=leak`,
      `https://app.example/share/${FIXTURE_TOKEN}#fragment`,
      `https://attacker.example/share/${FIXTURE_TOKEN}`,
      `https://user:password@app.example/share/${FIXTURE_TOKEN}`,
      'messtimate://share/not-a-capability-token',
    ]) {
      assert.equal(resolveCapabilityTarget(rejected, options), null);
    }

    const sessionEndedLink = await mintShareLink(
      checkedFetch,
      server.baseUrl,
      sessionBearer,
      { uses: 2 },
    );
    const replacementSessionBearer = await mintSignedInSession(server);
    const wrongSessionRevoke = await fetch(
      new URL(`/capability-links/${encodeURIComponent(sessionEndedLink.id)}`, server.baseUrl),
      {
        method: 'DELETE',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: {
          authorization: `Bearer ${replacementSessionBearer}`,
          'x-snapback-auth-client-protocol': '1',
        },
      },
    );
    assertResponseControls(wrongSessionRevoke, 'replacement-session DELETE refusal');
    assert.equal(wrongSessionRevoke.status, 403);
    assert.equal(
      (await responseJson(wrongSessionRevoke))?.diagnostic?.code,
      'SNAPBACK_CAPABILITY_LINK_REVOKE_DENIED',
    );
    await logoutSignedInSession(server, sessionBearer);
    const afterMinterLogout = await invoke(sessionEndedLink.serverUrl);
    assert.equal(
      afterMinterLogout.response.status,
      200,
      'ending the minting session must not kill a v1 link with a live minter principal',
    );
  } finally {
    await server?.stop();
    await rm(scratch, { recursive: true, force: true });
  }
}

await realBackendAcceptance();
console.log('check-guide-capability-link-example: v1 anonymous mint predicates, inert GET, raw-fetch Authorization refusal, POST consumption, server replay refusal, expiry, same-session revocation, session-end survival, response controls, and cold/warm pre-router token hygiene pass');
