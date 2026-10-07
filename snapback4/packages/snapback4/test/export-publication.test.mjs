import { signalChild, spawnTracked as spawn } from '../../../scripts/test-signals.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { inventory, hash } from '../../../crates/snapback4/src/verbs/witness/payload.mjs';
import { acquireExportLease, retainEvidence } from '../../snapback4-expo/export-ios.mjs';
import { publisherPid, waitForPublisher, killPausedPublisher, releasePublisherBarrier, waitForPublisherExit } from './helpers/publication-barrier.mjs';

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

for (const point of ['before', 'after']) test(`publisher ${point} barrier publishes a complete identity and rejects unsafe fault requests`, { timeout: 300000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-publisher-barrier-'));
  const barrier = path.join(root, 'paused'), resume = path.join(root, 'resume-write');
  const probe = path.join(root, 'probe'), writing = path.join(root, 'writing');
  let child, exited;
  try {
    // Hold the actual C fixture between opening its PID output and writing
    // it. This deterministically exposes the old fopen-before-fprintf race
    // without ever sending a signal to a PID obtained from partial bytes.
    fs.writeFileSync(probe + '.c', `
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <unistd.h>
static int held_fprintf(FILE *out, const char *format, ...) {
    FILE *marker = fopen(getenv("WRITE_ENTERED"), "w");
    if (!marker || fclose(marker)) _exit(126);
    while (access(getenv("WRITE_RESUME"), F_OK) != 0) usleep(10000);
    va_list args; va_start(args, format);
    int result = vfprintf(out, format, args); va_end(args); return result;
}
#define fprintf held_fprintf
#include ${JSON.stringify(new URL('./publication-interposer.c', import.meta.url).pathname)}
int main(void) { boundary(getenv("SB4_FAULT_TARGET"), ${point === 'after' ? 1 : 0}); return 0; }
`);
    const built = spawnSync('cc', [probe + '.c', ...(process.platform === 'darwin' ? [] : ['-ldl']), '-o', probe], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    child = spawn(probe, [], { env: { ...process.env, SB4_FAULT: 'pause-' + point, SB4_FAULT_TARGET: root, SB4_FAULT_BARRIER: barrier, WRITE_ENTERED: writing, WRITE_RESUME: resume }, stdio: 'ignore' });
    exited = once(child, 'exit');
    const end = performance.now() + 120000;
    while (!fs.existsSync(writing)) { assert.ok(performance.now() < end, 'fixture reached its PID write'); await new Promise(r => setTimeout(r, 10)); }
    assert.equal(fs.existsSync(barrier), false, 'incomplete PID record must not be published');
    fs.writeFileSync(resume, '');
    const record = await waitForPublisher(barrier, [probe]);
    assert.equal(record.pid, child.pid);
    assert.ok(record.start);
    for (const value of ['', '0', '-1', '+1', '1.5', '1e3', ' 1', '1 trailing', '2147483648', '9007199254740992']) assert.equal(publisherPid(value), undefined, value);
    for (const pid of [0, -1, undefined, NaN, 1.5, 2147483648]) {
      await assert.rejects(killPausedPublisher(barrier, { ...record, pid }, [probe]), /positive publisher PID/);
    }
    await assert.rejects(killPausedPublisher(barrier, { ...record, start: record.start + '-stale' }, [probe]), /stale publisher birth/);
    await assert.rejects(killPausedPublisher(barrier, { ...record, start: undefined }, [probe]), /recorded birth required/);
    await assert.rejects(killPausedPublisher(barrier, record, [probe, 'wrong-command']), /fixture publisher command/);
    assert.equal(fs.existsSync(barrier + '.kill'), false, 'refused identities cannot request any signal');
    // An inode, zero or malformed text never satisfies the observation wait.
    const invalid = path.join(root, 'invalid');
    for (const value of ['', '0', '-1', 'partial']) {
      fs.writeFileSync(invalid, value);
      await assert.rejects(waitForPublisher(invalid, [probe], 40), /complete positive publisher PID/);
    }
    await killPausedPublisher(barrier, record, [probe]);
    const [code, signal] = await exited;
    assert.equal(code, null); assert.equal(signal, 'SIGKILL');
    fs.rmSync(barrier + '.kill');
    // Disappearance or a reused PID must both refuse, without a fault request.
    await assert.rejects(killPausedPublisher(barrier, record, [probe]));
    assert.equal(fs.existsSync(barrier + '.kill'), false, 'exited publisher cannot authorize another fault');
  } finally {
    fs.writeFileSync(resume, ''); releasePublisherBarrier(barrier);
    if (child?.exitCode === null && child?.signalCode === null) signalChild(child, 'SIGKILL');
    if (exited) await exited;
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    signalChild(child, 'SIGKILL'); await exited;
    assert.equal(retainEvidence(path.join(root, 'runs'), dir, binary), true);
    assert.equal(fs.existsSync(path.join(dir, 'finished.json')), true);
    assert.equal(fs.existsSync(source), false);
  } finally { if(child.exitCode===null&&child.signalCode===null)signalChild(child, 'SIGKILL'); await exited; fs.rmSync(root, { recursive: true, force: true }); }
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
    fs.writeFileSync(${JSON.stringify(path.join(root, 'publisher.pid.tmp'))}, String(publisher.pid));
    fs.renameSync(${JSON.stringify(path.join(root, 'publisher.pid.tmp'))}, ${JSON.stringify(path.join(root, 'publisher.pid'))});
    console.log('publishing'); setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'close'); let publisher, unlocked = false;
  try {
    await once(child.stdout, 'data');
    publisher = await waitForPublisher(path.join(root, 'publisher.pid'), [binary, 'witness', 'export-publish', source, path.join(root, 'dist')]);
    // Parent dies while the real publisher is waiting for the destination lock.
    signalChild(child, 'SIGKILL'); await exited;
    assert.equal(retainEvidence(path.join(root, 'runs'), dir, binary), true);
    assert.equal(fs.existsSync(path.join(dir, 'finished.json')), false);
    assert.equal(fs.existsSync(source), true);
    fs.closeSync(lock); unlocked = true;
    let deadline = Date.now() + 120000;
    while (!fs.existsSync(path.join(dir, 'publication.json')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    assert.equal(fs.existsSync(path.join(dir, 'publication.json')), true);
    assert.equal(fs.readFileSync(path.join(root, 'dist/bundle'), 'utf8'), 'proved bytes');
    deadline = Date.now() + 120000;
    while (!fs.existsSync(path.join(dir, 'finished.json')) && Date.now() < deadline) {
      retainEvidence(path.join(root, 'runs'), dir, binary); await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(fs.existsSync(path.join(dir, 'finished.json')), true);
    assert.equal(fs.readFileSync(path.join(root, 'dist/bundle'), 'utf8'), 'proved bytes');
  } finally {
    if (!unlocked) fs.closeSync(lock);
    if(child.exitCode===null&&child.signalCode===null)signalChild(child, 'SIGKILL'); await exited;
    if (publisher) await waitForPublisherExit(publisher);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
