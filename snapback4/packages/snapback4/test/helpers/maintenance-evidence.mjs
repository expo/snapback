// @ref LLP 3000.030#15 — bounded diagnostics have no authority over custody.
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const collector = fileURLToPath(new URL('./maintenance-evidence.py', import.meta.url));
const scope = createHash('sha256').update(collector).digest('hex').slice(0, 16);
export function maintenanceEvidence(f, reason) {
  // All filesystem/probe work happens outside the test event loop, with no
  // inherited custody descriptors. A stuck collector is discarded after 2 s.
  return new Promise(resolve => {
    let child;
    try { child = spawn('python3', [collector], { stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch { resolve(null); return; }
    let output = '', done = false;
    const finish = value => {
      if (done) return;
      done = true; clearTimeout(timer);
      child.stdin.destroy(); child.stdout.destroy(); child.unref();
      if (!value) console.error(`maintenance evidence (${reason}): capture skipped or exceeded its bound`);
      resolve(value);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(null); }, 2000);
    child.on('error', () => finish(null));
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => finish(null));
    child.stdout.on('data', bytes => {
      if (output.length + bytes.length > 8192) { child.kill('SIGKILL'); finish(null); }
      else output += bytes;
    });
    child.on('close', () => {
      if (done) return;
      try {
        const { out } = JSON.parse(output);
        if (out) console.error(`maintenance evidence (${reason}): ${out}`);
        finish(out || null);
      } catch { finish(null); }
    });
    child.stdin.end(JSON.stringify({ root: f.root, reason, scope,
      base: process.env.SNAPBACK4_MAINTENANCE_EVIDENCE || path.join(os.tmpdir(), 'sb4-maintenance-evidence'),
      owner: process.pid, drains: f.maintenanceDrains || [] }));
  });
}

export function watchMaintenance(f) {
  f.env.SNAPBACK4_DEBUG_RETENTION = '1';
  f.maintenanceDrains = [];
  const timer = setTimeout(() => { void maintenanceEvidence(f, 'test-guard'); }, 110000);
  timer.unref();
  return () => clearTimeout(timer);
}

export async function observedMaintenance(f, allowParked, wait) {
  const started = performance.now();
  const trace = step => {
    const events = f.maintenanceDrains ||= [];
    if (events.length === 64) events.shift();
    events.push({ at: Date.now(), pid: process.pid, step, detail: { allowParked, elapsedMs: performance.now() - started } });
  };
  // No test-side trace file writes: even a FIFO cannot block the drain wait.
  trace('test-drain-start');
  try { await wait(); }
  catch (error) { await maintenanceEvidence(f, 'drain-timeout'); throw error; }
  finally { trace('test-drain-end'); }
}
