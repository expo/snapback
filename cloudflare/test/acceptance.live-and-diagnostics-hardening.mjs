// Regression coverage for the 2026-07-16 Cloudflare review findings:
// bounded/closed WebSocket frames, post-commit fan-out recovery, and a
// public cron projection that cannot disclose retained action diagnostics.
import assert from 'node:assert/strict';
import { startProof, ADMIN_TOKEN } from './harness.mjs';
import { bindingNameFor } from '../config-set.mjs';

const MAX_LIVE_SOCKET_FRAME_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();

async function postTest(proof, path, body = {}) {
  const response = await proof.raw(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function subscribe(proof, boardId) {
  const socket = await proof.openLiveSocket();
  socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId } });
  const snapshot = await socket.waitFor('snapshot');
  assert.equal(snapshot.function, 'listNotes');
  return { socket, snapshot };
}

async function fanOutDiagnostics(proof) {
  const response = await postTest(proof, '/_snapback/test/fanout-diagnostics');
  assert.equal(response.status, 200);
  return response.body;
}

async function assertCommittedAndRecoverable(proof, boardId, text) {
  const query = await proof.query('listNotes', { boardId });
  assert.equal(query.ok, true);
  assert.ok(query.rows.some((row) => row.text === text), 'the post-commit fan-out failure rolled back or hid the mutation');
  const recovered = await subscribe(proof, boardId);
  assert.ok(
    recovered.snapshot.rows.some((row) => row.text === text),
    'a reconnect did not recover the committed row through a fresh snapshot',
  );
  recovered.socket.close();
}

async function proveWholeGroupRecovery(binding, diagnosticCode, boardId) {
  const proof = await startProof({ bindings: { [binding]: '1' } });
  try {
    const first = await subscribe(proof, boardId);
    const second = await subscribe(proof, boardId);
    const firstClosed = first.socket.waitForClose();
    const secondClosed = second.socket.waitForClose();
    const text = `${diagnosticCode}-committed`;
    const mutation = await proof.mutation('addNote', { boardId, text });
    assert.equal(mutation.ok, true, 'fan-out recovery changed a committed mutation into a request failure');
    for (const closed of await Promise.all([firstClosed, secondClosed])) {
      assert.equal(closed.code, 1011);
      assert.equal(closed.reason, diagnosticCode);
    }
    await assertCommittedAndRecoverable(proof, boardId, text);
    const diagnostics = await fanOutDiagnostics(proof);
    assert.equal(diagnostics.counters[diagnosticCode], 1);
    assert.equal(diagnostics.total, 1);
  } finally {
    await proof.dispose();
  }
}

function nextLiveReplaceOrClose(socket, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(null, new Error('timed out waiting for live_replace or close')), timeoutMs);
    const onMessage = (event) => {
      const frame = JSON.parse(event.data);
      if (frame.type === 'live_replace') finish({ kind: 'message', frame });
    };
    const onClose = (event) => finish({ kind: 'close', code: event.code, reason: event.reason });
    const finish = (value, error = null) => {
      clearTimeout(timer);
      socket.ws.removeEventListener('message', onMessage);
      socket.ws.removeEventListener('close', onClose);
      if (error) reject(error);
      else resolve(value);
    };
    socket.ws.addEventListener('message', onMessage);
    socket.ws.addEventListener('close', onClose);
  });
}

await proveWholeGroupRecovery(
  'SNAPBACK_TEST_FANOUT_QUERY_FAILURES',
  'SNAPBACK_LIVE_FANOUT_QUERY_FAILED',
  'fanout-query-failure',
);
await proveWholeGroupRecovery(
  'SNAPBACK_TEST_FANOUT_SERIALIZATION_FAILURES',
  'SNAPBACK_LIVE_FANOUT_SERIALIZATION_FAILED',
  'fanout-serialization-failure',
);

const sendFailure = await startProof({ bindings: { SNAPBACK_TEST_FANOUT_SEND_FAILURES: '1' } });
try {
  const boardId = 'fanout-send-failure';
  const first = await subscribe(sendFailure, boardId);
  const second = await subscribe(sendFailure, boardId);
  const outcomes = [nextLiveReplaceOrClose(first.socket), nextLiveReplaceOrClose(second.socket)];
  const text = 'send-failure-committed';
  const mutation = await sendFailure.mutation('addNote', { boardId, text });
  assert.equal(mutation.ok, true);
  const delivered = await Promise.all(outcomes);
  assert.equal(delivered.filter((outcome) => outcome.kind === 'message').length, 1);
  assert.equal(delivered.filter((outcome) => outcome.kind === 'close').length, 1);
  const healthy = delivered.find((outcome) => outcome.kind === 'message');
  const failed = delivered.find((outcome) => outcome.kind === 'close');
  assert.ok(healthy.frame.rows.some((row) => row.text === text), 'the healthy group member missed the committed update');
  assert.equal(failed.code, 1011);
  assert.equal(failed.reason, 'SNAPBACK_LIVE_FANOUT_SEND_FAILED');
  await assertCommittedAndRecoverable(sendFailure, boardId, text);
  const diagnostics = await fanOutDiagnostics(sendFailure);
  assert.equal(diagnostics.counters.SNAPBACK_LIVE_FANOUT_SEND_FAILED, 1);
  assert.equal(diagnostics.total, 1);
  first.socket.close();
  second.socket.close();
} finally {
  await sendFailure.dispose();
}

