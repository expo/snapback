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

for (const persona of [undefined, 'alice']) test(`default web starter ${persona ?? 'guest'} proves a visible labelled form and ships a favicon`, { timeout: 120000 }, t => {
  const dir = project(t); success(invoke(['init', '--web'], dir)); symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules')); success(invoke(['check'], dir));
  success(spawnSync(join(root, 'node_modules/.bin/vite'), ['build'], { cwd: dir, encoding: 'utf8', timeout: 120000 }));
  const proof = invoke(['witness', 'web', 'dist', ...(persona ? ['--as', persona] : []), '--mutation', 'add', '--args', '{"title":"Visible proof"}', '--field', 'Task', '--value', 'Visible proof', '--button', 'Add'], dir);
  success(proof); assert.equal(JSON.parse(proof.stdout).proof, 'visible-form'); assert.equal(JSON.parse(proof.stdout).state, 'sent');
  const wrong = invoke(['witness', 'web', 'dist', '--mutation', 'add', '--args', '{"title":"Other value"}', '--field', 'Task', '--value', 'Visible proof', '--button', 'Add', '--timeout', '5'], dir);
  assert.equal(wrong.status, 1); assert.match(wrong.stderr, /E_WITNESS_ARGUMENT/);
  if (persona) { const sdk = invoke(['witness', 'web', 'dist', '--as', 'alice', '--mutation', 'add', '--args', '{"title":"SDK proof"}'], dir); success(sdk); }
});

test('visible-form arming ignores old sent state, isolates the clicked mutation and cleans repeated observers', async t => {
  const { registerWebWitness } = await import('../dist/witness-web.js');
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const window = { location: { search: '?witness=web' }, statusText: 'sent' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'window', old); else delete globalThis.window; });
  const listeners = new Set(), mutation = { kind: 'mutation', name: 'add' };
  const original = async (op, args) => { for (const listener of listeners) listener({ state: 'sent', id: 'clicked', seq: 1, result: args }); return { state: 'pending', id: 'clicked' }; };
  const app = { ready: Promise.resolve({ ok: true }), client: { viewer: () => 'dev:alice', onWrite: listener => { listeners.add(listener); return () => listeners.delete(listener); }, mutate: original } };
  registerWebWitness(app, { add: mutation });
  window.__snapback4Witness.beginForm('add', { title: 'new' });
  let settled = false; window.__snapback4Witness.formResult().then(() => settled = true);
  await Promise.resolve(); assert.equal(settled, false, 'existing sent text is not a write');
  const returned = await app.client.mutate(mutation, { title: 'new' }); assert.equal(returned.state, 'pending', 'instrumentation preserves UI custody');
  const receipt = await window.__snapback4Witness.formResult(); assert.equal(receipt.state, 'sent'); assert.equal(receipt.mutation, 'add');
  assert.equal(app.client.mutate, original); assert.equal(listeners.size, 0);
  window.__snapback4Witness.beginForm('add'); window.__snapback4Witness.beginForm('add');
  await app.client.mutate(mutation, {}); assert.equal((await window.__snapback4Witness.formResult()).state, 'sent'); assert.equal(app.client.mutate, original);
});
