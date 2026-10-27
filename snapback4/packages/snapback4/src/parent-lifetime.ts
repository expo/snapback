// @ref LLP 3000.037.000#9-serve-lifetime-and-store-recovery-srv1 — npm death can leave its shell (and inherited pipes) alive.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

type Identity = { parent: number; birth: string; command: string };
function identity(pid: number): Identity | undefined {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
      if (!fields[19] || !fields[1] || !fields[0] || ['Z', 'X'].includes(fields[0])) return;
      return { parent: Number(fields[1]), birth: fields[19], command: readFileSync(`/proc/${pid}/comm`, 'utf8').trim() };
    }
    // Darwin has no /proc; ps lstart pins the original process incarnation.
    const fields = execFileSync('ps', ['-p', String(pid), '-o', 'ppid=,stat=,lstart=,args='], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/);
    if (fields.length < 8 || fields[1]?.startsWith('Z')) return;
    return { parent: Number(fields[0]), birth: fields.slice(2, 7).join(' '), command: fields.slice(7).join(' ') };
  } catch {
    // Linux minimal userspaces may have no /proc; ps may also be unavailable.
    // Preserve direct-parent custody rather than mistaking absent metrology for death.
    try { process.kill(pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EPERM') return; }
    return { parent: 1, birth: 'unverified', command: '' };
  }
}
function capture(): Array<[number, string]> {
  const watched: Array<[number, string]> = [];
  let pid = process.ppid;
  for (let depth = 0; pid > 1 && depth < 32; depth++) {
    const entry = identity(pid);
    if (!entry) { watched.push([pid, '<unavailable>']); break; }
    const npm = /^(?:.*\/)?npm(?:\s|$)/.test(entry.command) || /(?:^|\/)npm-cli\.js(?:\s|$)/.test(entry.command);
    if (depth === 0 || npm) watched.push([pid, entry.birth]);
    if (npm) break;
    pid = entry.parent;
  }
  return watched;
}
// Capture on import, before asynchronous host startup can outlive npm.
const parent = process.ppid;
const parents = capture();
export function watchParent(onLost: () => void): () => void {
  let stopped = false;
  const check = () => {
    if (!stopped && ((parent > 1 && process.ppid !== parent) || parents.some(([pid, birth]) => { const current = identity(pid); return !current || (birth !== 'unverified' && current.birth !== 'unverified' && current.birth !== birth); }))) {
      stopped = true; clearInterval(timer); onLost();
    }
  };
  const timer = setInterval(check, 250);
  timer.unref();
  check();
  return () => { stopped = true; clearInterval(timer); };
}
