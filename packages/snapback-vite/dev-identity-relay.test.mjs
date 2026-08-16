import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WebSocket, WebSocketServer } from 'ws';

import { snapbackDev } from './index.mjs';
import { createSnapbackViteLifecycle, readManagedDevIdentityCapability } from './lifecycle.mjs';
import { createSnapbackProxy } from './proxy.mjs';

const DEV_IDENTITY_HEADER = 'x-snapback-dev-identity';
const VITE_8_DEFAULT_FS_DENY = [
  '.env',
  '.env.*',
  '*.{crt,pem,key,p12,pfx,cer,der}',
  '.npmrc',
  '.yarnrc.yml',
  '**/.git/**',
];

function vitePath(path) {
  return realpathSync.native(path).replaceAll('\\', '/');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function listenProxy(proxy) {
  const server = createServer((req, res) => {
    proxy.handleRequest(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  server.on('upgrade', (req, socket, head) => proxy.handleUpgrade(req, socket, head));
  return { server, url: await listen(server) };
}

const root = mkdtempSync(join(tmpdir(), 'snapback-vite-dev-identity-'));
const backendWss = new WebSocketServer({ noServer: true });
const observedHttpHeaders = [];
const observedUpgradeHeaders = [];
const backend = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, binary: { startupNonce: 'fixture-nonce' } }));
    return;
  }
  observedHttpHeaders.push(req.headers);
  req.resume();
  req.on('end', () => {
    res.writeHead(200, {
      'content-type': 'application/json',
      ...(req.headers[DEV_IDENTITY_HEADER]
        ? { [DEV_IDENTITY_HEADER]: req.headers[DEV_IDENTITY_HEADER] }
        : {}),
    });
    res.end('{}');
  });
});
backend.on('upgrade', (req, socket, head) => {
  observedUpgradeHeaders.push(req.headers);
  backendWss.handleUpgrade(req, socket, head, (websocket) => {
    backendWss.emit('connection', websocket, req);
  });
});
backendWss.on('connection', (websocket) => websocket.send('ready'));

