// App-data façade posture tests (LLP 0062 §Position; ticket
// issues/20260717-app-cli-client-core-package.md):
// - the façade has no admin methods and no ambient SNAPBACK_ADMIN_TOKEN
//   pickup — proven with the env var planted against a capturing server;
// - credential-carrying requests treat redirects as terminal;
// - per-class decoded-byte ingress bounds refuse oversized responses before
//   JSON materialization;
// - the bare public-artifact fetch path is credential-free, non-redirecting,
//   and enforces identity content coding.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';

import { SnapbackClient } from './index.mjs';
import {
  APP_DATA_CLIENT_METHODS,
  DEFAULT_INGRESS_LIMIT_BYTES,
  SnapbackAppDataClient,
  createAppDataClient,
  createExternalSessionAppDataClient,
  fetchPublicArtifact,
} from './app-data.mjs';

const PLANTED_ADMIN_TOKEN = 'sbadm_planted_admin_token_do_not_transmit';
const previousToken = process.env.SNAPBACK_ADMIN_TOKEN;
process.env.SNAPBACK_ADMIN_TOKEN = PLANTED_ADMIN_TOKEN;

const captured = [];
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString('utf8');
  captured.push({
    url: request.url,
    headers: { ...request.headers },
    bodyText,
  });
  const send = (value, status = 200, headers = {}) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(typeof value === 'string' ? value : JSON.stringify(value));
  };
  if (request.url === '/health') return send({ ok: true });
  if (request.url === '/redirect-follow/health') {
    return send('', 302, { location: '/health' });
  }
  if (request.url === '/inspect') return send({ appId: 'facade', functions: [] });
  if (request.url === '/query/listThings') return send({ rows: [{ id: 't1' }], version: 3 });
  if (request.url === '/query/big') {
    return send({ rows: ['x'.repeat(4096)], version: 1 });
  }
  if (request.url === '/mutation/addThing') {
    return send({ result: { id: 't2' }, changed_count: 1, version: 4 });
  }
  if (request.url === '/action/pingThing') return send({ ok: true, result: 'pong' });
  if (request.url === '/auth/request-code') {
    return send({ challengeId: 'chal-1', expiresInSeconds: 300 });
  }
  if (request.url === '/auth/session') {
    return send({ oversized: 'y'.repeat(4096) });
  }
  if (request.url?.startsWith('/redirect-everything')) {
    return send('', 307, { location: 'http://127.0.0.1:9/never' });
  }
  if (request.url === '/_snapback/api/schema/load') return send({ loaded: true });
  if (request.url === '/app-api/current') {
    return send({ appId: 'facade', envelopeSha256: 'a'.repeat(64) });
  }
  if (request.url === `/app-api/envelope/${'a'.repeat(64)}`) {
    return send({ envelope: true });
  }
  if (request.url === '/app-api/envelope/gzipped') {
    const compressed = gzipSync(Buffer.from(JSON.stringify({ envelope: true })));
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'content-length': String(compressed.byteLength),
    });
    return response.end(compressed);
  }
  if (request.url === '/app-api/envelope/redirected') {
    return send('', 308, { location: '/app-api/envelope/elsewhere' });
  }
  if (request.url === '/app-api/envelope/huge') {
    const huge = JSON.stringify({ payload: 'z'.repeat(8192) });
    return send(huge, 200, { 'content-length': String(Buffer.byteLength(huge)) });
  }
  if (request.url === '/app-api/envelope/chunked-huge') {
    // Deliberately no content-length: the bound must hold on received bytes.
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('"');
    response.write('w'.repeat(8192));
    response.end('"');
    return undefined;
  }
  return send({ diagnostic: { code: 'UNEXPECTED', message: request.url } }, 404);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

