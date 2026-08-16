import assert from 'node:assert/strict';
import test from 'node:test';

import { createDirector } from '../lib/director.mjs';

test('director long-polls commands and resolves correlated results', async (t) => {
  const director = createDirector({ port: 0, config: { binding: { format: 'test' } } });
  const address = await director.listen();
  t.after(() => director.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const commandPromise = director.sendCommand('bootstrap', { mode: 'native' }, 2_000);
  const delivered = await fetch(`${origin}/cmd`).then((response) => response.json());
  assert.equal(delivered.name, 'bootstrap');
  const posted = await fetch(`${origin}/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: delivered.id, ok: true, result: { status: 'ready' } }),
  });
  assert.equal(posted.ok, true);
  assert.deepEqual((await commandPromise).result, { status: 'ready' });
});

test('director records app events', async (t) => {
  const director = createDirector({ port: 0 });
  const address = await director.listen();
  t.after(() => director.close());
  await fetch(`http://127.0.0.1:${address.port}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'witness-ready', launchId: 'launch-1' }),
  });
  const event = await director.waitEvent((entry) => entry.event === 'witness-ready');
  assert.equal(event.launchId, 'launch-1');
});

test('director retains scanner secrets only in memory and never in event or request logs', async (t) => {
  const director = createDirector({ port: 0 });
  const address = await director.listen();
  t.after(() => director.close());
  const literal = 'one-shot-bearer-literal';
  const posted = await fetch(`http://127.0.0.1:${address.port}/secret`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'bearer', literal }),
  });
  assert.equal(posted.ok, true);
  assert.deepEqual(director.secretLiterals(), [literal]);
  assert.deepEqual(director.secretSummary(), { bearer: 1 });
  assert.equal(director.events.length, 0);
  assert.doesNotMatch(director.capturedLog(), new RegExp(literal, 'u'));
});