const frameProof = await startProof();
try {
  const exactEmpty = JSON.stringify({ type: 'ping', requestId: '' });
  const exactFrame = JSON.stringify({
    type: 'ping',
    requestId: 'x'.repeat(MAX_LIVE_SOCKET_FRAME_BYTES - textEncoder.encode(exactEmpty).byteLength),
  });
  assert.equal(textEncoder.encode(exactFrame).byteLength, MAX_LIVE_SOCKET_FRAME_BYTES);
  const boundary = await frameProof.openLiveSocket();
  boundary.sendRaw(exactFrame);
  assert.equal((await boundary.waitFor('pong')).type, 'pong', 'a valid boundary-sized frame was refused');
  boundary.close();
  const binaryBoundary = await frameProof.openLiveSocket();
  binaryBoundary.sendRaw(textEncoder.encode(exactFrame));
  assert.equal((await binaryBoundary.waitFor('pong')).type, 'pong', 'a valid boundary-sized binary frame was refused');
  binaryBoundary.close();

  const expectRefusal = async (raw, code, reason) => {
    const socket = await frameProof.openLiveSocket();
    const closed = socket.waitForClose();
    socket.sendRaw(raw);
    const result = await closed;
    assert.equal(result.code, code);
    assert.equal(result.reason, reason);
  };

  const oversizedText = JSON.stringify({
    type: 'ping',
    requestId: 'x'.repeat(MAX_LIVE_SOCKET_FRAME_BYTES - textEncoder.encode(exactEmpty).byteLength + 1),
  });
  await expectRefusal(oversizedText, 1009, 'SNAPBACK_LIVE_FRAME_TOO_LARGE');
  await expectRefusal(textEncoder.encode(oversizedText), 1009, 'SNAPBACK_LIVE_FRAME_TOO_LARGE');
  await expectRefusal(Uint8Array.from([0xc3, 0x28]), 1007, 'SNAPBACK_LIVE_FRAME_INVALID_UTF8');
  await expectRefusal('{', 1007, 'SNAPBACK_LIVE_FRAME_INVALID_JSON');
  for (const invalid of [
    null,
    [],
    { type: 'unknown' },
    { type: 'ping', name: 'listNotes' },
    { type: 'subscribe', name: 'listNotes', args: {}, subscriptionId: 'cross-variant' },
    { type: 'unsubscribe', subscriptionId: 'sub', args: {} },
  ]) {
    await expectRefusal(JSON.stringify(invalid), 1008, 'SNAPBACK_LIVE_FRAME_INVALID');
  }

  const protoSocket = await frameProof.openLiveSocket();
  protoSocket.sendRaw(
    '{"type":"subscribe","name":"listNotes","args":{"boardId":"proto-canonical","__proto__":{"scope":"kept"}}}',
  );
  await protoSocket.waitFor('snapshot');
  const ordinarySocket = await frameProof.openLiveSocket();
  ordinarySocket.send({
    type: 'subscribe',
    name: 'listNotes',
    args: { boardId: 'proto-canonical' },
  });
  await ordinarySocket.waitFor('snapshot');
  const state = await postTest(frameProof, '/_snapback/test/connection-state');
  assert.equal(state.body.subscriptions.length, 2, 'refused frames changed the subscription registry');
  assert.deepEqual(
    new Set(state.body.subscriptions.map((entry) => entry.args_json)),
    new Set([
      '{"__proto__":{"scope":"kept"},"boardId":"proto-canonical"}',
      '{"boardId":"proto-canonical"}',
    ]),
    'distinct canonical subscription args collided or dropped the owned __proto__ key',
  );
  protoSocket.close();
  ordinarySocket.close();
} finally {
  await frameProof.dispose();
}

