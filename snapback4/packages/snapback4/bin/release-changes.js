// @ref LLP 3000.011.003.000#11-wave-11-runtime-upgrade-history — read installed release history after package-manager symlink replacement.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const version = value => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value ?? '') ? value : undefined;
export function lockedVersion(text) {
  try {
    const lock = JSON.parse(text);
    const found = version(lock.packages?.['node_modules/snapback4']?.version ?? lock.dependencies?.snapback4?.version);
    if (found) return found;
  } catch { /* Bun lockfiles are JSONC; pnpm is YAML. */ }
  const lines = text.split('\n');
  const found = new Set();
  for (let i = 0; i < lines.length; i++) if (/^\s*['"]?snapback4['"]?:\s*$/.test(lines[i])) {
    for (const line of lines.slice(i + 1, i + 5)) {
      const resolved = /^\s*version:\s*(.+)$/.exec(line)?.[1]?.trim().replace(/^['"]|['"]$/g, '').split('(')[0];
      if (version(resolved)) found.add(resolved);
    }
  }
  for (const match of text.matchAll(/snapback4@([^\s"'/:()[\]{},]+)/g)) if (version(match[1])) found.add(match[1]);
  return found.size === 1 ? [...found][0] : undefined;
}
export function installedVersion(root) {
  try { const require = createRequire(join(root, 'package.json')); return version(JSON.parse(readFileSync(join(dirname(dirname(require.resolve('snapback4/bin-path'))), 'package.json'), 'utf8')).version); } catch { /* Older copied trees may have no installed compiler. */ }
  return undefined;
}
export function previousVersion(root) {
  for (const name of ['runtime-version.json', 'check-surface.json', 'upgrade-version.json']) {
    try { const found = version(JSON.parse(readFileSync(join(root, '.snapback4', name), 'utf8')).version); if (found) return found; } catch { /* absent or invalid */ }
  }
  try { const pkg = JSON.parse(readFileSync(join(root, 'snapback/generated/package.json'), 'utf8')); const found = version(pkg.snapback4Version ?? pkg.version); if (found) return found; } catch { /* absent */ }
  for (const name of ['package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'pnpm-lock.yaml']) {
    try { const found = lockedVersion(readFileSync(join(root, name), 'utf8')); if (found) return found; } catch { /* absent */ }
  }
  return installedVersion(root);
}
export function acknowledgeVersion(root, version) {
  const directory = join(root, '.snapback4'); mkdirSync(directory, { recursive: true });
  const path = join(directory, 'runtime-version.json'), temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version })); renameSync(temporary, path);
}
export function compareVersions(a, b) {
  const parts = v => { const i = v.indexOf('-'); return i < 0 ? [v, undefined] : [v.slice(0, i), v.slice(i + 1)]; };
  const [ac, ap] = parts(a), [bc, bp] = parts(b);
  const av = ac.split('.').map(Number), bv = bc.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] - bv[i];
  if (ap === undefined || bp === undefined) return ap === bp ? 0 : ap === undefined ? 1 : -1;
  const aa = ap.split('.'), ba = bp.split('.');
  for (let i = 0; i < Math.max(aa.length, ba.length); i++) {
    if (aa[i] === ba[i]) continue;
    if (aa[i] === undefined || ba[i] === undefined) return aa[i] === undefined ? -1 : 1;
    const an = /^\d+$/.test(aa[i]), bn = /^\d+$/.test(ba[i]);
    if (an && bn) { const av = aa[i].replace(/^0+/, ''), bv = ba[i].replace(/^0+/, ''); if (av === bv) continue; return av.length - bv.length || (av < bv ? -1 : 1); }
    if (an !== bn) return an ? -1 : 1;
    return aa[i] < ba[i] ? -1 : 1;
  }
  return 0;
}
export function runtimeChanges(history, previous, installed) {
  if (!version(previous) || !version(installed) || compareVersions(previous, installed) >= 0) return '';
  let selected = false, out = '';
  for (const line of history.split('\n')) {
    if (line.startsWith('## ')) { const v = line.slice(3); selected = !!version(v) && compareVersions(v, previous) > 0 && compareVersions(v, installed) <= 0; }
    if (selected && line.startsWith('## ')) out += (out ? '\n' : '') + line + '\n\n';
    else if (selected && line.startsWith('- ')) out += line + '\n';
  }
  return out ? `runtime changes: ${previous} → ${installed}\n${out}History begins at 0.4.26; earlier changes are not recorded.\n` : '';
}
export function installedHistory(root) {
  // The parent process resolved the old package already. Resolve the new
  // symlink in a fresh process, just like upgrade's post-install check.
  const script = `import {createRequire} from 'node:module';import {join,dirname} from 'node:path';const require=createRequire(join(process.argv[1],'package.json'));console.log(join(dirname(dirname(require.resolve('snapback4/bin-path'))),'CHANGELOG.md'));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw Error('installed release history unavailable');
  return readFileSync(result.stdout.trim(), 'utf8');
}
