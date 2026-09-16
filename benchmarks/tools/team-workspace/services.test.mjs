import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServices, loadMedia } from './services.mjs';
import { body, Journal } from './common.mjs';
import { sign, verify } from './payment.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { replay } from './replay.mjs';
import { actionBuilder } from './actions.mjs';

const adminToken = 'local-admin-token-123456', serviceToken = 'local-service-token-12345', signingSecret = 'local-signing-secret-1234';
async function temp(t) { const path = await mkdtemp(join(tmpdir(), 'workroom-test-')); t.after(() => rm(path, { recursive: true })); return path; }
async function request(url, path, value, key = 'key', token = adminToken) {
  const response = await fetch(url + path, { method: value === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, 'idempotency-key': key },
    body: value === undefined ? undefined : Buffer.isBuffer(value) ? value : JSON.stringify(value) });
  return { status: response.status, data: await response.json() };
}

test('email/extractor persist acceptance across dropped responses and restart, refuse changed inputs', async t => {
  const directory = await temp(t);
  let service = await startServices({ directory, adminToken, serviceToken, signingSecret, webhookUrl: 'http://127.0.0.1:1', autoRetry: false });
  t.after(async () => service?.close());
  const mail = { to: 'invited@workroom.test', subject: 'Invitation', body: 'http://127.0.0.1/accept?token=random-real-token' };
  assert.equal((await request(service.url, '/admin/email', undefined, '', 'bad')).status, 401);
  await request(service.url, '/admin/faults', { target: 'email', kind: '503', count: 1 });
  assert.equal((await request(service.url, '/email', mail, 'invite', serviceToken)).status, 503);
  assert.equal((await request(service.url, '/admin/email')).data.messages.length, 0);
  await request(service.url, '/admin/faults', { target: 'email', kind: 'drop', count: 1 });
  await assert.rejects(request(service.url, '/email', mail, 'invite', serviceToken));
  await service.close(); service = null;
  service = await startServices({ directory, adminToken, serviceToken, signingSecret, webhookUrl: 'http://127.0.0.1:1', autoRetry: false });
  assert.equal((await request(service.url, '/email', mail, 'invite', serviceToken)).data.id, 'email-1');
  assert.equal((await request(service.url, '/email', { ...mail, body: 'changed' }, 'invite', serviceToken)).status, 409);
  const emails = (await request(service.url, '/admin/email?recipient=invited%40workroom.test')).data.messages;
  assert.equal(emails.length, 1); assert.equal(emails[0].message.body, mail.body);
  for (const asset of await loadMedia()) {
    const extracted = await request(service.url, '/extract', asset.data, asset.id, serviceToken);
    assert.equal(extracted.data.sha256, asset.sha256); assert.equal(extracted.data.text, asset.text);
  }
  assert.equal((await request(service.url, '/extract', Buffer.from('http://secret.invalid'), 'unknown', serviceToken)).status, 400);
});

