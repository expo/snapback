// @ref LLP 3000.029#13 — current-replica answers do not create remote apply fences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { binary, server, until } from './helpers/app-server.mjs';
import { parkedChanges } from './helpers/sync-control.mjs';
const q = name => ({ kind: 'query', name });
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const schema = `use personas alice
table docs:
  body: text
  read <- allow
  sync public
query doc(id: docs) held:
  return docs[id] ! else NOT_FOUND
query timed(cutoff: time) held:
  require now >= cutoff else APP_DENIED
  return docs['present']
`;
async function fixture(t, tier, options = {}) {
  const f = await server(t, undefined, options.source ?? schema, options.serverOptions);
  assert.equal((await fetch(f.url + '/seed', { method: 'POST', body: JSON.stringify([
    { table: 'docs', row: { id: 'present', body: 'present' } },
  ]) }).then(r => r.json())).seeded, 1);
  let http = 0, syncs = 0;
  const opener = tier === 'process' ? processDevice({ dir: join(f.dir, 'device'), binary })
    : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
  const client = await createLocalClient({ url: f.url, persona: 'alice',
    device: { async open(...args) {
      const core = await opener.open(...args);
      return { ...core, async call(request, ...rest) {
        const reply = await core.call(options.request?.(request) ?? request, ...rest);
        return options.reply ? options.reply(request, reply) : reply;
      } };
    } },
    fetch(input, init) {
      const path = new URL(input).pathname;
      if (path === '/changes') return parkedChanges(init.signal);
      if (path.startsWith('/q/')) http++;
      if (path === '/sync') syncs++;
      return fetch(input, init);
    },
  });
  t.after(() => client.close());
  await client.sync();
  return { client, http: () => http, syncs: () => syncs };
}
for (const tier of ['process', 'wasm']) test(`round 11 ${tier}: local denial leaves acquired held reads runnable`, async t => {
  const f = await fixture(t, tier), op = q('doc'), args = { id: 'present' };
  const watch = f.client.observe(op, args); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data?.body === 'present');
  const snapshots = []; watch.subscribe(() => snapshots.push(watch.getSnapshot()));
  const syncs = f.syncs();
  for (let n = 0; n < 5; n++) {
    assert.equal((await f.client.query(op, { id: 'missing' })).denied?.code, 'NOT_FOUND');
    assert.equal((await f.client.query(op, args)).data?.body, 'present');
    assert.equal(watch.getSnapshot().data?.body, 'present');
  }
  assert.ok(snapshots.every(read => read.data?.body === 'present'), 'another argument cannot withdraw this current local answer');
  assert.equal(f.http(), 0); assert.equal(f.syncs(), syncs, 'no extra sync discharges local evidence');
});

// Native uses the actual guest clock on process; Quarry exercises the same
// evaluated denial on both substrates, without HTTP fallback.
for (const [tier, native] of [['process', false], ['wasm', false], ['process', true]]) {
  test(`round 11 ${tier}${native ? ' native' : ''}: older local denial cannot replace newer local success`, { timeout: 120000 }, async t => {
    const cutoff = Date.now() + 60000, held = gate(), arrived = gate();
    let now = cutoff - 1, buffer = true;
    t.after(() => held.resolve());
    const root = new URL('../../../', import.meta.url).pathname;
    const serverOptions = native ? { startupTimeout: 90000, prepare(dir) {
      const path = join(dir, 'snapback/native'); mkdirSync(join(path, 'src'), { recursive: true });
      writeFileSync(join(path, 'Cargo.toml'), readFileSync(join(root, 'native-fixtures/following/Cargo.toml'), 'utf8')
        .replace('sb4-fixture-following', 'sb4-fixture-local-publication-order')
        .replace('../../crates/snapback4-native', join(root, 'crates/snapback4-native')));
      writeFileSync(join(path, 'src/lib.rs'), `use snapback4_native::{Ctx, Json, Result, Error};
snapback4_native::module! { reads: [timed] }
fn timed(ctx: &Ctx, args: &Json) -> Result<Json> {
    if ctx.now()? < args["cutoff"].as_i64().unwrap() {
        return Err(Error::new("APP_DENIED", "before local cutoff"));
    }
    Ok(ctx.get("docs", "present")?.map(Json::Object).unwrap_or(Json::Null))
}`);
      mkdirSync(join(dir, 'snapback/generated'), { recursive: true });
      mkdirSync(join(root, 'target/native-fixture'), { recursive: true });
      symlinkSync(join(root, 'target/native-fixture'), join(dir, 'snapback/generated/native-target'), 'dir');
    } } : undefined;
    const f = await fixture(t, tier, { serverOptions,
      source: native ? schema.replace(/query timed[\s\S]*/, 'query timed(cutoff: time): native\n') : schema,
      request: request => request.op === 'query' ? { ...request, now } : request,
      async reply(request, reply) {
        if (buffer && request.op === 'query' && request.name === 'timed') {
          buffer = false;
          assert.equal((reply.denied ?? reply.ok?.denied)?.code, 'APP_DENIED', 'real device evaluated the early denial');
          arrived.resolve(); await held.promise;
        }
        return reply;
      },
    });
    const op = q('timed'), args = { cutoff }, syncs = f.syncs();
    const old = f.client.query(op, args); await arrived.promise;
    now = cutoff;
    const watch = f.client.observe(op, args); watch.subscribe(() => {}); t.after(() => watch.close());
    await until(() => watch.getSnapshot().data?.body === 'present');
    assert.equal((await f.client.query(op, args)).data?.body, 'present');
    const snapshots = []; watch.subscribe(() => snapshots.push(watch.getSnapshot()));
    held.resolve(); await old;
    assert.equal(watch.getSnapshot().data?.body, 'present');
    assert.ok(snapshots.every(read => read.data?.body === 'present'));
    assert.equal(f.http(), 0); assert.equal(f.syncs(), syncs);
  });
}
