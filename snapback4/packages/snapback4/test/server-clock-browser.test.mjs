import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from '../../../witness/lib.mjs';
const extraSource = readFileSync(new URL('./fixtures/server-clock.q', import.meta.url), 'utf8');
const query = name => ({ kind: 'query', name: `media.${name}` });
const mutation = name => ({ kind: 'mutation', name: `media.${name}` });

test('web device: +25h default-now prediction stays above the latest page across offline reload and server settlement', { timeout: 60_000 }, async t => {
  const f = await launch({ seed: [], extraSource, clockOffset: '+25h' });
  t.after(() => f.close());
  const { page, api } = f, errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const viewer = await page.evaluate(async api => {
    window.app = window.createApp({ url: api, device: window.webDevice(), sessionStore: window.localStorageSessionStore(), waitSeconds: 1 });
    await window.app.ready;
    const signed = await window.app.auth.guest();
    if (!signed.ok) throw Error(JSON.stringify(signed));
    return signed.session.principal;
  }, api);
  const seeded = await fetch(api + '/seed', { method: 'POST', body: JSON.stringify([
    { table: 'conversations', row: { id: 'room', title: 'Clock', creatorId: viewer } },
    { table: 'memberships', row: { id: 'member', conversationId: 'room', principal: viewer, role: 'admin', joinedAt: 1 } },
  ]) }).then(r => r.json());
  assert.equal(seeded.seeded, 2);
  await page.evaluate(async () => {
    await window.app.client.sync();
    for (let n = 0; n < 25; n++) {
      const sent = await window.app.mutate({ kind: 'mutation', name: 'media.sendClock' }, { conversationId: 'room', body: 'existing ' + n });
      if (sent.state !== 'sent') throw Error(JSON.stringify(sent));
    }
    await window.app.client.sync();
  });
  await page.context().setOffline(true);
  const predicted = await page.evaluate(async () => {
    await window.app.client.sync();
    const write = await window.app.mutate({ kind: 'mutation', name: 'media.sendClock' }, { conversationId: 'room', body: 'offline newest' });
    const read = await window.app.client.query({ kind: 'query', name: 'media.latestClock' }, { conversationId: 'room' });
    return { write, read, offset: window.app.client.now() - Date.now() };
  });
  assert.equal(predicted.write.state, 'pending');
  assert.equal(predicted.read.data.length, 20);
  assert.equal(predicted.read.data[0].body, 'offline newest');
  assert.equal(predicted.read.data[0].pending, true);
  assert.ok(Math.abs(predicted.offset - 90_000_000) < 250, JSON.stringify(predicted));
  const predictedAt = predicted.read.data[0].at;
  // Only the test shell can load. Every backend request remains cut, including
  // session restore and schema discovery in the fresh JavaScript lifetime.
  await page.context().route(api + '/**', route => route.abort('internetdisconnected'));
  await page.context().setOffline(false);
  await f.reload();
  const restored = await page.evaluate(async api => {
    window.app = window.createApp({ url: api, device: window.webDevice(), sessionStore: window.localStorageSessionStore(), waitSeconds: 1 });
    const ready = await window.app.ready;
    if (!ready.ok) throw Error(JSON.stringify(ready));
    const read = await window.app.client.query({ kind: 'query', name: 'media.latestClock' }, { conversationId: 'room' });
    const write = await window.app.mutate({ kind: 'mutation', name: 'media.sendClock' }, { conversationId: 'room', body: 'cold offline newest' });
    const next = await window.app.client.query({ kind: 'query', name: 'media.latestClock' }, { conversationId: 'room' });
    return { read, write, next, offset: window.app.client.now() - Date.now() };
  }, api);
  assert.equal(restored.read.data[0].body, 'offline newest');
  assert.equal(restored.read.data[0].at, predictedAt);
  assert.equal(restored.read.data[0].pending, true);
  assert.equal(restored.next.data[0].body, 'cold offline newest');
  assert.equal(restored.next.data[0].pending, true);
  assert.ok(Math.abs(restored.offset - 90_000_000) < 250);
  await fetch(api + '/dev/clock/advance', { method: 'POST', body: JSON.stringify({ duration: '2m' }) });
  await page.context().unroute(api + '/**');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  let confirmed;
  for (let attempt = 0; attempt < 200; attempt++) {
    confirmed = await page.evaluate(async () => {
      await window.app.client.sync();
      return (await window.app.client.query({ kind: 'query', name: 'media.latestClock' }, { conversationId: 'room' })).data;
    });
    const sent = confirmed?.filter(row => row.body.includes('offline newest'));
    if (sent?.length === 2 && sent.every(row => !row.pending)) break;
    await page.waitForTimeout(50);
  }
  const settled = confirmed.find(row => row.body === 'offline newest');
  assert.ok(settled.at >= predictedAt + 119_000, `settlement installs the server stamp: ${JSON.stringify({ predictedAt, settled })}`);
  assert.notEqual(settled.pending, true);
  assert.deepEqual(errors, []);
  t.diagnostic(`offset before reload ${predicted.offset} ms; after ${restored.offset} ms; server settlement advanced ${settled.at - predictedAt} ms`);
  await page.evaluate(() => window.app.close());
});

