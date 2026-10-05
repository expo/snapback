import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { inventory, hash } from '../../../crates/snapback4/src/verbs/witness/payload.mjs';
import { acquireExportLease, retainEvidence } from '../../snapback4-expo/export-ios.mjs';

const binary = new URL('../../../target/debug/snapback4', import.meta.url).pathname;
const wrapper = new URL('../../snapback4-expo/export-ios.mjs', import.meta.url).href;
const shim = new URL('../bin/snapback4.js', import.meta.url).pathname;
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-publication-'));
  const dir = path.join(root, 'runs/1-123'), source = path.join(dir, 'export');
  fs.mkdirSync(source, { recursive: true }); fs.writeFileSync(path.join(source, 'bundle'), 'proved bytes');
  for (let i = 2; i <= 6; i++) {
    const newer = path.join(root, `runs/${i}-123`); fs.mkdirSync(newer);
    fs.writeFileSync(path.join(newer, 'finished.json'), '{}');
    fs.writeFileSync(path.join(newer, 'result.json'), JSON.stringify({state:'skipped'}));
  }
  const proof = JSON.stringify({ exported: { inventory: inventory(source) } });
  fs.writeFileSync(path.join(dir, 'proof.json'), proof);
  fs.writeFileSync(path.join(dir, 'smoke-ios-run.json'), JSON.stringify({ exitStatus: 0, endedAt: 1, proof: { sha256: hash(proof) } }));
  return { root, dir, source };
}
const publish = (source, root, lease) => spawnSync(process.execPath, [shim, 'witness', 'export-publish', source, path.join(root, 'dist')], {
  encoding: 'utf8', env: { ...process.env, SNAPBACK4_BIN: binary }, stdio: ['ignore', 'pipe', 'pipe', lease],
});

test('actual kernel lease survives helper and CLI shim exit; live wrapper journal and export survive pruning', () => {
  const { root, dir, source } = fixture();
  const old = process.env.SNAPBACK4_BIN; process.env.SNAPBACK4_BIN = binary;
  // Exercise the installed CLI spelling, including descriptor forwarding.
  let lease;
  try {
    lease = acquireExportLease(dir, shim);
    const journal = fs.readFileSync(path.join(dir, 'live.json'), 'utf8');
    assert.equal(JSON.parse(journal).wrapper.pid, process.pid);
    assert.equal(retainEvidence(path.join(root, 'runs'), dir, binary), true);
    assert.equal(fs.readFileSync(path.join(dir, 'live.json'), 'utf8'), journal);
    assert.equal(fs.existsSync(path.join(dir, 'finished.json')), false);
    assert.equal(fs.readFileSync(path.join(source, 'bundle'), 'utf8'), 'proved bytes');
    const result = publish(source, root, lease); assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(inventory(path.join(root, 'dist')).files, JSON.parse(fs.readFileSync(path.join(dir, 'publication.json'))).files);
    fs.closeSync(lease); lease = undefined;
    assert.equal(retainEvidence(path.join(root, 'runs'), dir, binary), true);
    assert.equal(fs.readFileSync(path.join(root, 'dist/bundle'), 'utf8'), 'proved bytes');
  } finally {
    if (lease !== undefined) fs.closeSync(lease);
    if (old === undefined) delete process.env.SNAPBACK4_BIN; else process.env.SNAPBACK4_BIN = old;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publication refuses changed inventory and a changed proof; no success receipt', () => {
  for (const change of ['inventory', 'proof']) {
    const { root, dir, source } = fixture(); const lease = acquireExportLease(dir, binary);
    try {
      if (change === 'inventory') fs.writeFileSync(path.join(source, 'bundle'), 'tampered bytes');
      else fs.appendFileSync(path.join(dir, 'proof.json'), ' ');
      const result = publish(source, root, lease);
      assert.equal(result.status, 1); assert.match(result.stderr, /E_WITNESS_PROOF/);
      assert.equal(fs.existsSync(path.join(root, 'dist')), false);
      assert.equal(fs.existsSync(path.join(dir, 'publication.json')), false);
    } finally { fs.closeSync(lease); fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('SIGKILL releases the actual Node wrapper lease and cleanup recovers its run', async () => {
  const { root, dir, source } = fixture();
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireExportLease } from ${JSON.stringify(wrapper)};
    acquireExportLease(${JSON.stringify(dir)}, ${JSON.stringify(binary)});
    console.log('locked'); setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'close');
  try {
    await once(child.stdout, 'data');
    assert.equal(retainEvidence(path.join(root, 'runs'), dir, binary), true);
    assert.equal(fs.existsSync(source), true);
    child.kill('SIGKILL'); await exited;
    assert.equal(retainEvidence(path.join(root, 'runs'), dir, binary), true);
    assert.equal(fs.existsSync(path.join(dir, 'finished.json')), true);
    assert.equal(fs.existsSync(source), false);
  } finally { child.kill('SIGKILL'); await exited; fs.rmSync(root, { recursive: true, force: true }); }
});

test('publisher inherits custody if its Node wrapper is killed while publication is blocked', async () => {
  const { root, dir, source } = fixture();
  fs.mkdirSync(path.join(root, 'artifacts/native-smoke'), { recursive: true });
  const lock = fs.openSync(path.join(root, 'artifacts/native-smoke/publication.lock'), 'a+');
  const blocker = path.join(root, 'blocker'); fs.mkdirSync(blocker);
  const held = spawnSync(binary, ['witness', 'export-lease', blocker], { stdio: ['ignore', 'pipe', 'pipe', lock] });
  assert.equal(held.status, 0);
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; import {spawn} from 'node:child_process';
    import { acquireExportLease } from ${JSON.stringify(wrapper)};
    const lease = acquireExportLease(${JSON.stringify(dir)}, ${JSON.stringify(binary)});
    const publisher = spawn(${JSON.stringify(binary)}, ['witness','export-publish',${JSON.stringify(source)},${JSON.stringify(path.join(root, 'dist'))}], {stdio:['ignore','ignore','ignore',lease]});
    fs.writeFileSync(${JSON.stringify(path.join(root, 'publisher.pid'))}, String(publisher.pid));
    console.log('publishing'); setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'close'); let publisher, unlocked = false;
  try {
    await once(child.stdout, 'data');
    publisher = Number(fs.readFileSync(path.join(root, 'publisher.pid')));
    // Parent dies while the real publisher is waiting for the destination lock.
    child.kill('SIGKILL'); await exited;
    assert.equal(retainEvidence(path.join(root, 'runs'), dir, binary), true);
    assert.equal(fs.existsSync(path.join(dir, 'finished.json')), false);
    assert.equal(fs.existsSync(source), true);
    fs.closeSync(lock); unlocked = true;
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(path.join(dir, 'publication.json')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    assert.equal(fs.existsSync(path.join(dir, 'publication.json')), true);
    assert.equal(fs.readFileSync(path.join(root, 'dist/bundle'), 'utf8'), 'proved bytes');
    while (!fs.existsSync(path.join(dir, 'finished.json')) && Date.now() < deadline) {
      retainEvidence(path.join(root, 'runs'), dir, binary); await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(fs.existsSync(path.join(dir, 'finished.json')), true);
    assert.equal(fs.readFileSync(path.join(root, 'dist/bundle'), 'utf8'), 'proved bytes');
    publisher = undefined;
  } finally {
    if (!unlocked) fs.closeSync(lock);
    child.kill('SIGKILL'); await exited;
    if (publisher) { try { process.kill(publisher, 'SIGKILL'); } catch {} }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
