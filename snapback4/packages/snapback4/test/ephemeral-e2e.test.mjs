import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalClient } from '../dist/local.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { ephemeralServer, device, api, until } from './helpers/ephemeral-server.mjs';

// @ref LLP 3000.017#47-tests — the benchmark's 45 keystrokes, two real wasm clients, five trials.
test('ephemeral typing: five real-server trials beside a durable typing control', { timeout: 60_000 }, async t => {
  const { url } = await ephemeralServer(t), polls = [];
  let ephemeralSends = 0, durableSends = 0;
  const a = await createLocalClient({ url, persona: 'alice', device: device(), fetch: (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/m/setTyping') ephemeralSends++;
    if (path === '/m/setDurableTyping') durableSends++;
    return defaultFetch(input, init);
  } });
  t.after(() => a.close());
  const b = await createLocalClient({ url, persona: 'bob', device: device(), fetch: (input, init) => {
    const parsed = new URL(input);
    if (parsed.pathname === '/changes') polls.push({ parameters: parsed.searchParams, signal: init.signal });
    return defaultFetch(input, init);
  } });
  t.after(() => b.close());
  await Promise.all([a.sync(), b.sync()]);
  const measurements = [];
  for (let trial = 1; trial <= 5; trial++) {
    const room = `trial-${trial}`;
    const control = b.observe(api.durableTypingIn, { room });
    t.after(() => control.close());
    await until(() => control.getSnapshot().data?.length === 0);
    await until(() => polls.some(p => !p.signal.aborted && p.parameters.get('ephi') && p.parameters.get('ephTables') === ''));
    const held = polls.findLast(p => !p.signal.aborted);
    await delay(30); // Poll predates ephemeral observation and is held at the server.
    const typing = b.observe(api.typingIn, { room });
    t.after(() => typing.close());
    await until(() => typing.getSnapshot().data?.length === 0);
    assert.equal(held.signal.aborted, true, 'mounting typing retires the pre-existing poll');
    const record = observation => {
      const times = { first: null, gone: null };
      const stop = observation.subscribe(() => {
        const read = observation.getSnapshot();
        if (!('data' in read)) return; // Loading is not an authoritative disappearance.
        if (read.data.length && times.first === null) times.first = performance.now();
        if (!read.data.length && times.first !== null && times.gone === null) times.gone = performance.now();
      });
      return { times, stop };
    };
    const eph = record(typing), durable = record(control), outcomes = [];
    const beforeEph = ephemeralSends, beforeDurable = durableSends;
    const firstCall = performance.now();
    let lastCall = firstCall;
    for (let key = 0; key < 45; key++) {
      lastCall = performance.now();
      outcomes.push(a.mutate(api.setTyping, { room }));
      outcomes.push(a.mutate(api.setDurableTyping, { room }));
      if (key < 44) await delay(25);
    }
    const results = await Promise.all(outcomes);
    for (let i = 0; i < results.length; i += 2) assert.equal(results[i].state, 'sent', JSON.stringify(results[i]));
    await until(() => eph.times.gone !== null, `ephemeral trial ${trial} disappears`);
    // The control is measured only. Missing a timing bound is not an assertion.
    const controlUntil = performance.now() + 5500;
    while (durable.times.gone === null && performance.now() < controlUntil) await delay(10);
    const ms = value => value === null ? null : Math.round(value * 1000) / 1000;
    const measure = { trial,
      ephemeralFirstMs: ms(eph.times.first - firstCall), ephemeralGoneAfterLastMs: ms(eph.times.gone - lastCall),
      durableFirstMs: durable.times.first === null ? null : ms(durable.times.first - firstCall),
      durableGoneAfterLastMs: durable.times.gone === null ? null : ms(durable.times.gone - lastCall),
      ephemeralRequests: ephemeralSends - beforeEph, durableRequests: durableSends - beforeDurable };
    measurements.push(measure); t.diagnostic(JSON.stringify(measure));
    assert.ok(measure.ephemeralFirstMs <= 500, JSON.stringify(measure));
    assert.ok(measure.ephemeralGoneAfterLastMs <= 4500, JSON.stringify(measure));
    eph.stop(); durable.stop(); typing.close(); control.close();
    // Shrinking never restarts a poll. A durable change ends the previous
    // interest's poll so the next trial can begin with an empty held interest.
    const wake = await a.mutate(api.add, { body: `between trials ${trial}` });
    assert.equal(wake.state, 'sent');
  }
  t.diagnostic(`EPHEMERAL_ACCEPTANCE=${JSON.stringify(measurements)}`);
});
