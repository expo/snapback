// @ref LLP 3000.037.000#one-verify-path-and-conservative-phase-reuse-ver2 — disposable passing-phase receipts, never authority.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync, mkdirSync, chmodSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
const hash = value => createHash('sha256').update(value).digest('hex');
const phases = ['acceptance', 'frontend:proof'];
const directory = '.snapback4/verify-cache';
function processIdentity(pid) {
  // No process-table fallback: unsupported/ambiguous hosts simply rerun.
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
  if (!fields[19] || ['Z', 'X'].includes(fields[0])) throw Error('dead session');
  const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  return { pid, parent: Number(fields[1]), birth: fields[19], argv };
}
function session() {
  let pid = process.ppid;
  for (let depth = 0; pid > 1 && depth < 64; depth++) {
    const entry = processIdentity(pid);
    // Find the live builder, across distinct per-command shells/process groups.
    // An interactive shell is a session too; noninteractive `sh -c` is not.
    const names = entry.argv.slice(0, 2).map(arg => arg.split('/').at(-1));
    if (names.some(name => /^(?:(?:codex|muse|muse-code)(?:\.js)?|muse-bin-\d+(?:\.\d+)*-R\d+(?:\.\d+)?)$/.test(name)) ||
        (/^-?(?:ba|z|fi)?sh$/.test(names[0] ?? '') && !entry.argv.includes('-c') && (entry.argv.length === 1 || entry.argv.includes('-i')))) {
      return [readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), pid, entry.birth];
    }
    pid = entry.parent;
  }
}
function prepare() {
  for (const dir of ['.snapback4', directory]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('cache directory');
    chmodSync(dir, 0o700);
  }
}
async function source() {
  const digest = createHash('sha256');
  let entries = 0, bytesRead = 0;
  const tick = async () => {
    if (++entries > 200000) throw Error('cache scan budget');
    if (entries % 64 === 0) await new Promise(resolve => setImmediate(resolve));
  };
  // Only generated runtime/build state is excluded. Unknown authored files,
  // dotfiles, fixtures, scripts and all lockfiles participate, even outside git.
  const outputs = new Set(['.git', '.snapback4', 'node_modules', 'dist', '.expo', 'target', 'logs']);
  const walk = async path => {
    for (const name of readdirSync(path).sort()) {
      if (path === '.' && outputs.has(name)) continue;
      // Test timing/evidence is a phase output, not an input to its own rerun.
      if (join(path, name) === 'snapback/generated/security-test.json') continue;
      await tick();
      const file = join(path, name), stat = lstatSync(file);
      // Compiler-owned generated API files are rewritten by check; their bytes
      // still participate. Authored metadata also catches edit-then-revert.
      if (file !== 'snapback/generated' && !file.startsWith('snapback/generated/')) digest.update(JSON.stringify([file, stat.ino, stat.mtimeMs, stat.ctimeMs]));
      if (stat.isSymbolicLink()) throw Error('source symlink');
      if (stat.isDirectory()) await walk(file);
      else if (stat.isFile()) {
        bytesRead += stat.size;
        if (stat.size > 8 * 1024 * 1024 || bytesRead > 64 * 1024 * 1024) throw Error('source scan budget');
        const bytes = readFileSync(file);
        digest.update(JSON.stringify([file, stat.mode, bytes.length])); digest.update(bytes);
      } else throw Error('non-file source');
    }
  };
  await walk('.');
  // Dependency source edits/install changes also invalidate reuse. Metadata is
  // cheaper than rehashing Expo's dependencies; ctime catches restored mtimes.
  // Follow symlinks once, so linked dependency trees remain covered.
  // Vite writes and removes temporary config modules on every build. Prepare
  // its reserved output directory before capturing node_modules metadata so
  // its first creation cannot masquerade as an installation change.
  try { if (lstatSync('node_modules').isDirectory()) mkdirSync('node_modules/.vite-temp', { recursive: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const seen = new Set();
  const dependencies = async path => {
    if (path === 'node_modules/.vite-temp') return;
    await tick();
    let stat;
    try { stat = lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    digest.update(JSON.stringify([path, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs]));
    if (stat.isSymbolicLink()) { await dependencies(realpathSync(path)); return; }
    if (stat.isDirectory()) {
      const real = realpathSync(path); if (seen.has(real)) return; seen.add(real);
      for (const name of readdirSync(path).sort()) await dependencies(join(path, name));
    }
  };
  await dependencies('node_modules');
  return digest.digest('hex');
}
export async function phaseKey(phase) {
  if (!phases.includes(phase)) return;
  try {
    const owner = session(); if (!owner) return;
    const environment = Object.entries(process.env).map(([name, value]) => [name, name === 'PATH' ? [...new Set(value.split(':'))].join(':') : value]).filter(([name]) =>
      !['npm_lifecycle_event', 'npm_lifecycle_script', 'npm_command', 'npm_config_argv', '_', 'SHLVL'].includes(name)).sort(([a], [b]) => a.localeCompare(b));
    const inputs = await source();
    if (JSON.stringify(session()) !== JSON.stringify(owner)) return;
    return hash(JSON.stringify([2, realpathSync('.'), owner, process.version, process.execPath, inputs, environment, phase]));
  } catch { /* A cache miss is always safe. */ }
}
function prefix(phase) { return phase.replace(':', '-') + '-'; }
function file(phase) { return join(directory, `${phase.replace(':', '-')}.json`); }
export function forgetPhase(phase) { try { unlinkSync(file(phase)); } catch {} }
export async function reusePhase(phase) {
  const key = await phaseKey(phase); if (!key) return false;
  try {
    prepare();
    if (readdirSync(directory).some(name => name.startsWith(prefix(phase)) && name.endsWith('.pending'))) return false;
    const stat = lstatSync(file(phase));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return false;
    const receipt = JSON.parse(readFileSync(file(phase), 'utf8'));
    return receipt.key === key && receipt.passed === true && Date.now() - receipt.at >= 0 && Date.now() - receipt.at < 2 * 60 * 60 * 1000;
  } catch { return false; }
}
function save(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); renameSync(tmp, path);
}
// npm invokes post<phase> only after a successful script. Pair with the same
// live npm incarnation so concurrent/failed direct runs cannot mint a pass.
async function hook(mode, phase) {
  if (!phases.includes(phase)) return;
  try {
    prepare(); let pid = process.ppid, npm;
    for (let depth = 0; pid > 1 && depth < 16; depth++) {
      const entry = processIdentity(pid);
      if (entry.argv.some(arg => /(?:^|\/)npm(?:-cli\.js)?(?: run.*)?$/.test(arg))) { npm = entry; break; }
      pid = entry.parent;
    }
    if (!npm) return;
    if (mode === 'before') forgetPhase(phase);
    // Additional script arguments are deliberately outside reusable runs.
    if (npm.argv.join(' ').trim() !== `npm run ${phase}`) return;
    const pending = join(directory, `${prefix(phase)}${npm.pid}-${npm.birth}.pending`);
    if (mode === 'before') {
      save(pending, { scanning: true }); // every admitted run blocks reuse, including cleanup failures
      // A failed/interrupted run leaves a marker. It blocks reuse until a new
      // run starts; do not remove markers owned by concurrent live npm runs.
      for (const name of readdirSync(directory).filter(name => name.startsWith(prefix(phase)) && name.endsWith('.pending'))) {
        const match = name.slice(prefix(phase).length).match(/^(\d+)-(\d+)\.pending$/);
        if (!match) continue;
        let alive = false;
        try { alive = processIdentity(Number(match[1])).birth === match[2]; } catch {}
        if (!alive) { try { unlinkSync(join(directory, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      }
      const key = await phaseKey(phase); if (key) save(pending, { key });
    } else if (mode === 'after') {
      const key = await phaseKey(phase);
      const start = JSON.parse(readFileSync(pending, 'utf8')); unlinkSync(pending);
      if (key && start.key === key) save(file(phase), { key, passed: true, at: Date.now() });
    }
  } catch { /* Cache I/O must never change the proof's exit status. */ }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await hook(...process.argv.slice(2));
