// @ref LLP 3000.000.000.001#8-wave-18-developer-loop-amendment-dx4 — bounded candidate scan, never an automatic script rewrite.
// Project-specific migration advice. Read authored files only; never print their contents.
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
const excluded = new Set(['node_modules', '.git', '.snapback4', 'generated', 'dist', 'build', 'target', 'deploy', 'logs', 'store', 'output', '.runtime']);
export function upgradeWarnings(root, declarations) {
  const doors = [], persistence = [];
  let scanned = 0, incomplete = false;
  const walk = (dir, prefix = '', depth = 0) => {
    if (scanned > 10000 || depth > 8) { incomplete = true; return; }
    let entries;
    try { entries = readdirSync(dir, {withFileTypes: true}); } catch { incomplete = true; return; }
    for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
      if (++scanned > 10000) { incomplete = true; return; }
      if (excluded.has(entry.name) || entry.name.startsWith('.')) continue;
      const relative = prefix + entry.name, path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path, relative + '/', depth + 1); continue; }
      if (!entry.isFile() || !/\.(?:[cm]?[jt]sx?|sh|json)$/.test(entry.name)) continue;
      let size; try { size = lstatSync(path).size; } catch { incomplete = true; continue; }
      if (size > 1048576) { incomplete = true; continue; }
      let source; try { source = readFileSync(path, 'utf8'); } catch { incomplete = true; continue; }
      if (/\/seed\b|\/dev\/|x-snapback-persona/.test(source)) doors.push(relative);
      if (/\bstartDev\s*\(/.test(source)) persistence.push(relative);
    }
  };
  walk(root);
  const warnings = [];
  const passwordOnly = /^\s*use[ \t]+identity[ \t]+password\b/m.test(declarations) && !/^\s*use[ \t]+identity(?:[ \t]*(?:--[^\n]*)?)?$/m.test(declarations);
  if (passwordOnly) warnings.push('password-only dev doors are CLOSED since 0.4.33: /seed, /dev/* and persona headers refuse. Use deploy staging --staging plus serve staging for real users (guide staging); local fixtures explicitly opt into dev --unsafe-dev-doors.' + (doors.length ? ' Review: ' + doors.join(', ') : ' No matching dev-door scripts found.'));
  if (persistence.length) warnings.push('startDev() persists since 0.4.33: reruns see old rows and share the dev store. For disposable acceptance use startDev({args:["--memory"]}); keep persistence for continuity. Review (check each call for explicit memory): ' + persistence.join(', '));
  if (incomplete) warnings.push('migration scan incomplete (unreadable/large files or depth/file limit); inspect remaining authored scripts for /seed, /dev/*, persona headers and startDev().');
  return warnings;
}
