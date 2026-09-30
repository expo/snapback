// @ref LLP 3000.019#3.3 — an expired fallback is withheld while the live watch recovers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { ReadWork } from '../dist/read-work.js';
import { ServerClock } from '../dist/clock.js';
import { ephemeralServer, device, api, until } from './helpers/ephemeral-server.mjs';

for (const ending of ['recover', 'close watch', 'close client']) {
  for (const keep of [undefined, false, true]) {
    test(`expired server replies: ${ending}, keep=${keep}`, async t => {
      const { url } = await ephemeralServer(t);
      const writer = createClient({ url, persona: 'alice' });
      t.after(() => writer.close());
      let replay = true, captured, active = 0, peak = 0, invalidate = false;
      const requests = [];
      // A frozen estimate and replayed real reply keep every retry expired,
      // independently of scheduler speed or server expiry maintenance.
      const clock = new ServerClock(() => Date.now() + 60_000);
      const client = await createLocalClient({ url, persona: 'bob', device: device(), fetch: clock.wrap(async (input, init) => {
        const path = new URL(input).pathname;
        if (path === '/changes') return new Promise((_, reject) => {
          if (init.signal.aborted) reject(init.signal.reason);
          else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
        if (path !== '/q/typingIn') {
          const response = await defaultFetch(input, init);
          const headers = new Headers(response.headers); headers.delete('x-snapback-time');
          return new Response(response.body, { status: response.status, headers });
        }
        requests.push(performance.now()); peak = Math.max(peak, ++active);
        try {
          const response = await defaultFetch(input, init), answer = await response.json();
          // Force a commit between the first watch request and its reply. That
          // request must be rerun through the authority fence, without expiry
          // backoff: request-arrival gaps cannot identify expiry retries.
          if (invalidate) { invalidate = false; await client.sync(); }
          if (!captured) {
            assert.deepEqual(answer.data, [{ principal: 'dev:alice' }]);
            assert.ok(answer.nextExpiry < Date.now() + 60_000);
            captured = answer;
          }
          return Response.json(replay ? captured : answer);
        } finally { active--; }
      }) });
      t.after(() => client.close());
      await client.sync();
      assert.equal((await writer.mutate(api.setTyping, { room: 'r' })).state, 'sent');
      // Finish incarnation discovery before measuring only expiry retries.
      assert.equal((await client.query(api.typingIn, { room: 'r' })).denied?.code, client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
      requests.length = 0; peak = 0; invalidate = true;
      const context = new AsyncLocalStorage();
      const timerContext = {};
      const timers = [];
      const realTimeout = globalThis.setTimeout;
      const realRetry = ReadWork.prototype.retry;
      let schedulingRetry = false;
      t.mock.method(ReadWork.prototype, 'retry', function (...args) {
        const previous = schedulingRetry;
        schedulingRetry = context.getStore() === timerContext;
        try { return realRetry.apply(this, args); }
        finally { schedulingRetry = previous; }
      });
      t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
        // Only synchronous timer creation by this watch's real ReadWork.retry
        // belongs to us. Undici inherits the watch's async context too, and its
        // idle timer can equal the retry cap; neither context nor delay is an owner.
        if (!schedulingRetry) return realTimeout(callback, ms, ...args);
        // Keep the product's requested delay; this test, not host scheduling,
        // releases its callback after checking the wait and single-flight state.
        const handle = realTimeout(() => {}, ms);
        clearTimeout(handle);
        timers.push({ ms, fire() { clearTimeout(handle); context.run(timerContext, () => callback(...args)); } });
        return handle;
      });
      t.after(() => { for (const timer of timers) timer.fire(); });
      const watch = context.run(timerContext, () => client.observe(api.typingIn, { room: 'r' }, { keep }));
      t.after(() => watch.close());
      const values = [];
      context.run(timerContext, () => watch.subscribe(() => values.push(watch.getSnapshot())));
      const expected = [25, 50, 100, 200, 400, 800, 1000, 1000];
      for (const [n, ms] of expected.entries()) {
        await until(() => timers.length > n, 'scheduled expired-response retry');
        assert.equal(timers.length, n + 1, 'one pending retry per watch');
        assert.equal(timers[n].ms, ms, 'expiry retry doubles to the one-second cap');
        const count = requests.length;
        await delay(0); // Let a late event-loop turn pass with the timer held.
        assert.equal(requests.length, count, 'no retry before its scheduled timer fires');
        assert.equal(peak, 1, 'one request at a time per watch');
        if (n < expected.length - 1) timers[n].fire();
      }
      assert.ok(values.every(read => !('data' in read)), 'expired replies never publish');
      if (ending === 'recover') {
        // The priming one-shot now completes its retry rounds. Renew the
        // four-second fixture row so deletion tests recovery, not wall time.
        assert.equal((await writer.mutate(api.setTyping, { room: 'r' })).state, 'sent');
        const stopped = await writer.mutate(api.stopTyping, { room: 'r' });
        assert.equal(stopped.state, 'sent', JSON.stringify(stopped));
        replay = false; timers.at(-1).fire();
        await until(() => watch.getSnapshot().data?.length === 0, 'recovered authoritative empty answer');
        assert.equal(watch.getSnapshot().complete, true);
        assert.equal(watch.getSnapshot().fresh, true);
      } else if (ending === 'close watch') watch.close();
      else await client.close();
      const count = requests.length;
      if (ending !== 'recover') timers.at(-1).fire();
      await delay(1100); // Beyond even the capped retry delay.
      assert.equal(requests.length, count, `${ending} stops expiry retries`);
      assert.equal(timers.length, 8, `${ending} schedules no further expiry retries`);
    });
  }
}

// Keep KG's warm-candidate withdrawal coverage beside FX's scheduled retry checks.
for (const keep of [undefined, false, true]) {
  test(`expired warm server answer withdraws before retry, keep=${keep}`, async t => {
      const { url } = await ephemeralServer(t);
      const writer = createClient({ url, persona: 'alice' });
      t.after(() => writer.close());
      let replay = false, captured, active = 0, peak = 0, watch, expiredReplies = 0;
      const requests = [];
      // A frozen estimate and replayed real reply keep every retry expired,
      // independently of scheduler speed or server expiry maintenance.
      const clock = new ServerClock(() => Date.now() + (replay ? 60_000 : 0));
      const client = await createLocalClient({ url, persona: 'bob', device: device(), fetch: clock.wrap(async (input, init) => {
        const path = new URL(input).pathname;
        if (path === '/changes') return new Promise((_, reject) => {
          if (init.signal.aborted) reject(init.signal.reason);
          else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
        if (path !== '/q/typingIn') {
          const response = await defaultFetch(input, init);
          const headers = new Headers(response.headers); headers.delete('x-snapback-time');
          return new Response(response.body, { status: response.status, headers });
        }
        if (replay && ++expiredReplies > 1) assert.deepEqual(watch.getSnapshot(), { loading: true }, 'expired candidate withdrew before retry backoff');
        requests.push(performance.now()); peak = Math.max(peak, ++active);
        try {
          const response = await defaultFetch(input, init), answer = await response.json();
          if (!captured) {
            assert.deepEqual(answer.data, [{ principal: 'dev:alice' }]);
            assert.ok(answer.nextExpiry < Date.now() + 60_000);
            captured = answer;
          }
          return Response.json(replay ? captured : { ...answer, nextExpiry: answer.nextExpiry == null ? null : answer.nextExpiry + 3_600_000 });
        } finally { active--; }
      }) });
      t.after(() => client.close());
      await client.sync();
      assert.equal((await writer.mutate(api.setTyping, { room: 'r' })).state, 'sent');
      // Finish incarnation discovery before measuring only expiry retries.
      await client.query(api.typingIn, { room: 'r' });
      requests.length = 0; peak = 0;
      watch = client.observe(api.typingIn, { room: 'r' }, { keep });
      t.after(() => watch.close());
      const values = [];
      watch.subscribe(() => values.push(watch.getSnapshot()));
      await until(() => watch.getSnapshot().data?.[0]?.principal === 'dev:alice', 'warm authorized answer');
      requests.length = 0;
      replay = true;
      // Re-run the warm watch while every real server reply is already expired.
      await client.sync();
      await until(() => watch.getSnapshot().loading, 'expired reply hard-withdraws the warm answer');
      values.length = 0;
      await until(() => expiredReplies >= 2, 'expired warm answer stays withdrawn during retry');
      assert.equal(peak, 1, 'one request at a time per watch');
      assert.ok(values.every(read => !('data' in read)), 'expired replies never publish');
  });
}
