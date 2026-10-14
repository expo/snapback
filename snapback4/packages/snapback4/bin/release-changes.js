// @ref LLP 3000.011.003.000#11-wave-11-runtime-upgrade-history — read installed release history after package-manager symlink replacement.
import { readFileSync } from 'node:fs';
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
export function previousVersion(root) {
  try { const require = createRequire(join(root, 'package.json')); return version(JSON.parse(readFileSync(join(dirname(dirname(require.resolve('snapback4/bin-path'))), 'package.json'), 'utf8')).version); } catch { /* Older copied trees may have no installed compiler. */ }
  for (const name of ['package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'pnpm-lock.yaml']) {
    try { const found = lockedVersion(readFileSync(join(root, name), 'utf8')); if (found) return found; } catch { /* absent */ }
  }
  try { const pkg = JSON.parse(readFileSync(join(root, 'snapback/generated/package.json'), 'utf8')); return version(pkg.snapback4Version ?? pkg.version); } catch { return undefined; }
}
const key = value => value.split('-')[0].split('.').map(Number);
const compare = (a, b) => { a = key(a); b = key(b); return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; };
export function runtimeChanges(history, previous, installed) {
  if (!version(previous) || !version(installed) || compare(previous, installed) >= 0) return '';
  let selected = false, out = '';
  for (const line of history.split('\n')) {
    if (line.startsWith('## ')) { const v = line.slice(3); selected = !!version(v) && compare(v, previous) > 0 && compare(v, installed) <= 0; }
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
