// Process-group custody; visible descendants also receive metadata validation.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const inspectionError = detail => new Error(`TEST_PROCESS_INSPECTION: ${detail}`);
class TransientRouting extends Error {}

// Only recognized exit-time routing anomalies get another snapshot. Never
// drop a damaged row or let its apparent PID confer ownership/exemption.
// @ref LLP 3000#publication-suite-under-contention — three fresh snapshots,
// 50 ms apart; persistent malformed routing keeps the first refusal.
function freshSnapshots(inspect) {
  let first;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return inspect(); }
    catch (error) {
      first ??= error;
      if (!(error instanceof TransientRouting) || attempt === 2) throw first;
      // This inspection API is synchronous; only this rare retry path waits.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

function psMetadata(rest) {
  const match = /^(-?\d+)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+([A-Za-z?][A-Za-z0-9+<>-]*?)\s+(.*)$/.exec(rest);
  return match && Number(match[1]) >= -0x80000000 && Number(match[1]) <= 0xffffffff
    && Number.isFinite(Date.parse(match[2].replace(/\s+/g, ' '))) ? match : undefined;
}

function transientRouting(ids, rest, platform) {
  if (!ids || ids[0] < 1 || !ids.slice(0, 2).every(id => Number.isSafeInteger(id) && id >= 0 && id <= 0x7fffffff)) return false;
  const sentinel = ids[2] === -1 || ids[2] === 0xffffffff;
  const linuxCandidate = platform === 'linux'
    && (sentinel || (ids[1] === 0 && ids[2] >= 0 && ids[2] <= 0x7fffffff));
  if (!linuxCandidate && !(platform === 'darwin' && sentinel)) return false;
  const state = psMetadata(rest)?.[3];
  // Linux X is dead, with only procps stat flags permitted here. Darwin X is
  // a *traced flag*, E is exiting, and ? is unknown (never evidence of death).
  if (linuxCandidate) return /^X[<NLsl+]*$/.test(state ?? '');
  if (platform === 'darwin') return sentinel && /^[RUSITHZ?][<NXEVLs+]*$/.test(state ?? '')
    && (state[0] === 'Z' || state[0] === '?' || state.slice(1).includes('E'));
  return false;
}

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
// confused with a failed command. C locale fixes lstart's words, not spacing.
// @ref LLP 3000#publication-suite-under-contention — classify every routing
// prefix before validating metadata; unrelated rows cannot refuse a file.
export function processTable(options = {}) {
  return freshSnapshots(() => processSnapshot(options));
}

function processSnapshot({ run = spawnSync, exists = processExists, platform = process.platform, group, pid, onDiagnostic = () => {} }) {
  const result = run('ps', ['-axo', 'pid=,ppid=,pgid=,uid=,lstart=,stat=,comm='], {
    timeout: 2000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (result.error || result.status !== 0 || !result.stdout?.toString().trim())
    throw inspectionError(`ps failed: ${result.error?.message ?? `status ${result.status}, signal ${result.signal}`}; ${result.stderr ?? ''}`);
  // Split bytes, not decoded text, so a rejected row retains its exact bytes.
  const rows = Buffer.from(result.stdout).toString('latin1').split('\n').filter(Boolean).map(bytes => {
    const raw = Buffer.from(bytes, 'latin1'), line = raw.toString('utf8');
    const prefix = /^\s*(\d+)\s+(\d+)\s+(-?\d+)(?:\s+|$)/.exec(line);
    const ids = prefix?.slice(1).map(Number);
    const rest = prefix ? line.slice(prefix[0].length) : '';
    if (transientRouting(ids, rest, platform)) throw new TransientRouting(inspectionError(JSON.stringify({
      firstError: 'transient ps row: pid/ppid/pgid', rawBase64: raw.toString('base64'),
    })).message);
    // PID 0 / PGID 0 are real kernel rows. Never guess ownership from a
    // damaged prefix, even if its apparent PID has since disappeared.
    if (!ids || !ids.every(id => Number.isSafeInteger(id) && id >= 0 && id <= 0x7fffffff))
      metadataFailure(undefined, Error('malformed ps row: pid/ppid/pgid'), raw, exists);
    return { pid: ids[0], parent: ids[1], group: ids[2], raw, rest };
  });
  let selected;
  if (group !== undefined) {
    // Index once: order-independent, linear even for a 5,000-row deep tree.
    const children = new Map();
    for (const row of rows) {
      if (!children.has(row.parent)) children.set(row.parent, []);
      children.get(row.parent).push(row.pid);
    }
    const pending = [group, ...rows.filter(row => row.group === group).map(row => row.pid)];
    selected = new Set(pending);
    for (let i = 0; i < pending.length; i++) for (const child of children.get(pending[i]) ?? []) {
      if (!selected.has(child)) { selected.add(child); pending.push(child); }
    }
  } else if (pid !== undefined) selected = new Set([pid]);
  let unrelatedRows = 0;
  const parsed = rows.flatMap(row => {
    if (selected && !selected.has(row.pid)) { unrelatedRows++; return []; }
    // Darwin formats uid_t through a signed decimal; Linux uses unsigned.
    // lstart is five whitespace-separated C-locale fields, never a fixed width.
    // stat has platform-specific flags; only Z is nonliving. The rest of the
    // line is comm, including spaces, parentheses and <defunct>.
    const match = psMetadata(row.rest);
    const start = match?.[2].replace(/\s+/g, ' ');
    if (!match) {
      metadataFailure(row.pid, Error('malformed ps row'), row.raw, exists);
      return [];
    }
    const [, uid, , state, executable] = match;
    return { pid: row.pid, parent: row.parent, group: row.group, uid: Number(uid), start, executable, alive: !state.startsWith('Z') };
  });
  onDiagnostic({ unrelatedRows });
  return parsed;
}

// @ref LLP 3000#publication-suite-under-contention — a vanished candidate is
// exited; only malformed metadata for a still-present PID refuses inspection.
export function identity(pid, { platform = process.platform, read = readFileSync, exists = processExists, inspect = processTable, group } = {}) {
  if (!Number.isInteger(pid) || pid < 1) throw inspectionError(`invalid PID ${pid}`);
  // A fresh Darwin table must reclassify the file's scope before metadata
  // validation: this PID may now name an unrelated replacement process.
  if (platform !== 'linux') return inspect({ pid, group }).find(row => row.pid === pid);
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
  return inspect({ group: keeper.pid }).filter(row => row.alive && row.group === keeper.pid && (includeKeeper || row.pid !== keeper.pid))
    .flatMap(row => {
      // A table is a snapshot: a vanished member has exited. Recheck group
      // membership too, so a reused PID or a process that left is not a leak.
      const current = identity(row.pid, { group: keeper.pid });
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
