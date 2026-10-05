// Paired OP ordinary live latency, adapted from RH round 1. Both clients observe each same mutation.
// @ref LLP 3000.023#10 — ordinary routing and publication control.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const oldSdk = new URL('../../target/op/sdk-before/', import.meta.url);
const { createLocalClient: baseline } = await import(new URL('dist/local.js', oldSdk));
const { webDevice, memoryPersistence } = await import(new URL('dist/web.js', oldSdk));
const { processDevice } = await import(new URL('dist/native.js', oldSdk));
const oldBinary = fileURLToPath(new URL('../../target/debug/snapback4', import.meta.url));
const oldOpener = (host, dir) => host === 'process' ? processDevice({ binary: oldBinary, dir })
  : webDevice({ wasm: readFileSync(new URL('dist/wasm/snapback4_device_bg.wasm', oldSdk)), persist: memoryPersistence() });
import { createLocalClient as fixed } from '../../target/op/sdk-final4/dist/local.js';
import { fixture, source, opener, q, until } from '../../packages/snapback4/test/helpers/answers-stay.mjs';
const rows = [];
const runs = Number(process.env.RH_RUNS ?? 100);
const output = process.env.RH_OUT ?? '../../target/op/ordinary-paired.json';
const program = source.replace('  sync to members[.room]\ntable profiles:', '  retain delivered-history\n  sync to members[.room] last 1 by byRoom\ntable profiles:')
  .replace("return messages['room'] first 100", "return messages['room'] last 100")
  .replace('table profiles:\n  name: text\n  read <- allow', 'table profiles:\n  name: text\n  read <- allow\n  update <- allow') + `
mutation editProfile(name: text): server
  update profiles['bob'] { name }
`;
for (const host of ['wasm', 'process']) for (const mode of (process.env.RH_MODES?.split(',') ?? ['known-local', 'server-only-source', 'current-history-fallback', 'current-search'])) {
  test(`${host} ${mode}: ${runs} paired mutations`, async t => {
    const f = await fixture(t, mode === 'current-search' ? program.replace('table messages:', 'table messages:\n  immutable room').replace('  by byRoom: room, at, id', '  by byRoom: room, at, id\n  search body') + '\nquery search(q: text <=200, c: cursor?):\n  return messages matching q last 100 by .at after c\n' : program);
    assert.equal((await f.post('/seed', [{ table: 'messages', row: { id: 'older', room: 'room', body: 'older', at: 0 } }])).seeded, 1);
    const readers = [];
    const name = mode === 'current-search' ? 'search' : mode === 'known-local' ? 'item' : mode === 'server-only-source' ? 'profile' : 'history';
    const factories = host === 'wasm' ? [['baseline', baseline], ['fixed', fixed]] : [['fixed', fixed], ['baseline', baseline]];
    if (process.env.RH_REVERSE) factories.reverse();
    for (const [label, open] of factories) {
      const client = await open({ url: f.url, persona: 'bob', waitSeconds: 1, device: (label === 'baseline' ? oldOpener : opener)(host, join(f.dir, `${host}-${label}`)) });
      t.after(() => client.close()); await client.sync();
      const watch = client.observe(q(name), name === 'search' ? { q: 'image', c: null } : name === 'history' ? { c: null } : {});
      t.after(() => watch.close());
      let expected, done, started;
      const samples = [];
      const value = read => ['search','history'].includes(name) ? read.data?.[0]?.body : name === 'profile' ? read.data?.name : read.data?.body;
      watch.subscribe(() => {
        const read = watch.getSnapshot();
        if (done && value(read) === expected && read.complete && !read.revalidating) {
          samples.push(performance.now() - started); const resolve = done; done = undefined; resolve();
        }
      });
      await until(() => watch.getSnapshot().data && watch.getSnapshot().complete, 'initial ordinary answer');
      readers.push({ client, label, samples, arm(value, at) { expected = value; started = at; return new Promise(resolve => { done = resolve; }); } });
    }
    for (let index = 0; index < runs + 10; index++) {
      // Keep each trial's initial partition current; both clients see the same
      // next commit, network path and host load. Ten warm-up trials are dropped.
      await Promise.all(readers.map(r => r.client.sync()));
      const value = `${name === 'search' ? 'image ' : ''}value-${index}`, started = performance.now();
      const deliveries = readers.map(r => r.arm(value, started));
      const mutation = name === 'profile' ? 'editProfile' : 'edit';
      const reply = await f.post(`/m/${mutation}`, { id: `${mode}-${index}`, args: name === 'profile' ? { name: value } : { body: value } });
      assert.equal(reply.state, 'sent');
      await Promise.all(deliveries);
    }
    for (const reader of readers) {
      const samples = reader.samples.slice(10), sorted = [...samples].sort((a,b) => a-b);
      const row = { host, mode, label: reader.label, n: samples.length, p50: sorted[Math.ceil(samples.length*.5)-1], p95: sorted[Math.ceil(samples.length*.95)-1], max: sorted.at(-1), samples };
      rows.push(row); console.log(JSON.stringify({ ...row, samples: undefined }));
    }
    writeFileSync(new URL(output, import.meta.url), JSON.stringify(rows, null, 2)+'\n');
  });
}
