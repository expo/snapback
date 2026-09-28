import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerClock, sampleChanges } from '../dist/clock.js';

function store() {
  const meta = new Map();
  return { meta, async call(request) {
    if (request.op === 'state') return { ok: { watermark: 1 } };
    if (request.op === 'queued') return { ok: [] };
    if (request.op === 'meta') return { ok: meta.get(request.key) ?? null };
    if (request.op === 'set_meta') { meta.set(request.key, request.value); return { ok: true }; }
    throw Error(request.op);
  } };
}

test('receipt-driven reads share an unchanged durable clock and retry failed saves', async () => {
  const clock = new ServerClock(() => 1000), core = store();
  const call = core.call; let saves = 0, fail = false;
  core.call = async request => {
    if (request.op === 'set_meta') { saves++; if (fail) throw Error('disk unavailable'); }
    return call(request);
  };
  await clock.attach(core);
  const initial = saves;
  await Promise.all(Array.from({ length: 10000 }, () => clock.persist()));
  assert.equal(saves, initial, 'message watches do not rewrite unchanged clock metadata');
  for (let peer = 1; peer < 50; peer++) {
    clock.sample(1000 + peer, 1000, 1000, `receipt:${peer}`);
    await Promise.all(Array.from({ length: 50 }, () => clock.persist()));
  }
  assert.equal(saves, initial + 49, 'one changed clock image per receipt, independent of readers');
  fail = true;
  clock.sample(2000, 1000, 1000, 'failed-save');
  await assert.rejects(clock.persist(), /disk unavailable/);
  fail = false;
  await clock.persist();
  assert.equal(JSON.parse(core.meta.get('server-clock')).offset, 1000, 'failure is not remembered as durable');
  await clock.detach();
  const next = store(); await clock.attach(next);
  assert.ok(next.meta.has('server-clock'), 'a different device must persist its own clock');
});

test('clock chooses the minimum RTT in a recent bounded window, then forgets old samples', () => {
  let wall = 1000;
  const clock = new ServerClock(() => wall);
  assert.equal(clock.issuedDeviceNow(), 1000, 'zero offset before any sample');
  clock.sample(1110, 1000, 1020, 'host:0'); // +100, 20ms RTT
  clock.sample(1600, 1000, 1200, 'host:0'); // +500, 200ms RTT
  assert.equal(clock.issuedDeviceNow(), 1100);
  clock.sample(1201, 1000, 1002, 'host:0'); // +200, 2ms RTT
  assert.equal(clock.issuedDeviceNow(), 1200);
  wall = 62000;
  clock.sample(62300, 62000, 62200, 'host:0'); // new recent window: +200
  assert.equal(clock.issuedDeviceNow(), 62200);
  for (let i = 0; i < 33; i++) clock.sample(wall + 700, wall, wall + 100, 'host:0');
  assert.equal(clock.issuedDeviceNow(), wall + 650, 'old best sample ages out of the 32-sample bound');
});

test('advance switches windows immediately; late pre-advance replies cannot rewind it', () => {
  const clock = new ServerClock(() => 1000);
  clock.sample(1000, 1000, 1000, 'host:0', 1);
  clock.sample(121050, 1000, 1100, 'host:1', 3);
  assert.equal(clock.issuedDeviceNow(), 121000);
  clock.sample(1000, 1000, 1000, 'host:0', 2);
  assert.equal(clock.issuedDeviceNow(), 121000);
});

test('restart rejects every already-issued other-epoch response, including on a fork', async () => {
  const wall = 5_000_000, clock = new ServerClock(() => wall), releases = [];
  const fetcher = clock.wrap(() => new Promise(resolve => releases.push(resolve)));
  const first = fetcher('http://clock.test/first'), later = fetcher('http://clock.test/later');
  const response = (epoch, now) => new Response('', { headers: { 'x-snapback-time': String(now), 'x-snapback-clock': epoch + ':0' } });
  releases[0](response('NEW', wall)); await first;
  const fork = clock.fork();
  releases[1](response('OLD', wall + 90_000_000)); await later;
  fork.sample(wall + 90_000_000, wall, wall, 'OLD:0', 2);
  assert.equal(clock.issuedDeviceNow(), wall);
  assert.equal(fork.issuedDeviceNow(), wall, 'the fork retains the request-order barrier');
  await fork.wrap(async () => response('NEWER', wall + 1000))('http://clock.test/new');
  assert.equal(fork.issuedDeviceNow(), wall + 1000, 'newly issued requests can adopt another epoch');
});

