import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WebSocket, WebSocketServer } from 'ws';

import { createSnapbackViteLifecycle, readManagedDevIdentityCapability } from './lifecycle.mjs';
import { createSnapbackProxy } from './proxy.mjs';

const DEV_IDENTITY_HEADER = 'x-snapback-dev-identity';

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
    res.writeHead(200, { 'content-type': 'application/json' });
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

let relayServer = null;
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
  relayServer = createServer((req, res) => {
    proxy.handleRequest(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  relayServer.on('upgrade', (req, socket, head) => proxy.handleUpgrade(req, socket, head));
  const relayUrl = await listen(relayServer);

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
  const firstManaged = readManagedDevIdentityCapability({ readyFile, database });
  assert.equal(firstManaged.descriptor.startupNonce, 'nonce-one');
  assert.equal(firstManaged.capability, 'sbdev_managed_nonce_one');

  descriptor.startupNonce = 'nonce-two';
  writeFileSync(managedCapabilityFile, 'sbdev_managed_nonce_two\n');
  writeFileSync(readyFile, `${JSON.stringify(descriptor)}\n`);
  const restartedManaged = readManagedDevIdentityCapability({ readyFile, database });
  assert.equal(restartedManaged.descriptor.startupNonce, 'nonce-two');
  assert.equal(restartedManaged.capability, 'sbdev_managed_nonce_two');
  console.log('dev identity relay: managed descriptor nonce rotation re-reads the sidecar');

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
  await missing.close();
  console.log('dev identity relay: external env handoff stamps; absent handoff warns once and remains permissive');
} finally {
  try {
    await close(relayServer);
  } catch {
    // best-effort cleanup
  }
  try {
    await close(backend);
  } catch {
    // best-effort cleanup
  }
  backendWss.close();
  rmSync(root, { recursive: true, force: true });
}