try {
  // --- Surface: no admin methods, no admin option, closed delegation list.
  const facade = new SnapbackAppDataClient(baseUrl, {
    rqsStore: null,
    __outboxDrainLifecycle: false,
  });
  for (const adminMethod of [
    'loadSchema',
    'loadFunctions',
    'ensureApp',
    'ensureEphemeralCollections',
    'ensureVersionedSeed',
    'previewVersionedSeed',
    'resetInstallVersionedSeed',
    'clearVersionedSeed',
    'reset',
    'seed',
    'cronTick',
  ]) {
    assert.equal(
      facade[adminMethod],
      undefined,
      `façade must not expose admin method ${adminMethod}`,
    );
  }
  for (const name of APP_DATA_CLIENT_METHODS) {
    assert.equal(typeof facade[name], 'function', `façade must delegate ${name}`);
  }
  assert.equal('adminToken' in facade, false, 'façade carries no adminToken property');
  assert.throws(
    () => new SnapbackAppDataClient(baseUrl, { adminToken: 'sbadm_x' }),
    /app-data-only/,
    'an admin token option is refused, not ignored',
  );
  assert.throws(
    () => new SnapbackAppDataClient(baseUrl, { adminToken: null }),
    /app-data-only/,
    'even a null adminToken member signals the wrong plane',
  );
  assert.ok(createAppDataClient(baseUrl) instanceof SnapbackAppDataClient);
  const externalSession = createExternalSessionAppDataClient(baseUrl, {
    bearerToken: 'sbs_external_app_data_test',
  });
  assert.ok(externalSession instanceof SnapbackAppDataClient);
  assert.deepEqual(externalSession.authProtocols, {
    authClient: 1,
    authInvalidation: 1,
    authorityDescriptor: 1,
    authorizedLease: null,
    ephemeralAuthority: null,
    ephemeralExpiry: 1,
  });
  assert.throws(
    () => createExternalSessionAppDataClient(baseUrl, { bearerToken: '' }),
    /non-empty bearerToken/u,
  );
  assert.throws(
    () => createExternalSessionAppDataClient(baseUrl, {
      bearerToken: 'sbs_external_app_data_test',
      senderConstrained: true,
    }),
    /mutually exclusive/u,
  );

  // --- Planted-token non-transmission across the app-data call paths.
  captured.length = 0;
  assert.deepEqual(await facade.health(), { ok: true });
  await facade.inspect();
  assert.deepEqual(
    (await facade.query('listThings')).rows,
    [{ id: 't1' }],
  );
  await facade.mutate('addThing', { args: { title: 'planted' }, queue: false });
  await facade.action('pingThing');
  assert.equal(await facade.run('pingThing'), 'pong');
  // The request capture is what matters here; a strict challenge-projection
  // refusal on the response side must not abort the non-transmission sweep.
  await facade.authRequestCode('facade@example.com').catch(() => {});
  await fetchPublicArtifact(baseUrl, '/app-api/current', { ingressClass: 'discovery' });
  await fetchPublicArtifact(baseUrl, `/app-api/envelope/${'a'.repeat(64)}`);
  assert.ok(captured.length >= 8, 'capture server observed the driven calls');
  for (const call of captured) {
    const serialized = JSON.stringify(call);
    assert.equal(
      serialized.includes(PLANTED_ADMIN_TOKEN),
      false,
      `request to ${call.url} must not carry the planted admin token`,
    );
    assert.equal(
      'x-snapback-admin-token' in call.headers,
      false,
      `request to ${call.url} must not carry an admin token header at all`,
    );
  }

  // --- The artifact path is bare: no credential or cookie carrier of any
  // class, and it explicitly requests identity encoding.
  const artifactCalls = captured.filter(({ url }) => url.startsWith('/app-api/'));
  assert.equal(artifactCalls.length, 2);
  for (const call of artifactCalls) {
    assert.equal(call.headers.authorization, undefined);
    assert.equal(call.headers.cookie, undefined);
    assert.equal(call.headers['accept-encoding'], 'identity');
  }

  // --- Detector sensitivity: the full client's ambient pickup still exists
  // (the ticket governs the façade and engine posture, not full-client
  // consumers), and the same capture harness sees the token when it is sent.
  captured.length = 0;
  const fullClient = new SnapbackClient(baseUrl);
  await fullClient.loadSchema({});
  assert.equal(
    captured[0].headers['x-snapback-admin-token'],
    PLANTED_ADMIN_TOKEN,
    'the capture harness detects admin-token transmission when it happens',
  );

  // --- Redirect-terminal credentialed requests (client-enforced).
  const redirectingAdmin = new SnapbackClient(`${baseUrl}/redirect-everything`, {
    adminToken: 'sbadm_redirect_case',
  });
  await assert.rejects(
    redirectingAdmin.loadSchema({}),
    (error) => error?.code === 'SNAPBACK_REDIRECT_REFUSED',
    'an admin-token request never follows a redirect',
  );
  const redirectingBearer = new SnapbackClient(`${baseUrl}/redirect-everything`, {
    bearerToken: 'sbses_redirect_case',
    authClientProtocol: 1,
  });
  await assert.rejects(
    redirectingBearer.query('listThings'),
    (error) => error?.code === 'SNAPBACK_REDIRECT_REFUSED',
    'a bearer-headed request never follows a redirect',
  );
  // Credential-free requests keep the platform's ordinary redirect behavior.
  const following = new SnapbackAppDataClient(`${baseUrl}/redirect-follow`);
  assert.deepEqual(
    await following.health(),
    { ok: true },
    'credential-free fetches may still follow redirects',
  );

  // --- Per-class decoded-byte ingress bounds before materialization.
  const bounded = new SnapbackAppDataClient(baseUrl, {
    ingressLimits: { appCall: 1024, authLifecycle: 512 },
  });
  assert.equal(bounded.ingressLimits.appCall, 1024);
  assert.equal(
    bounded.ingressLimits.artifact,
    DEFAULT_INGRESS_LIMIT_BYTES.artifact,
    'unspecified classes keep their defaults',
  );
  await assert.rejects(
    bounded.query('big'),
    (error) => error?.code === 'SNAPBACK_INGRESS_LIMIT_EXCEEDED'
      && error?.diagnostic?.details?.ingressClass === 'appCall',
    'an oversized app-call response is a typed transport-class refusal',
  );
  // authSession only fetches under an auth-client protocol; external-bearer
  // custody is the lightest way to reach the /auth/ ingress class.
  const boundedAuth = new SnapbackAppDataClient(baseUrl, {
    bearerToken: 'sbses_bounded_case',
    authClientProtocol: 1,
    ingressLimits: { authLifecycle: 512 },
  });
  await assert.rejects(
    boundedAuth.authSession(),
    (error) => error?.code === 'SNAPBACK_INGRESS_LIMIT_EXCEEDED'
      && error?.diagnostic?.details?.ingressClass === 'authLifecycle',
    'auth-lifecycle responses carry their own (smaller) bound',
  );
  assert.throws(
    () => new SnapbackAppDataClient(baseUrl, { ingressLimits: { unknownClass: 5 } }),
    /unknown ingress class/,
  );

  // --- Bare artifact path contract: identity coding enforced, redirects
  // terminal, decoded-byte bound enforced with and without content-length.
  const envelope = await fetchPublicArtifact(baseUrl, `/app-api/envelope/${'a'.repeat(64)}`);
  assert.equal(envelope.ok, true);
  assert.deepEqual(JSON.parse(envelope.bodyText()), { envelope: true });
  await assert.rejects(
    fetchPublicArtifact(baseUrl, '/app-api/envelope/gzipped'),
    (error) => error?.code === 'SNAPBACK_ARTIFACT_ENCODING_UNEXPECTED',
    'a transformed body is refused, never normalized into the envelope identity',
  );
  await assert.rejects(
    fetchPublicArtifact(baseUrl, '/app-api/envelope/redirected'),
    (error) => error?.code === 'SNAPBACK_REDIRECT_REFUSED',
    'the artifact path is non-redirecting',
  );
  await assert.rejects(
    fetchPublicArtifact(baseUrl, '/app-api/envelope/huge', { limitBytes: 1024 }),
    (error) => error?.code === 'SNAPBACK_INGRESS_LIMIT_EXCEEDED',
    'an honestly-declared oversized artifact is refused',
  );
  await assert.rejects(
    fetchPublicArtifact(baseUrl, '/app-api/envelope/chunked-huge', { limitBytes: 1024 }),
    (error) => error?.code === 'SNAPBACK_INGRESS_LIMIT_EXCEEDED',
    'a dishonestly-framed (chunked) oversized artifact is refused on received bytes',
  );

  // --- 0137 A4-f6: anonymous-public custody (headless public-query reads).
  {
    captured.length = 0;
    const anonymous = new SnapbackClient(baseUrl, { custody: 'anonymous-public', adminToken: null });
    assert.deepEqual(
      await anonymous.query('listThings'),
      { rows: [{ id: 't1' }], version: 3 },
      'anonymous-public custody reads a query without credentials',
    );
    const request = captured.find((entry) => entry.url === '/query/listThings');
    assert.equal(
      request.headers['x-snapback-auth-client-protocol'],
      '1',
      'the protocol offer is sent',
    );
    assert.equal(request.headers.authorization, undefined, 'no bearer is sent');
    // 0137 A4-f6 regression: the offer header is the only auth carrier, so the
    // wire body must not carry legacy identity fields — a sessions server
    // refuses them with SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED.
    const anonymousBody = request.bodyText ? JSON.parse(request.bodyText) : {};
    assert.equal(
      'auth' in anonymousBody,
      false,
      'anonymous-public query bodies carry no legacy auth field',
    );
    assert.throws(
      () => new SnapbackClient(baseUrl, { custody: 'anonymous-public', bearerToken: 'sbses_x', adminToken: null }),
      /mutually exclusive/,
      'anonymous-public custody refuses a bearer',
    );
    assert.throws(
      () => new SnapbackClient(baseUrl, { custody: 'anything-else', adminToken: null }),
      /custody must be null/,
      'unknown custody values refuse',
    );
  }

  // --- Diary 0068: non-session inspection needs the complete client option pair.
  {
    captured.length = 0;
    const inspection = new SnapbackClient(baseUrl, {
      authClientProtocol: 1,
      custody: 'anonymous-public',
    });
    assert.deepEqual(
      await inspection.query('listThings'),
      { rows: [{ id: 't1' }], version: 3 },
      'a non-session inspection client reads with the protocol offer',
    );
    await inspection.loadSchema({});
    const queryRequest = captured.find((entry) => entry.url === '/query/listThings');
    assert.equal(queryRequest.headers['x-snapback-auth-client-protocol'], '1');
    const adminRequest = captured.find((entry) => entry.url === '/_snapback/api/schema/load');
    assert.equal(adminRequest.headers['x-snapback-admin-token'], PLANTED_ADMIN_TOKEN);
  }
  console.log('app-data anonymous-public custody assertions pass');

  console.log('app-data.test.mjs: façade posture, redirect-terminal, ingress bounds, and bare artifact path pass');
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (previousToken === undefined) delete process.env.SNAPBACK_ADMIN_TOKEN;
  else process.env.SNAPBACK_ADMIN_TOKEN = previousToken;
}
