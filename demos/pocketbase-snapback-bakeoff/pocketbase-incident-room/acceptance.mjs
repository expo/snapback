import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { EventSource } from 'eventsource';
import PocketBase from 'pocketbase';

global.EventSource = EventSource;

const root = import.meta.dirname;
const binary = `${root}/.pocketbase/pocketbase`;
const baseUrl = 'http://127.0.0.1:8099';
const commonArgs = ['--dir=./pb_data', '--migrationsDir=./pb_migrations', '--hooksDir=./pb_hooks'];

const superuser = spawnSync(binary, [
  'superuser', 'upsert', 'admin@example.test', 'correct-horse-admin', ...commonArgs,
], { cwd: root, encoding: 'utf8' });
assert.equal(superuser.status, 0, superuser.stderr);

const server = spawn(binary, ['serve', '--http=127.0.0.1:8099', ...commonArgs], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', (chunk) => { logs += chunk; });
server.stderr.on('data', (chunk) => { logs += chunk; });

async function until(fn, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(30);
  }
  throw new Error(`${label} timed out: ${lastError?.message ?? ''}\n${logs}`);
}

const client = (email, password) => {
  const pb = new PocketBase(baseUrl);
  pb.autoCancellation(false);
  return pb.collection('users').authWithPassword(email, password).then(() => pb);
};

const results = [];
async function check(name, fn) {
  const started = performance.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Math.round(performance.now() - started) });
  } catch (error) {
    results.push({ name, ok: false, ms: Math.round(performance.now() - started), error: error.message });
  }
}

try {
  await until(async () => (await fetch(`${baseUrl}/api/health`)).ok, 'PocketBase health');
  const [ada, grace, mallory] = await Promise.all([
    client('ada@example.test', 'correct-horse-ada'),
    client('grace@example.test', 'correct-horse-grace'),
    client('mallory@example.test', 'correct-horse-mallory'),
  ]);
  const admin = new PocketBase(baseUrl);
  await admin.collection('_superusers').authWithPassword('admin@example.test', 'correct-horse-admin');

  await check('auth and relation-scoped reads', async () => {
    const adaRows = await ada.collection('incidents').getFullList({ sort: '-created' });
    const graceRows = await grace.collection('incidents').getFullList({ sort: '-created' });
    const outsiderRows = await mallory.collection('incidents').getFullList();
    assert.equal(adaRows.length >= 1, true);
    assert.equal(graceRows.length, adaRows.length);
    assert.equal(outsiderRows.length, 0);
  });

  await check('indexed filtering and text search', async () => {
    const rows = await ada.collection('incidents').getFullList({
      filter: ada.filter('severity = {:severity} && (title ~ {:term} || summary ~ {:term})', {
        severity: 'sev2', term: 'latency',
      }),
      sort: '-created',
    });
    assert.equal(rows.some((row) => row.id === 'incidentapi0000'), true);
  });

  let realtimeMessage = null;
  await check('cross-client authoritative realtime', async () => {
    const unsubscribe = await grace.collection('messages').subscribe('*', (event) => {
      if (event.action === 'create' && event.record.body === 'Realtime handoff') realtimeMessage = event.record;
    }, { filter: 'incident = "incidentapi0000"' });
    const created = await ada.collection('messages').create({
      incident: 'incidentapi0000',
      author: 'usermallory0000',
      body: 'Realtime handoff',
      kind: 'system',
    });
    assert.equal(created.author, 'userada00000000', 'hook must derive author from auth');
    assert.equal(created.kind, 'message', 'hook must close the message kind');
    await until(() => realtimeMessage, 'message realtime delivery');
    assert.equal(realtimeMessage.author, 'userada00000000');
    await unsubscribe();
    await ada.collection('messages').delete(created.id);
  });

  await check('transactional server route writes incident plus activity', async () => {
    await ada.collection('incidents').update('incidentapi0000', { status: 'open', acknowledgedAt: '' });
    const before = await admin.collection('activity').getFullList({ filter: 'incident = "incidentapi0000"' });
    const ack = await ada.send('/api/incident-room/incidents/incidentapi0000/acknowledge', { method: 'POST' });
    const after = await admin.collection('activity').getFullList({ filter: 'incident = "incidentapi0000"' });
    assert.equal(ack.incident.status, 'acknowledged');
    assert.equal(after.length, before.length + 1);
    assert.equal(after.at(-1).actor, 'userada00000000');
  });

  await check('protected file upload and token-gated download', async () => {
    const created = await ada.collection('incidents').create({
      room: 'roomops00000000',
      title: 'Attachment smoke',
      summary: 'Prove native multipart and protected delivery.',
      severity: 'sev3',
      attachment: new File(['runbook contents'], 'runbook.txt', { type: 'text/plain' }),
    });
    assert.equal(created.commander, 'userada00000000');
    const token = await ada.files.getToken();
    const response = await fetch(ada.files.getURL(created, created.attachment, { token }));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'runbook contents');
    await ada.collection('incidents').delete(created.id);
  });

  await check('durable presence substitute and scheduled cleanup', async () => {
    const presence = await ada.collection('presence').create({
      incident: 'incidentapi0000',
      user: 'userada00000000',
      state: 'typing',
      expiresAt: '2000-01-01 00:00:00.000Z',
    });
    const jobs = await admin.crons.getFullList();
    assert.equal(jobs.some((job) => job.id === 'expire-presence'), true);
    await admin.crons.run('expire-presence');
    await until(async () => {
      try {
        await admin.collection('presence').getOne(presence.id);
        return false;
      } catch (error) {
        if (error.status === 404) return true;
        throw error;
      }
    }, 'scheduled presence cleanup');
  });

  assert.equal(results.length, 6);
  assert.equal(results.every((result) => result.ok), true, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ app: 'pocketbase-incident-room', versions: { server: '0.39.9', sdk: '0.27.0' }, results }, null, 2));
} finally {
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    server.kill('SIGTERM');
    setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL');
    }, 3_000).unref();
  });
}
