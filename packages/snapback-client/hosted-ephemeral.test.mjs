import assert from 'node:assert/strict';
import { EphemeralOverlay, SnapbackClient } from './index.mjs';

const originalFetch = globalThis.fetch;
let authority = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const requests = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ path: url.pathname, body });
  if (url.pathname === '/connection/open') {
    assert.equal(body.ephemeralAuthorityProtocol, 1);
    return Response.json({
      connectionId: 'conn-hosted',
      connectionToken: 'sct_hosted',
      wireVersion: 'snapback.v1',
      ephemeralAuthorityProtocol: 1,
    });
  }
  if (url.pathname === '/ephemeral/subscribe') {
    return Response.json({
      Snapshot: {
        ephemeral_authority_instance: authority,
        room: { collection: 'presence', scope: { roomId: 'lobby' } },
        scope_epoch: 1,
        room_authority_generation: 1,
        high_water_version: 0,
        entries: [],
      },
    });
  }
  if (url.pathname === '/ephemeral/publish') {
    return Response.json({
      room: { collection: 'presence', scope: { roomId: 'lobby' } },
      key: 'conn-hosted',
      scope_epoch: 1,
      entry_version: 1,
      expires_at_ms: Date.now() + 1_000,
    });
  }
  if (url.pathname === '/ephemeral/unsubscribe') return Response.json({ ok: true });
  throw new Error(`unexpected request ${url.pathname}`);
};

try {
  const client = new SnapbackClient('https://hosted.test', {
    ephemeralAuthorityProtocol: 1,
  });
  const values = [];
  const registration = client.registerEphemeralRepublisher('presence', async ({ collection }) => {
    assert.equal(collection, 'presence');
    values.push('invoked');
    return { online: true };
  });
  const first = await client.subscribeEphemeral('presence', {
    connectionId: 'app',
    scope: { roomId: 'lobby' },
  });
  assert.deepEqual(values, [], 'initial authority establishment is not a restart');
  first.dispose();
  authority = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const second = await client.subscribeEphemeral('presence', {
    connectionId: 'app',
    scope: { roomId: 'lobby' },
  });
  assert.deepEqual(values, ['invoked']);
  assert.equal(requests.filter(({ path }) => path === '/ephemeral/publish').length, 1);
  registration.dispose();
  registration.dispose();

  const fakeClient = {
    authProtocols: { ephemeralAuthority: 1 },
    registerEphemeralConsumer: () => () => {},
    registerAuthMaterialization: () => () => {},
    recordReceipt: () => {},
  };
  const overlay = new EphemeralOverlay(fakeClient, 'presence', {
    connectionId: 'fake',
    scope: { roomId: 'lobby' },
    permissions: [],
  });
  const snapshot = (instance) => ({
    Snapshot: {
      ephemeral_authority_instance: instance,
      room: { collection: 'presence', scope: { roomId: 'lobby' } },
      scope_epoch: 1,
      room_authority_generation: 1,
      high_water_version: 0,
      entries: [],
    },
  });
  assert.equal(overlay.applyInitialSnapshot(snapshot('authority-a')), 'applied');
  assert.equal(overlay.apply(snapshot('authority-b')), 'applied');
  assert.equal(overlay.apply(snapshot('authority-a')), 'ignored_stale_authority');
  assert.equal(overlay.apply({
    Upsert: {
      room: { collection: 'presence', scope: { roomId: 'lobby' } },
      room_authority_generation: 1,
      entry: {
        key: 'late',
        value: [],
        received_at_ms: 1,
        expires_at_ms: 2,
        scope_epoch: 1,
        entry_version: 1,
      },
    },
  }), 'authority_missing');
  overlay.dispose();
  second.dispose();
} finally {
  globalThis.fetch = originalFetch;
}

console.log('snapback-client hosted ephemeral authority corpus passed');
