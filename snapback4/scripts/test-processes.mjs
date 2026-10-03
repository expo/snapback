// Process-group custody for the test-file runner. Escapes are out of scope.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const inspectionError = detail => new Error(`TEST_PROCESS_INSPECTION: ${detail}`);

// Signal 0 only tests existence; EPERM proves presence, never ownership.
export function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw inspectionError(`cannot check PID ${pid}: ${error.code ?? error.message}`);
  }
}

// Metadata only: base64 retains every byte (including invalid UTF-8), without
// logging environments. Keep the original read/parse error if rechecking fails.
function metadataFailure(pid, error, raw, exists) {
  let recheck;
  try { if (pid && !exists(pid)) return; }
  catch (failure) { recheck = failure.message; }
  throw inspectionError(JSON.stringify({ pid, firstError: error.message,
    ...(raw === undefined ? {} : { rawBase64: Buffer.from(raw).toString('base64') }),
    ...(recheck ? { recheckError: recheck } : {}) }));
}

// Inspect the complete table: unlike `ps -p`, an empty selection cannot be
// confused with a failed command. C locale makes BSD lstart exactly 24 chars.
export function processTable({ run = spawnSync, exists = processExists } = {}) {
  const result = run('ps', ['-axo', 'pid=,ppid=,pgid=,uid=,lstart=,stat=,comm='], {
    timeout: 2000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (result.error || result.status !== 0 || !result.stdout?.toString().trim())
    throw inspectionError(`ps failed: ${result.error?.message ?? `status ${result.status}, signal ${result.signal}`}; ${result.stderr ?? ''}`);
  // Split bytes, not decoded text, so a rejected row retains its exact bytes.
  return Buffer.from(result.stdout).toString('latin1').split('\n').filter(Boolean).flatMap(bytes => {
    const raw = Buffer.from(bytes, 'latin1'), line = raw.toString('utf8');
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(\S+)\s+(.+)$/.exec(line);
    if (!match || !Number.isFinite(Date.parse(match[5]))) {
      const pid = Number(/^\s*(\d+)(?:\s|$)/.exec(line)?.[1]);
      metadataFailure(Number.isSafeInteger(pid) && pid > 0 ? pid : undefined,
        Error('malformed ps row'), raw, exists);
      return [];
    }
    const [, pid, parent, group, uid, start, state, executable] = match;
    return { pid: Number(pid), parent: Number(parent), group: Number(group), uid: Number(uid), start, executable, alive: !state.startsWith('Z') };
  });
}

// @ref LLP 3000#publication-suite-under-contention — a vanished candidate is
// exited; only malformed metadata for a still-present PID refuses inspection.
export function identity(pid, { platform = process.platform, read = readFileSync, exists = processExists, inspect = processTable } = {}) {
  if (!Number.isInteger(pid) || pid < 1) throw inspectionError(`invalid PID ${pid}`);
  if (platform !== 'linux') return inspect().find(row => row.pid === pid);
  let raw;
  try {
    raw = read(`/proc/${pid}/stat`);
    const text = raw.toString('utf8'), end = text.lastIndexOf(')');
    const fields = text.slice(end + 1).trim().split(/\s+/);
    if (!text.startsWith(`${pid} (`) || end < 0 || text[end + 1] !== ' '
      || fields.length < 50 || !/^[A-Za-z]$/.test(fields[0])
      || !fields.slice(1).every(field => /^-?\d+$/.test(field))
      || ![1, 2, 3, 19].every(index => /^\d+$/.test(fields[index])))
      throw Error(`malformed /proc/${pid}/stat`);
    return { pid, parent: Number(fields[1]), start: fields[19], group: Number(fields[2]), session: Number(fields[3]), alive: fields[0] !== 'Z' };
  } catch (error) {
    return metadataFailure(pid, error, raw, exists);
  }
}
export const live = record => {
  const now = identity(record.pid);
  return !!now?.alive && now.start === record.start;
};
// @ref LLP 3000#publication-suite-under-contention — only the process group
// created for this file is owned. Parent links and environments confer nothing.
export function ownedProcesses(keeper, inspect = processTable, { includeKeeper = false } = {}) {
  return inspect().filter(row => row.alive && row.group === keeper.pid && (includeKeeper || row.pid !== keeper.pid))
    .flatMap(row => {
      // A table is a snapshot: a vanished member has exited. Recheck group
      // membership too, so a reused PID or a process that left is not a leak.
      const current = identity(row.pid);
      return current?.alive && current.group === keeper.pid ? [current] : [];
    });
}

export async function cleanupProcesses(keeper, { inspect = processTable, release } = {}) {
  release(); // unconditional, even when preliminary inspection found no leak
  const deadline = performance.now() + 5000;
  const found = new Map();
  let empty = 0, remaining = [];
  do {
    remaining = ownedProcesses(keeper, inspect, { includeKeeper: true });
    for (const row of remaining) if (row.pid !== keeper.pid) found.set(row.pid, row);
    if (remaining.length) empty = 0;
    else if (++empty === 2) return [...found.values()];
    await sleep(50);
  } while (performance.now() < deadline);
  throw new Error(`TEST_FILE_LEAK: no two consecutive empty group inspections: ${JSON.stringify(remaining)}`);
}
