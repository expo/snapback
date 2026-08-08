import assert from 'node:assert/strict';

import {
  SUPERVISED_CONTROL_PATH,
  SUPERVISED_EXCHANGE_PATH,
  admittedBrowserExchangeOrigin,
  startBootstrapExchange,
} from './expo-dev.mjs';

const admittedOrigins = [
  'http://127.0.0.1:8081',
  'https://127.0.0.1:8081',
  'http://localhost:8081',
  'https://localhost:8081',
  'http://[::1]:8081',
  'https://[::1]:8081',
];
for (const origin of admittedOrigins) {
  assert.equal(admittedBrowserExchangeOrigin(origin), origin);
}
assert.equal(admittedBrowserExchangeOrigin('http://localhost:'), 'http://localhost:');
for (const origin of [
  undefined,
  '',
  'https://example.com:8081',
  'http://192.0.2.10:8081',
  'http://127.0.0.1',
  'http://localhost',
]) {
  assert.equal(admittedBrowserExchangeOrigin(origin), null);
}

const browserOrigin = 'http://localhost:8081';
const payload = {
  ok: true,
  format: 'snapback.expo-supervised-exchange.v1',
  binding: { appId: 'test-app' },
  session: { accessToken: 'ordinary-session' },
};
let currentPayload = payload;
const exchange = await startBootstrapExchange(() => currentPayload);

try {
  const admittedGet = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`, {
    headers: { Origin: browserOrigin },
  });
  assert.equal(admittedGet.status, 200);
  assert.equal(admittedGet.headers.get('access-control-allow-origin'), browserOrigin);
  assert.equal(admittedGet.headers.get('vary'), 'Origin');
  assert.equal(admittedGet.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal(admittedGet.headers.get('access-control-allow-headers'), 'accept');
  assert.deepEqual(await admittedGet.json(), payload);

  const preflight = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`, {
    method: 'OPTIONS',
    headers: {
      Origin: browserOrigin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'accept',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), browserOrigin);
  assert.match(preflight.headers.get('access-control-allow-methods'), /\bGET\b/u);
  assert.equal(preflight.headers.get('access-control-max-age'), '600');
  assert.equal(await preflight.text(), '');

  const unadmittedGet = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`, {
    headers: { Origin: 'http://192.0.2.10:8081' },
  });
  assert.equal(unadmittedGet.status, 200);
  assert.equal(unadmittedGet.headers.get('access-control-allow-origin'), null);
  assert.equal(unadmittedGet.headers.get('access-control-allow-methods'), null);
  assert.deepEqual(await unadmittedGet.json(), payload);

  const originlessGet = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`);
  assert.equal(originlessGet.status, 200);
  assert.equal(originlessGet.headers.get('access-control-allow-origin'), null);
  assert.equal(originlessGet.headers.get('access-control-allow-methods'), null);
  assert.equal(originlessGet.headers.get('cache-control'), 'no-store, max-age=0');
  assert.deepEqual(await originlessGet.json(), payload);

  currentPayload = null;
  const unavailableGet = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`, {
    headers: { Origin: browserOrigin },
  });
  assert.equal(unavailableGet.status, 503);
  assert.equal(unavailableGet.headers.get('access-control-allow-origin'), browserOrigin);
  assert.deepEqual(await unavailableGet.json(), {
    ok: false,
    code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
  });

  const missingGet = await fetch(`${exchange.origin}/not-the-bootstrap`, {
    headers: { Origin: browserOrigin },
  });
  assert.equal(missingGet.status, 404);
  assert.equal(missingGet.headers.get('access-control-allow-origin'), browserOrigin);

  const noHandlerControl = await fetch(`${exchange.origin}${SUPERVISED_CONTROL_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verb: 'dev-fresh' }),
  });
  assert.equal(noHandlerControl.status, 404);
  assert.deepEqual(await noHandlerControl.json(), {
    ok: false,
    code: 'SNAPBACK_EXPO_BOOTSTRAP_ROUTE_NOT_FOUND',
  });

  const missingPreflight = await fetch(`${exchange.origin}/not-the-bootstrap`, {
    method: 'OPTIONS',
    headers: { Origin: browserOrigin },
  });
  assert.equal(missingPreflight.status, 404);
  assert.equal(missingPreflight.headers.get('access-control-allow-origin'), browserOrigin);
  assert.deepEqual(await missingPreflight.json(), {
    ok: false,
    code: 'SNAPBACK_EXPO_BOOTSTRAP_ROUTE_NOT_FOUND',
  });

  console.log('expo-bootstrap-exchange.test.mjs: scoped loopback CORS, preflight, payload, refusal, and route handling pass');
} finally {
  await exchange.close();
}
