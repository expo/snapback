// @ref LLP 3000.023#10 — continuous same-cut sync cannot starve a whole server answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sdk, fixture, opener, source, q, parked, until } from './helpers/answers-stay.mjs';
import { hangBudget } from './helpers/wait.mjs';
const { createLocalClient } = await import(new URL('local.js', sdk));

for (const host of ['process', 'wasm']) test(`${host}: publish a matching reply despite sync before every response`, { timeout: hangBudget(12) }, async t => {
  const f = await fixture(t, source.replace('table profiles:\n', 'table profiles:\n  update <- allow\n') + `
mutation rename(name: text):
  update profiles['bob'] { name }
`);
  let active = false, responses = 0, client;
  const exhausted = Promise.withResolvers(), published = Promise.withResolvers();
  client = await createLocalClient({ url: f.url, persona: 'bob', device: opener(host, join(f.dir, host)),
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return parked(init.signal);
      const response = await fetch(input, init);
      if (path === '/q/profile' && active) {
        // The body is already authoritative. Every attempt now crosses an
        // actual published apply at that same cut before receiving the body.
        const json = await response.json();
        assert.equal(json.data.name, 'new');
        await client.sync();
        responses++;
        if (responses === 6) { active = false; exhausted.resolve(); }
        return Response.json(json);
      }
      return response;
    } });
  t.after(() => client.close()); await client.sync();
  const watch = client.observe(q('profile'), {});
  t.after(() => watch.close());
  watch.subscribe(() => { if (watch.getSnapshot().data?.name === 'new') { active = false; published.resolve(); } });
  await until(() => watch.getSnapshot().data?.name === 'Bob', 'initial server answer');
  assert.equal((await f.post('/m/rename', { id: 'rename', args: { name: 'new' } })).state, 'sent');
  active = true;
  await client.sync();
  await Promise.race([published.promise, exhausted.promise]);
  assert.equal(watch.getSnapshot().data?.name, 'new', 'same-cut evidence must not discard every matching reply');
  assert.equal(responses, 1, 'the first matching response covers its intervening sync');
});