const relayServers = [];
let viteServer = null;
try {
  const backendUrl = await listen(backend);

  const relayCapabilityFile = join(root, 'relay.dev-identity');
  writeFileSync(relayCapabilityFile, 'sbdev_relay_fixture_one\n', { mode: 0o600 });
  const external = createSnapbackViteLifecycle({
    mode: 'external',
    projectRoot: root,
    url: backendUrl,
    env: { SNAPBACK_DEV_IDENTITY_FILE: relayCapabilityFile },
    logJson: false,
  });
  await external.start();
  const proxy = createSnapbackProxy({
    base: '/__snapback',
    mode: 'external',
    getState: external.state,
    getDevIdentityCapability: external.readDevIdentityCapability,
  });
  const externalRelay = await listenProxy(proxy);
  relayServers.push(externalRelay.server);
  const relayUrl = externalRelay.url;

  const connectionOpen = await fetch(`${relayUrl}/__snapback/connection/open`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [DEV_IDENTITY_HEADER]: 'sbdev_client_supplied_must_be_overwritten',
    },
    body: '{}',
  });
  assert.equal(connectionOpen.status, 200);
  assert.equal(observedHttpHeaders[0][DEV_IDENTITY_HEADER], 'sbdev_relay_fixture_one');
  assert.equal(connectionOpen.headers.get(DEV_IDENTITY_HEADER), null, 'relay strips reflected capability response headers');

  writeFileSync(relayCapabilityFile, 'sbdev_relay_fixture_two\n');
  const query = await fetch(`${relayUrl}/__snapback/query/example`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(query.status, 200);
  assert.equal(observedHttpHeaders[1][DEV_IDENTITY_HEADER], 'sbdev_relay_fixture_two');

  const websocket = new WebSocket(`${relayUrl.replace('http:', 'ws:')}/__snapback/live/fixture/stream`, {
    headers: { [DEV_IDENTITY_HEADER]: 'sbdev_ws_client_supplied_must_be_overwritten' },
  });
  await new Promise((resolve, reject) => {
    websocket.once('message', (data) => {
      assert.equal(data.toString(), 'ready');
      resolve();
    });
    websocket.once('error', reject);
  });
  assert.equal(observedUpgradeHeaders[0][DEV_IDENTITY_HEADER], 'sbdev_relay_fixture_two');
  websocket.close();
  await external.close();
  console.log('dev identity relay: HTTP /connection/open + request re-read + WS upgrade stamp and overwrite pass');

  const viteRoot = join(root, 'vite-app');
  const viteStateRoot = join(viteRoot, '.snapback');
  const viteCapabilityFile = join(viteStateRoot, 'custom-carrier');
  const globDeniedFile = join(viteStateRoot, 'unconfigured.dev-identity');
  mkdirSync(viteStateRoot, { recursive: true });
  writeFileSync(join(viteRoot, 'index.html'), '<!doctype html><title>fixture</title>\n');
  writeFileSync(join(viteRoot, '.env'), 'SECRET=sbdev_env_must_stay_denied\n');
  writeFileSync(viteCapabilityFile, 'sbdev_real_vite_secret\n', { mode: 0o600 });
  writeFileSync(globDeniedFile, 'sbdev_glob_denied_secret\n', { mode: 0o600 });
  const canonicalViteRoot = realpathSync.native(viteRoot);
  const aliasedViteRoot = join(root, 'vite-app-symlink');
  symlinkSync(viteRoot, aliasedViteRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const aliasedViteCapabilityFile = join(aliasedViteRoot, '.snapback', 'custom-carrier');
  const canonicalViteCapabilityFile = vitePath(viteCapabilityFile);
  const canonicalEnvFile = vitePath(join(viteRoot, '.env'));
  const { createServer: createViteServer } = await import('vite');
  viteServer = await createViteServer({
    root: viteRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [snapbackDev({
      server: { mode: 'external', url: backendUrl },
      projectRoot: viteRoot,
      env: { SNAPBACK_DEV_IDENTITY_FILE: aliasedViteCapabilityFile },
      logJson: false,
    })],
    server: { host: '127.0.0.1', port: 0 },
  });
  await viteServer.listen();
  const viteOrigin = `http://127.0.0.1:${viteServer.httpServer.address().port}`;
  assert.ok(viteServer.config.server.fs.deny.includes('**/*.dev-identity'));
  assert.ok(viteServer.config.server.fs.deny.includes(canonicalViteCapabilityFile));
  for (const pattern of VITE_8_DEFAULT_FS_DENY) {
    assert.ok(viteServer.config.server.fs.deny.includes(pattern), `resolved deny keeps Vite default ${pattern}`);
  }
  for (const [path, secret] of [
    ['/.env', 'sbdev_env_must_stay_denied'],
    [encodeURI(`/@fs${canonicalEnvFile}`), 'sbdev_env_must_stay_denied'],
    [encodeURI(`/@fs/${canonicalEnvFile}`), 'sbdev_env_must_stay_denied'],
    ['/.snapback/custom-carrier', 'sbdev_real_vite_secret'],
    [encodeURI(`/@fs${canonicalViteCapabilityFile}`), 'sbdev_real_vite_secret'],
    [encodeURI(`/@fs/${canonicalViteCapabilityFile}`), 'sbdev_real_vite_secret'],
    [encodeURI(`/@fs${aliasedViteCapabilityFile}`), 'sbdev_real_vite_secret'],
    [encodeURI(`/@fs/${aliasedViteCapabilityFile}`), 'sbdev_real_vite_secret'],
    ['/.snapback/unconfigured.dev-identity', 'sbdev_glob_denied_secret'],
    [encodeURI(`/@fs${globDeniedFile}`), 'sbdev_glob_denied_secret'],
    [encodeURI(`/@fs/${globDeniedFile}`), 'sbdev_glob_denied_secret'],
  ]) {
    const response = await fetch(`${viteOrigin}${path}`);
    assert.equal(response.status, 403, `${path} must be denied by real Vite serving`);
    assert.ok(!(await response.text()).includes(secret));
  }
  const viteRelayResponse = await fetch(`${viteOrigin}/__snapback/connection/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(viteRelayResponse.status, 200);
  assert.equal(observedHttpHeaders.at(-1)[DEV_IDENTITY_HEADER], 'sbdev_real_vite_secret');
  assert.equal(viteRelayResponse.headers.get(DEV_IDENTITY_HEADER), null);
  await viteServer.close();
  viteServer = null;

  const customDenyPlugin = snapbackDev({
    server: { mode: 'external', url: backendUrl },
    projectRoot: viteRoot,
    env: { SNAPBACK_DEV_IDENTITY_FILE: viteCapabilityFile },
    logJson: false,
  });
  const customDenyPatch = customDenyPlugin.config(
    { server: { fs: { deny: ['**/user-secret'] } } },
    { command: 'serve' },
  );
  assert.deepEqual(customDenyPatch.server.fs.deny.slice(0, 2), [
    '**/user-secret',
    '**/*.dev-identity',
  ]);
  assert.ok(customDenyPatch.server.fs.deny.includes(canonicalViteCapabilityFile));
  assert.ok(customDenyPatch.server.fs.deny.includes(viteCapabilityFile.replaceAll('\\', '/')));

  const managedStrictFalseEvents = [];
  await assert.rejects(
    createViteServer({
      root: canonicalViteRoot,
      configFile: false,
      logLevel: 'silent',
      plugins: [snapbackDev({
        server: { mode: 'managed' },
        projectRoot: canonicalViteRoot,
        setup: { reset: 'always' },
        onEvent: (event) => managedStrictFalseEvents.push(event),
        logJson: false,
      })],
      server: { host: '127.0.0.1', port: 0, fs: { strict: false } },
    }),
    (error) => error.code === 'SNAPBACK_DEV_IDENTITY_FS_CHECKS_DISABLED',
  );
  assert.equal(
    managedStrictFalseEvents.filter((event) => (
      event.code === 'SNAPBACK_DEV_IDENTITY_FS_CHECKS_DISABLED'
      && event.event === 'diagnostic'
    )).length,
    1,
  );
  assert.equal(
    managedStrictFalseEvents.some((event) => event.event === 'server-ready'),
    false,
    'managed lifecycle must not emit readiness when carrier custody cannot be enforced',
  );
  assert.equal(
    managedStrictFalseEvents.some((event) => event.event === 'server-setup'),
    false,
    'managed lifecycle must not run setup when carrier custody cannot be enforced',
  );

  const strictFalseOutsideEvents = [];
  viteServer = await createViteServer({
    root: canonicalViteRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [snapbackDev({
      server: { mode: 'external', url: backendUrl },
      projectRoot: viteRoot,
      env: { SNAPBACK_DEV_IDENTITY_FILE: relayCapabilityFile },
      onEvent: (event) => strictFalseOutsideEvents.push(event),
      logJson: false,
    })],
    server: { host: '127.0.0.1', port: 0, fs: { strict: false } },
  });
  await viteServer.listen();
  const strictFalseOrigin = `http://127.0.0.1:${viteServer.httpServer.address().port}`;
  const strictFalseHeaderIndex = observedHttpHeaders.length;
  const strictFalseRelayResponse = await fetch(`${strictFalseOrigin}/__snapback/connection/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(strictFalseRelayResponse.status, 200);
  assert.equal(observedHttpHeaders[strictFalseHeaderIndex][DEV_IDENTITY_HEADER], undefined);
  assert.equal(
    strictFalseOutsideEvents.filter((event) => (
      event.code === 'SNAPBACK_DEV_IDENTITY_FS_CHECKS_DISABLED'
      && event.event === 'dev-identity-stamping-refused'
    )).length,
    1,
  );
  const strictFalseDiagnostic = strictFalseOutsideEvents.find(
    (event) => event.code === 'SNAPBACK_DEV_IDENTITY_FS_CHECKS_DISABLED',
  );
  assert.match(strictFalseDiagnostic.message, /carrier file itself may be servable via \/@fs/u);
  await viteServer.close();
  viteServer = null;

  const servableCarrierEvents = [];
  const servableCarrierPlugin = snapbackDev({
    server: { mode: 'external', url: backendUrl },
    projectRoot: canonicalViteRoot,
    env: { SNAPBACK_DEV_IDENTITY_FILE: viteCapabilityFile },
    onEvent: (event) => servableCarrierEvents.push(event),
    logJson: false,
  });
  servableCarrierPlugin.config({}, { command: 'serve' });
  const servableCarrierConfig = {
    root: canonicalViteRoot,
    publicDir: false,
    server: {
      host: '127.0.0.1',
      fs: { strict: true, allow: [canonicalViteRoot] },
    },
    fsDenyGlob: () => false,
    safeModulePaths: new Set(),
  };
  servableCarrierPlugin.configResolved(servableCarrierConfig);
  await assert.rejects(
    servableCarrierPlugin.configureServer({
      config: servableCarrierConfig,
      middlewares: { use: () => {} },
      httpServer: null,
    }),
    (error) => error.code === 'SNAPBACK_DEV_IDENTITY_CARRIER_SERVABLE',
  );
  assert.equal(
    servableCarrierEvents.filter((event) => (
      event.code === 'SNAPBACK_DEV_IDENTITY_CARRIER_SERVABLE'
      && event.event === 'diagnostic'
    )).length,
    1,
  );

  const publicDir = join(viteRoot, 'public');
  const publicCarrier = join(publicDir, 'leaked.dev-identity');
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(publicCarrier, 'sbdev_public_must_refuse\n', { mode: 0o600 });
  const publicCarrierPlugin = snapbackDev({
    server: { mode: 'external', url: backendUrl },
    projectRoot: viteRoot,
    env: { SNAPBACK_DEV_IDENTITY_FILE: publicCarrier },
    logJson: false,
  });
  publicCarrierPlugin.config({}, { command: 'serve' });
  assert.throws(
    () => publicCarrierPlugin.configResolved({ root: viteRoot, publicDir, server: { host: '127.0.0.1' } }),
    (error) => error.code === 'SNAPBACK_DEV_READY_FILE_INVALID',
  );
  console.log('dev identity relay: strict-mode carriers stay denied; disabled fs checks fail closed for custody');

  const database = join(root, 'fixture.sqlite3');
  const readyFile = join(root, 'fixture.ready.json');
  const managedCapabilityFile = `${database}.dev-identity`;
  const descriptor = {
    schemaVersion: 'snapback.v0',
    descriptorKind: 'snapbackHostReady',
    ready: true,
    pid: process.pid,
    serverUrl: backendUrl,
    database: { path: database },
    startupNonce: 'nonce-one',
    devIdentityCapabilityFile: managedCapabilityFile,
  };
  writeFileSync(managedCapabilityFile, 'sbdev_managed_nonce_one\n', { mode: 0o600 });
  writeFileSync(readyFile, `${JSON.stringify(descriptor)}\n`, { mode: 0o600 });

  chmodSync(managedCapabilityFile, 0o644);
  assert.throws(
    () => readManagedDevIdentityCapability({ readyFile, database }),
    (error) => error.code === 'SNAPBACK_DEV_READY_FILE_INVALID',
  );
  chmodSync(managedCapabilityFile, 0o600);
  descriptor.devIdentityCapabilityFile = join(root, 'wrong.dev-identity');
  writeFileSync(readyFile, `${JSON.stringify(descriptor)}\n`);
  assert.throws(
    () => readManagedDevIdentityCapability({ readyFile, database }),
    (error) => error.code === 'SNAPBACK_DEV_SERVER_TARGET_MISMATCH',
  );
  descriptor.devIdentityCapabilityFile = managedCapabilityFile;
  writeFileSync(readyFile, `${JSON.stringify(descriptor)}\n`);

  const firstManaged = readManagedDevIdentityCapability({ readyFile, database });
  assert.equal(firstManaged.descriptor.startupNonce, 'nonce-one');
  assert.equal(firstManaged.capability, 'sbdev_managed_nonce_one');

  descriptor.startupNonce = 'nonce-two';
  writeFileSync(managedCapabilityFile, 'sbdev_managed_nonce_two\n');
  writeFileSync(readyFile, `${JSON.stringify(descriptor)}\n`);
  const restartedManaged = readManagedDevIdentityCapability({ readyFile, database });
  assert.equal(restartedManaged.descriptor.startupNonce, 'nonce-two');
  assert.equal(restartedManaged.capability, 'sbdev_managed_nonce_two');
  const managedProxy = createSnapbackProxy({
    base: '/__snapback',
    mode: 'managed',
    getState: () => ({ serverUrl: backendUrl }),
    getDevIdentityCapability: () => readManagedDevIdentityCapability({ readyFile, database }).capability,
  });
  const managedRelay = await listenProxy(managedProxy);
  relayServers.push(managedRelay.server);
  const managedResponse = await fetch(`${managedRelay.url}/__snapback/query/example`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(managedResponse.status, 200);
  assert.equal(observedHttpHeaders.at(-1)[DEV_IDENTITY_HEADER], 'sbdev_managed_nonce_two');
  console.log('dev identity relay: managed descriptor + owner-only sidecar stamp; unsafe carriers refuse harvest');

  const missingEvents = [];
  const missing = createSnapbackViteLifecycle({
    mode: 'external',
    projectRoot: root,
    url: backendUrl,
    env: {},
    onEvent: (event) => missingEvents.push(event),
    logJson: false,
  });
  await missing.start();
  assert.equal(missing.readDevIdentityCapability(), null);
  assert.equal(missing.readDevIdentityCapability(), null);
  assert.equal(
    missingEvents.filter((event) => event.event === 'dev-identity-handoff-missing').length,
    1,
  );
  const missingProxy = createSnapbackProxy({
    base: '/__snapback',
    mode: 'external',
    getState: missing.state,
    getDevIdentityCapability: missing.readDevIdentityCapability,
  });
  const missingRelay = await listenProxy(missingProxy);
  relayServers.push(missingRelay.server);
  const uncredentialedResponse = await fetch(`${missingRelay.url}/__snapback/query/example`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [DEV_IDENTITY_HEADER]: 'sbdev_client_cannot_self_supply',
    },
    body: '{}',
  });
  assert.equal(uncredentialedResponse.status, 200);
  assert.equal(observedHttpHeaders.at(-1)[DEV_IDENTITY_HEADER], undefined);
  await missing.close();
  console.log('dev identity relay: absent handoff warns once and strips a client-supplied capability');
} finally {
  if (viteServer) {
    try {
      await viteServer.close();
    } catch {
      // best-effort cleanup
    }
  }
  for (const relayServer of relayServers) {
    try {
      await close(relayServer);
    } catch {
      // best-effort cleanup
    }
  }
  try {
    await close(backend);
  } catch {
    // best-effort cleanup
  }
  backendWss.close();
  rmSync(root, { recursive: true, force: true });
}
