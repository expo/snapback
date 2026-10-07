// Test-only publication barriers. PID files carry identity, never permission
// to send a numeric signal. Only the C fixture can act on its private request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { identity } from '../../../../scripts/test-processes.mjs';

export function publisherPid(text) {
  if (!/^[1-9][0-9]*\n?$/.test(text)) return undefined;
  const pid = Number(text);
  return Number.isSafeInteger(pid) && pid <= 0x7fffffff ? pid : undefined;
}
async function inspectPublisher(pid, argv) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid <= 0x7fffffff, 'positive publisher PID required');
  const before = await identity(pid);
  assert.ok(before?.alive, 'recorded publisher must still be alive');
  if (process.platform === 'linux') {
    const actual = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    assert.equal(actual.pop(), '');
    assert.deepEqual(actual, argv, 'PID must identify this fixture publisher command');
  } else {
    const result = spawnSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 10000, env: { ...process.env, LC_ALL: 'C' } });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.stdout.trim(), argv.join(' '), 'PID must identify this fixture publisher command');
  }
  const after = await identity(pid);
  assert.ok(after?.alive && after.start === before.start, 'publisher identity changed during command inspection');
  return after;
}
export async function waitForPublisher(file, argv, timeout = 30000) {
  const end = performance.now() + timeout;
  for (;;) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const pid = publisherPid(text ?? '');
    if (pid !== undefined) return inspectPublisher(pid, argv);
    assert.ok(performance.now() < end, 'complete positive publisher PID record required');
    await pause(20);
  }
}
export async function killPausedPublisher(file, record, argv) {
  const current = await inspectPublisher(record.pid, argv);
  assert.equal(current.start, record.start, 'stale publisher birth must not authorize a fault');
  releasePublisherBarrier(file);
}
export function releasePublisherBarrier(file) {
  // Also usable by finally before readiness, or after a corrupt/stale record:
  // only the injected publisher at this private path reads this request. It
  // raises SIGKILL on itself; neither PID 0 nor an unrelated PID is signalled.
  fs.writeFileSync(file + '.kill', '');
}
export async function waitForPublisherExit(record, timeout = 30000) {
  const end = performance.now() + timeout;
  for (;;) {
    const current = await identity(record.pid);
    if (!current?.alive || current.start !== record.start) return;
    assert.ok(performance.now() < end, 'owned publisher exited after its lease was released');
    await pause(20);
  }
}
