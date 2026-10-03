// Process custody for the test-file runner, including detached browsers.
import { readFileSync, appendFileSync } from 'node:fs';
import { ChildProcess, spawnSync } from 'node:child_process';
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
export function records(path) {
  try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

// Runs in both the node:test launcher and its test child. Record immediately
// after spawn, before user callbacks can unref or detach the child.
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

// The live keeper reserves the file's process group until whole-group cleanup.
// Verification continues after that signal, including when the keeper is dead.
// Reparenting (including shell double forks) cannot remove group membership.
// Registered detached processes additionally seed ancestry discovery. The
// separate inherited-token sweep covers descendants that leave this group.
export function ownedProcesses(owned, keeper, inspect = processTable) {
  const table = inspect(); // errors must propagate, even when no records exist
  const known = new Map();
  for (const row of owned) if (live(row)) known.set(row.pid, row);
  for (const row of table) if (row.alive && keeper && row.group === keeper.pid && row.pid !== keeper.pid) {
    const current = identity(row.pid);
    // A vanished member is exited, not a leak. The unconditional group signal
    // and two fresh snapshots still cover children absent from this old table.
    if (current?.alive && current.group === keeper.pid) known.set(row.pid, current);
  }
  let added;
  do {
    added = false;
    for (const row of table) if (row.alive && !known.has(row.pid) && known.has(row.parent)) {
      const current = identity(row.pid);
      if (current?.alive) { known.set(row.pid, current); added = true; }
    }
  } while (added);
  known.delete(keeper?.pid);
  return [...known.values()];
}

export async function cleanupProcesses(owned, { keeper, inspect = processTable, inspectToken = () => [] } = {}) {
  const known = new Map(owned.map(row => [row.pid, row]));
  const signalGroup = (mayBeGone = false) => {
    // A new group leader with the same PID is not ours. The first signal is
    // sent while our keeper is alive; later signals stay on that same group.
    const now = identity(keeper.pid);
    if (now && now.start !== keeper.start) throw inspectionError('file group identity changed');
    try { process.kill(-keeper.pid, 'SIGKILL'); }
    catch (error) {
      if (error.code === 'ESRCH') return;
      // Darwin can report EPERM for a now-empty group. Never ignore a denied
      // first signal, or a denial while any live member still belongs to it.
      if (mayBeGone && error.code === 'EPERM' && !processTable().some(row => row.group === keeper.pid && row.alive)) return;
      throw error;
    }
  };
  const signalDetached = () => {
    for (const row of known.values()) if (!row.vanished && live(row)) {
      try { process.kill(row.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  };
  if (!keeper || !live(keeper)) throw inspectionError('file group keeper exited before cleanup');
  // Signal the entire group BEFORE the first verification snapshot, even when
  // the initial discovery saw nothing. Individual PID lists cannot close the
  // fork/exit race. Zombies have no execution or resources to clean up.
  signalGroup(); signalDetached();
  const deadline = performance.now() + 5000;
  let empty = 0, remaining = [];
  do {
    remaining = ownedProcesses([...known.values()], keeper, inspect);
    try { remaining.push(...inspectToken().filter(row => row.pid !== keeper.pid)); }
    catch (error) {
      // A failed inspection must not strand already proven owners.
      for (const row of error.owned ?? []) known.set(row.pid, row);
      signalDetached();
      throw error;
    }
    for (const row of remaining) known.set(row.pid, row);
    if (remaining.length) {
      empty = 0; signalGroup(true); signalDetached();
    } else if (++empty === 2) return [...known.values()];
    await sleep(50);
  } while (performance.now() < deadline);
  throw new Error(`TEST_PROCESS_CLEANUP: no two consecutive empty snapshots: ${JSON.stringify(remaining)}`);
}
