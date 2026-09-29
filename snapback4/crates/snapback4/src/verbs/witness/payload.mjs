// @ref LLP 3000.030#6 — inventories bind actual payloads, including bounded links.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export const fail = (code, message) => { throw new Error(`${code}: ${message}`); };
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const seal = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
export function inventory(root, omit = () => false, onLink = () => {}) {
  root = fs.realpathSync(root);
  const files = [];
  function walk(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const rel = path.posix.join(relative, name);
      if (omit(rel)) continue;
      if (name === 'provider-secrets.env') fail('E_WITNESS_BUILD', 'secret input is forbidden');
      const file = path.join(root, rel), stat = fs.lstatSync(file);
      const row = { path: rel, mode: stat.mode & 0o777 };
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(file), resolved = fs.realpathSync(file);
        if (path.isAbsolute(target) || !resolved.startsWith(root + path.sep)) fail('E_WITNESS_PROOF', `escaping link: ${rel}`);
        onLink(rel, resolved);
        files.push({ ...row, type: 'symlink', target });
      } else if (stat.isDirectory()) {
        files.push({ ...row, type: 'directory' }); walk(rel);
      } else if (stat.isFile()) {
        const bytes = fs.readFileSync(file);
        files.push({ ...row, type: 'file', bytes: bytes.length, sha256: hash(bytes) });
      } else fail('E_WITNESS_PROOF', `unsupported file type: ${rel}`);
    }
  }
  walk('');
  return { sha256: hash(JSON.stringify(files)), bytes: files.reduce((sum, f) => sum + (f.bytes ?? 0), 0), files };
}
export function hbc(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 128 || bytes.subarray(0, 8).toString('hex') !== 'c61fbc03c103191f') fail('E_WITNESS_HERMES', `${file} is not Hermes bytecode; use --build`);
  return { sha256: hash(bytes), bytes: bytes.length, version: bytes.readUInt32LE(8) };
}
export function nativeFiles(root, inv) {
  const magic = new Set(['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca', 'cefaedfe']);
  return inv.files.filter(row => row.type === 'file' && magic.has(fs.readFileSync(path.join(root, row.path)).subarray(0, 4).toString('hex')));
}
export function differences(a, b) {
  const left = new Map(a.map(x => [x.path, x])), right = new Map(b.map(x => [x.path, x]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().flatMap(p => JSON.stringify(left.get(p)) === JSON.stringify(right.get(p)) ? [] : [{ path: p, expected: left.get(p) ?? null, actual: right.get(p) ?? null }]);
}
// CoreSimulator 27 removes execute bits from embedded framework libraries.
// Bind that exact, byte-preserving transformation; never discard modes generally.
export function installedInventory(expected, actual, native) {
  for (const change of differences(expected.files, actual.files)) {
    const a = change.expected, b = change.actual;
    if (!a || !b || !native.some(n => n.path === change.path) || !/^Frameworks\/[^/]+\.framework\/[^/]+$/.test(change.path)
        || a.mode !== 0o755 || b.mode !== 0o644 || JSON.stringify({ ...a, mode: b.mode }) !== JSON.stringify(b)) {
      fail('E_WITNESS_PROOF', `installed payload differs: ${change.path}`);
    }
  }
  return actual;
}

// The pinned export:embed output is the resource graph for this bundle. A
// directory prefix alone never authorizes new or missing asset bytes.
export function repackAssets(app, exported) {
  const actual = inventory(path.join(app, 'assets'));
  const expected = inventory(path.join(exported, 'assets'));
  if (actual.sha256 !== expected.sha256) fail('E_WITNESS_REPACK', 'bundled assets differ from export:embed output; use --build');
  return expected;
}
