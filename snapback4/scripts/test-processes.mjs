// Process custody for the test-file runner, including detached browsers.
import { readFileSync, appendFileSync } from 'node:fs';
import { ChildProcess, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export function identity(pid) {
  try {
    if (process.platform === 'linux') {
      const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
      return { pid, start: fields[19], alive: fields[0] !== 'Z' };
    }
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'stat='], { encoding: 'utf8', timeout: 1000 });
    const text = result.stdout?.trim();
    if (!text || result.status !== 0) return;
    return { pid, start: text.slice(0, 24), alive: !text.slice(24).trim().startsWith('Z') };
  } catch {}
}
export const live = record => {
  const now = identity(record.pid);
  return now?.alive && now.start === record.start;
};
export function records(path) {
  try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

// Runs in both the node:test launcher and its test child. Record immediately
// after spawn, before user callbacks can unref or detach the child. Start-time
// comparison prevents signalling a PID recycled after an earlier test ended.
const registry = process.env.SNAPBACK4_TEST_PROCESS_LOG;
if (registry) {
  const original = ChildProcess.prototype.spawn;
  ChildProcess.prototype.spawn = function (options) {
    const result = original.call(this, options);
    if (this.pid) {
      const record = identity(this.pid);
      if (record) appendFileSync(registry, JSON.stringify({ ...record, detached: !!options.detached }) + '\n');
    }
    return result;
  };
}

export async function cleanupProcesses(owned, { graceMs = 5000 } = {}) {
  const known = new Map(owned.map(row => [row.pid, row]));
  // Capture descendants while their parents still exist; Rust's worker
  // watchdog and Chromium can create their own process groups without Node.
  const tree = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 2000 });
  const inspectionError = tree.status !== 0 ? new Error(`TEST_PROCESS_CLEANUP: cannot inspect descendants: ${tree.stderr}`) : undefined;
  const pairs = (tree.stdout ?? '').trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  let added;
  do {
    added = false;
    for (const [pid, parent] of pairs) if (!known.has(pid) && known.has(parent) && live(known.get(parent))) {
      const row = identity(pid);
      if (row) { known.set(pid, row); added = true; }
    }
  } while (added);
  const signal = name => {
    for (const row of [...known.values()].reverse()) if (live(row)) {
      try { process.kill(row.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  };
  signal('SIGTERM');
  const deadline = performance.now() + graceMs;
  while ([...known.values()].some(live) && performance.now() < deadline) await sleep(25);
  signal('SIGKILL');
  const killedAt = performance.now();
  while ([...known.values()].some(live) && performance.now() - killedAt < 2000) await sleep(25);
  const remaining = [...known.values()].filter(live);
  if (remaining.length) throw new Error(`TEST_PROCESS_CLEANUP: still alive after SIGKILL: ${JSON.stringify(remaining)}`);
  if (inspectionError) throw inspectionError;
  return [...known.values()];
}
