import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalClient } from '../dist/local.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { ephemeralServer, device, api, until } from './helpers/ephemeral-server.mjs';

// @ref LLP 3000.017#47-tests — isolated phases keep durable commits from masking a lost ephemeral wake.
test('ephemeral typing: five real-server trials beside a durable typing control', { timeout: 90_000 }, async t => {
  const measurements = Array.from({ length: 5 }, (_, n) => ({ trial: n + 1 }));
  for (const phase of ['ephemeral', 'durable']) {
    const { url } = await ephemeralServer(t), polls = [];
    let sends = 0;
    const op = phase === 'ephemeral' ? api.setTyping : api.setDurableTyping;
    const query = phase === 'ephemeral' ? api.typingIn : api.durableTypingIn;
    const a = await createLocalClient({ url, persona: 'alice', device: device(), fetch: (input, init) => {
      if (new URL(input).pathname === `/m/${op.name}`) sends++;
      return defaultFetch(input, init);
    } });
    t.after(() => a.close());
    const b = await createLocalClient({ url, persona: 'bob', device: device(), fetch: async (input, init) => {
      const parsed = new URL(input);
      const poll = parsed.pathname === '/changes' ? { parameters: parsed.searchParams, signal: init.signal } : null;
      if (poll) polls.push(poll);
      const response = await defaultFetch(input, init);
      if (poll) void response.clone().json().then(answer => { poll.answer = answer; poll.at = performance.now(); }).catch(() => {});
      return response;
    } });
    t.after(() => b.close());
    await Promise.all([a.sync(), b.sync()]);
    for (const measure of measurements) {
      const room = `trial-${measure.trial}`, observation = b.observe(query, { room });
      t.after(() => observation.close());
      await until(() => observation.getSnapshot().data?.length === 0);
      let held;
      await until(() => (held = polls.findLast(p => !p.answer && !p.signal.aborted && p.parameters.get('ephi') &&
        (phase !== 'ephemeral' || p.parameters.get('ephTables') === 'typing'))), 'held peer poll');
      await delay(150); // Settle startup/incarnation queries; the next write must wake this poll.
      if (phase === 'ephemeral') assert.equal(held.answer, undefined);
      const times = { first: null, gone: null };
      let delivery;
      const stop = observation.subscribe(() => {
        const read = observation.getSnapshot();
        if (!('data' in read)) return;
        if (read.data.length && times.first === null) {
          times.first = performance.now();
          delivery = polls.findLast(p => p.answer && p.at <= times.first);
        }
        if (!read.data.length && times.first !== null && times.gone === null) times.gone = performance.now();
      });
      const before = sends, outcomes = [], firstCall = performance.now();
      let lastCall = firstCall;
      for (let key = 0; key < 45; key++) {
        lastCall = performance.now();
        outcomes.push(a.mutate(op, { room }));
        if (key < 44) await delay(25);
      }
      const results = await Promise.all(outcomes);
      if (phase === 'ephemeral') {
        for (const result of results) assert.equal(result.state, 'sent', JSON.stringify(result));
        await until(() => times.gone !== null, `${phase} trial ${measure.trial} disappears`);
      } else {
        // The durable control is measured, including a possible missed bound.
        const deadline = performance.now() + 5500;
        while (times.gone === null && performance.now() < deadline) await delay(10);
      }
      const ms = n => Math.round(n * 1000) / 1000;
      measure[`${phase}FirstMs`] = times.first === null ? null : ms(times.first - firstCall);
      measure[`${phase}GoneAfterLastMs`] = times.gone === null ? null : ms(times.gone - lastCall);
      measure[`${phase}Requests`] = sends - before;
      if (phase === 'ephemeral') {
        assert.ok(measure.ephemeralFirstMs <= 500, JSON.stringify(measure));
        assert.ok(measure.ephemeralGoneAfterLastMs >= 0 && measure.ephemeralGoneAfterLastMs <= 4500, JSON.stringify(measure));
        assert.ok(measure.ephemeralRequests <= 4, JSON.stringify(measure));
        assert.ok(delivery?.at >= firstCall, 'first sight follows a change answer');
        assert.ok(delivery.answer.ephemeral.tables.includes('typing'), JSON.stringify(delivery.answer));
        assert.equal(delivery.answer.seq, Number(held.parameters.get('since')), 'ephemeral delivery leaves seq unchanged');
        assert.equal(delivery.answer.seq, Number(delivery.parameters.get('since')));
      } else t.diagnostic(JSON.stringify(measure));
      stop(); observation.close();
    }
    await a.close(); await b.close();
  }
  t.diagnostic(`EPHEMERAL_ACCEPTANCE=${JSON.stringify(measurements)}`);
});
