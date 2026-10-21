// @ref LLP 3000.000.000.001#8-wave-18-developer-loop-amendment-dx4 — bounded candidate scan, never an automatic script rewrite.
// Project-specific migration advice. Read authored files only; never print their contents.
import { readdirSync, readFileSync, lstatSync, existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const excluded = new Set(['node_modules', '.git', '.snapback4', 'generated', 'dist', 'build', 'target', 'deploy', 'logs', 'store', 'output', '.runtime']);
export function upgradeWarnings(root, declarations) {
  const doors = [], persistence = [], dataJson = [];
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
      // Candidate scan: shell commands, argv arrays and npm-script strings.
      // Never infer how the parsed result is used or rewrite application code.
      const commandText = source.replace(/\s+/g, ' ');
      if (/(?:\bsnapback4(?:@[^\s"']+)?\s+data\b|["']data(?:["']|\s))[^;]{0,2000}--json/.test(commandText)
        || /(?:\bsnapback4\b[^;]{0,2000}--json[^;]{0,2000}\bdata\b|["']--json["'][^;]{0,2000}["']data["'])/.test(commandText)) dataJson.push(relative);
    }
  };
  walk(root);
  const warnings = [];
  const passwordOnly = /^\s*use[ \t]+identity[ \t]+password\b/m.test(declarations) && !/^\s*use[ \t]+identity(?:[ \t]*(?:--[^\n]*)?)?$/m.test(declarations);
  if (passwordOnly) warnings.push('password-only dev doors are CLOSED since 0.4.33: /seed, /dev/* and persona headers refuse. Use deploy staging --staging plus serve staging for real users (guide staging); local fixtures explicitly opt into dev --unsafe-dev-doors.' + (doors.length ? ' Review: ' + doors.join(', ') : ' No matching dev-door scripts found.'));
  if (persistence.length) warnings.push('startDev() persists since 0.4.33: reruns see old rows and share the dev store. For disposable acceptance use startDev({args:["--memory"]}); keep persistence for continuity. Review (check each call for explicit memory): ' + persistence.join(', '));
  if (dataJson.length) warnings.push('data --json returns {rows, more, limit} since 0.4.35, replacing the bare array. One-line fix: JSON.parse(stdout).rows (was JSON.parse(stdout)); use more/limit to detect truncation. Review candidate consumers: ' + dataJson.join(', '));
  if (incomplete) warnings.push('migration scan incomplete (unreadable/large files or depth/file limit); inspect remaining authored scripts for /seed, /dev/*, persona headers, startDev() and data --json array consumers.');
  return warnings;
}

// @ref LLP 3000.000.000.001#10-wave-20-loop-repairs-dx5 — the OLD CLI invokes the NEW wrapper for its post-upgrade check.
export function firstCheckWarnings(cwd = process.cwd()) {
  if (process.env.SNAPBACK4_UPGRADE_BASELINE === '1') return;
  let temporary;
  try {
    let root = cwd;
    while (!existsSync(join(root, 'package.json'))) { const parent = dirname(root); if (parent === root) return; root = parent; }
    const schema = join(root, 'snapback');
    if (!existsSync(schema)) return;
    const version = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version;
    const receipt = join(root, '.snapback4/project-warnings-version.json');
    try { if (JSON.parse(readFileSync(receipt, 'utf8')).version === version) return; } catch { /* First check or unreadable receipt: deliver. */ }
    const declarations = readdirSync(schema).filter(name => name.endsWith('.q')).map(name => readFileSync(join(schema, name), 'utf8')).join('\n');
    const warnings = upgradeWarnings(root, declarations);
    const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name ?? root;
    for (const warning of warnings) process.stderr.write(`project ${name}: upgrade warning: ${warning}\n`);
    // Old upgrade --quiet captures and discards check stderr. A pipe is not
    // evidence of delivery: leave advice pending for the next visible check.
    if (warnings.length && !process.stderr.isTTY) return;
    mkdirSync(dirname(receipt), {recursive:true});
    temporary = `${receipt}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({version}) + '\n', {flag:'wx'});
    renameSync(temporary, receipt);
  } catch {
    process.stderr.write('snapback4: project migration advice unavailable or not acknowledged; check will continue. Review guide changes and run upgrade to scan authored scripts.\n');
  } finally { if (temporary) try { rmSync(temporary, {force:true}); } catch { /* Advisory only. */ } }
}
