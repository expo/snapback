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

const envelopeSchema = `use personas alice
table notes:
  title: text <=80
  public
  insert <- allow
query list():
  return notes first 10 by .id { id, title }
mutation add(title: text <=80):
  return insert notes { title }
mutation nothing():
  return null
mutation refuse():
  require false else PROOF_REFUSED
  return null
`;
async function dev(dir) {
  const child = spawn(bin, ['dev', '--memory', '--port', '0', '--no-watch'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.resume();
  const [url] = await once(createInterface({ input: child.stdout }), 'line');
  return { url, stop: async () => { if (child.exitCode !== null || child.signalCode !== null) return; const done = once(child, 'close'); child.kill('SIGTERM'); await done; } };
}
test('guide testing full HTTP bodies match real routes, including null returns, refusals and omitted ids', async t => {
  const dir = project(t); mkdirSync(join(dir, 'snapback')); writeFileSync(join(dir, 'snapback/schema.q'), envelopeSchema);
  const server = await dev(dir); t.after(server.stop);
  const guide = readFileSync(join(root, 'crates/snapback4-lang/src/guide/testing.md'), 'utf8');
  const examples = JSON.parse(guide.match(/```json\n(\{\n  "\/m\/add"[\s\S]*?)\n```/)[1]);
  let rowId, store;
  for (const route of Object.keys(examples)) {
    const body = await (await fetch(server.url + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-snapback-persona': 'alice' }, body: JSON.stringify({ args: route === '/m/add' ? { title: 'Proof' } : {} }) })).json();
    assert.ok(!('id' in body), 'missing request id is omitted, never null');
    if (route === '/m/add') { rowId = body.result.id; store = body.store_id; }
    const text = JSON.stringify(body).replaceAll(rowId, 'row1').replaceAll(store, 'store1');
    assert.deepEqual(JSON.parse(text), examples[route], route);
  }
  const explicit = await (await fetch(server.url + '/m/nothing', { method: 'POST', headers: { 'content-type': 'application/json', 'x-snapback-persona': 'alice' }, body: JSON.stringify({ id: 'saved-intent', args: {} }) })).json();
  assert.equal(explicit.id, 'saved-intent'); assert.equal(explicit.result, null);
});