const cronSecret = 'cron-diagnostic-secret';
const controlCronSecret = 'cron\nsecret\tvalue';
const privateSentinel = 'PRIVATE_UPSTREAM_SENTINEL';
const cronProof = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: {
    [bindingNameFor('all-aboard', 'caltrainFeed')]: JSON.stringify([
      cronSecret,
      controlCronSecret,
    ]),
    SNAPBACK_CONFIG_GENERATION: '1',
  },
});
try {
  const base = await cronProof.url();
  const actionOverride = `${privateSentinel}-${cronSecret}-${'z'.repeat(4000)}`;
  const attempt = await postTest(cronProof, '/_snapback/test/run-cron', {
    job: 'warmPoll',
    trigger: 'manual',
    actionOverride,
  });
  assert.equal(attempt.body.outcome, 'failed');

  const publicResponse = await fetch(`${base}/_snapback/api/cron/status`);
  const publicBody = await publicResponse.json();
  const publicText = JSON.stringify(publicBody);
  const publicRun = publicBody.jobs[0].lastRun;
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(publicResponse.headers.get('vary'), 'x-snapback-admin-token');
  assert.equal(publicRun.errorCode, 'SNAPBACK_ACTION_UNKNOWN');
  assert.equal(publicRun.error, undefined);
  assert.equal(publicRun.runId, undefined);
  assert.ok(!publicText.includes(privateSentinel));
  assert.ok(!publicText.includes(cronSecret));

  const operatorResponse = await fetch(`${base}/_snapback/api/cron/status`, {
    headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
  });
  const operatorBody = await operatorResponse.json();
  const operatorRun = operatorBody.jobs[0].lastRun;
  assert.equal(operatorResponse.status, 200);
  assert.equal(operatorResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(operatorResponse.headers.get('vary'), 'x-snapback-admin-token');
  assert.equal(operatorRun.runId, attempt.body.runId);
  assert.equal(operatorRun.errorCode, 'SNAPBACK_ACTION_UNKNOWN');
  assert.ok(operatorRun.error.includes(privateSentinel));
  assert.ok(operatorRun.error.includes('[redacted]'));
  assert.ok(!operatorRun.error.includes(cronSecret));
  assert.ok(textEncoder.encode(operatorRun.error).byteLength <= 1024);

  const retained = await postTest(cronProof, '/_snapback/test/cron-claims');
  const retainedError = String(retained.body.cronState[0].last_error);
  assert.ok(!retainedError.includes(cronSecret));
  assert.ok(textEncoder.encode(retainedError).byteLength <= 1024);

  // A raw exception can begin with something that looks like a Snapback
  // diagnostic. It remains useful to an authenticated operator, but cannot
  // extend the public endpoint's closed classification vocabulary.
  const rawPrivateCode = 'SNAPBACK_PRIVATE_UPSTREAM_SENTINEL';
  const rawAttempt = await postTest(cronProof, '/_snapback/test/run-cron', {
    job: 'warmPoll',
    trigger: 'manual',
    rawErrorOverride: `${rawPrivateCode}: raw failure detail`,
  });
  assert.equal(rawAttempt.body.outcome, 'failed');
  const rawPublic = await (await fetch(`${base}/_snapback/api/cron/status`)).json();
  assert.equal(rawPublic.jobs[0].lastRun.errorCode, 'SNAPBACK_CRON_ACTION_FAILED');
  assert.ok(!JSON.stringify(rawPublic).includes(rawPrivateCode));
  const rawOperator = await (await fetch(`${base}/_snapback/api/cron/status`, {
    headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
  })).json();
  assert.equal(rawOperator.jobs[0].lastRun.errorCode, 'SNAPBACK_CRON_ACTION_FAILED');
  assert.ok(rawOperator.jobs[0].lastRun.error.includes(rawPrivateCode));
  const rawRetained = await postTest(cronProof, '/_snapback/test/cron-claims');
  assert.equal(
    rawRetained.body.cronState[0].last_error_code,
    'SNAPBACK_CRON_ACTION_FAILED',
  );
  assert.ok(!String(rawRetained.body.cronState[0].last_error_code).includes(rawPrivateCode));

  const legacy = await postTest(cronProof, '/_snapback/test/migrate-legacy-cron-diagnostic', {
    errorCode: 'SNAPBACK_LEGACY_PRIVATE_CODE',
    error: `${privateSentinel}-${cronSecret}-${controlCronSecret}-${'q'.repeat(4000)}`,
  });
  assert.equal(legacy.body.state.last_error_code, 'SNAPBACK_CRON_ACTION_FAILED');
  assert.ok(String(legacy.body.state.last_error).includes(privateSentinel));
  assert.ok(!String(legacy.body.state.last_error).includes(cronSecret));
  assert.ok(!String(legacy.body.state.last_error).includes(controlCronSecret));
  assert.ok(!String(legacy.body.state.last_error).includes('cron secret value'));
  assert.ok(textEncoder.encode(String(legacy.body.state.last_error)).byteLength <= 1024);
  const legacyPublic = await (await fetch(`${base}/_snapback/api/cron/status`)).json();
  assert.equal(legacyPublic.jobs[0].lastRun.errorCode, 'SNAPBACK_CRON_ACTION_FAILED');
  assert.ok(!JSON.stringify(legacyPublic).includes('SNAPBACK_LEGACY_PRIVATE_CODE'));
  const legacyOperator = await (await fetch(`${base}/_snapback/api/cron/status`, {
    headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
  })).json();
  const legacyOperatorText = JSON.stringify(legacyOperator);
  assert.ok(!legacyOperatorText.includes(controlCronSecret));
  assert.ok(!legacyOperatorText.includes('cron secret value'));
} finally {
  await cronProof.dispose();
}

console.log('cloudflare live/diagnostics hardening acceptance: bounded frames, recoverable fan-out, and private cron diagnostics passed');
