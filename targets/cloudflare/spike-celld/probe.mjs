#!/usr/bin/env node

import assert from 'node:assert/strict';

const base = process.env.CELLD_PROBE_URL ?? 'http://127.0.0.1:8080';
const idleMs = Number(process.env.CELLD_PROBE_IDLE_MS ?? 5_000);

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, headers: Object.fromEntries(response.headers), body };
}

async function post(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function openSocket(path) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(base.replace(/^http/, 'ws') + path);
    const queue = [];
    const waiters = [];
    const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), 8_000);

    function deliver(message) {
      const index = waiters.findIndex((waiter) => waiter.type === message.type);
      if (index < 0) {
        queue.push(message);
        return;
      }
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }

    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        send(value) {
          socket.send(JSON.stringify(value));
        },
        waitFor(type, timeoutMs = 8_000) {
          const index = queue.findIndex((message) => message.type === type);
          if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
          return new Promise((resolveFrame, rejectFrame) => {
            const waiter = {
              type,
              resolve: resolveFrame,
              timer: setTimeout(() => {
                const waiterIndex = waiters.indexOf(waiter);
                if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
                rejectFrame(new Error(`timeout waiting for ${type}`));
              }, timeoutMs),
            };
            waiters.push(waiter);
          });
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener('message', (event) => deliver(JSON.parse(event.data)));
    socket.addEventListener('error', (event) => reject(event.error ?? new Error('WebSocket error')));
  });
}

const evidence = {};

evidence.healthBefore = await request('/health');
assert.equal(evidence.healthBefore.status, 200);
assert.equal(evidence.healthBefore.body.ok, true);

evidence.manifest = await request('/inspect');
assert.equal(evidence.manifest.status, 200);
assert.equal(evidence.manifest.body.targetProfileId, 'cloudflare-do-sqlite-v8');

const boardId = `celld-spike-${Date.now()}`;
evidence.queryBefore = await post('/query', { name: 'listNotes', args: { boardId } });
assert.equal(evidence.queryBefore.status, 200);
assert.equal(evidence.queryBefore.body.ok, true);
assert.deepEqual(evidence.queryBefore.body.rows, []);

evidence.firstMutation = await post('/mutation', {
  name: 'addNote',
  args: { boardId, text: 'written through celld', authorId: 'lane-c' },
});
assert.equal(evidence.firstMutation.status, 200);
assert.equal(evidence.firstMutation.body.ok, true);
assert.equal(evidence.firstMutation.body.changedCount, 1);

evidence.queryAfter = await post('/query', { name: 'listNotes', args: { boardId } });
assert.equal(evidence.queryAfter.status, 200);
assert.equal(evidence.queryAfter.body.rows.length, 1);
assert.equal(evidence.queryAfter.body.rows[0].text, 'written through celld');

evidence.ambientDenial = await post('/query', { name: 'probeAmbient', args: {} });
assert.equal(evidence.ambientDenial.status, 200);
assert.equal(evidence.ambientDenial.body.ok, true);
const reachableAmbient = evidence.ambientDenial.body.rows.filter((entry) => entry.reachable);
assert.equal(reachableAmbient.find((entry) => entry.name === '__cell')?.reachable, true);

const socket = await openSocket('/live/stream');
try {
  socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId } });
  evidence.snapshot = await socket.waitFor('snapshot');
  assert.equal(evidence.snapshot.rows.length, 1);

  evidence.healthBeforeSocketIdle = await request('/health');
  await new Promise((resolve) => setTimeout(resolve, idleMs));
  evidence.healthAfterSocketIdle = await request('/health');
  assert.notEqual(
    evidence.healthAfterSocketIdle.body.objectBoot,
    evidence.healthBeforeSocketIdle.body.objectBoot,
    `coordinator did not rehydrate after ${idleMs} ms of connected idle`,
  );

  evidence.liveMutation = await post('/mutation', {
    name: 'addNote',
    args: { boardId, text: 'delivered over celld websocket' },
  });
  assert.equal(evidence.liveMutation.body.ok, true);

  evidence.liveReplace = await socket.waitFor('live_replace');
  assert.ok(evidence.liveReplace.rows.some((row) => row.text === 'delivered over celld websocket'));
} finally {
  socket.close();
}

evidence.healthAfter = await request('/health');
assert.equal(evidence.healthAfter.body.ok, true);
assert.ok(evidence.healthAfter.body.version >= evidence.liveMutation.body.version);

console.log(JSON.stringify({ ok: true, base, idleMs, evidence }, null, 2));
