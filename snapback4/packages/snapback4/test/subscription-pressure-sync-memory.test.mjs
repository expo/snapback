// Astra's round-4 sync-only reproduction, plus commitment and notification boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { fixture, source, open, opener, q, until, parked, sdk } from './helpers/answers-stay.mjs';
const { guardClient } = await import(new URL('app-client.js', sdk));
const { RememberedAnswers } = await import(new URL('local-reads.js', sdk));

for (const tier of ['wasm', 'process']) for (const mode of ['publication', 'commit-then-throw', 'recovery-after-lost-ack', 'unknown-footprint', 'housekeeping-footprint', 'nonempty-footprint', 'empty-notification']) {
  test(`${tier}: ownerless server memory is retired by ${mode}`, async t => {
    let program = source.replace("table profiles:\n  name: text\n  read <- allow", "table profiles:\n  name: text\n  read <- .name = 'Bob'\n  update <- allow") + `
query hasProfile():
  return {present: exists profiles['bob'], secret: profiles['bob']}
mutation eraseProfile():
  update profiles['bob'] {name: 'revoked'}
`;
    if (mode === 'nonempty-footprint') program = program.replace("update profiles['bob'] {name: 'revoked'}", "update profiles['bob'] {name: 'revoked'}\n  update messages['item'] {body: 'unrelated'}");
    if (mode === 'housekeeping-footprint') program += `\ntable hints:\n  room: text <=40\n  principal: principal\n  unique room, principal\n  read <- exists members[.room, viewer]\n  ephemeral 4s\n`;
    const f = await fixture(t, program), feed = Promise.withResolvers();
    const base = opener(tier, join(f.dir, 'device'));
    let sent = false, offline = false, memory, arm = false, intercepted = false, holdSync = false, notified = false;
    const pages = [];
    const oldSet = RememberedAnswers.prototype.set;
    t.mock.method(RememberedAnswers.prototype, 'set', function (...args) { memory = this; return oldSet.apply(this, args); });
    const client = await open(t, f, tier, {
      fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (path === '/changes') {
          if (sent) return parked(init.signal);
          sent = true;
          const reply = await Promise.race([feed.promise, parked(init.signal)]);
          notified = true; return Response.json(reply);
        }
        if (path === '/sync' && holdSync) return parked(init.signal);
        if (offline) throw Error('offline');
        const response = await fetch(input, init);
        if (path === '/sync') { const page = await response.clone().json(); pages.push({ watermark: page.watermark, events: page.events?.length }); }
        return response;
      },
      device: { async open(...args) {
        const core = await base.open(...args);
        return { ...core, async call(req, commit) {
          const alter = arm && req.op === 'apply' && req.page.watermark > req.page.captured_watermark;
          const reported = result => alter && mode === 'unknown-footprint' ? { ...result, ok: { ...result.ok, touched: undefined } } : result;
          const result = await core.call(req, value => { if (!(alter && mode === 'recovery-after-lost-ack')) commit?.(reported(value)); });
          if (alter) {
            intercepted = true; arm = false;
            if (mode === 'commit-then-throw') { commit?.(reported(result)); throw Error('after committed publication'); }
            if (mode === 'recovery-after-lost-ack') throw Error('after committed publication');
          }
          return reported(result);
        } };
      } },
    });
    const watch = client.observe(q('hasProfile'), {});
    watch.subscribe(() => {}); t.after(() => watch.close());
    await until(() => watch.getSnapshot().data?.secret?.name === 'Bob');
    const facade = guardClient(client, async () => true, () => true, () => ({ code: 'E_AUTH', family: 'auth', message: 'ended' }));
    const view = facade.client.observe(q('hasProfile'), {}); view.subscribe(() => {});
    t.after(() => { view.close(); facade.fence()(); });
    await until(() => view.getSnapshot().data?.secret?.name === 'Bob');
    view.close(); watch.close();
    assert.equal(memory.get('hasProfile:{}')?.read.data.secret.name, 'Bob');
    const removal = await f.post('/m/eraseProfile', { id: 'remove', args: {} });
    assert.equal(removal.state, 'sent');
    if (mode === 'empty-notification') {
      holdSync = true;
      feed.resolve({ seq: removal.seq, tables: [], store_id: removal.store_id, generation: 1 });
      await until(() => notified);
      // Give acceptance its turn; sync remains held for the complete stale-display window.
      await delay(25);
    } else {
      arm = true;
      await client.sync().catch(error => { assert.ok(['commit-then-throw', 'recovery-after-lost-ack'].includes(mode)); assert.match(String(error), /after committed publication/); });
      if (mode === 'recovery-after-lost-ack') await client.sync(); // The committed watermark is now captured before a no-op apply.
      assert.ok(intercepted, 'the real advancing apply crossed the controlled boundary');
      assert.ok(pages.some(page => page.watermark === 2 && (mode === 'nonempty-footprint' ? page.events > 0 : page.events === 0)));
    }
    const authoritative = await f.post('/q/hasProfile', { args: {} }, 'bob');
    assert.deepEqual(authoritative.data, { present: false, secret: null });
    const before = watch.getSnapshot(), remembered = memory.get('hasProfile:{}');
    offline = true;
    const events = []; watch.subscribe(() => events.push(watch.getSnapshot()));
    await delay(1250);
    const after = watch.getSnapshot(), direct = await client.query(q('hasProfile'), {});
    t.diagnostic(JSON.stringify({ mode, pages, authoritative: authoritative.data, before, after, direct, remembered: remembered?.read }));
    assert.notEqual(after.data?.secret?.name, 'Bob', 'revoked content cannot recover after watermark evidence');
    assert.notEqual(direct.data?.secret?.name, 'Bob', 'direct reads cannot recover revoked memory');
    assert.equal(remembered, undefined, 'invalidation does not require a live owner');
    assert.ok(!('data' in before), 'closed getter discards its saved answer');
    assert.ok(events.every(read => read.data?.secret?.name !== 'Bob'), 'no transient callback can republish revoked memory');
    assert.ok(!('data' in view.getSnapshot()), 'closed facade cannot retain its approved old answer');
    assert.notEqual((await facade.client.query(q('hasProfile'), {})).data?.secret?.name, 'Bob');
  });
}