test('signed socket receiver: invalid then valid same body, reordering, duplicates, 503/drop, provider restart', async t => {
  const directory = await temp(t), receiverJournal = await Journal.open(join(directory, 'receiver.ndjson'));
  const applied = new Map(), seen = new Set(); let behavior = 'ok', rejections = 0;
  const receiver = http.createServer(async (req, res) => {
    const bytes = await body(req);
    if (!verify(bytes, req.headers['x-workroom-signature'], signingSecret)) { rejections++; res.writeHead(401); res.end(); return; }
    if (behavior === '503') { behavior = 'ok'; res.writeHead(503); res.end(); return; }
    const event = JSON.parse(bytes);
    assert.equal(verify(Buffer.from(JSON.stringify(event)), req.headers['x-workroom-signature'], signingSecret), false);
    if (!seen.has(event.id)) {
      await receiverJournal.append({ id: event.id, revision: event.revision, plan: event.plan });
      seen.add(event.id);
      if ((applied.get(event.organizationId)?.revision ?? 0) < event.revision) applied.set(event.organizationId, event);
    }
    if (behavior === 'drop') { behavior = 'ok'; res.destroy(); return; }
    assert.equal(receiverJournal.records.filter(x => x.id === event.id).length, 1);
    res.writeHead(204); res.end();
  });
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => receiver.close(resolve)); await receiverJournal.close(); });
  const webhookUrl = `http://127.0.0.1:${receiver.address().port}/webhook`;
  let service = await startServices({ directory, adminToken, serviceToken, signingSecret, webhookUrl, autoRetry: false });
  t.after(() => service?.close());
  const old = (await request(service.url, '/payment/events', { organizationId: 'org', plan: 'free', seatLimit: 2 }, 'old')).data;
  const newer = (await request(service.url, '/payment/events', { organizationId: 'org', plan: 'pro', seatLimit: 20 }, 'new')).data;
  assert.equal(newer.event.revision, 2);
  assert.equal((await request(service.url, '/payment/events', { organizationId: 'org', plan: 'pro', seatLimit: 21 }, 'new')).status, 409);
  const baseline = { applied: [...applied], audit: [...receiverJournal.records] };
  for (const signature of ['wrong', 'unsigned']) {
    await request(service.url, '/payment/deliveries', { eventIds: [newer.event.id], signature, retry: false }, signature);
    await request(service.url, '/payment/tick', {});
    const badStatus = (await request(service.url, '/payment/status')).data;
    assert.equal(badStatus.attempts.at(-1).status, 401);
    assert.equal(badStatus.attempts.at(-1).ack, false);
    assert.deepEqual({ applied: [...applied], audit: [...receiverJournal.records] }, baseline);
    assert.equal(seen.size, 0);
  }
  assert.equal(rejections, 2);
  await request(service.url, '/payment/deliveries', { eventIds: [newer.event.id, old.event.id, newer.event.id] }, 'valid-reordered');
  behavior = '503'; await request(service.url, '/payment/tick', {});
  assert.equal(applied.get('org').revision, 2);
  behavior = 'drop'; await request(service.url, '/payment/tick', {});
  let status = (await request(service.url, '/payment/status')).data;
  assert.ok(status.deliveries.some(x => !x.done));
  await service.close(); service = null;
  service = await startServices({ directory, adminToken, serviceToken, signingSecret, webhookUrl, autoRetry: false });
  await request(service.url, '/payment/tick', {});
  status = (await request(service.url, '/payment/status')).data;
  assert.ok(status.deliveries.every(x => x.done));
  assert.equal(receiverJournal.records.length, 2); assert.equal(applied.get('org').plan, 'pro');
  assert.ok(status.attempts.some(x => x.status === 503)); assert.ok(status.attempts.some(x => x.error));
  assert.ok(status.duplicateAttempts >= 3);
  const decoded = Buffer.from(newer.bodyBase64, 'base64');
  assert.ok(verify(decoded, sign(decoded, signingSecret), signingSecret));
});