test('web held typing: deadline republishes locally and clock advance expires on the next query response without a deletion', { timeout: 60_000 }, async t => {
  const f = await launch({ extraSource, seed: [
    { table: 'conversations', row: { id: 'room', title: 'Clock', creatorId: 'dev:alice' } },
    { table: 'memberships', row: { id: 'member', conversationId: 'room', principal: 'dev:alice', role: 'admin', joinedAt: 1 } },
  ] });
  t.after(() => f.close());
  const { page, api } = f;
  await page.evaluate(async api => {
    window.blockSync = false;
    window.client = await window.createLocalClient({ url: api, persona: 'alice', fetch: (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      if (window.blockSync && path === '/sync') throw Error('deletions held');
      return fetch(input, init);
    } });
    window.watch = window.client.observe({ kind: 'query', name: 'media.heldTyping' }, { conversationId: 'room' });
    window.expiries = [];
    window.watch.subscribe(() => {
      const read = window.watch.getSnapshot();
      if (read.data?.length === 1) window.deadline = read.data[0].expiresAt;
      if (read.data?.length === 0 && window.deadline) {
        window.expiries.push({ deadline: window.deadline, at: window.client.now(), wall: Date.now() });
        window.deadline = undefined;
      }
    });
  }, api);
  for (let n = 0; n < 5; n++) {
    await page.evaluate(async () => {
      await window.client.mutate({ kind: 'mutation', name: 'media.typeClock' }, { conversationId: 'room', lifetime: 300 });
      await window.client.sync();
    });
    await page.waitForFunction(n => window.expiries.length > n, n);
  }
  const delays = await page.evaluate(() => window.expiries.map(e => e.at - e.deadline));
  assert.ok(delays.every(ms => ms >= 0 && ms <= 1000), JSON.stringify(delays));
  t.diagnostic(`held answer deadline lateness (ms): ${delays.join(', ')}; within 16.7ms frame: ${delays.every(ms => ms <= 16.7)}`);
  await page.evaluate(async () => {
    await window.client.mutate({ kind: 'mutation', name: 'media.typeClock' }, { conversationId: 'room', lifetime: 120000 });
    await window.client.sync(); window.blockSync = true;
  });
  await page.waitForFunction(() => window.watch.getSnapshot().data?.length === 1);
  await fetch(api + '/dev/clock/advance', { method: 'POST', body: JSON.stringify({ duration: '2m' }) });
  const before = Date.now();
  const now = await page.evaluate(() => window.client.query({ kind: 'query', name: 'media.clockTime' }, {}));
  assert.equal(typeof now.data?.at, 'number', JSON.stringify(now));
  await page.waitForFunction(() => window.watch.getSnapshot().data?.length === 0);
  assert.ok(Date.now() - before < 3000, 'must not wait two minutes of device time');
  await page.evaluate(async () => { window.watch.close(); await window.client.close(); });
});
