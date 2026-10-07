// @ref LLP 3000.030#15 — retain queue, lease and process evidence before fixture cleanup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function maintenanceEvidence(f, reason) {
  try { return snapshotMaintenance(f, reason); }
  catch (error) { console.error(`maintenance evidence capture failed (${reason}): ${error}`); return null; }
}

function snapshotMaintenance(f, reason) {
  const root = path.join(f.root, 'artifacts/native-smoke');
  const base = process.env.SNAPBACK4_MAINTENANCE_EVIDENCE || path.join(os.tmpdir(), 'sb4-maintenance-evidence');
  const out = path.join(base, `${path.basename(f.root)}-${Date.now()}-${reason}`);
  fs.mkdirSync(out, { recursive: true });
  const files = [], pids = new Set(f.maintainers || []), inodes = new Set();
  function walk(dir, relative = '') {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), rel = path.join(relative, name);
      try {
        const stat = fs.lstatSync(file);
        files.push({ path: rel, size: stat.size, mtimeMs: stat.mtimeMs, inode: stat.ino, mode: stat.mode });
        if (name.endsWith('.lock')) inodes.add(String(stat.ino));
        if (stat.isDirectory()) { walk(file, rel); continue; }
        if (!stat.isFile() || !/\.(json|jsonl|log|lock|tmp)$/.test(name)) continue;
        const target = path.join(out, 'files', rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target);
        if (name.endsWith('.json')) {
          const collect = value => {
            if (!value || typeof value !== 'object') return;
            if (Number.isInteger(value.pid)) pids.add(value.pid);
            if (Number.isInteger(value.group)) pids.add(value.group);
            for (const child of Object.values(value)) collect(child);
          };
          try { collect(JSON.parse(fs.readFileSync(file))); } catch {}
        }
      } catch (error) { files.push({ path: rel, error: String(error) }); }
    }
  }
  if (fs.existsSync(root)) walk(root);
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,etime=,time=,command='], { encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  const rows = (ps.stdout || '').split('\n').map(line => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+/);
    return m ? { pid: +m[1], parent: +m[2], group: +m[3], line } : null;
  }).filter(Boolean);
  for (const row of rows) if (row.line.includes(f.root)) pids.add(row.pid);
  for (let size = -1; size !== pids.size;) {
    size = pids.size;
    for (const row of rows) if (pids.has(row.parent) || pids.has(row.group)) pids.add(row.pid);
  }
  fs.writeFileSync(path.join(out, 'processes.txt'), rows.filter(row => pids.has(row.pid)).map(row => row.line).join('\n') + '\n');
  const proc = {};
  if (process.platform === 'linux') {
    for (const pid of pids) {
      const record = proc[pid] = {};
      for (const name of ['stat', 'status', 'wchan']) try { record[name] = fs.readFileSync(`/proc/${pid}/${name}`, 'utf8'); } catch {}
      try {
        record.fds = fs.readdirSync(`/proc/${pid}/fd`).map(fd => {
          try { return { fd, path: fs.readlinkSync(`/proc/${pid}/fd/${fd}`), info: fs.readFileSync(`/proc/${pid}/fdinfo/${fd}`, 'utf8') }; } catch { return { fd, vanished: true }; }
        });
      } catch {}
    }
    const locks = fs.readFileSync('/proc/locks', 'utf8').split('\n').filter(line => [...inodes].some(ino => line.includes(`:${ino} `)));
    fs.writeFileSync(path.join(out, 'locks.txt'), locks.join('\n') + '\n');
  } else if (process.platform === 'darwin' && pids.size) {
    const lsof = spawnSync('lsof', ['-nP', '-a', '-p', [...pids].join(',')], { encoding: 'utf8', timeout: 5000 });
    fs.writeFileSync(path.join(out, 'descriptors.txt'), (lsof.stdout || '') + (lsof.stderr || '') + (lsof.error?.message || ''));
  }
  fs.writeFileSync(path.join(out, 'snapshot.json'), JSON.stringify({ at: new Date().toISOString(), reason, root, platform: process.platform, load: os.loadavg(), psError: ps.error?.message, files, proc }, null, 2));
  console.error(`maintenance evidence (${reason}): ${out}`);
  return out;
}

export function watchMaintenance(f) {
  f.env.SNAPBACK4_DEBUG_RETENTION = '1';
  const evidence = process.env.SNAPBACK4_MAINTENANCE_EVIDENCE;
  if (evidence) {
    fs.mkdirSync(evidence, { recursive: true });
    fs.appendFileSync(path.join(evidence, 'fixtures.jsonl'), JSON.stringify({ root: f.root, at: Date.now(), pid: process.pid }) + '\n');
  }
  // Capture before the enclosing 120-second test guard as well as on drain failure.
  const timer = setTimeout(() => maintenanceEvidence(f, 'test-guard'), 110000);
  timer.unref();
  return () => clearTimeout(timer);
}

export async function observedMaintenance(f, allowParked, wait) {
  const started = performance.now();
  const trace = step => {
    try {
      fs.appendFileSync(path.join(f.root, 'artifacts/native-smoke/retention-trace.jsonl'), JSON.stringify({ at: Date.now(), pid: process.pid, step, detail: { allowParked, elapsedMs: performance.now() - started } }) + '\n');
    } catch {} // Diagnostics cannot alter the assertion or cleanup outcome.
  };
  trace('test-drain-start');
  try { await wait(); }
  catch (error) { maintenanceEvidence(f, 'drain-timeout'); throw error; }
  finally { trace('test-drain-end'); }
}