test('delivery batch replay recovers identical IDs after lost response and provider restart, refusing changed input', async t => {
  const directory = await temp(t);
  const options = { directory, adminToken, serviceToken, signingSecret, webhookUrl: 'http://127.0.0.1:1', autoRetry: false };
  let service = await startServices(options); t.after(() => service?.close());
  const events = [];
  for (const plan of ['free', 'pro']) events.push((await request(service.url, '/payment/events',
    { organizationId: 'org', plan, seatLimit: 20 }, plan)).data.event.id);
  const a = actionBuilder('batch-recovery'), actions = [a('W5', 'fixture-provider', 'payment.deliver', 'batch',
    { eventIds: [events[0], events[1], events[0]] })];
  const adapter = { async execute(action) {
    let response;
    try { response = await request(service.url, '/payment/deliveries', action.input, action.key); }
    catch (error) { throw Object.assign(error, { code: 'TRANSPORT_UNKNOWN' }); }
    assert.equal(response.status, 200);
    return { status: 'applied', receipt: { id: response.data.batchId, authoritative: true, deliveryIds: response.data.deliveryIds },
      bindings: { batch: response.data.batchId } };
  }};
  await request(service.url, '/admin/faults', { target: 'payment-deliveries', kind: 'drop', count: 1 });
  const receiptPath = join(directory, 'replay.ndjson');
  await assert.rejects(replay(actions, adapter, receiptPath, { transportRetries: 0 }), { code: 'TRANSPORT_UNKNOWN' });
  const before = (await request(service.url, '/payment/status')).data;
  assert.equal(before.batches.length, 1); assert.equal(before.deliveries.length, 3);
  const batchRecords = (await readFile(join(directory, 'provider.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse)
    .filter(record => record.kind === 'payment.delivery-batch');
  assert.equal(batchRecords.length, 1); assert.equal(batchRecords[0].key, actions[0].key);
  assert.equal(batchRecords[0].deliveries.length, 3); assert.match(batchRecords[0].inputDigest, /^[a-f0-9]{64}$/);
  const retryBeforeRestart = await request(service.url, '/payment/deliveries', actions[0].input, actions[0].key);
  assert.deepEqual(retryBeforeRestart.data.deliveryIds, before.deliveries.map(x => x.id));
  await service.close(); service = null; service = await startServices(options);
  assert.equal((await replay(actions, adapter, receiptPath)).aliases.batch, before.batches[0].id);
  assert.equal((await replay(actions, adapter, receiptPath)).skipped, 1);
  const retry = await request(service.url, '/payment/deliveries', { ...actions[0].input, signature: 'valid', retry: true }, actions[0].key);
  assert.deepEqual(retry.data, retryBeforeRestart.data);
  assert.equal((await request(service.url, '/payment/deliveries', { eventIds: [...events].reverse() }, actions[0].key)).status, 409);
  assert.equal((await request(service.url, '/payment/deliveries', { ...actions[0].input, retry: false }, actions[0].key)).status, 409);
  const after = (await request(service.url, '/payment/status')).data;
  assert.deepEqual(after.batches, before.batches); assert.deepEqual(after.deliveries, before.deliveries);
  const missingKey = await fetch(service.url + '/payment/deliveries', { method: 'POST',
    headers: { authorization: 'Bearer ' + adminToken }, body: JSON.stringify(actions[0].input) });
  assert.equal(missingKey.status, 400); assert.equal((await missingKey.json()).code, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('admin, service and signing tokens must be pairwise distinct before creating a journal', async t => {
  const directory = join(await temp(t), 'not-created');
  for (const tokens of [
    { adminToken, serviceToken: adminToken, signingSecret },
    { adminToken, serviceToken, signingSecret: adminToken },
    { adminToken, serviceToken, signingSecret: serviceToken }
  ]) {
    await assert.rejects(startServices({ directory, ...tokens, webhookUrl: 'http://127.0.0.1:1' }), { code: 'FIXTURE_TOKENS_MUST_DIFFER' });
  }
  await assert.rejects(readFile(join(directory, 'provider.ndjson')), { code: 'ENOENT' });
});

test('provider process crash preserves email and backlog; automatic retries finish when receiver returns', async t => {
  const directory = await temp(t);
  let received = 0;
  const receiver = http.createServer(async (req, res) => {
    assert.ok(verify(await body(req), req.headers['x-workroom-signature'], signingSecret));
    received++; res.writeHead(received === 1 ? 503 : 204); res.end();
  });
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
  const port = receiver.address().port;
  await new Promise(resolve => receiver.close(resolve));
  const config = join(directory, 'config.json');
  await writeFile(config, JSON.stringify({ directory, adminToken, serviceToken, signingSecret,
    webhookUrl: `http://127.0.0.1:${port}/webhook`, retryMs: 10, timeoutMs: 100 }));
  let processHandle;
  const start = async () => {
    processHandle = spawn(process.execPath, [fileURLToPath(new URL('./services.mjs', import.meta.url)), config], { stdio: ['ignore', 'pipe', 'pipe'] });
    const reader = createInterface({ input: processHandle.stdout });
    const [text] = await once(reader, 'line', { signal: AbortSignal.timeout(5000) }); reader.close();
    return JSON.parse(text).url;
  };
  const stop = async signal => {
    if (processHandle && processHandle.exitCode === null && processHandle.signalCode === null) {
      const exited = once(processHandle, 'exit'); processHandle.kill(signal); await exited;
    }
  };
  t.after(async () => { await stop('SIGTERM'); if (receiver.listening) await new Promise(resolve => receiver.close(resolve)); });
  let url = await start();
  const mail = { to: 'owner@workroom.test', subject: 'Durable', body: 'Stored before SIGKILL' };
  assert.equal((await request(url, '/email', mail, 'crash-mail', serviceToken)).status, 200);
  const event = (await request(url, '/payment/events', { organizationId: 'org', plan: 'pro', seatLimit: 20 }, 'crash-event')).data;
  await request(url, '/payment/deliveries', { eventIds: [event.event.id] });
  await request(url, '/payment/tick', {});
  assert.equal((await request(url, '/payment/status')).data.deliveries[0].ack, false);
  await stop('SIGKILL');
  url = await start();
  assert.equal((await request(url, '/admin/email')).data.messages.length, 1);
  assert.equal((await request(url, '/payment/status')).data.deliveries[0].ack, false);
  await new Promise(resolve => receiver.listen(port, '127.0.0.1', resolve));
  let status, deadline = Date.now() + 3000;
  do {
    status = (await request(url, '/payment/status')).data;
    if (status.deliveries[0].ack) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.equal(status.deliveries[0].ack, true); assert.ok(received >= 2);
  assert.ok(status.attempts.some(x => x.error)); assert.ok(status.attempts.some(x => x.status === 503));
  await stop('SIGTERM'); url = await start();
  assert.equal((await request(url, '/payment/status')).data.deliveries[0].ack, true);
});