test('streaming advances are provisional receipt stamps with no half-wait overshoot', async () => {
  let wall = 1_000_000;
  const clock = new ServerClock(() => wall);
  const response = await clock.wrap(async () => {
    wall += 15;
    return new Response('', { headers: { 'x-snapback-time': String(wall), 'x-snapback-clock': 'host:0' } });
  })('http://clock.test/changes');
  clock.issuedDeviceNow();
  wall += 20_000;
  const actual = wall + 120_000;
  sampleChanges(response, { serverNow: actual - 15, clockRevision: 'host:1' });
  assert.equal(clock.issuedDeviceNow(), actual - 15);
  assert.ok(clock.issuedDeviceNow() <= actual, 'the 20-second hold cannot advance the floor by ten seconds');
  const sent = wall; wall += 40;
  clock.sample(sent + 20 + 120_000, sent, wall, 'host:1');
  assert.equal(clock.estimatedServerNow(), wall + 120_000, 'the real 40ms sample beats provisional zero RTT');
  assert.equal(clock.issuedDeviceNow(), wall + 120_000, 'the refined clock has no frozen overshoot');
});

test('now stays integer and monotonic when the offset shrinks or wall time rolls back', () => {
  let wall = 1000;
  const clock = new ServerClock(() => wall);
  clock.sample(3000, 1000, 1001, 'host:0');
  const issued = clock.issuedDeviceNow();
  assert.equal(issued, 3000);
  clock.sample(1000, 1000, 1000, 'restart:0');
  assert.equal(clock.issuedDeviceNow(), issued);
  wall = 500;
  assert.equal(clock.issuedDeviceNow(), issued);
  wall = 4000;
  assert.equal(clock.issuedDeviceNow(), 4000);
});

test('an offline cold start restores the estimate and admission floor beside device identity', async () => {
  let wall = 1000;
  const device = store(), first = new ServerClock(() => wall);
  await first.attach(device);
  first.sample(90001000, 1000, 1000, 'host:0');
  wall += 123;
  const issued = first.issuedDeviceNow();
  device.meta.set('server-clock-floor', String(issued)); // an admitted write pins this time
  await first.persist();
  const restarted = new ServerClock(() => wall);
  await restarted.attach(device);
  assert.equal(restarted.issuedDeviceNow(), issued);
  const rolledBack = new ServerClock(() => 0);
  await rolledBack.attach(device);
  assert.equal(rolledBack.issuedDeviceNow(), issued);
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
  assert.equal(clock.issuedDeviceNow(), 1000);
});

test('recovered issued time wakes deadlines without changing the estimate or accepting invalid floors', () => {
  const clock = new ServerClock(() => 1_000_000), notices = [];
  clock.subscribe((shift, reschedule) => notices.push({ shift, reschedule, delay: clock.deviceDelay(1_004_000) }));
  clock.raiseIssued(1_003_999);
  clock.raiseIssued(1_004_000);
  assert.deepEqual(notices, [{ shift: 3999, reschedule: true, delay: 4000 }, { shift: 1, reschedule: true, delay: 0 }]);
  assert.equal(clock.estimatedServerNow(), 1_000_000);
  assert.equal(clock.serverDelay(1_004_000), 4000);
  assert.equal(clock.issuedDeviceNow(), 1_004_000);
  for (const value of [1_002_000, 1_004_000, -1, NaN, Infinity, 1_004_001.5, Number.MAX_SAFE_INTEGER + 1]) clock.raiseIssued(value);
  assert.equal(notices.length, 2);
  assert.equal(clock.issuedDeviceNow(), 1_004_000);
});

test('stream final-body clock stamp supersedes pre-advance response headers', async () => {
  const clock = new ServerClock();
  const before = Date.now();
  const transport = clock.wrap(async () => new Response('', { headers: {
    'x-snapback-time': String(before), 'x-snapback-clock': 'host:0',
  } }));
  const response = await transport('http://clock.test/changes');
  sampleChanges(response, { serverNow: Date.now() + 120000, clockRevision: 'host:1' });
  assert.ok(clock.issuedDeviceNow() >= before + 120000);
});


