// @ref LLP 3000#publication-suite-under-contention — inherited tokens retain
// custody across native setsid/setpgid and intermediate-parent exit.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { identity, live, processTable } from './test-processes.mjs';

export const TOKEN_KEY = 'SNAPBACK_TEST_FILE_TOKEN';
const fail = message => Error(`TEST_PROCESS_INSPECTION: ${message}`);
const helper = fileURLToPath(new URL('./test-process-environment.py', import.meta.url));

// Capture BEFORE assigning the unpredictable token or launching its keeper.
// These exact identities cannot be descendants of this file. This also avoids
// asking for protected environments of preexisting sshd/systemd processes.
export function createTokenInspector({ inspect = processTable, read = readFileSync, run = spawnSync } = {}) {
  const uid = process.getuid();
  const baseline = new Map();
  for (const row of inspect()) if (row.alive) {
    const current = process.platform === 'linux' ? identity(row.pid) : row;
    if (current?.alive) baseline.set(row.pid, current);
  }
  const ancestors = new Set();
  for (let pid = process.pid; pid && !ancestors.has(pid); pid = baseline.get(pid)?.parent) ancestors.add(pid);
  return (token, keeper) => {
    if (!/^[a-f0-9]{64}$/.test(token)) throw fail('invalid file ownership token');
    const candidates = [];
    const table = inspect(), byPid = new Map(table.map(row => [row.pid, row]));
    const unrelated = row => {
      const seen = new Set([row.pid]);
      for (let pid = row.parent; pid && !seen.has(pid);) {
        seen.add(pid);
        const parent = process.platform === 'linux' ? identity(pid) : byPid.get(pid);
        if (!parent?.alive) return false;
        if (baseline.get(pid)?.start === parent.start) return !ancestors.has(pid);
        pid = parent.parent;
      }
      return false;
    };
    for (const row of table) if (row.uid === uid && row.alive) {
      const current = process.platform === 'linux' ? identity(row.pid) : row;
      // An unchanged pre-launch process outside our ancestor chain cannot
      // spawn or adopt our descendants. This excludes independent new SSH
      // sessions, but never PID 1 or an ancestral subreaper after reparenting.
      if (current?.alive && baseline.get(row.pid)?.start !== current.start && !unrelated(current)) candidates.push(current);
    }
    const preexistingSession = session => {
      const before = baseline.get(session);
      return before && live(before);
    };
    const owned = [], errors = [];
    // A positive token match remains evidence after exit: that process may
    // have forked a replacement during the environment read.
    const matched = (row, proof = 'tokenOwned') => { owned.push({ ...row, [proof]: true, vanished: !live(row) }); };
    const unreadable = (row, detail) => {
      if (live(row)) errors.push(`environment of PID ${row.pid}: ${detail}`);
    };
    if (process.platform === 'linux') {
      for (const row of candidates) {
        if (row.session === keeper?.pid) { matched(row, 'sessionOwned'); continue; }
        if (preexistingSession(row.session)) continue;
        try {
          const env = read(`/proc/${row.pid}/environ`);
          if (env.toString('utf8').split('\0').includes(`${TOKEN_KEY}=${token}`)) matched(row);
        } catch (error) {
          if (!['ENOENT', 'ESRCH'].includes(error.code)) unreadable(row, error.code ?? 'read failed');
        }
      }
    } else if (process.platform === 'darwin') {
      // Only boolean matches and coded errors leave this helper; never print
      // another process's environment or include it in diagnostic messages.
      const result = run('python3', [helper], {
        input: JSON.stringify({ token, pids: candidates.map(row => row.pid) }),
        encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024,
        env: { ...process.env, LC_ALL: 'C' },
      });
      if (result.error || result.status !== 0) throw fail(`environment helper failed (${result.error?.code ?? result.status})`);
      let entries;
      try { entries = JSON.parse(result.stdout); } catch { throw fail('malformed environment helper output'); }
      if (!Array.isArray(entries) || entries.length !== candidates.length) throw fail('incomplete environment helper output');
      for (let i = 0; i < candidates.length; i++) {
        const row = candidates[i], entry = entries[i];
        if (!entry || entry.pid !== row.pid || typeof entry.match !== 'boolean'
          || (entry.error !== undefined && (typeof entry.error !== 'string' || !entry.error))
          || (!entry.error && (!Number.isInteger(entry.session) || entry.session < 1))) throw fail('invalid environment helper row');
        // POSIX cannot join an existing session. Our keeper starts a new one;
        // a still-existing pre-launch session is therefore provably unrelated.
        if (entry.session === keeper?.pid && keeper) matched(row, 'sessionOwned');
        else if (preexistingSession(entry.session)) continue;
        else if (entry.error) unreadable(row, entry.error);
        else if (entry.match) matched(row);
      }
    } else throw fail(`environment inspection unsupported on ${process.platform}`);
    if (errors.length) throw Object.assign(fail(errors.join('; ')), { owned });
    return owned;
  };
}
