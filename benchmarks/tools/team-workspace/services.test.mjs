import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServices, loadMedia } from './services.mjs';
import { body, Journal } from './common.mjs';
import { sign, verify } from './payment.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

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
  await request(service.url, '/payment/deliveries', { eventIds: [newer.event.id], signature: 'wrong', retry: false });
  await request(service.url, '/payment/tick', {});
  assert.equal(seen.size, 0); assert.equal(rejections, 1);
  await request(service.url, '/payment/deliveries', { eventIds: [newer.event.id, old.event.id, newer.event.id] });
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
