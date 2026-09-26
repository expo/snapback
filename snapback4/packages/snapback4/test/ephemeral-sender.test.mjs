import test from 'node:test';
import assert from 'node:assert/strict';
import { ephemeralLane } from '../dist/ephemeral.js';

const renewal = { kind: 'mutation', name: 'set', ephemeral: true, renews: true, renewMs: 1000 };
const ordinary = { kind: 'mutation', name: 'stop', ephemeral: true, renewMs: 1000 };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let time = 0, id = 0, link = 'online';
  const calls = [], aborter = new AbortController();
  const lane = ephemeralLane({ url: 'http://test', mint: () => String(++id), now: () => time,
    link: () => link, signal: aborter.signal, headers: () => ({ 'content-type': 'application/json' }),
    offline: () => { link = 'offline'; lane.linkChanged(); },
    fetch: async (url, init) => new Promise((resolve, reject) => calls.push({ url, body: JSON.parse(init.body),
      done: (result = null) => resolve(Response.json({ state: 'sent', result })),
      fail: code => resolve(Response.json({ state: 'failed', why: { code, family: 'auth', retryable: true } })),
      reject,
    })),
  });
  return { lane, calls, aborter, tick: n => { time += n; }, link: () => link,
    offline: () => { link = 'offline'; lane.linkChanged(); } };
}

test('one in-flight request, renews coalesces at the tail and set/set/stop stays stopped', async () => {
  const f = fixture(), first = f.lane.mutate(renewal, { b: 2, a: 1 });
  const replaced = f.lane.mutate(renewal, { a: 1, b: 2 });
  const second = f.lane.mutate(renewal, { b: 2, a: 1 });
  const stop = f.lane.mutate(ordinary, {});
  assert.equal(f.calls.length, 1);
  f.calls[0].done(); await first; await turn();
  assert.equal(f.calls.length, 2); // stop is waiting, so the head cannot be suppressed.
  f.calls[1].done(); assert.deepEqual(await replaced, await second); await turn();
  assert.match(f.calls[2].url, /stop$/); f.calls[2].done(); await stop;
  assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['args', 'id']);
});

test('coalesced replacement moves behind an intervening stop', async () => {
  const f = fixture(), first = f.lane.mutate(renewal, {}), old = f.lane.mutate(renewal, {});
  const stop = f.lane.mutate(ordinary, {}), latest = f.lane.mutate(renewal, {});
  f.calls[0].done(); await first; await turn();
  assert.match(f.calls[1].url, /stop$/); f.calls[1].done(); await stop; await turn();
  assert.match(f.calls[2].url, /set$/); f.calls[2].done(); assert.deepEqual(await old, await latest);
});

test('window applies at call and dequeue using send time; stop closes it', async () => {
  const f = fixture(), first = f.lane.mutate(renewal, {}), queued = f.lane.mutate(renewal, {});
  f.tick(100); f.calls[0].done('result'); const previous = await first;
  assert.deepEqual(await queued, previous); assert.equal(f.calls.length, 1);
  assert.deepEqual(await f.lane.mutate(renewal, {}), previous);
  f.tick(900); const next = f.lane.mutate(renewal, {});
  assert.equal(f.calls.length, 2); f.calls[1].done(); await next;
  const stop = f.lane.mutate(ordinary, {}); f.calls[2].done(); await stop;
  const again = f.lane.mutate(renewal, {}); assert.equal(f.calls.length, 4); f.calls[3].done(); await again;
});

test('nonrenewals never coalesce or suppress; waiting is bounded at 256', async () => {
  const f = fixture(), first = f.lane.mutate(ordinary, {});
  const queued = Array.from({ length: 256 }, () => f.lane.mutate(ordinary, {}));
  assert.equal((await f.lane.mutate(ordinary, {})).why.code, 'E_RATE_LIMIT');
  f.calls[0].done(); await first;
  for (let i = 0; i < 256; i++) { await turn(); f.calls[i + 1].done(); await queued[i]; }
  assert.equal(f.calls.length, 257);
});

test('offline fails waiting and new calls immediately, without replay', async () => {
  const f = fixture(), first = f.lane.mutate(renewal, {}), queued = f.lane.mutate(ordinary, {});
  f.offline(); assert.equal((await queued).why.code, 'E_OFFLINE');
  assert.equal((await f.lane.mutate(renewal, {})).why.code, 'E_OFFLINE');
  f.calls[0].done(); await first; assert.equal(f.calls.length, 1);
});

test('rate/capacity refusals preserve online; malformed transport goes offline', async () => {
  for (const code of ['E_RATE_LIMIT', 'E_EPHEMERAL_FULL', 'E_RULE', 'E_GENERATION']) {
    const f = fixture(), result = f.lane.mutate(renewal, {}); f.calls[0].fail(code);
    assert.equal((await result).why.code, code); assert.equal(f.link(), 'online');
  }
  const f = fixture(), result = f.lane.mutate(renewal, {}); f.calls[0].reject(Error('lost'));
  assert.equal((await result).why.code, 'E_OFFLINE'); assert.equal(f.link(), 'offline');
});

test('argument custody and closed request settle without waiting for fetch', async () => {
  const f = fixture(), args = { a: 1 }, result = f.lane.mutate(renewal, args);
  args.a = 2; assert.equal(f.calls[0].body.args.a, 1);
  f.aborter.abort(); assert.equal((await result).why.code, 'E_CLOSED');
});
