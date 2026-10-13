import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import vm from 'node:vm';
import { settleMutation } from '../dist/write-settlement.js';
import { sentResult, matchRead, otherwiseAll } from '../dist/contract.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bin = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const invoke = (args, cwd, env = {}) => spawnSync(bin, args, { cwd, encoding: 'utf8', env: { ...process.env, SNAPBACK4_BIN: bin, PORT_LO: undefined, PORT_HI: undefined, ...env }, timeout: 120000 });
const success = result => assert.equal(result.status, 0, result.stdout + result.stderr);
const project = (t, name = 'dx10-') => { const dir = mkdtempSync(join(root, 'target', name)); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

for (const state of ['sent', 'failed']) test(`run settlement owns a per-intent observer: ${state}, early receipt, concurrent calls and no read subscribers`, async () => {
  const listeners = new Set(), submitted = [];
  const client = { onWrite: fn => { listeners.add(fn); return () => listeners.delete(fn); }, mutate: async (op, args, options) => {
    submitted.push(options.id);
    return { state: 'pending', id: options.id };
  } };
  const first = settleMutation(client, { name: 'add' }, {}), second = settleMutation(client, { name: 'add' }, {});
  let a = false, b = false; first.then(() => a = true); second.then(() => b = true);
  await Promise.resolve(); assert.equal(listeners.size, 2); assert.notEqual(submitted[0], submitted[1]);
  const outcome = id => state === 'sent' ? { state, id, seq: 1, result: null } : { state, id, why: { code: 'NO', family: 'rule', message: 'No' } };
  for (const listener of listeners) listener(outcome(submitted[1]));
  assert.deepEqual(await second, outcome(submitted[1])); assert.equal(a, false); assert.equal(b, true); assert.equal(listeners.size, 1);
  for (const listener of listeners) listener(outcome(submitted[0]));
  assert.deepEqual(await first, outcome(submitted[0])); assert.equal(listeners.size, 0);
  client.mutate = async (op, args, options) => { for (const listener of listeners) listener(outcome(options.id)); return { state: 'pending', id: options.id }; };
  assert.equal((await settleMutation(client, {}, {})).state, state); assert.equal(listeners.size, 0);
  client.mutate = async () => { throw Error('admission threw'); };
  await assert.rejects(settleMutation(client, {}, {}), /admission threw/); assert.equal(listeners.size, 0);
  client.mutate = async () => ({ state: 'pending', id: 'custody' });
  assert.equal((await settleMutation(client, {}, {}, { waitSeconds: 0 })).state, 'pending'); assert.equal(listeners.size, 0);
});

test('sentResult and compact matchRead preserve null, replay and empty-list meanings', () => {
  assert.equal(sentResult({ state: 'sent', id: 'a', seq: 1, result: null }), null);
  assert.equal(sentResult({ state: 'sent', id: 'a', seq: 1, replayed: true }), undefined);
  for (const read of [undefined, { state: 'pending', id: 'a' }, { state: 'failed', id: 'a', why: {} }]) assert.equal(sentResult(read), undefined);
  const handlers = { ...otherwiseAll(() => 'Unavailable'), absent: () => 'No notes', present: rows => `${rows.length} notes` };
  assert.equal(matchRead({ data: [], complete: true, existence: 'absent' }, handlers), 'No notes');
  assert.equal(matchRead({ data: [], complete: false, existence: 'partial' }, handlers), 'Unavailable');
  assert.equal(matchRead({ denied: { code: 'NO' } }, handlers), 'Unavailable');
  assert.equal(matchRead({ loading: true }, handlers), 'Unavailable');
  assert.equal(matchRead({ data: [1], complete: true, existence: 'present' }, handlers), '1 notes');
});

