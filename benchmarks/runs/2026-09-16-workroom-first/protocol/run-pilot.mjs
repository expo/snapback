#!/usr/bin/env node
// Run the one 2026-09-16 Workroom diagnostic pilot in the foreground.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync, closeSync, constants, copyFileSync, existsSync, lstatSync,
  mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statfsSync,
  writeFileSync, writeSync,
} from 'node:fs';
import { freemem, loadavg, totalmem } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_NODE = 'v24.13.1';
const MODEL = 'gpt-5.6-sol';
const EFFORT = 'xhigh';
const MAX_MS = 4 * 60 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
export const CUSTODY_SAMPLE_MS = 5_000;
const GRACEFUL_CANCEL_MS = 5_000;
const TERMINAL_CLEANUP_MS = 30_000;
const MIN_FREE_BYTES = 2n * 1024n * 1024n * 1024n;
export const CUSTODY_LIMITATION =
  'Sampled ancestry cannot see a process that double-forks and reparents between snapshots; this is not generic subtree custody.';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const iso = () => new Date().toISOString();
function fail(code, detail = '') { throw new Error(detail ? `${code}: ${detail}` : code); }
function intentionalStop(reason) {
  return ['four-hour-operational-ceiling', 'disk-floor', 'driver-SIGINT', 'driver-SIGTERM'].includes(reason);
}
function writePrivate(path, value) {
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
}
function within(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`);
}
function gitRoot(directory) {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? resolve(result.stdout.trim()) : null;
}
function diskFree(path) {
  const fs = statfsSync(path, { bigint: true });
  return fs.bavail * fs.bsize;
}
function fileReceipt(path) {
  if (!existsSync(path) || !lstatSync(path).isFile()) return null;
  const bytes = readFileSync(path);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}
function expectedPacketFiles(manifest) {
  const files = [];
  for (const file of manifest.files ?? []) files.push([file.staged, file.copied]);
  files.push([manifest.brief?.staged, manifest.brief?.rendered]);
  files.push([manifest.prompt?.staged, manifest.prompt?.copied]);
  for (const profile of ['starter', 'conformance']) {
    for (const file of manifest.generatedProfiles?.[profile]?.files ?? []) files.push([file.path, file]);
  }
  return files;
}
function packetIntegrity(packet, manifest, capturedManifest) {
  const failures = [];
  let checked = 0;
  for (const [relativePath, expected] of expectedPacketFiles(manifest)) {
    checked++;
    try {
      if (typeof relativePath !== 'string' || !expected) fail('PILOT_PACKET_BINDING_INVALID');
      const path = join(packet, relativePath);
      if (!existsSync(path) || !lstatSync(path).isFile()) fail('PILOT_PACKET_FILE_MISSING');
      const actualPath = realpathSync(path);
      if (!within(packet, actualPath)) fail('PILOT_PACKET_PATH_ESCAPE');
      const actual = fileReceipt(actualPath);
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) fail('PILOT_PACKET_FILE_CHANGED');
    } catch (error) {
      failures.push({ path: relativePath ?? null, reason: error.message });
    }
  }
  if (capturedManifest) {
    checked++;
    const current = fileReceipt(capturedManifest.path);
    if (!current || current.bytes !== capturedManifest.bytes || current.sha256 !== capturedManifest.sha256) {
      failures.push({ path: 'stage-manifest.json', reason: 'PILOT_STAGE_MANIFEST_CHANGED' });
    }
  }
  return { ok: failures.length === 0, checked, failures };
}
function childEnvironment() {
  const allowed = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ', 'NO_COLOR', 'USER', 'LOGNAME', 'SHELL'];
  const env = {};
  for (const key of allowed) if (process.env[key]) env[key] = process.env[key];
  if (!env.HOME || !env.PATH) fail('PILOT_ENV_REQUIRED', 'HOME and PATH must be supplied');
  env.TMPDIR ??= '/tmp';
  return env;
}
function findExactRollout(home, threadId) {
  if (!threadId) return { status: 'unavailable', reason: 'thread.started did not provide an id' };
  const root = join(home, '.codex', 'sessions');
  if (!existsSync(root)) return { status: 'unavailable', reason: 'native sessions directory absent' };
  const wanted = `-${threadId}.jsonl`;
  const matches = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(wanted)) matches.push(path);
    }
  }
  visit(root);
  if (matches.length !== 1) return {
    status: 'unavailable',
    reason: matches.length === 0 ? 'no exact thread-id rollout found' : 'multiple exact thread-id rollouts found',
    matchCount: matches.length,
  };
  return { status: 'found', path: matches[0] };
}
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

export function parseProcessSnapshot(output) {
  const rows = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^\s*(\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.*)$/);
    if (!match) fail('PILOT_PROCESS_SNAPSHOT_PARSE', line);
    const [, pid, uid, ppid, pgid, startTime, command] = match;
    rows.push({
      pid: Number(pid), uid: Number(uid), ppid: Number(ppid), pgid: Number(pgid),
      startTime, startToken: `${pid}:${startTime}`, commandSha256: sha256(command),
    });
  }
  return rows;
}

export function processSnapshot(env = process.env) {
  const observed = spawnSync('ps', ['-axo', 'pid=,uid=,ppid=,pgid=,lstart=,command='], {
    env: { ...env, LC_ALL: 'C' }, encoding: 'utf8', timeout: 2_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (observed.error) fail('PILOT_PROCESS_SNAPSHOT_FAILED', observed.error.message);
  if (observed.status !== 0) fail('PILOT_PROCESS_SNAPSHOT_FAILED', observed.stderr?.trim() || `status ${observed.status}`);
  return parseProcessSnapshot(observed.stdout);
}

function stableIdentityMatches(identity, observed) {
  return Boolean(observed)
    && identity.pid === observed.pid
    && identity.uid === observed.uid
    && identity.startToken === observed.startToken;
}

function identityReference(identity) {
  return {
    pid: identity.pid, uid: identity.uid, startTime: identity.startTime,
    startToken: identity.startToken, commandSha256: identity.commandSha256,
  };
}

function snapshotIdentity(observed, detail = {}) {
  return {
    pid: observed.pid, startTime: observed.startTime, startToken: observed.startToken,
    uid: observed.uid, ppid: observed.ppid, pgid: observed.pgid,
    commandSha256: observed.commandSha256, ...detail,
  };
}

export class ProcessCustody {
  constructor({ uid, snapshot, signalPid, signalGroup, sleep = delay, now = iso, record = () => {}, timings = {} }) {
    this.uid = uid;
    this.snapshot = snapshot;
    this.signalPid = signalPid;
    this.signalGroup = signalGroup;
    this.sleep = sleep;
    this.now = now;
    this.record = record;
    this.timings = {
      pollMs: timings.pollMs ?? 100,
      gracefulMs: timings.gracefulMs ?? GRACEFUL_CANCEL_MS,
      groupTermMs: timings.groupTermMs ?? 30_000,
      groupKillMs: timings.groupKillMs ?? 10_000,
      descendantTermMs: timings.descendantTermMs ?? 5_000,
      descendantKillMs: timings.descendantKillMs ?? 5_000,
      pidTermMs: timings.pidTermMs ?? 5_000,
      pidKillMs: timings.pidKillMs ?? 5_000,
    };
    this.ledger = [];
    this.byPid = new Map();
    this.groupLedger = new Map();
    this.events = [];
    this.uncertainties = [];
    this._uncertaintyKeys = new Set();
    this._recordFailureLatched = false;
    this.cleanupPromise = null;
    this.leader = null;
    this.leaderGroupVerified = false;
    this.lastSnapshotAt = null;
    this.lastRows = [];
  }

  emit(event, detail = {}) {
    const entry = { at: this.now(), event, ...detail };
    this.events.push(entry);
    try {
      this.record(entry);
    } catch (error) {
      if (!this._recordFailureLatched) {
        this._recordFailureLatched = true;
        let message = 'record callback threw';
        try { message = error instanceof Error ? error.message : String(error); }
        catch { /* Keep recorder failure handling non-throwing even for an exotic thrown value. */ }
        this.uncertainties.push({
          at: entry.at, code: 'PILOT_CUSTODY_RECORD_FAILED', event: entry.event, message,
        });
      }
    }
    return entry;
  }

  uncertain(code, detail = {}, key = `${code}:${JSON.stringify(detail)}`) {
    if (this._uncertaintyKeys.has(key)) return;
    this._uncertaintyKeys.add(key);
    const entry = { at: this.now(), code, ...detail };
    this.uncertainties.push(entry);
    this.emit('custody-uncertainty', entry);
  }

  seedLeader(observed, { expectedPid, expectedPgid, launcherPid }) {
    if (!observed || observed.pid !== expectedPid || observed.uid !== this.uid
        || observed.ppid !== launcherPid) {
      fail('PILOT_CODEX_IDENTITY_UNVERIFIED', JSON.stringify(observed ?? null));
    }
    const at = this.now();
    const leader = snapshotIdentity(observed, {
      role: 'codex-leader', parentIdentity: null, depth: 0,
      firstSeenAt: at, lastSeenAt: at, lastObserved: snapshotIdentity(observed),
    });
    this.leader = leader;
    this.ledger.push(leader);
    this.byPid.set(leader.pid, leader);
    this.leaderGroupVerified = observed.pgid === expectedPgid;
    this.emit('identity-adopted', { identity: identityReference(leader), role: leader.role, pgid: leader.pgid });
    if (!this.leaderGroupVerified) {
      this.uncertain('PILOT_CODEX_GROUP_UNVERIFIED', { expectedPgid, observedPgid: observed.pgid });
    }
    return leader;
  }

  noteDescendantGroup(identity, observed, at) {
    if (!this.leader || identity === this.leader || observed.pgid === this.leader.pgid) return;
    const group = this.groupLedger.get(observed.pgid) ?? {
      pgid: observed.pgid, firstSeenAt: at, lastSeenAt: at, members: new Map(),
    };
    group.lastSeenAt = at;
    group.members.set(`${identity.pid}:${identity.startToken}`, identityReference(observed));
    this.groupLedger.set(observed.pgid, group);
  }

  observeRows(rows, { adopt = false } = {}) {
    const at = this.now();
    this.lastSnapshotAt = at;
    this.lastRows = rows;
    const byPid = new Map(rows.map(row => [row.pid, row]));
    const verified = new Map();
    for (const identity of this.ledger) {
      const observed = byPid.get(identity.pid);
      if (stableIdentityMatches(identity, observed)) {
        identity.lastSeenAt = at;
        const changed = identity.lastObserved.ppid !== observed.ppid
          || identity.lastObserved.pgid !== observed.pgid
          || identity.lastObserved.commandSha256 !== observed.commandSha256;
        if (changed) {
          this.emit('identity-coordinates-changed', {
            identity: identityReference(identity),
            from: {
              ppid: identity.lastObserved.ppid, pgid: identity.lastObserved.pgid,
              commandSha256: identity.lastObserved.commandSha256,
            },
            to: {
              ppid: observed.ppid, pgid: observed.pgid,
              commandSha256: observed.commandSha256,
            },
          });
        }
        this.noteDescendantGroup(identity, observed, at);
        identity.lastObserved = snapshotIdentity(observed);
        verified.set(identity.pid, identity);
      } else if (observed) {
        this.uncertain('PILOT_PID_IDENTITY_CHANGED', {
          recorded: identityReference(identity),
          observed: identityReference(observed),
        }, `pid-reuse:${identity.pid}:${observed.startToken}:${observed.uid}`);
      }
    }

    if (!adopt || verified.size === 0) return { rows, byPid, verified };
    let added = true;
    while (added) {
      added = false;
      for (const observed of rows) {
        if (verified.has(observed.pid)) continue;
        const parent = verified.get(observed.ppid);
        if (!parent) continue;
        if (observed.uid !== this.uid) {
          this.uncertain('PILOT_FOREIGN_DESCENDANT_REFUSED', {
            pid: observed.pid, uid: observed.uid, ppid: observed.ppid,
            parentIdentity: identityReference(parent),
          }, `foreign-child:${observed.pid}:${observed.startToken}`);
          continue;
        }
        if (this.byPid.has(observed.pid)) {
          const prior = this.byPid.get(observed.pid);
          this.uncertain('PILOT_REUSED_DESCENDANT_PID_REFUSED', {
            recorded: identityReference(prior), observed: identityReference(observed),
          }, `reused-child:${observed.pid}:${observed.startToken}`);
          continue;
        }
        const identity = snapshotIdentity(observed, {
          role: 'adopted-descendant', parentIdentity: identityReference(parent),
          depth: parent.depth + 1, firstSeenAt: at, lastSeenAt: at,
          lastObserved: snapshotIdentity(observed),
        });
        this.ledger.push(identity);
        this.byPid.set(identity.pid, identity);
        verified.set(identity.pid, identity);
        this.noteDescendantGroup(identity, observed, at);
        this.emit('identity-adopted', {
          identity: identityReference(identity), role: identity.role,
          parentIdentity: identity.parentIdentity, ppid: identity.ppid, pgid: identity.pgid,
        });
        added = true;
      }
    }
    return { rows, byPid, verified };
  }

  async sample({ adopt = false } = {}) {
    return this.observeRows(await this.snapshot(), { adopt });
  }

  terminalDeadlineExceeded(deadline, reason, phase) {
    if (deadline === null || Date.now() < deadline) return false;
    this.uncertain('PILOT_TERMINAL_CLEANUP_DEADLINE_EXHAUSTED', {
      reason, phase, limitMilliseconds: TERMINAL_CLEANUP_MS,
    }, 'terminal-cleanup-deadline');
    return true;
  }

  async signalExact(identity, signal, reason, deadline = null) {
    if (this.terminalDeadlineExceeded(deadline, reason, 'before-exact-pid-signal')) {
      return { signalled: false, gone: false, deadlineExhausted: true };
    }
    const state = await this.sample({ adopt: true });
    if (this.terminalDeadlineExceeded(deadline, reason, 'before-exact-pid-signal')) {
      return { signalled: false, gone: false, deadlineExhausted: true };
    }
    const observed = state.byPid.get(identity.pid);
    if (!observed) {
      this.emit('exact-pid-disappeared', { reason, signal, identity: identityReference(identity), after: 'no-signal' });
      return { signalled: false, gone: true };
    }
    if (!stableIdentityMatches(identity, observed)) {
      this.uncertain('PILOT_EXACT_PID_SIGNAL_REFUSED', {
        reason, signal, recorded: identityReference(identity), observed: identityReference(observed),
      }, `exact-refusal:${identity.pid}:${observed.startToken}:${signal}`);
      this.emit('exact-pid-signal-refused', { reason, signal, pid: identity.pid, cause: 'identity-changed' });
      return { signalled: false, gone: false, refused: true };
    }
    this.emit('exact-pid-signal', { reason, signal, identity: identityReference(identity) });
    try { await this.signalPid(identity.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    return {
      signalled: true, gone: false,
      deadlineExhausted: this.terminalDeadlineExceeded(deadline, reason, 'after-exact-pid-signal'),
    };
  }

  async gracefulCancel(reason, deadline) {
    if (!this.leader) return { attempted: false, outcome: 'leader-unverified' };
    const sent = await this.signalExact(this.leader, 'SIGINT', reason, deadline);
    if (sent.deadlineExhausted) return {
      attempted: sent.signalled, ...(sent.signalled ? { signal: 'SIGINT' } : {}),
      outcome: 'cleanup-deadline-exhausted',
    };
    if (!sent.signalled) return {
      attempted: false, outcome: sent.gone ? 'leader-already-gone' : 'identity-refused',
    };
    const until = Math.min(Date.now() + this.timings.gracefulMs, deadline);
    while (Date.now() < until) {
      await this.sleep(Math.min(this.timings.pollMs, Math.max(0, until - Date.now()),
        Math.max(0, deadline - Date.now())));
      if (this.terminalDeadlineExceeded(deadline, reason, 'before-graceful-cancel-snapshot')) {
        return { attempted: true, signal: 'SIGINT', outcome: 'cleanup-deadline-exhausted' };
      }
      const state = await this.sample({ adopt: true });
      if (this.terminalDeadlineExceeded(deadline, reason, 'after-graceful-cancel-snapshot')) {
        return { attempted: true, signal: 'SIGINT', outcome: 'cleanup-deadline-exhausted' };
      }
      const observed = state.byPid.get(this.leader.pid);
      if (!stableIdentityMatches(this.leader, observed)) {
        this.emit('graceful-cancel-complete', { reason, signal: 'SIGINT', outcome: 'leader-exited' });
        return { attempted: true, signal: 'SIGINT', outcome: 'leader-exited' };
      }
    }
    if (this.terminalDeadlineExceeded(deadline, reason, 'graceful-cancel-wait')) {
      return { attempted: true, signal: 'SIGINT', outcome: 'cleanup-deadline-exhausted' };
    }
    this.emit('graceful-cancel-complete', { reason, signal: 'SIGINT', outcome: 'grace-expired' });
    return { attempted: true, signal: 'SIGINT', outcome: 'grace-expired' };
  }

  groupMembers(rows, pgid) {
    return rows.filter(row => row.pgid === pgid);
  }

  validateGroup(rows, pgid, reason) {
    const members = this.groupMembers(rows, pgid);
    const unknown = members.filter(observed => {
      const identity = this.byPid.get(observed.pid);
      return !identity || !stableIdentityMatches(identity, observed);
    });
    if (unknown.length) {
      const detail = {
        reason, pgid,
        members: members.map(identityReference),
        unknown: unknown.map(identityReference),
      };
      this.uncertain('PILOT_GROUP_HAS_UNKNOWN_MEMBER', detail,
        `unsafe-group:${pgid}:${unknown.map(row => `${row.pid}:${row.startToken}:${row.uid}`).join(',')}`);
      this.emit('group-signal-refused', { ...detail, cause: 'unknown-or-nondescended-member' });
      return { safe: false, members, unknown };
    }
    return { safe: true, members, unknown: [] };
  }

  async groupState(pgid, reason, deadline) {
    if (this.terminalDeadlineExceeded(deadline, reason, 'before-group-snapshot')) {
      return {
        safe: false, members: this.groupMembers(this.lastRows, pgid), unknown: [],
        rows: this.lastRows, deadlineExhausted: true,
      };
    }
    const state = await this.sample({ adopt: true });
    const validation = this.validateGroup(state.rows, pgid, reason);
    return {
      ...validation, rows: state.rows,
      deadlineExhausted: this.terminalDeadlineExceeded(deadline, reason, 'after-group-snapshot'),
    };
  }

  async waitForGroup(pgid, milliseconds, reason, deadline) {
    const until = Date.now() + milliseconds;
    for (;;) {
      const state = await this.groupState(pgid, reason, deadline);
      if (state.deadlineExhausted) {
        return { gone: state.members.length === 0, deadlineExhausted: true };
      }
      if (state.members.length === 0) return { gone: true };
      if (!state.safe) return { gone: false, refused: true };
      if (Date.now() >= until) return { gone: false };
      await this.sleep(Math.min(this.timings.pollMs, Math.max(0, until - Date.now()),
        Math.max(0, deadline - Date.now())));
    }
  }

  async cleanupGroup(pgid, reason, deadline, { descendant = false } = {}) {
    let state = await this.groupState(pgid, reason, deadline);
    if (state.deadlineExhausted) {
      return { pgid, disappeared: false, descendant, deadlineExhausted: true };
    }
    if (state.members.length === 0) {
      this.emit('group-disappeared', { reason, pgid, after: 'no-signal', descendant });
      return { pgid, disappeared: true, after: 'no-signal', descendant };
    }
    if (!state.safe) return { pgid, disappeared: false, refused: true, descendant };
    this.emit('group-signal', { reason, pgid, signal: 'SIGTERM', descendant, members: state.members.map(identityReference) });
    try { await this.signalGroup(pgid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    if (this.terminalDeadlineExceeded(deadline, reason, 'after-group-SIGTERM')) {
      return { pgid, disappeared: false, descendant, after: 'SIGTERM', deadlineExhausted: true };
    }
    const term = await this.waitForGroup(pgid,
      descendant ? this.timings.descendantTermMs : this.timings.groupTermMs, reason, deadline);
    if (term.deadlineExhausted) {
      return {
        pgid, disappeared: term.gone, descendant, after: 'SIGTERM', deadlineExhausted: true,
      };
    }
    if (term.gone) {
      this.emit('group-disappeared', { reason, pgid, after: 'SIGTERM', descendant });
      return { pgid, disappeared: true, after: 'SIGTERM', descendant };
    }
    if (term.refused) return { pgid, disappeared: false, refused: true, after: 'SIGTERM', descendant };
    state = await this.groupState(pgid, reason, deadline);
    if (state.deadlineExhausted) {
      return { pgid, disappeared: false, descendant, after: 'SIGTERM', deadlineExhausted: true };
    }
    if (!state.safe) return { pgid, disappeared: false, refused: true, after: 'SIGTERM', descendant };
    this.emit('group-signal', { reason, pgid, signal: 'SIGKILL', descendant, members: state.members.map(identityReference) });
    try { await this.signalGroup(pgid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    if (this.terminalDeadlineExceeded(deadline, reason, 'after-group-SIGKILL')) {
      return { pgid, disappeared: false, descendant, after: 'SIGKILL', deadlineExhausted: true };
    }
    const killed = await this.waitForGroup(pgid,
      descendant ? this.timings.descendantKillMs : this.timings.groupKillMs, reason, deadline);
    this.emit(killed.gone ? 'group-disappeared' : 'group-still-present', {
      reason, pgid, after: 'SIGKILL', descendant, refused: Boolean(killed.refused),
    });
    return {
      pgid, disappeared: killed.gone, refused: Boolean(killed.refused), after: 'SIGKILL', descendant,
      deadlineExhausted: Boolean(killed.deadlineExhausted),
    };
  }

  descendantGroups() {
    return [...this.groupLedger.values()]
      .map(group => ({ ...group, members: [...group.members.values()] }))
      .sort((a, b) => a.pgid - b.pgid);
  }

  currentDescendantGroupIds() {
    const current = new Set();
    const byPid = new Map(this.lastRows.map(row => [row.pid, row]));
    for (const identity of this.ledger) {
      if (identity === this.leader) continue;
      const observed = byPid.get(identity.pid);
      if (stableIdentityMatches(identity, observed) && observed.pgid !== this.leader?.pgid) {
        current.add(observed.pgid);
      }
    }
    return [...current].sort((a, b) => a - b);
  }

  async waitForExactGone(identities, milliseconds, reason, deadline) {
    const until = Date.now() + milliseconds;
    for (;;) {
      if (this.terminalDeadlineExceeded(deadline, reason, 'before-exact-pid-wait')) {
        return { remaining: identities, deadlineExhausted: true };
      }
      const state = await this.sample({ adopt: true });
      const remaining = identities.filter(identity => stableIdentityMatches(identity, state.byPid.get(identity.pid)));
      if (this.terminalDeadlineExceeded(deadline, reason, 'after-exact-pid-snapshot')) {
        return { remaining, deadlineExhausted: true };
      }
      if (remaining.length === 0) return { remaining: [] };
      if (Date.now() >= until) return { remaining };
      await this.sleep(Math.min(this.timings.pollMs, Math.max(0, until - Date.now()),
        Math.max(0, deadline - Date.now())));
    }
  }

  async cleanupExactPids(reason, identities, deadline) {
    if (this.terminalDeadlineExceeded(deadline, reason, 'before-exact-pid-cleanup')) {
      return { remaining: identities, deadlineExhausted: true };
    }
    const state = await this.sample({ adopt: true });
    const live = identities
      .filter(identity => stableIdentityMatches(identity, state.byPid.get(identity.pid)))
      .sort((a, b) => b.depth - a.depth || b.pid - a.pid);
    for (const identity of live) {
      const result = await this.signalExact(identity, 'SIGTERM', reason, deadline);
      if (result.deadlineExhausted) return { remaining: live, deadlineExhausted: true };
    }
    let waited = await this.waitForExactGone(live, this.timings.pidTermMs, reason, deadline);
    if (waited.deadlineExhausted) return waited;
    for (const identity of waited.remaining) {
      const result = await this.signalExact(identity, 'SIGKILL', reason, deadline);
      if (result.deadlineExhausted) return { remaining: waited.remaining, deadlineExhausted: true };
    }
    waited = await this.waitForExactGone(waited.remaining, this.timings.pidKillMs, reason, deadline);
    for (const identity of waited.remaining) {
      this.emit('exact-pid-still-present', { reason, after: 'SIGKILL', identity: identityReference(identity) });
    }
    return waited;
  }

  async cleanup({ reason, intentional = false } = {}) {
    return this.cleanupPromise ??= this._cleanup({ reason, intentional });
  }

  async _cleanup({ reason, intentional }) {
    const terminalDeadline = Date.now() + TERMINAL_CLEANUP_MS;
    let gracefulCancellation = { attempted: false, outcome: 'not-an-intentional-stop' };
    if (intentional) {
      try { gracefulCancellation = await this.gracefulCancel(reason, terminalDeadline); }
      catch (error) {
        gracefulCancellation = { attempted: false, outcome: 'graceful-cancel-error', error: error.message };
        this.uncertain('PILOT_GRACEFUL_CANCEL_FAILED', { reason, message: error.message });
      }
    }

    const groupCleanups = [];
    const processedGroups = new Set();
    const processedExact = new Set();
    let leaderGroupHandled = false;
    let finalRows = [];
    for (;;) {
      if (this.terminalDeadlineExceeded(terminalDeadline, reason, 'before-terminal-snapshot')) break;
      let state;
      try { state = await this.sample({ adopt: true }); }
      catch (error) {
        this.uncertain('PILOT_TERMINAL_SNAPSHOT_FAILED', { reason, message: error.message });
        break;
      }
      finalRows = state.rows;
      if (this.terminalDeadlineExceeded(terminalDeadline, reason, 'after-terminal-snapshot')) break;

      const targetPgid = this.currentDescendantGroupIds()
        .find(pgid => !processedGroups.has(pgid));
      if (targetPgid !== undefined) {
        processedGroups.add(targetPgid);
        try {
          const cleanup = await this.cleanupGroup(targetPgid, reason, terminalDeadline, { descendant: true });
          groupCleanups.push(cleanup);
          if (cleanup.deadlineExhausted) break;
        } catch (error) {
          groupCleanups.push({ pgid: targetPgid, disappeared: false, descendant: true, error: error.message });
          this.uncertain('PILOT_DESCENDANT_GROUP_CLEANUP_FAILED', {
            reason, pgid: targetPgid, message: error.message,
          });
        }
        continue;
      }

      if (!leaderGroupHandled && this.leader) {
        leaderGroupHandled = true;
        processedGroups.add(this.leader.pgid);
        if (this.leaderGroupVerified) {
          try {
            const cleanup = await this.cleanupGroup(this.leader.pgid, reason, terminalDeadline, { descendant: false });
            groupCleanups.push(cleanup);
            if (cleanup.deadlineExhausted) break;
          } catch (error) {
            groupCleanups.push({ pgid: this.leader.pgid, disappeared: false, descendant: false, error: error.message });
            this.uncertain('PILOT_CODEX_GROUP_CLEANUP_FAILED', {
              reason, pgid: this.leader.pgid, message: error.message,
            });
          }
        } else {
          this.emit('group-signal-refused', {
            reason, pgid: this.leader.pgid, cause: 'codex-group-was-not-verified-at-spawn',
          });
        }
        continue;
      }

      const liveExact = this.ledger.filter(identity => {
        const key = `${identity.pid}:${identity.startToken}:${identity.uid}`;
        return !processedExact.has(key) && stableIdentityMatches(identity, state.byPid.get(identity.pid));
      });
      if (liveExact.length) {
        for (const identity of liveExact) {
          processedExact.add(`${identity.pid}:${identity.startToken}:${identity.uid}`);
        }
        try {
          const cleanup = await this.cleanupExactPids(reason, liveExact, terminalDeadline);
          if (cleanup.deadlineExhausted) break;
        } catch (error) {
          this.uncertain('PILOT_EXACT_PID_CLEANUP_FAILED', { reason, message: error.message });
        }
        continue;
      }
      break;
    }

    if (this.terminalDeadlineExceeded(terminalDeadline, reason, 'terminal-verification')) {
      try {
        const finalState = await this.sample({ adopt: true });
        finalRows = finalState.rows;
      } catch (error) {
        this.uncertain('PILOT_FINAL_SNAPSHOT_FAILED', { reason, message: error.message });
      }
    }
    const finalByPid = new Map(finalRows.map(row => [row.pid, row]));
    const survivors = this.ledger
      .filter(identity => stableIdentityMatches(identity, finalByPid.get(identity.pid)))
      .map(identity => ({ ...identityReference(identity), pgid: finalByPid.get(identity.pid).pgid }));
    const adoptedGroups = this.descendantGroups();
    const terminalDeadlineExhausted = this.uncertainties.some(
      uncertainty => uncertainty.code === 'PILOT_TERMINAL_CLEANUP_DEADLINE_EXHAUSTED',
    );
    const receipt = {
      ok: this.uncertainties.length === 0 && survivors.length === 0,
      gracefulCancellation,
      leaderIdentity: this.leader ? snapshotIdentity(this.leader) : null,
      adoptedIdentities: this.ledger.map(identity => ({
        ...snapshotIdentity(identity), parentIdentity: identity.parentIdentity,
        role: identity.role, depth: identity.depth,
        firstSeenAt: identity.firstSeenAt, lastSeenAt: identity.lastSeenAt,
        lastObserved: snapshotIdentity(identity.lastObserved),
      })),
      adoptedGroups, groupCleanups,
      terminalCleanup: { limitMilliseconds: TERMINAL_CLEANUP_MS, exhausted: terminalDeadlineExhausted },
      uncertainties: this.uncertainties,
      survivors, events: this.events,
      limitation: CUSTODY_LIMITATION,
      custodyClaim: 'same-UID ancestry observed in bounded process snapshots only',
      coldCellCoverage: {
        status: 'external-actual-codex-receipt-required', eligibleFromThisReceipt: false,
        reason: 'Actual-Codex ordinary exec-spawn/session coverage must pass before a cold cell.',
      },
    };
    const completion = this.emit('custody-cleanup-complete', {
      reason, ok: receipt.ok, uncertaintyCount: receipt.uncertainties.length,
      survivorCount: receipt.survivors.length,
    });
    receipt.ok = receipt.uncertainties.length === 0 && receipt.survivors.length === 0;
    completion.ok = receipt.ok;
    completion.uncertaintyCount = receipt.uncertainties.length;
    return receipt;
  }
}

export async function cleanupAfterActiveSample(activeSample, cleanup) {
  if (activeSample) await activeSample;
  return cleanup();
}

export async function runPilot(rootArgument, { telemetry = false } = {}) {
  if (process.platform === 'win32') fail('PILOT_POSIX_REQUIRED');
  if (process.version !== REQUIRED_NODE) fail('PILOT_NODE_VERSION', `need ${REQUIRED_NODE}, got ${process.version}`);
  const root = realpathSync(resolve(rootArgument));
  if (gitRoot(root)) fail('PILOT_ROOT_IN_REPO', root);
  const app = realpathSync(join(root, 'app'));
  const packet = realpathSync(join(root, 'packet'));
  if (!within(root, app) || !within(root, packet)) fail('PILOT_STAGED_PATH_ESCAPE');
  if (readdirSync(app).length !== 0) fail('PILOT_APP_NOT_FRESH', app);
  const manifestPath = join(packet, 'stage-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== 1 || manifest.kind !== 'workroom-diagnostic-pilot-packet'
      || manifest.snapback4 !== '0.2.26' || manifest.rawHoldoutsDelivered !== false) {
    fail('PILOT_STAGE_MANIFEST_INVALID');
  }
  for (const profile of ['starter', 'conformance']) {
    if (manifest.generatedProfiles?.[profile]?.verified?.verified !== true) fail('PILOT_PROFILE_UNVERIFIED', profile);
  }
  const capturedManifest = fileReceipt(manifestPath);
  const initialIntegrity = packetIntegrity(packet, manifest, capturedManifest);
  if (!initialIntegrity.ok) fail('PILOT_PACKET_INTEGRITY', JSON.stringify(initialIntegrity.failures));
  const promptPath = join(packet, 'pilot-prompt.md');
  const prompt = readFileSync(promptPath);
  if (sha256(prompt) !== manifest.prompt.copied.sha256 || prompt.length !== manifest.prompt.copied.bytes) {
    fail('PILOT_PROMPT_CHANGED');
  }
  const initialFree = diskFree(root);
  if (initialFree < MIN_FREE_BYTES) fail('PILOT_DISK_FLOOR', `${initialFree} bytes available`);

  const privateDir = join(root, 'private');
  if (existsSync(privateDir)) fail('PILOT_RUN_ALREADY_EXISTS', privateDir);
  mkdirSync(privateDir, { mode: 0o700 });
  const stdoutPath = join(privateDir, 'codex.stdout.jsonl');
  const stderrPath = join(privateDir, 'codex.stderr.log');
  const heartbeatPath = join(privateDir, 'heartbeat.ndjson');
  const cleanupPath = join(privateDir, 'process-group.ndjson');
  const stdoutFd = openSync(stdoutPath, 'wx', 0o600);
  const stderrFd = openSync(stderrPath, 'wx', 0o600);
  const heartbeatFd = openSync(heartbeatPath, 'wx', 0o600);
  const cleanupFd = openSync(cleanupPath, 'wx', 0o600);
  const env = childEnvironment();
  const childNode = spawnSync('node', ['--version'], { env, encoding: 'utf8' });
  const childNodeVersion = childNode.stdout?.trim() ?? '';
  if (childNode.status !== 0 || childNodeVersion !== REQUIRED_NODE) {
    fail('PILOT_CHILD_NODE_VERSION', `need ${REQUIRED_NODE}, got ${childNodeVersion || childNode.stderr?.trim() || childNode.error?.message || 'unavailable'}`);
  }
  const version = spawnSync('codex', ['--version'], { env, encoding: 'utf8' });
  if (version.status !== 0) fail('PILOT_CODEX_UNAVAILABLE', version.stderr?.trim() ?? 'codex --version failed');

  const builderFinalPath = join(app, 'FINAL.md');
  const lastMessagePath = join(privateDir, 'last-message.md');
  const command = ['codex', 'exec', '--dangerously-bypass-approvals-and-sandbox',
    '--ignore-user-config', '--skip-git-repo-check', '--json', '--color', 'never',
    '-m', MODEL, '-c', `model_reasoning_effort=${EFFORT}`, '-C', app,
    '-o', lastMessagePath, '-'];
  const commandHash = sha256(JSON.stringify(command));
  const spawnedAt = iso();
  const monotonicStart = performance.now();
  const child = spawn(command[0], command.slice(1), {
    cwd: app, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (!child.pid) fail('PILOT_SPAWN_FAILED');
  const pgid = child.pid; // POSIX detached spawn creates a new group led by the child.
  const exitPromise = new Promise(resolveExit => {
    child.once('error', error => resolveExit({ code: null, signal: null, spawnError: error.message }));
    child.once('exit', (code, signal) => resolveExit({ code, signal, spawnError: null }));
  });
  const closePromise = new Promise(resolveClose => {
    child.once('error', error => resolveClose({ code: null, signal: null, spawnError: error.message }));
    child.once('close', (code, signal) => resolveClose({ code, signal, spawnError: null }));
  });
  const recordCustody = record => {
    try { writeSync(cleanupFd, JSON.stringify(record) + '\n'); } catch { /* end.json retains the in-memory record */ }
  };
  const custody = new ProcessCustody({
    uid: process.getuid(),
    snapshot: async () => processSnapshot(env),
    signalPid: async (pid, signal) => process.kill(pid, signal),
    signalGroup: async (targetPgid, signal) => process.kill(-targetPgid, signal),
    record: recordCustody,
  });
  let identitySeeded = false;
  const cleanupExactChild = async reason => {
    const alive = () => child.exitCode === null && child.signalCode === null;
    if (!alive()) {
      recordCustody({ at: iso(), event: 'exact-child-disappeared', reason, pid: child.pid, after: 'no-signal' });
      return { disappeared: true, exactChildOnly: true, after: 'no-signal' };
    }
    recordCustody({ at: iso(), event: 'exact-child-signal', reason, pid: child.pid, signal: 'SIGTERM' });
    try { child.kill('SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await Promise.race([exitPromise, delay(5_000)]);
    if (!alive()) {
      recordCustody({ at: iso(), event: 'exact-child-disappeared', reason, pid: child.pid, after: 'SIGTERM' });
      return { disappeared: true, exactChildOnly: true, after: 'SIGTERM' };
    }
    recordCustody({ at: iso(), event: 'exact-child-signal', reason, pid: child.pid, signal: 'SIGKILL' });
    try { child.kill('SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await Promise.race([exitPromise, delay(5_000)]);
    const disappeared = !alive();
    recordCustody({
      at: iso(), event: disappeared ? 'exact-child-disappeared' : 'exact-child-still-present',
      reason, pid: child.pid, after: 'SIGKILL',
    });
    return { disappeared, exactChildOnly: true, after: 'SIGKILL' };
  };
  let threadId = null;
  let stdoutText = '';
  let streamError = null;
  const onStdout = chunk => {
    try { writeSync(stdoutFd, chunk); }
    catch (error) { streamError ??= error.message; requestStop('stdout-log-failure'); }
    stdoutText += chunk.toString('utf8');
    let newline;
    while ((newline = stdoutText.indexOf('\n')) >= 0) {
      const line = stdoutText.slice(0, newline); stdoutText = stdoutText.slice(newline + 1);
      try {
        const event = JSON.parse(line);
        if (event.type === 'thread.started' && typeof (event.thread_id ?? event.threadId ?? event.id) === 'string') {
          threadId ??= event.thread_id ?? event.threadId ?? event.id;
        }
      } catch { /* Raw output is authoritative; malformed/non-JSON lines remain there. */ }
    }
  };
  const onStderr = chunk => {
    try { writeSync(stderrFd, chunk); }
    catch (error) { streamError ??= error.message; requestStop('stderr-log-failure'); }
  };
  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);
  child.stdin.on('error', () => {});
  let stop = null;
  let resolveStopRequested;
  const stopRequestedPromise = new Promise(resolveRequested => { resolveStopRequested = resolveRequested; });
  let custodyStopPromise = null;
  function startCustodyCleanup(reason) {
    if (!identitySeeded) return null;
    return custodyStopPromise ??= cleanupAfterActiveSample(custodySamplePromise, () => custody.cleanup({
      reason, intentional: intentionalStop(reason),
    }));
  }
  function requestStop(reason) {
    if (stop) return;
    stop = { reason, requestedAt: iso(), pid: child.pid, pgid };
    resolveStopRequested(stop);
    try { writePrivate(join(privateDir, 'termination.json'), stop); } catch (error) { stop.recordError = error.message; }
    if (custodySampleTimer) {
      clearInterval(custodySampleTimer);
      custodySampleTimer = null;
    }
    startCustodyCleanup(reason)
      ?.catch(error => { streamError ??= `custody cleanup: ${error.message}`; });
  }
  const onSigint = () => requestStop('driver-SIGINT');
  const onSigterm = () => requestStop('driver-SIGTERM');
  let heartbeatTimer = null;
  let ceilingTimer = null;
  let custodySampleTimer = null;
  let custodySamplePromise = null;
  let result = { code: null, signal: null, spawnError: null };
  let lifecycleError = null;
  let custodyCleanup = null;
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  try {
    const initialProcesses = await custody.snapshot();
    const observed = initialProcesses.find(row => row.pid === child.pid);
    const leaderIdentity = custody.seedLeader(observed, {
      expectedPid: child.pid, expectedPgid: pgid, launcherPid: process.pid,
    });
    identitySeeded = true;
    writePrivate(join(privateDir, 'pid.json'), {
      ...snapshotIdentity(leaderIdentity), expectedPgid: pgid, detachedChild: true, recordedAt: iso(),
    });
    if (!custody.leaderGroupVerified) fail('PILOT_PROCESS_GROUP_UNVERIFIED', `observed ${leaderIdentity.pgid}`);
    writePrivate(join(privateDir, 'process-group.json'), {
      ...snapshotIdentity(leaderIdentity), verifiedAt: iso(), source: 'bounded ps snapshot',
    });
    custody.observeRows(initialProcesses, { adopt: true });
    const deadlineAt = new Date(Date.now() + MAX_MS).toISOString();
    writePrivate(join(privateDir, 'start.json'), {
      kind: 'workroom-diagnostic-pilot', spawnedAt, promptDeliveredAt: iso(), deadlineAt,
      pid: child.pid, pgid, cwd: app, model: MODEL, effort: EFFORT,
      processIdentity: snapshotIdentity(leaderIdentity), custodySampleMilliseconds: CUSTODY_SAMPLE_MS,
      custodyLimitation: CUSTODY_LIMITATION,
      command, commandSha256: commandHash, ephemeral: false,
      codexVersion: version.stdout.trim(), node: process.version, childNode: childNodeVersion,
      prompt: { path: promptPath, bytes: prompt.length, sha256: sha256(prompt) },
      stageManifest: capturedManifest, packetIntegrity: initialIntegrity,
      environmentKeys: Object.keys(env).sort(), initialFreeBytes: initialFree.toString(),
      stdout: stdoutPath, stderr: stderrPath, lastMessage: lastMessagePath,
    });
    const heartbeat = () => {
      try {
        const free = diskFree(root);
        const record = {
          at: iso(), elapsedSeconds: Math.round((performance.now() - monotonicStart) / 1000),
          pid: child.pid, pgid, freeBytes: free.toString(),
          ...(telemetry ? { loadAverage: loadavg(), memory: { free: freemem(), total: totalmem() } } : {}),
        };
        writeSync(heartbeatFd, JSON.stringify(record) + '\n');
        console.log(`[pilot] heartbeat ${record.at} elapsed=${record.elapsedSeconds}s pid=${child.pid} freeGiB=${(Number(free) / 2 ** 30).toFixed(2)}`);
        if (free < MIN_FREE_BYTES) requestStop('disk-floor');
      } catch (error) {
        streamError ??= `heartbeat: ${error.message}`;
        requestStop('heartbeat-failure');
      }
    };
    heartbeat();
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
    custodySampleTimer = setInterval(() => {
      if (custodySamplePromise) return;
      custodySamplePromise = custody.sample({ adopt: true }).catch(error => {
        streamError ??= `custody snapshot: ${error.message}`;
        custody.uncertain('PILOT_LIVE_SNAPSHOT_FAILED', { message: error.message });
        requestStop('custody-snapshot-failure');
      }).finally(() => { custodySamplePromise = null; });
    }, CUSTODY_SAMPLE_MS);
    ceilingTimer = setTimeout(() => requestStop('four-hour-operational-ceiling'), MAX_MS);
    child.stdin.end(prompt);
    const terminal = await Promise.race([
      exitPromise.then(exit => ({ kind: 'exit', exit })),
      stopRequestedPromise.then(() => ({ kind: 'stop-requested' })),
    ]);
    if (terminal.kind === 'exit') {
      result = terminal.exit;
    } else {
      await startCustodyCleanup(stop.reason);
      result = await Promise.race([exitPromise, delay(250).then(() => result)]);
    }
  } catch (error) {
    lifecycleError = error.message;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (ceilingTimer) clearTimeout(ceilingTimer);
    if (custodySampleTimer) clearInterval(custodySampleTimer);
    if (custodySamplePromise) await custodySamplePromise;
    if (identitySeeded) {
      try {
        custodyCleanup = await startCustodyCleanup(
          stop?.reason ?? (lifecycleError ? 'lifecycle-error' : 'leader-exited'),
        );
      } catch (error) {
        custodyCleanup = {
          ok: false, error: error.message, uncertainties: [{ code: 'PILOT_CUSTODY_CLEANUP_FAILED', message: error.message }],
          survivors: [], limitation: CUSTODY_LIMITATION,
        };
        lifecycleError ??= `custody cleanup: ${error.message}`;
      }
    } else {
      recordCustody({ at: iso(), event: 'group-not-targeted', reason: 'Codex identity was not validated' });
      try {
        const fallback = await cleanupExactChild(lifecycleError ? 'lifecycle-error' : 'identity-unverified');
        custodyCleanup = {
          ok: false, exactChildFallback: fallback,
          uncertainties: [{ code: 'PILOT_CODEX_IDENTITY_UNVERIFIED' }], survivors: [],
          limitation: CUSTODY_LIMITATION,
          coldCellCoverage: {
            status: 'external-actual-codex-receipt-required', eligibleFromThisReceipt: false,
          },
        };
      } catch (error) {
        custodyCleanup = {
          ok: false, exactChildFallback: { disappeared: false, error: error.message },
          uncertainties: [{ code: 'PILOT_EXACT_CHILD_CLEANUP_FAILED', message: error.message }], survivors: [],
          limitation: CUSTODY_LIMITATION,
        };
        lifecycleError ??= `exact child cleanup: ${error.message}`;
      }
    }
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    await Promise.race([closePromise, delay(2_000)]);
    child.stdout.off('data', onStdout); child.stderr.off('data', onStderr);
    child.stdout.destroy(); child.stderr.destroy();
    if (child.exitCode === null && child.signalCode === null) child.unref();
    for (const fd of [stdoutFd, stderrFd, heartbeatFd, cleanupFd]) {
      try { closeSync(fd); } catch { /* end record carries lifecycle errors already observed */ }
    }
  }
  let nativeReceipt;
  try {
    const native = findExactRollout(env.HOME, threadId);
    nativeReceipt = native;
    if (native.status === 'found') {
      const retained = join(privateDir, basename(native.path));
      copyFileSync(native.path, retained, constants.COPYFILE_EXCL);
      chmodSync(retained, 0o600);
      nativeReceipt = { status: 'retained', source: native.path, ...fileReceipt(retained) };
    }
  } catch (error) {
    nativeReceipt = { status: 'unavailable', reason: `native rollout retention failed: ${error.message}` };
  }
  const finalIntegrity = packetIntegrity(packet, manifest, capturedManifest);
  const end = {
    kind: 'workroom-diagnostic-pilot', endedAt: iso(),
    wallSeconds: Math.round((performance.now() - monotonicStart) / 1000),
    pid: child.pid, pgid, model: MODEL, effort: EFFORT,
    exitCode: result.code, exitSignal: result.signal, spawnError: result.spawnError,
    lifecycleError, streamError, termination: stop,
    custody: custodyCleanup, groupCleanup: custodyCleanup, groupEvents: custody.events,
    threadId, nativeRollout: nativeReceipt, packetIntegrity: finalIntegrity,
    stdout: fileReceipt(stdoutPath), stderr: fileReceipt(stderrPath),
    builderFinal: fileReceipt(builderFinalPath), lastMessage: fileReceipt(lastMessagePath),
  };
  writePrivate(join(privateDir, 'end.json'), end);
  console.log(`[pilot] exit=${result.code ?? 'null'} signal=${result.signal ?? 'none'} lifecycle=${privateDir}`);
  if (stop?.reason === 'four-hour-operational-ceiling') return 124;
  if (stop?.reason === 'disk-floor') return 125;
  if (stop?.reason === 'driver-SIGINT') return 130;
  if (stop?.reason === 'driver-SIGTERM') return 143;
  if (!finalIntegrity.ok) return 126;
  if (lifecycleError || streamError || custodyCleanup?.ok !== true) return 1;
  return result.code ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const telemetry = args[0] === '--telemetry';
    if (telemetry) args.shift();
    if (args.length !== 1) fail('PILOT_USAGE', 'run-pilot.mjs [--telemetry] STAGED_DESTINATION');
    process.exitCode = await runPilot(args[0], { telemetry });
  } catch (error) {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  }
}
