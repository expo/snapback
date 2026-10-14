// @ref LLP 3000.011.003.000.000#8 — observe only this proof's process tree, never shared-host listeners.
import { readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
if (process.env.SNAPBACK4_AUDIT_LISTENERS && !process.env.SNAPBACK4_AUDITOR_PID) {
  if (process.platform !== 'linux') throw Error('listener audit requires Linux /proc');
  process.env.SNAPBACK4_AUDITOR_PID = String(process.pid);
  const low = Number(process.env.PORT_LO), high = Number(process.env.PORT_HI);
  if (!(low >= 1 && high <= 65535 && low < high)) throw Error('listener audit needs PORT_LO/PORT_HI');
  let samples = 0, failure, listeners = new Map();
  const inspect = () => {
    try {
      const rows = listenerSnapshot(); samples++;
      for (const row of rows) {
        listeners.set(`${row.pid}:${row.port}`, row);
        if (row.port < low || row.port > high) throw Error(`E_PROOF_LISTENER: pid ${row.pid} listens on ${row.port} outside ${low}..${high}`);
      }
    } catch (error) { failure ??= String(error); console.error(failure); process.exitCode = 1; }
  };
  inspect();
  const timer = setInterval(inspect, 20); timer.unref();
  process.on('beforeExit', inspect);
  process.on('exit', () => {
    if (failure) process.exitCode = 1;
    if (process.env.SNAPBACK4_AUDIT_REPORT) writeFileSync(process.env.SNAPBACK4_AUDIT_REPORT, JSON.stringify({ status: failure ? 'failed' : 'passed', samples, listeners: [...listeners.values()], failure }));
  });
}
