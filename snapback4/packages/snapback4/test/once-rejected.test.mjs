// @ref LLP 3000.023#12 — disclosure is mandatory even without a retention plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { fixture, source, open, opener, q } from './helpers/answers-stay.mjs';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const program = source.replace('table messages:\n', 'table messages:\n  photo: image <=10000 once ?\n  other: image <=10000 once ?\n  photos: [[image <=10000 once] <=2] <=2 ?\n') + `
mutation place(photo: image <=10000, photos: [[image <=10000] <=2] <=2 ?):
  update messages['item'] { photo, photos }
mutation clearPhoto():
  update messages['item'] { photo: null, photos: null }
query nativeRows(): native
query nativeHandle(): native
query filtered():
  return messages[] where .photo != null first 10 by byId
query filteredRows():
  return messages[] where .body != '' first 10 by byId
query ranged():
  return messages['room'] where .at >= 0 first 10 by byRoom
query existence():
  require exists messages['item'] else MISSING
  return messages['item']
query derivedHandle():
  row = messages['item']
  return row.photo
query derivedFacts():
  row = messages['item']
  return row.photo.width if row.photo != null else null
`;
async function prepare(t) {
  const f = await fixture(t, program, { prepare(dir) {
    const native = join(dir, 'snapback/native'); mkdirSync(join(native, 'src'), { recursive: true });
    const sdk = process.env.ON_TEST_NATIVE_SDK ?? resolve(import.meta.dirname, '../../../crates/snapback4-native');
    writeFileSync(join(native, 'Cargo.toml'), `[package]\nname = "once-review-native"\nversion = "0.0.0"\nedition = "2024"\n[workspace]\n[lib]\ncrate-type = ["cdylib"]\n[dependencies]\nsnapback4-native = { path = ${JSON.stringify(sdk)} }\n`);
    writeFileSync(join(native, 'src/lib.rs'), `use snapback4_native::{Ctx, Json, Order, Result, json};
snapback4_native::module! { reads: [nativeRows, nativeHandle] }
#[allow(non_snake_case)] fn nativeRows(ctx: &Ctx, _: &Json) -> Result<Json> { Ok(json!(ctx.scan("messages", "byId", &[], Order::Asc, 10, None)?.rows)) }
#[allow(non_snake_case)] fn nativeHandle(ctx: &Ctx, _: &Json) -> Result<Json> { Ok(ctx.lookup("messages", "byId", &[json!("item")])?.and_then(|r|r.get("photo").cloned()).unwrap_or(Json::Null)) }
`);
    // Reuse compilation only; each test still opens a fresh store and server.
    const target = join(process.env.CARGO_TARGET_DIR ?? resolve(import.meta.dirname, '../../../target'), 'once-review-native');
    mkdirSync(target, { recursive: true }); mkdirSync(join(dir, 'snapback/generated'), { recursive: true });
    symlinkSync(target, join(dir, 'snapback/generated/native-target'));
  } });
  const upload = async () => (await fetch(f.url + '/assets', { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: png }).then(r => r.json())).asset;
  const [scalar, viewed, live] = [await upload(), await upload(), await upload()];
  const placed = await f.post('/m/place', { id: 'place', args: { photo: { id: scalar.id }, photos: [[{ id: viewed.id }, { id: live.id }]] } });
  assert.equal(placed.state, 'sent', JSON.stringify(placed));
  return { ...f, scalar, viewed, live };
}
function restore(f, edit) {
  const db = new DatabaseSync(join(f.dir, '.snapback4/store.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');
    const stored = db.prepare('SELECT data FROM r WHERE id = ?').get('item');
    const row = JSON.parse(stored.data); edit(row.Row);
    db.prepare('UPDATE r SET data = ? WHERE id = ?').run(JSON.stringify(row), 'item');
    db.exec('COMMIT');
  } finally { db.close(); }
}
for (const host of ['online', 'process', 'wasm']) for (const event of ['viewed', 'released']) test(`${host}: rejected plans disclose no ${event} handles or facts`, async t => {
  const f = await prepare(t);
  let old; restore(f, row => { old = structuredClone(row); });
  if (event === 'viewed') {
    for (const asset of [f.scalar, f.viewed]) {
      const r = await fetch(f.url + '/assets/' + asset.id, { headers: { 'x-snapback-persona': 'bob' } });
      assert.equal(r.status, 200); await r.arrayBuffer();
      assert.equal((await fetch(f.url + '/assets/' + asset.id, { headers: { 'x-snapback-persona': 'bob' } })).status, 410);
    }
  } else {
    assert.equal((await f.post('/m/clearPhoto', { id: 'release', args: {} })).state, 'sent');
    restore(f, row => { row.photo = old.photo; row.photos = old.photos; });
  }
  let core;
  const device = opener(host, join(f.dir, 'client'));
  const client = await open(t, f, host, host === 'online' ? {} : { device: { async open(...args) { core = await device.open(...args); return core; } } });
  for (const name of ['filtered', 'filteredRows', 'ranged', 'existence', 'derivedHandle', 'derivedFacts', 'nativeRows', 'nativeHandle']) {
    await t.test(name, async () => {
    const raw = await f.post('/q/' + name, { args: {} }, 'bob');
    assert.equal(raw.once, undefined, `${name} must not qualify for conditional retention`);
    for (const read of [raw, await client.query(q(name), {}), ...(core && !(host === 'wasm' && name.startsWith('native')) ? [(await core.call({ op: 'query', name, viewer: 'dev:bob', args: {}, now: Date.now() })).ok] : [])]) {
      assert.ok('data' in read, JSON.stringify(read));
      const text = JSON.stringify(read.data);
      for (const asset of [f.scalar, f.viewed, f.live]) assert.ok(!text.includes(asset.id), `${host}/${name}: leaked ${event} cell: ${text}`);
      if (name.startsWith('derived') || name === 'nativeHandle') assert.equal(read.data, null);
      const rows = Array.isArray(read.data) ? read.data : read.data ? [read.data] : [];
      for (const row of rows) { assert.equal(row.photo, null); assert.equal(row.photos, null); }
    }
    });
  }
});
for (const host of ['online', 'process', 'wasm']) test(`${host}: restore rejects a once handle copied to the wrong column`, async t => {
  const f = await prepare(t);
  const old = (await f.post('/q/item', { args: {} }, 'bob')).data;
  assert.equal(old.photo.id, f.scalar.id, 'positive home proof');
  restore(f, row => { row.other = row.photo; });
  const client = await open(t, f, host);
  const read = await client.query(q('history'), { c: null });
  assert.equal(read.data[0].other, null, 'exact column home must be checked');
  assert.equal(read.data[0].photo.id, f.scalar.id, 'the correct home still restores');
});
