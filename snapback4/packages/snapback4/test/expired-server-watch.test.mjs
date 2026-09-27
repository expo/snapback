// @ref LLP 3000.019#3.3 — an expired fallback is withheld while the live watch recovers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { ServerClock } from '../dist/clock.js';
import { ephemeralServer, device, api, until } from './helpers/ephemeral-server.mjs';

for (const ending of ['recover', 'close watch', 'close client']) {
  for (const keep of ending === 'close watch' ? [false] : [undefined, false, true]) {
    test(`expired server replies: ${ending}, keep=${keep}`, async t => {
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
      await until(() => requests.length >= 5, 'paced expired-response retries');
      assert.equal(peak, 1, 'one request at a time per watch');
      for (let n = 1; n < 5; n++) assert.ok(requests[n] - requests[n - 1] >= 25 * 2 ** (n - 1) - 2,
        `retry ${n} must back off: ${JSON.stringify(requests)}`);
      assert.ok(values.every(read => !('data' in read)), 'expired replies never publish');
      if (ending === 'recover') {
        assert.equal((await writer.mutate(api.stopTyping, { room: 'r' })).state, 'sent');
        replay = false;
        await until(() => watch.getSnapshot().data?.length === 0, 'recovered authoritative empty answer');
        assert.equal(watch.getSnapshot().complete, true);
        assert.equal(watch.getSnapshot().fresh, true);
      } else if (ending === 'close watch') watch.close();
      else await client.close();
      const count = requests.length;
      await delay(1100); // Beyond even the capped retry delay.
      assert.equal(requests.length, count, `${ending} stops expiry retries`);
    });
  }
}