test('wall-clock rollback discards the old window and does not spin frozen deadlines', () => {
  let wall = 10000;
  const clock = new ServerClock(() => wall);
  clock.sample(10000, 10000, 10000, 'host:0');
  assert.equal(clock.issuedDeviceNow(), 10000);
  wall = 1000;
  clock.sample(11000, 1000, 1002, 'host:0');
  assert.equal(clock.issuedDeviceNow(), 10999, 'the pre-rollback zero-RTT sample cannot win');
  clock.sample(1000, 1000, 1000, 'restart:0');
  assert.equal(clock.issuedDeviceNow(), 10999);
  assert.equal(clock.deviceDelay(12000), 11000, 'a shrinking offset schedules after the frozen floor catches up');
});

test('detaching drains its final save and never queues later response samples on a closed device', async () => {
  const core = store(), clock = new ServerClock(() => 1000);
  await clock.attach(core);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const original = core.call;
  core.call = async request => { calls++; await blocked; return original(request); };
  clock.sample(2000, 1000, 1000, 'host:0');
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
  const expiresAt = clock.issuedDeviceNow() + 120000;
  core.call = async request => {
    if (request.op === 'asset_home') {
      seen.push(request.now);
      return { ok: request.now < expiresAt ? { store_id: 'media-store', table: 'messages', row: 'message', column: 'photo', generation: 1, expiresAt, type: 'image/png' } : null };
    }
    return ordinary(request);
  };
  const cache = new MediaCache(core, 'alice', { keep: 'viewed', maxBytes: 100 }, clock.issuedDeviceNow);
  await cache.open();
  const read = await cache.viewed('asset', new Blob(['image'], { type: 'image/png' }), new Response('', { headers: { 'accept-ranges': 'bytes', 'x-snapback-asset-home': encodeURIComponent(JSON.stringify({ store_id: 'media-store', table: 'messages', row: 'message', column: 'photo' })) } }));
  assert.equal(typeof read.url, 'string');
  assert.ok(seen.every(now => now === 90001000));
  wall += 1;
  clock.sample(90121001, 1001, 1001, 'host:1');
  await cache.reconcile();
  assert.equal((await cache.read('asset')).denied.code, 'E_OFFLINE');
  assert.equal(core.meta.get('media:bytes:asset'), '');
  await cache.close();
});

for (const first of ['stream', 'slow']) test(`a 20s response cannot latch a midpoint error (${first} arrives first)`, async () => {
  let wall = 1_000_000;
  const clock = new ServerClock(() => wall), device = store();
  clock.sample(wall, wall, wall, 'host:0', 1);
  const sent = wall; wall += 20_000;
  const actual = wall + 120_000, issued = [];
  clock.subscribe(() => issued.push(clock.issuedDeviceNow()));
  const stream = () => clock.sampleStream(actual, 'host:1', 2);
  const slow = () => clock.sample(actual - 500, sent, wall, 'host:1', 3);
  if (first === 'stream') { stream(); slow(); } else { slow(); stream(); }
  assert.ok(issued.every(now => now <= actual + 100), JSON.stringify(issued));
  assert.equal(clock.issuedDeviceNow(), actual);
  assert.equal(clock.estimatedServerNow(), actual, 'the streaming estimate beats a slow stamp 500ms behind');
  assert.equal(clock.serverDelay(actual + 100), 100, 'the slow stamp cannot postpone refetch by 500ms');
  assert.equal(clock.fork().issuedDeviceNow(), actual);
  const shortSent = wall; wall += 40;
  clock.sample(shortSent + 20 + 120_000, shortSent, wall, 'host:1', 4);
  assert.equal(clock.estimatedServerNow(), wall + 120_000);
  assert.equal(clock.issuedDeviceNow(), wall + 120_000, 'the short response leaves no frozen overshoot');
  await clock.attach(device); await clock.detach();
});

