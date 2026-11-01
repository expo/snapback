#!/usr/bin/env node
// Advance the release and its explicit fixture tripwires together.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const next = process.argv[2];
if (process.argv.length !== 3 || !/^0\.\d+\.\d+$/.test(next ?? ''))
  throw new Error('usage: node scripts/bump-version.mjs 0.x.y');
const read = path => readFileSync(resolve(root, path), 'utf8');
const previous = JSON.parse(read('packages/snapback4/package.json')).version;
const edits = new Map();
for (const name of ['snapback4', 'snapback4-expo', 'snapback4-darwin-arm64', 'snapback4-linux-x64']) {
  const path = `packages/${name}/package.json`, source = read(path), manifest = JSON.parse(source);
  if (manifest.version !== previous) throw new Error(`${path}: release versions disagree`);
  manifest.version = next;
  for (const dependency of ['snapback4-darwin-arm64', 'snapback4-linux-x64']) {
    if (manifest.optionalDependencies?.[dependency] !== undefined) {
      if (manifest.optionalDependencies[dependency] !== previous) throw new Error(`${path}: dependency version disagrees`);
      manifest.optionalDependencies[dependency] = next;
    }
  }
  edits.set(path, JSON.stringify(manifest, null, 2) + '\n');
}
const workspace = read('Cargo.toml');
if (!workspace.includes(`version = "${previous}"`)) throw new Error('Cargo.toml: release version disagrees');
edits.set('Cargo.toml', workspace.replace(`version = "${previous}"`, `version = "${next}"`));
for (const path of ['Cargo.lock', 'native-fixtures/following/Cargo.lock']) {
  let count = 0;
  const source = read(path).replace(/(\[\[package\]\]\nname = "snapback4(?:-[^"]+)?"\nversion = ")([^"]+)(")/g, (_, prefix, current, suffix) => {
    if (current !== previous) throw new Error(`${path}: ${prefix} version disagrees`);
    count++;
    return prefix + next + suffix;
  });
  if (!count) throw new Error(`${path}: no release pins found`);
  edits.set(path, source);
}
for (const name of ['device-version', 'sync-generation']) {
  const path = `packages/snapback4/test/${name}.test.mjs`;
  const pin = `assert.equal(packageVersion, '${previous}', 'release fixture pin follows the package bump')`;
  const source = read(path);
  if (!source.includes(pin)) throw new Error(`${path}: release tripwire disagrees`);
  edits.set(path, source.replace(pin, pin.replace(previous, next)));
}
// Validate every input before changing any file.
for (const [path, source] of edits) writeFileSync(resolve(root, path), source);
console.log(`snapback4 ${previous} → ${next}: ${edits.size} release files updated`);
