#!/usr/bin/env node
import assert from 'node:assert/strict';

const TOKEN = 'sbl_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TOKEN_PATTERN = /^sbl_[A-Za-z0-9_-]{43}$/u;
const UNAVAILABLE = 'SNAPBACK_CAPABILITY_LINK_UNAVAILABLE';

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

// Expo calls this once when the share screen mounts. `Linking` is the
// `expo-linking` module (or React Native's compatible Linking surface).
export function subscribeExpoCapabilityLinks(Linking, consume) {
  let active = true;
  void Linking.getInitialURL().then((url) => {
    if (active && url !== null) void consume(url);
  });
  const subscription = Linking.addEventListener('url', ({ url }) => {
    if (active) void consume(url);
  });
  return () => {
    active = false;
    subscription.remove();
  };
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
export async function mintShareLink(fetchImpl, serverOrigin, sessionBearer) {
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
      function: 'listTodos',
      pinnedArgs: {},
      callerArgs: [],
      expiresInMs: 3_600_000,
      uses: 1,
    }),
  });
  if (!response.ok) throw new Error('capability-link mint failed');
  const minted = await response.json();
  return Object.freeze({
    id: minted.id,
    shareUrl: new URL(minted.url, serverOrigin).href,
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

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function lifecycleFetch({ initialUses = 1 } = {}) {
  let remainingUses = initialUses;
  let revoked = false;
  let expired = false;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init: structuredClone(init) });
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(new Headers(init.headers).has('authorization'), false);
    if (revoked || expired || remainingUses === 0) {
      return jsonResponse({ diagnostic: { code: UNAVAILABLE } }, 404);
    }
    if (init.method === 'GET') {
      return jsonResponse({
        id: 'cplk_test',
        function: 'listTodos',
        kind: 'query',
        callerArgs: [],
        expiresAtMs: Date.now() + 60_000,
        remainingUses,
        approvalPerUse: false,
      });
    }
    remainingUses -= 1;
    return jsonResponse({ rows: [{ id: 'todo_42', title: 'Shared result' }] });
  };
  return {
    calls,
    fetchImpl,
    expire() { expired = true; },
    revoke() { revoked = true; },
  };
}

const options = {
  serverOrigin: 'https://snapback.example',
  webOrigin: 'https://app.example',
  expoScheme: 'messtimate',
};

for (const rejected of [
  `https://app.example/share/${TOKEN}?campaign=leak`,
  `https://app.example/share/${TOKEN}#fragment`,
  `https://attacker.example/share/${TOKEN}`,
  `https://user:password@app.example/share/${TOKEN}`,
  'messtimate://share/not-a-capability-token',
]) {
  assert.equal(resolveCapabilityTarget(rejected, options), null);
}

{
  const crawlerSafe = lifecycleFetch({ initialUses: 2 });
  const controller = await openCapabilityLink(
    `https://snapback.example/capability-links/${TOKEN}`,
    { ...options, fetchImpl: crawlerSafe.fetchImpl },
  );
  assert.equal(controller.snapshot().preview.remainingUses, 2);
  assert.deepEqual(crawlerSafe.calls.map(({ init }) => init.method), ['GET']);
  assert.equal(JSON.stringify(controller.snapshot()).includes(TOKEN), false);
  const first = await controller.invoke();
  assert.equal(first.result.ok, true);
  assert.equal(first.state.preview.remainingUses, 1);
  assert.deepEqual(crawlerSafe.calls.map(({ init }) => init.method), ['GET', 'POST', 'GET']);
  const second = await controller.invoke();
  assert.equal(second.state.status, 'used');
  const callsBeforeReplay = crawlerSafe.calls.length;
  assert.equal((await controller.invoke()).invoked, false);
  assert.equal(crawlerSafe.calls.length, callsBeforeReplay, 'terminal replay performs no request');
}

for (const terminalize of ['expire', 'revoke']) {
  const lifecycle = lifecycleFetch();
  const controller = await openCapabilityLink(
    `messtimate://share/${TOKEN}`,
    { ...options, fetchImpl: lifecycle.fetchImpl },
  );
  lifecycle[terminalize]();
  assert.equal((await controller.refresh()).status, 'unavailable', terminalize);
  assert.equal(JSON.stringify(controller.snapshot()).includes(TOKEN), false);
}

{
  const order = [];
  const windowLike = {
    location: { href: `https://app.example/share/${TOKEN}` },
    history: { replaceState() { order.push('scrub'); } },
  };
  const raw = consumeWebCapabilityLocation(windowLike);
  order.push('open');
  assert.equal(raw.endsWith(TOKEN), true);
  assert.deepEqual(order, ['scrub', 'open']);
}

{
  let initialConsumer;
  let eventConsumer;
  let removed = false;
  const seen = [];
  const Linking = {
    getInitialURL: async () => `messtimate://share/${TOKEN}`,
    addEventListener(_name, listener) {
      eventConsumer = listener;
      return { remove() { removed = true; } };
    },
  };
  initialConsumer = (url) => { seen.push(url); };
  const unsubscribe = subscribeExpoCapabilityLinks(Linking, initialConsumer);
  await Promise.resolve();
  eventConsumer({ url: `messtimate://share/${TOKEN}` });
  unsubscribe();
  assert.equal(seen.length, 2);
  assert.equal(removed, true);
}

{
  const calls = [];
  const minted = await mintShareLink(async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({
      id: 'cplk_issuer',
      url: `/capability-links/${TOKEN}`,
      expiresAtMs: 1_800_000,
      remainingUses: 1,
      approvalPerUse: false,
    });
  }, options.serverOrigin, 'issuer-session-secret');
  assert.equal(minted.shareUrl, `https://snapback.example/capability-links/${TOKEN}`);
  assert.equal(calls[0].url, 'https://snapback.example/capability-links');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer issuer-session-secret');
  assert.equal(JSON.stringify(minted).includes('issuer-session-secret'), false);
}

{
  const calls = [];
  await revokeShareLink(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  }, options.serverOrigin, 'issuer-session-secret', 'cplk_issuer');
  assert.equal(calls[0].url, 'https://snapback.example/capability-links/cplk_issuer');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer issuer-session-secret');
  assert.equal(JSON.stringify(calls[0].url).includes(TOKEN), false);
}

console.log('check-guide-capability-link-example: crawler-safe GET, explicit invoke, use count/replay, expiry, revoke request/state, strict Expo/web intake, and secret-free state pass');