test('a lone slow receipt stamp advances both clocks across a fork and offline restart', async () => {
  const wall = 1_020_000, clock = new ServerClock(() => wall), device = store();
  await clock.attach(device);
  clock.sample(wall + 120_000, wall - 20_000, wall, 'host:1');
  assert.equal(clock.estimatedServerNow(), wall + 120_000);
  assert.equal(clock.issuedDeviceNow(), wall + 120_000);
  assert.equal(clock.serverDelay(wall + 140_000), 20_000);
  assert.equal(clock.deviceDelay(wall + 140_000), 20_000);
  assert.equal(clock.fork().issuedDeviceNow(), wall + 120_000);
  await clock.persist();
  const reopened = new ServerClock(() => wall); await reopened.attach(device);
  assert.equal(reopened.estimatedServerNow(), wall + 120_000);
  assert.equal(reopened.issuedDeviceNow(), wall + 120_000, 'the persisted receipt stamp still bounds issued time');
  await clock.detach(); await reopened.detach();
});

test('the durable admission floor survives retirement of every queued entry', async () => {
  const device = store();
  device.meta.set('server-clock', JSON.stringify({ offset: 0, last: 0 }));
  device.meta.set('server-clock-floor', '1004000');
  const reopened = new ServerClock(() => 1_000_000); await reopened.attach(device);
  assert.equal(reopened.issuedDeviceNow(), 1_004_000);
  await reopened.detach();
});

test('a short confirmation corrects a legacy round-two issued offset and notifies watches', async () => {
  const wall = 1_020_000, clock = new ServerClock(() => wall), changes = [], device = store();
  device.meta.set('server-clock', JSON.stringify({ offset: 120_000, issuedOffset: 0, last: 0 }));
  await clock.attach(device);
  assert.equal(clock.estimatedServerNow(), wall + 120_000);
  assert.equal(clock.issuedDeviceNow(), wall);
  clock.subscribe((shift, revised) => { if (revised || Math.abs(shift) >= 10) changes.push(clock.issuedDeviceNow()); });
  clock.sample(wall + 120_000, wall, wall, 'host:1');
  assert.equal(clock.estimatedServerNow(), wall + 120_000, 'the estimate did not change');
  assert.deepEqual(changes, [wall + 120_000], 'the device watch still learns the correction');
});

for (const roundTrip of [1000, 1001, 2000]) test(`${roundTrip}ms response obeys the short-RTT boundary before and after refinement`, () => {
  let wall = 1_000_000;
  const clock = new ServerClock(() => wall), offset = 120_000, sent = wall;
  wall += roundTrip;
  const serverStamp = wall + offset - 25; // 25ms from stamp to receipt
  clock.sample(serverStamp, sent, wall, 'host:1');
  const first = serverStamp + (roundTrip <= 1000 ? roundTrip / 2 : 0);
  assert.equal(clock.estimatedServerNow(), first);
  assert.equal(clock.issuedDeviceNow(), first);
  if (roundTrip > 1000) assert.ok(clock.issuedDeviceNow() <= wall + offset, 'a slow sample cannot issue future time');
  const shortSent = wall; wall += 40;
  clock.sample(shortSent + 20 + offset, shortSent, wall, 'host:1');
  assert.equal(clock.estimatedServerNow(), wall + offset, 'the 40ms midpoint sample wins');
  assert.equal(clock.issuedDeviceNow(), Math.max(first, wall + offset), 'refinement preserves only the already-issued floor');
  if (roundTrip > 1000) assert.equal(clock.issuedDeviceNow(), wall + offset, 'no slow-sample midpoint remains frozen');
});

