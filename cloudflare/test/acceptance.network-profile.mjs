import assert from 'node:assert/strict';
import { ADMIN_TOKEN, startProof } from './harness.mjs';

const PROFILE_PATH = '/_snapback/api/debug/network-profile';

async function jsonRequest(proof, path, { method = 'POST', value, admin = false } = {}) {
  const headers = new Headers();
  if (value !== undefined) headers.set('content-type', 'application/json');
  if (admin) headers.set('x-snapback-admin-token', ADMIN_TOKEN);
  const response = await proof.raw(path, {
    method,
    headers,
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  return { response, body: await response.json() };
}

async function startupRefusal(bindings, expectedCode) {
  const proof = await startProof({ bindings });
  try {
    const health = await proof.raw('/health');
    const body = await health.json();
    assert.equal(health.status, 409, JSON.stringify(body));
    assert.equal(body.code, expectedCode, JSON.stringify(body));
  } finally {
    await proof.dispose();
  }
}

// Deployment classification is exact and fail-closed for env selection.
await startupRefusal(
  { SNAPBACK_TESTING: null, SNAPBACK_NETWORK_PROFILE: 'optimistic' },
  'SNAPBACK_NETWORK_PROFILE_FORBIDDEN',
);
await startupRefusal(
  { SNAPBACK_TESTING: '0', SNAPBACK_NETWORK_PROFILE: 'optimistic' },
  'SNAPBACK_NETWORK_PROFILE_FORBIDDEN',
);

// Field and combined lane+jitter ceilings refuse rather than clamp.
await startupRefusal(
  {
    SNAPBACK_NETWORK_PROFILE: JSON.stringify({
      name: 'field-too-slow',
      mutationAckDelayMs: 30_001,
      liveDeltaDelayMs: 0,
      queryResponseDelayMs: 0,
      jitterMs: 0,
    }),
  },
  'SNAPBACK_NETWORK_PROFILE_DELAY_CEILING',
);
await startupRefusal(
  {
    SNAPBACK_NETWORK_PROFILE: JSON.stringify({
      name: 'combined-too-slow',
      mutationAckDelayMs: 30_000,
      liveDeltaDelayMs: 0,
      queryResponseDelayMs: 0,
      jitterMs: 1,
    }),
  },
  'SNAPBACK_NETWORK_PROFILE_DELAY_CEILING',
);

// Runtime GET/PUT mirrors the Rust route authority and lifecycle. The
// /object/evict Miniflare seam models DO reconstruction: runtime state clears
// and the deployment env (normal here) is re-applied.
const runtime = await startProof();
try {
  const unauthenticated = await jsonRequest(runtime, PROFILE_PATH, { method: 'GET' });
  assert.equal(unauthenticated.response.status, 403);

  const invalid = await jsonRequest(runtime, PROFILE_PATH, {
    method: 'PUT',
    value: { name: 'invalid', mutationAckDelayMs: 0 },
    admin: true,
  });
  assert.equal(invalid.response.status, 400, JSON.stringify(invalid.body));
  assert.equal(invalid.body.diagnostic?.code, 'SNAPBACK_NETWORK_PROFILE_INVALID');

  const queryProfile = await jsonRequest(runtime, PROFILE_PATH, {
    method: 'PUT',
    value: {
      name: 'query-floor',
      mutationAckDelayMs: 0,
      liveDeltaDelayMs: 0,
      queryResponseDelayMs: 75,
      jitterMs: 0,
    },
    admin: true,
  });
  assert.equal(queryProfile.response.status, 200, JSON.stringify(queryProfile.body));
  const queryStartedAt = Date.now();
  const delayedQuery = await jsonRequest(runtime, '/query', {
    value: { name: 'listNotes', args: { boardId: 'runtime-profile' } },
  });
  assert.ok(Date.now() - queryStartedAt >= 60, 'query response missed its configured floor');
  assert.equal(delayedQuery.response.headers.get('snapback-network-profile'), 'query-floor');

  const selected = await jsonRequest(runtime, PROFILE_PATH, {
    method: 'PUT',
    value: 'demo-slow',
    admin: true,
  });
  assert.equal(selected.response.status, 200, JSON.stringify(selected.body));
  assert.equal(selected.body.profile.name, 'demo-slow');
  assert.equal(selected.body.provenance.source, 'api');

  const read = await jsonRequest(runtime, PROFILE_PATH, { method: 'GET', admin: true });
  assert.equal(read.body.profile.name, 'demo-slow');
  await runtime.evict();
  const restarted = await jsonRequest(runtime, PROFILE_PATH, { method: 'GET', admin: true });
  assert.equal(restarted.body.profile.name, 'normal');
  assert.equal(restarted.body.provenance.source, 'env');
} finally {
  await runtime.dispose();
}

// Runtime selection uses the same classification gate as env selection.
const hostedClass = await startProof({ bindings: { SNAPBACK_TESTING: '0' } });
try {
  const forbidden = await jsonRequest(hostedClass, PROFILE_PATH, {
    method: 'PUT',
    value: 'optimistic',
    admin: true,
  });
  assert.equal(forbidden.response.status, 403, JSON.stringify(forbidden.body));
  assert.equal(forbidden.body.diagnostic?.code, 'SNAPBACK_NETWORK_PROFILE_FORBIDDEN');
} finally {
  await hostedClass.dispose();
}

// The built-in optimistic profile: query has a zero lane delay but still
// carries the honest marker; mutation ack and live frame share one
// commit-relative 1 s deadline. Admission remains open while the ack waits.
const optimistic = await startProof({ bindings: { SNAPBACK_NETWORK_PROFILE: 'optimistic' } });
try {
  await optimistic.reset();
  const health = await optimistic.health();
  assert.equal(health.networkProfile?.profile?.name, 'optimistic');

  const query = await jsonRequest(optimistic, '/query', {
    value: { name: 'listNotes', args: { boardId: 'profile-board' } },
  });
  assert.equal(query.response.headers.get('snapback-network-profile'), 'optimistic');
  assert.match(query.response.headers.get('access-control-expose-headers') || '', /snapback-network-profile/i);

  const socket = await optimistic.openLiveSocket();
  try {
    socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'profile-board' } });
    await socket.waitFor('snapshot');

    let firstAckReleased = false;
    let secondAckReleased = false;
    const firstStartedAt = Date.now();
    const first = jsonRequest(optimistic, '/mutation', {
      value: { name: 'addNote', args: { boardId: 'profile-board', text: 'admission-1' } },
    }).then((value) => {
      firstAckReleased = true;
      return value;
    });
    const second = jsonRequest(optimistic, '/mutation', {
      value: { name: 'addNote', args: { boardId: 'profile-board', text: 'admission-2' } },
    }).then((value) => {
      secondAckReleased = true;
      return value;
    });

    // optimistic.queryResponseDelayMs is zero. Seeing both rows while both
    // ack promises remain pending proves the second mutation was admitted and
    // committed before the first response deadline expired.
    const admitted = await jsonRequest(optimistic, '/query', {
      value: { name: 'listNotes', args: { boardId: 'profile-board' } },
    });
    assert.equal(firstAckReleased, false);
    assert.equal(secondAckReleased, false);
    assert.deepEqual(
      admitted.body.rows.map((row) => row.text).sort(),
      ['admission-1', 'admission-2'],
    );

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.ok(Date.now() - firstStartedAt >= 900, 'optimistic mutation ack released below its 1 s floor');
    assert.equal(firstResult.body.version + 1, secondResult.body.version, 'concurrent mutation admission order changed');
    assert.equal(firstResult.response.headers.get('snapback-network-profile'), 'optimistic');

    // Drain the two earlier live frames before measuring one commit's shared
    // ack/delta deadline.
    await socket.waitFor('live_replace');
    await socket.waitFor('live_replace');
    const measuredStartedAt = Date.now();
    const delta = socket.waitFor('live_replace').then((frame) => ({ frame, observedAt: Date.now() }));
    const ack = jsonRequest(optimistic, '/mutation', {
      value: { name: 'addNote', args: { boardId: 'profile-board', text: 'shared-deadline' } },
    }).then((value) => ({ ...value, observedAt: Date.now() }));
    const [deltaResult, ackResult] = await Promise.all([delta, ack]);
    assert.ok(ackResult.observedAt - measuredStartedAt >= 900, 'ack missed optimistic floor');
    assert.ok(deltaResult.observedAt - measuredStartedAt >= 900, 'live frame missed optimistic floor');
    assert.ok(
      Math.abs(deltaResult.observedAt - ackResult.observedAt) <= 150,
      `ack/live shared deadline skew exceeded scheduler noise: ${Math.abs(deltaResult.observedAt - ackResult.observedAt)}ms`,
    );
    assert.equal(deltaResult.frame.version, ackResult.body.version);
  } finally {
    socket.close();
  }
} finally {
  await optimistic.dispose();
}

console.log('cloudflare network-profile acceptance: classification, ceilings, runtime lifecycle, two-phase deadlines, and admission passed');
