import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SnapbackClient,
  isTerminalLiveProtocolRefusal,
} from './index.mjs';

const TERMINAL_CODES = [
  'SNAPBACK_AUTHORIZED_LEASE_CLIENT_UNSUPPORTED',
  'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED',
  'SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED',
  'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED',
  'SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED',
  'SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED',
  'SNAPBACK_EPHEMERAL_AUTHORITY_PROTOCOL_MISMATCH',
  'SNAPBACK_EPHEMERAL_EXPIRY_PROTOCOL_MISMATCH',
  'SNAPBACK_WIRE_VERSION_MISMATCH',
  'SNAPBACK_WIRE_VERSION_REQUIRED',
  'SNAPBACK_WIRE_VERSION_UNSUPPORTED',
];

const retryableNeighbors = [
  { code: 'SNAPBACK_REQUEST_JSON_INVALID', status: 400, label: 'legacy probe' },
  { code: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE', status: 503, label: 'readiness' },
  { code: 'SNAPBACK_WIRE_VERSION_UNSUPPORTED', status: 409, label: 'conflict' },
  { code: 'SNAPBACK_CLIENT_REFUSED', status: undefined, label: 'transport' },
];

const refusal = (code, status) => {
  const error = new Error(`${code}: subscribe refused`);
  error.code = code;
  error.diagnostic = { code, message: error.message, details: {} };
  if (status !== undefined) error.status = status;
  return error;
};

const waitFor = async (check, label) => {
  const deadline = Date.now() + 1_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? 'timed out'}`);
};

test('terminal live-protocol classifier is a closed allowlist', () => {
  for (const code of TERMINAL_CODES) {
    assert.equal(isTerminalLiveProtocolRefusal(refusal(code, 400)), true, code);
    assert.equal(isTerminalLiveProtocolRefusal(refusal(code, undefined)), true, code);
  }
  for (const neighbor of retryableNeighbors) {
    assert.equal(
      isTerminalLiveProtocolRefusal(refusal(neighbor.code, neighbor.status)),
      false,
      neighbor.label,
    );
  }
  assert.equal(
    isTerminalLiveProtocolRefusal(refusal('SNAPBACK_FUTURE_CLIENT_UNSUPPORTED', 400)),
    false,
    'suffix similarity cannot expand the closed set',
  );
});

test('managed subscribe closes on wire-version unsupported without reconnecting', async () => {
  const client = new SnapbackClient('https://terminal-subscribe.test', { rqsStore: null });
  let attempts = 0;
  client.connectionGrant = async () => {
    attempts += 1;
    throw refusal('SNAPBACK_WIRE_VERSION_UNSUPPORTED', 400);
  };
  client.refreshConnectionGrant = client.connectionGrant;
  const manager = client.liveStreamManager('terminal-subscribe', {
    reconnectBaseDelayMs: 1,
    reconnectMaxDelayMs: 1,
  });
  const states = [];
  manager.onState((state, detail) => states.push({ state, detail }));
  await waitFor(
    () => assert.equal(manager.inspection().closed, true),
    'terminal manager did not close',
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(attempts, 1);
  assert.equal(manager.inspection().reconnectTimer, 0);
  assert.equal(states.at(-1)?.state, 'closed');
  assert.equal(states.at(-1)?.detail?.code, 'SNAPBACK_WIRE_VERSION_UNSUPPORTED');
  await client.close();
});

test('legacy-probe, 503, 409, and transport neighbors retain reconnect', async () => {
  for (const neighbor of retryableNeighbors) {
    const client = new SnapbackClient(`https://${neighbor.label}.subscribe.test`, {
      rqsStore: null,
    });
    let attempts = 0;
    client.connectionGrant = async () => {
      attempts += 1;
      throw refusal(neighbor.code, neighbor.status);
    };
    client.refreshConnectionGrant = client.connectionGrant;
    const manager = client.liveStreamManager(`retry-${neighbor.label}`, {
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1,
    });
    manager.onState(() => {});
    await waitFor(
      () => assert.ok(attempts >= 2),
      `${neighbor.label} did not reconnect`,
    );
    assert.equal(manager.inspection().closed, false, neighbor.label);
    manager.close();
    await client.close();
  }
});

