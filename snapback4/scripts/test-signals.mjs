// One gate for test signals: positive PID, live exact birth, expected command,
// then another birth/command inspection immediately before dispatch. No await
// or caller callback separates the final inspection from the signal.
// @ref LLP 3000#publication-suite-under-contention — readiness is not lifetime;
// native birth precision and expected argv bind each fault to its fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nativeSpawn, spawnSync } from 'node:child_process';

const refusal = detail => new Error(`TEST_SIGNAL_REFUSED: ${detail}`);
let probe;
function darwinProbe() {
  if (probe) return probe;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-test-identity-'));
  process.once('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'inspect');
  const built = spawnSync('cc', [new URL('./test-process-identity.c', import.meta.url).pathname, '-o', file], { encoding: 'utf8', timeout: 30000 });
  if (built.status !== 0) throw refusal(`cannot build Darwin identity inspector: ${built.error?.message ?? built.stderr}`);
  probe = file;
  return file;
}
function positivePid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff) throw refusal('positive publisher PID / process PID required');
}
function linuxBirth(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
  if (!stat.startsWith(`${pid} (`) || fields.length < 50 || !/^\d+$/.test(fields[19])) throw refusal(`malformed stat for ${pid}`);
  if (['Z', 'X'].includes(fields[0])) throw refusal(`PID ${pid} is exited`);
  if (!/^[RSDTtWKIP]$/.test(fields[0])) throw refusal(`unknown process state for ${pid}`);
  return { parent: Number(fields[1]), start: [fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8'), fields[19]] };
}
function snapshot(pid) {
  positivePid(pid);
  try {
    if (process.platform === 'linux') {
      const before = linuxBirth(pid);
      const argv = command(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'));
      const after = linuxBirth(pid);
      sameBirth(after.start, before.start);
      return { pid, ...after, argv };
    }
    if (process.platform !== 'darwin') throw refusal(`unsupported platform ${process.platform}`);
    const result = spawnSync(darwinProbe(), [String(pid)], { timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw refusal(`PID ${pid} identity unavailable${result.status === 3 ? ' (exited)' : ''}: ${result.error?.message ?? result.stderr}`);
    const output = result.stdout.toString('utf8'), newline = output.indexOf('\n');
    const { start, parent } = JSON.parse(output.slice(0, newline));
    if (!Array.isArray(start) || start.length !== 2 || !start.every(Number.isSafeInteger)) throw refusal('invalid Darwin birth');
    if (!Number.isSafeInteger(parent) || parent < 0) throw refusal('invalid Darwin parent');
    return { pid, start, parent, argv: command(output.slice(newline + 1)) };
  } catch (error) {
    if (error.message.startsWith('TEST_SIGNAL_REFUSED:')) throw error;
    throw refusal(`PID ${pid} identity unavailable: ${error.code ?? error.message}`);
  }
}
function command(text) {
  const argv = text.split('\0');
  if (argv.pop() !== '' || !argv[0]) throw refusal('incomplete process command');
  return argv;
}
function sameBirth(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw refusal('stale publisher birth / process birth must not authorize a fault');
}
function checkCommand(actual, expected) {
  if (Array.isArray(expected?.[0])) {
    if (!expected.some(argv => { try { checkCommand(actual, argv); return true; } catch { return false; } })) throw refusal('expected fixture command required');
    return;
  }
  // RegExp arguments are anchored by callers for variable native deadlines.
  if (!Array.isArray(expected) || actual.length !== expected.length || !actual.every((arg, i) => expected[i] instanceof RegExp ? expected[i].test(arg) : arg === expected[i]))
    throw refusal('PID must identify this fixture publisher command / expected process command');
}
export function inspectSignalTarget(pid, argv, start) {
  const before = snapshot(pid);
  if (start !== undefined) sameBirth(before.start, start);
  checkCommand(before.argv, argv);
  const after = snapshot(pid);
  sameBirth(after.start, before.start);
  checkCommand(after.argv, argv);
  return after;
}
export function signalTargetAlive(record) {
  assert.ok(record?.start !== undefined, 'TEST_SIGNAL_REFUSED: recorded birth required');
  positivePid(record.pid);
  try { return JSON.stringify((process.platform === 'linux' ? linuxBirth(record.pid) : snapshot(record.pid)).start) === JSON.stringify(record.start); }
  catch (error) { if (error.code === 'ENOENT' || /identity unavailable: ENOENT|is exited|identity unavailable \(exited\)/.test(error.message)) return false; throw error; }
}
export function checkSignalRecord(record, argv) {
  assert.ok(record?.start !== undefined, 'TEST_SIGNAL_REFUSED: recorded birth required');
  return inspectSignalTarget(record.pid, argv, record.start);
}
export function signalRecorded(record, signal, argv) {
  checkSignalRecord(record, argv);
  process.kill(record.pid, signal);
}
const children = new WeakMap();
export function spawnTracked(...args) {
  const child = nativeSpawn(...args);
  try {
    const record = snapshot(child.pid);
    if (record.parent !== process.pid) throw refusal('spawned process is not this parent\'s child');
    children.set(child, { record });
  } catch (error) {
    // A short command can finish before capture. Its normal exit remains
    // usable, but missing birth evidence can never authorize a later signal.
    children.set(child, { error });
  }
  return child;
}
export function signalChild(child, signal = 'SIGTERM') {
  // Null JS exit fields do NOT prove unreaped custody (LLP 3000 QF7).
  // Require the birth captured at spawn, plus a fresh command/birth check.
  if (!child || child.exitCode !== null || child.signalCode !== null) throw refusal('direct child already exited');
  const { record, error } = children.get(child) ?? {};
  if (!record) throw refusal(`no captured child birth: ${error?.message ?? 'use spawnTracked'}`);
  signalRecorded(record, signal, child.spawnargs);
}
export function signalSelf(signal, { group = false } = {}) {
  // Execution itself proves this birth. A live member pins its own group;
  // callers cannot supply a numeric PID/PGID or a stale disk record here.
  positivePid(process.pid);
  process.kill(group ? 0 : process.pid, signal);
}
