import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerClock, sampleChanges } from '../dist/clock.js';

function store() {
  const meta = new Map();
  return { meta, async call(request) {
    if (request.op === 'meta') return { ok: meta.get(request.key) ?? null };
    if (request.op === 'set_meta') { meta.set(request.key, request.value); return { ok: true }; }
    throw Error(request.op);
  } };
}

test('clock chooses the minimum RTT in a recent bounded window, then forgets old samples', () => {
  let wall = 1000;
  const clock = new ServerClock(() => wall);
  assert.equal(clock.now(), 1000, 'zero offset before any sample');
  clock.sample(1110, 1000, 1020, 'host:0'); // +100, 20ms RTT
  clock.sample(1600, 1000, 1200, 'host:0'); // +500, 200ms RTT
  assert.equal(clock.now(), 1100);
  clock.sample(1201, 1000, 1002, 'host:0'); // +200, 2ms RTT
  assert.equal(clock.now(), 1200);
  wall = 62000;
  clock.sample(62300, 62000, 62200, 'host:0'); // new recent window: +200
  assert.equal(clock.now(), 62200);
  for (let i = 0; i < 33; i++) clock.sample(wall + 700, wall, wall + 100, 'host:0');
  assert.equal(clock.now(), wall + 650, 'old best sample ages out of the 32-sample bound');
});

test('advance switches windows immediately; late pre-advance replies cannot rewind it', () => {
  const clock = new ServerClock(() => 1000);
  clock.sample(1000, 1000, 1000, 'host:0', 1);
  clock.sample(121050, 1000, 1100, 'host:1', 3);
  assert.equal(clock.now(), 121000);
  clock.sample(1000, 1000, 1000, 'host:0', 2);
  assert.equal(clock.now(), 121000);
});

test('now stays integer and monotonic when the offset shrinks or wall time rolls back', () => {
  let wall = 1000;
  const clock = new ServerClock(() => wall);
  clock.sample(3000, 1000, 1001, 'host:0');
  const issued = clock.now();
  assert.equal(issued, 3000);
  clock.sample(1000, 1000, 1000, 'restart:0');
  assert.equal(clock.now(), issued);
  wall = 500;
  assert.equal(clock.now(), issued);
  wall = 4000;
  assert.equal(clock.now(), 4000);
});

test('an offline cold start restores the estimate and issued floor beside device identity', async () => {
  let wall = 1000;
  const device = store(), first = new ServerClock(() => wall);
  await first.attach(device);
  first.sample(90001000, 1000, 1000, 'host:0');
  wall += 123;
  const issued = first.now();
  await first.persist();
  const restarted = new ServerClock(() => wall);
  await restarted.attach(device);
  assert.equal(restarted.now(), issued);
  const rolledBack = new ServerClock(() => 0);
  await rolledBack.attach(device);
  assert.equal(rolledBack.now(), issued);
  await first.detach(); await restarted.detach(); await rolledBack.detach();
});

test('a fork owns its own persistence and a new live sample wins over stored offset', async () => {
  const parent = new ServerClock(() => 1000), one = store(), two = store();
  parent.sample(2000, 1000, 1000, 'host:0');
  const a = parent.fork(), b = parent.fork();
  two.meta.set('server-clock', JSON.stringify({ offset: 0, last: 500 }));
  await a.attach(one); await b.attach(two); await a.detach();
  b.sample(5000, 1000, 1000, 'host:1');
  await b.persist();
  assert.equal(JSON.parse(two.meta.get('server-clock')).offset, 4000);
  assert.equal(JSON.parse(one.meta.get('server-clock')).offset, 1000);
});

test('malformed metadata and invalid samples cannot poison device time', async () => {
  const device = store(); device.meta.set('server-clock', '{"offset":1e999,"last":0}');
  const clock = new ServerClock(() => 1000); await clock.attach(device);
  for (const stamp of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) clock.sample(stamp, 1000, 1001);
  clock.sample(9999, 1001, 1000);
  assert.equal(clock.now(), 1000);
});

test('stream final-body clock stamp supersedes pre-advance response headers', async () => {
  const clock = new ServerClock();
  const before = Date.now();
  const transport = clock.wrap(async () => new Response('', { headers: {
    'x-snapback-time': String(before), 'x-snapback-clock': 'host:0',
  } }));
  const response = await transport('http://clock.test/changes');
  sampleChanges(response, { serverNow: Date.now() + 120000, clockRevision: 'host:1' });
  assert.ok(clock.now() >= before + 120000);
});


test('wall-clock rollback discards the old window and does not spin frozen deadlines', () => {
  let wall = 10000;
  const clock = new ServerClock(() => wall);
  clock.sample(10000, 10000, 10000, 'host:0');
  assert.equal(clock.now(), 10000);
  wall = 1000;
  clock.sample(11000, 1000, 1002, 'host:0');
  assert.equal(clock.now(), 10999, 'the pre-rollback zero-RTT sample cannot win');
  clock.sample(1000, 1000, 1000, 'restart:0');
  assert.equal(clock.now(), 10999);
  assert.equal(clock.delay(12000), 11000, 'a shrinking offset schedules after the frozen floor catches up');
});

test('detaching drains its final save and never queues later response samples on a closed device', async () => {
  const core = store(), clock = new ServerClock(() => 1000);
  await clock.attach(core);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const original = core.call;
  core.call = async request => { calls++; await blocked; return original(request); };
  const closing = clock.detach();
  clock.sample(5000, 1000, 1000, 'host:1');
  release(); await closing;
  assert.equal(calls, 1, 'only the already-captured final save reaches the device');
});

test('retained asset homes and expiry use the same estimated time as device reads', async () => {
  const { MediaCache } = await import('../dist/local-assets.js');
  let wall = 1000;
  const clock = new ServerClock(() => wall), core = store(), ordinary = core.call, seen = [];
  clock.sample(90001000, 1000, 1000, 'host:0');
  const expiresAt = clock.now() + 120000;
  core.call = async request => {
    if (request.op === 'asset_home') {
      seen.push(request.now);
      return { ok: request.now < expiresAt ? { table: 'messages', row: 'message', column: 'photo', generation: 1, expiresAt, type: 'image/png' } : null };
    }
    return ordinary(request);
  };
  const cache = new MediaCache(core, 'alice', { keep: 'viewed', maxBytes: 100 }, clock.now);
  await cache.open();
  const read = await cache.viewed('asset', new Blob(['image'], { type: 'image/png' }), new Response('', { headers: { 'accept-ranges': 'bytes' } }));
  assert.equal(typeof read.url, 'string');
  assert.ok(seen.every(now => now === 90001000));
  wall += 1;
  clock.sample(90121001, 1001, 1001, 'host:1');
  await cache.reconcile();
  assert.equal((await cache.read('asset')).denied.code, 'E_OFFLINE');
  assert.equal(core.meta.get('media:bytes:asset'), '');
  await cache.close();
});
