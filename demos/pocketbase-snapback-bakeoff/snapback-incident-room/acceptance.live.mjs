import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SnapbackClient, parseSearchQueryV1 } from '@expo/snapback-client';
import { createAssetClient } from '@expo/snapback-client/assets';
import api from './snapback/generated/api.mjs';
import functionsManifest from './snapback/generated/functions.manifest.json' with { type: 'json' };

const root = resolve(import.meta.dirname);
const readyFile = join(root, '.snapback', 'dev.ready.json');
const executable = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'snapback.cmd' : 'snapback');
const child = spawn(executable, ['dev', 'snapback'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
let remainder = '';
const lifecycle = [];
child.stdout.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  stdout += text;
  remainder += text;
  for (;;) {
    const newline = remainder.indexOf('\n');
    if (newline < 0) break;
    const line = remainder.slice(0, newline).trim();
    remainder = remainder.slice(newline + 1);
    try {
      const event = JSON.parse(line);
      if (event.schemaVersion === 'snapback.dev.v1') lifecycle.push(event);
    } catch { /* human output */ }
  }
});
child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

async function until(fn, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    if (child.exitCode !== null) throw new Error(`${label}: dev exited ${child.exitCode}\n${stdout}\n${stderr}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`${label}: timed out\n${stdout}\n${stderr}`);
}

const results = [];
async function check(name, fn) {
  const started = performance.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Math.round(performance.now() - started) });
  } catch (error) {
    results.push({ name, ok: false, ms: Math.round(performance.now() - started), error: error?.diagnostic?.code ?? error.message });
  }
}

try {
  const ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'managed ready file');
  await until(() => lifecycle.some((event) => event.state === 'generated-and-loaded'), 'generated-and-loaded');
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const client = new SnapbackClient(ready.serverUrl, { adminToken });

  await check('generated auth-scoped reads', async () => {
    const [ada, grace, mallory] = await Promise.all([
      client.query(api.listIncidents, { args: {}, userId: 'user_ada' }),
      client.query(api.listIncidents, { args: {}, userId: 'user_grace' }),
      client.query(api.listIncidents, { args: {}, userId: 'user_mallory' }),
    ]);
    assert.equal(ada.rows.length, 1);
    assert.equal(grace.rows.length, 1);
    assert.equal(mallory.rows.length, 0);
  });

  await check('portable indexed search with owner partition', async () => {
    const result = await client.search(api.searchIncidents, {
      query: parseSearchQueryV1('latency', { fields: ['title', 'summary'] }),
      userId: 'user_ada',
    });
    assert.equal(result.items.some((item) => item.rowId === 'incident_api'), true);
    const outsider = await client.search(api.searchIncidents, {
      query: parseSearchQueryV1('latency', { fields: ['title', 'summary'] }),
      userId: 'user_mallory',
    });
    assert.equal(outsider.items.length, 0);
  });

  await check('cross-client live query and server-derived author', async () => {
    let delivered = null;
    const body = `Realtime handoff ${Date.now()}`;
    const live = await client.liveQuery(api.messagesForIncident, {
      connectionId: 'grace-message-observer',
      args: { incidentId: 'incident_api' },
      userId: 'user_grace',
      fallbackToPoll: false,
      transport: 'stream',
      onUpdate: (rows) => { delivered = rows.find((row) => row.body === body) ?? delivered; },
    });
    const createdId = await client.mutate(api.createMessage, {
      args: { incidentId: 'incident_api', authorName: 'Ada', body },
      userId: 'user_ada',
    });
    await until(() => delivered, 'live message delivery');
    assert.equal(delivered.authorId, 'user_ada');
    assert.ok(createdId);
    live.dispose();
  });

  await check('atomic handler writes incident plus activity', async () => {
    const before = await client.query(api.activityForIncident, { args: { incidentId: 'incident_api' }, userId: 'user_ada' });
    await client.mutate(api.acknowledgeIncident, { args: { incidentId: 'incident_api' }, userId: 'user_ada' });
    const incidents = await client.query(api.listIncidents, { args: {}, userId: 'user_ada' });
    const after = await client.query(api.activityForIncident, { args: { incidentId: 'incident_api' }, userId: 'user_ada' });
    assert.equal(incidents.rows[0].status, 'acknowledged');
    assert.equal(after.rows.length, before.rows.length + 1);
    assert.equal(after.rows.at(-1).actorId, 'user_ada');
  });

  await check('GAP: authenticated asset upload exposes 0.1.8 auth failure', async () => {
    const assets = createAssetClient(client, { chunkBytes: 5 });
    // A real PNG signature: the intent accepts detectable types only, and
    // this check measures the auth refusal that precedes detection anyway.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = new Blob([png], { type: 'image/png' });
    const task = assets.start({
      upload: api.incidentAttachment,
      file,
      userId: 'user_ada',
      declaredFilename: 'runbook.png',
      declaredContentType: 'image/png',
    });
    const completed = await task.done;
    assert.equal(completed.status, 'failed', JSON.stringify(completed));
    assert.equal(completed.diagnostic?.diagnostic?.code, 'SNAPBACK_AUTH_REQUIRED');
  });

  await check('true ephemeral presence leaves durable version untouched', async () => {
    const inspectBefore = await client.inspect();
    const ada = await client.subscribeEphemeral(api.ephemeral.incidentPresence, {
      connectionId: 'presence-ada', scope: { incidentId: 'incident_api' }, userId: 'user_ada',
    });
    const grace = await client.subscribeEphemeral(api.ephemeral.incidentPresence, {
      connectionId: 'presence-grace', scope: { incidentId: 'incident_api' }, userId: 'user_grace',
    });
    await ada.publish({ name: 'Ada', state: 'typing' }, { ttlMs: 2_000 });
    await until(() => grace.currentEntries().some((entry) => entry.value.name === 'Ada'), 'presence delivery');
    const inspectAfter = await client.inspect();
    assert.equal(inspectAfter.storageVersion, inspectBefore.storageVersion);
    ada.dispose();
    grace.dispose();
  });

  await check('action commits through mutation and cron is loaded', async () => {
    const before = await client.query(api.maintenanceStatus, { args: {}, userId: 'user_ada' });
    await client.action(api.runMaintenance, { args: {}, userId: 'user_ada' });
    const after = await client.query(api.maintenanceStatus, { args: {}, userId: 'user_ada' });
    assert.equal(after.rows[0].runCount, before.rows[0].runCount + 1);
    assert.equal(functionsManifest.cronJobs.some((job) => job.name === 'hourlyMaintenance'), true);
  });

  assert.equal(results.length, 7);
  assert.equal(results.every((result) => result.ok), true, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ app: 'snapback-incident-room', version: '0.1.8', results }, null, 2));
} finally {
  if (child.exitCode === null) {
    child.stdin.end();
    const deadline = Date.now() + 5_000;
    while (child.exitCode === null && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}
