// Run with the wasm directory from an unchanged a8c20c40e9 checkout.
// Acquired images/backends come from that compiler and wasm, not a stamp edit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = resolve(process.argv[2]);
const wasm = readFileSync(`${dir}/snapback4_device_bg.wasm`);
assert.equal(createHash('sha256').update(wasm).digest('hex'), '1fd8cd3fdef29bc5038a642e10ba0eb22df841b44ca704d1f0d2d4f5decf0e74');
const { initSync, WebDevice } = await import(pathToFileURL(`${dir}/snapback4_device.js`));
initSync({ module: wasm });
for (const version of ['0411', '0412']) {
  const read = name => readFileSync(new URL(`${version}/${name}`, import.meta.url), 'utf8');
  const backend = read('backend-schema.part') + read('backend-programs.part');
  const kept = [{ s: 'm', k: 'device:backend', v: backend }, ...JSON.parse(read('acquired.json'))];
  const d = new WebDevice(undefined, JSON.stringify(kept));
  try {
    d.drain();
    const q = { id: 'profile-before-upgrade', seq: 1, op: 'saveProfile', viewer: 'alice', now: 4_000_000_000_000,
      new_ids: [], predicted: [], predictable: true,
      args: { displayName: 'Before upgrade', handle: 'alice', bio: 'A new bio', location: 'Berlin', link: null } };
    const answer = JSON.parse(d.call(JSON.stringify({ op: 'admit', entry: q })));
    assert.equal(answer.ok?.predictable, true, JSON.stringify(answer));
    assert.equal(answer.ok.predicted.length, 1);
    const pending = JSON.parse(d.drain());
    const path = new URL(`${version}/pending.json`, import.meta.url);
    if (process.env.UPDATE_RP_OLD_PROFILES) writeFileSync(path, JSON.stringify(pending) + '\n');
    assert.deepEqual(pending, JSON.parse(readFileSync(path, 'utf8')));
    console.log(`${version}: authentic old saveProfile predicts; persisted fixture matches`);
  } finally { d.free(); }
}