test('real changeFeed learns an advance from three buffered two-second polls', async t => {
  const { changeFeed } = await import('../dist/changes.js');
  const streams = globalThis.ReadableStream;
  globalThis.ReadableStream = undefined;
  t.after(() => { globalThis.ReadableStream = streams; });
  let wall = 1_000_000, requests = 0;
  const clock = new ServerClock(() => wall), lifetime = new AbortController();
  t.after(() => lifetime.abort());
  clock.sample(wall, wall, wall, 'host:0');
  assert.equal(clock.issuedDeviceNow(), wall);
  const transport = clock.wrap(async input => {
    const url = new URL(input);
    assert.equal(url.searchParams.get('wait'), '2');
    assert.equal(url.searchParams.has('heartbeat'), false, 'exercise the no-stream request path');
    requests++; wall += 2000;
    return { body: null, headers: new Headers({ 'x-snapback-time': String(wall + 120_000), 'x-snapback-clock': 'host:1' }),
      json: async () => ({ seq: 0, tables: [], generation: 1 }) }; // ordinary buffered polls have only header stamps
  });
  const feed = changeFeed(transport, 'http://clock.test', lifetime.signal, () => assert.fail('healthy buffered poll went offline'), () => {});
  for (let n = 0; n < 3; n++) {
    await feed(0, 25, {});
    assert.equal(clock.estimatedServerNow(), wall + 120_000);
    assert.equal(clock.issuedDeviceNow(), wall + 120_000);
    assert.equal(clock.serverDelay(wall + 120_500), 500);
    assert.equal(clock.deviceDelay(wall + 120_500), 500);
  }
  assert.equal(requests, 3);
  const sent = wall; wall += 40;
  clock.sample(sent + 20 + 120_000, sent, wall, 'host:1');
  assert.equal(clock.issuedDeviceNow(), wall + 120_000, 'a short refinement finds no frozen overshoot');
});

for (const issuedOffset of [0, -31 * 86_400_000]) test(`a non-admission last cannot pin a negative startup correction (issuedOffset ${issuedOffset})`, async () => {
  let wall = 1_780_000_000_000;
  const offset = -31 * 86_400_000, device = store(), clock = new ServerClock(() => wall);
  device.meta.set('server-clock', JSON.stringify({ offset, issuedOffset, last: wall - 5000 }));
  const sent = wall; wall += 1500;
  clock.sample(wall + offset, sent, wall, 'host:0');
  await clock.attach(device);
  assert.equal(clock.issuedDeviceNow(), wall + offset);
  const expiresAt = sent + offset + 30 * 86_400_000;
  assert.ok(clock.issuedDeviceNow() < expiresAt, 'a valid thirty-day session remains valid');
  assert.equal('last' in JSON.parse(device.meta.get('server-clock')), false, 'only offsets are persisted here');
  await clock.detach();
});

test('an offline legacy offset without issuedOffset preserves a valid thirty-day session', async () => {
  const wall = 1_780_000_000_000, offset = -31 * 86_400_000;
  const device = store(), clock = new ServerClock(() => wall);
  device.meta.set('server-clock', JSON.stringify({ offset, last: wall - 5000 }));
  await clock.attach(device); // No sample, admission or issuedOffset to mask the legacy fallback.
  assert.equal(clock.issuedDeviceNow(), wall + offset);
  assert.ok(clock.issuedDeviceNow() < wall + offset + 30 * 86_400_000);
  await clock.detach();
});

test('a non-admission last above wall time cannot pin an offline issued offset', async () => {
  const wall = 1_780_000_000_000, issuedOffset = -31 * 86_400_000;
  const device = store(), clock = new ServerClock(() => wall);
  device.meta.set('server-clock', JSON.stringify({ offset: issuedOffset + 500, issuedOffset, last: wall + 120_000 }));
  await clock.attach(device);
  assert.equal(clock.estimatedServerNow(), wall + issuedOffset + 500);
  assert.equal(clock.issuedDeviceNow(), wall + issuedOffset);
  await clock.detach();
});

for (const kind of ['measured', 'streaming']) test(`newest equal-RTT ${kind} sample wins even when the issued floor masks its correction`, () => {
  let wall = 10_000;
  const clock = new ServerClock(() => wall);
  const sample = offset => kind === 'streaming'
    ? clock.sampleStream(wall + offset, 'host:0', 1)
    : clock.sample(wall + offset - 10, wall - 20, wall, 'host:0');
  sample(1000);
  const floor = clock.issuedDeviceNow();
  wall += 10; sample(500);
  assert.equal(clock.estimatedServerNow(), wall + 500, 'newest wins the RTT tie, including a downward correction');
  assert.equal(clock.issuedDeviceNow(), floor, 'live issuance remains monotonic');
  assert.equal(clock.serverDelay(wall + 600), 100, 'refetch timing follows the newer estimate');
});
