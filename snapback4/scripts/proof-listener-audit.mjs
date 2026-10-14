// @ref LLP 3000.011.003.000.000#8 — observe only this proof's process tree, never shared-host listeners.
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
export function listenerSnapshot(root = process.pid, proc = '/proc') {
  const parents = new Map();
  for (const id of readdirSync(proc).filter(id => /^\d+$/.test(id))) {
    try { parents.set(Number(id), Number(readFileSync(join(proc, id, 'status'), 'utf8').match(/^PPid:\s+(\d+)/m)[1])); }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
  }
  const owned = new Set([root]);
  for (let before = -1; before !== owned.size;) {
    before = owned.size;
    for (const [pid, parent] of parents) if (owned.has(parent)) owned.add(pid);
  }
  const sockets = new Map();
  for (const pid of owned) {
    try {
      for (const fd of readdirSync(join(proc, String(pid), 'fd'))) {
        try { const match = readlinkSync(join(proc, String(pid), 'fd', fd)).match(/^socket:\[(\d+)\]$/); if (match) sockets.set(match[1], pid); }
        catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
      }
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
  }
  return ['tcp', 'tcp6'].flatMap(name => readFileSync(join(proc, 'net', name), 'utf8').trim().split('\n').slice(1).flatMap(line => {
    const fields = line.trim().split(/\s+/);
    return fields[3] === '0A' && sockets.has(fields[9]) ? [{ pid: sockets.get(fields[9]), port: parseInt(fields[1].split(':')[1], 16) }] : [];
  }));
}
/** Qualify the decoder before any expensive host build. */
export function requireListenerTracer() {
  const result = spawnSync('strace', ['--version'], {encoding:'utf8',timeout:5000});
  const version = result.stdout?.split('\n')[0] ?? '';
  const match = version.match(/version (\d+)\.(\d+)/);
  if (result.status !== 0 || !match || Number(match[1]) < 6 || (Number(match[1]) === 6 && Number(match[2]) < 8))
    throw Error('E_PROOF_LISTENER: Linux qualification requires strace 6.8 or newer on PATH');
  return version;
}

/** Inspect every successful listen syscall in a strace -f -yy trace of this proof. */
export function auditListenerTrace(trace, low, high) {
  if (!(Number.isInteger(low) && Number.isInteger(high) && low >= 1 && high <= 65535 && low <= high)) throw Error('invalid listener audit range');
  const unfinished = new Map(), listeners = [], nonReturned = [];
  let samples = 0;
  for (let line of trace.split('\n').filter(Boolean)) {
    const prefix = line.match(/^(\d+)\s+(.*)$/);
    if (!prefix) throw Error(`E_PROOF_LISTENER: unrecognized trace line: ${line}`);
    const [, pid, body] = prefix;
    if (Number(pid) < 1) throw Error('E_PROOF_LISTENER: invalid trace pid');
    // strace can leave an undecoded, non-returning fragment when a keeper is
    // SIGKILLed. Accept only these exact shapes and corroborate process exit.
    if (/^\?\?\?\((?: <(?:unfinished|detached) \.\.\.>|\d+ \+\+\+ (?:exited with \d+|killed by SIG[A-Z0-9]+(?: \(core dumped\))?) \+\+\+)$/.test(body)) {
      let state;
      try {
        const stat = readFileSync(`/proc/${pid}/stat`,'utf8');
        if (stat.slice(stat.lastIndexOf(')')+2, stat.lastIndexOf(')')+3) !== 'Z') throw Error(`E_PROOF_LISTENER: undecoded live process ${pid}`);
        state = 'zombie';
      } catch(error) { if(error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; state = 'absent'; }
      nonReturned.push({pid:Number(pid),state,record:body}); continue;
    }
    if (body.includes('<unfinished ...>') && body.startsWith('listen(')) { if(unfinished.has(pid)) throw Error('E_PROOF_LISTENER: duplicate unfinished listen'); unfinished.set(pid, body.replace('<unfinished ...>', '')); continue; }
    if (body.startsWith('<... listen resumed>')) {
      if (!unfinished.has(pid)) throw Error('E_PROOF_LISTENER: unmatched resumed listen');
      line = unfinished.get(pid) + body.replace('<... listen resumed>', ''); unfinished.delete(pid);
    } else line = body;
    if (!line.startsWith('listen(')) {
      if (/^(?:--- |\+\+\+ )/.test(line)) continue; // Traced process exit/signal, never a listener.
      throw Error(`E_PROOF_LISTENER: unrecognized syscall: ${line}`);
    }
    if (!/^listen\(\d+(?:<.+>)?, -?\d+\s*\)\s+= 0\s*$/.test(line)) {
      if (/^listen\(\d+(?:<.+>)?, -?\d+\s*\)\s+= -1 [A-Z][A-Z0-9_]*(?: \([^\n]*\))?\s*$/.test(line)) continue;
      throw Error(`E_PROOF_LISTENER: incomplete listen result: ${line}`);
    }
    samples++;
    if (/<UNIX(?:-STREAM)?(?:-LISTEN)?:\[/.test(line)) continue;
    const tcp = line.match(/^listen\(\d+<TCP(?:v6)?:\[.*:(\d+)\]>/);
    if (!tcp) throw Error(`E_PROOF_LISTENER: unresolved successful listen: ${line}`);
    const port = Number(tcp[1]);
    listeners.push({pid:Number(pid),port});
    if (port < low || port > high) throw Error(`E_PROOF_LISTENER: pid ${pid} listens on ${port} outside ${low}..${high}`);
  }
  if (unfinished.size) throw Error('E_PROOF_LISTENER: incomplete listen trace');
  if (!listeners.length) throw Error('E_PROOF_LISTENER: proof produced no traced TCP listener');
  return {status:'passed',method:'strace-listen',samples,listeners,nonReturned,range:[low,high]};
}
