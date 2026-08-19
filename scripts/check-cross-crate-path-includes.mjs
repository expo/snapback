#!/usr/bin/env node

// @ref LLP 0276#crates--the-rust-workspace — one owner compiles each source
// file. A path attribute may organize modules inside that owner, but may not
// compile another workspace crate's source with different features/statics.

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIAGNOSTIC = 'SNAPBACK_CROSS_CRATE_PATH_INCLUDE';

function walk(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'target' || entry.name === '.git') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(path, output);
    else if (entry.isFile() && path.endsWith('.rs')) output.push(path);
  }
  return output;
}

function crateRoots(root) {
  const crates = resolve(root, 'crates');
  return readdirSync(crates, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(crates, entry.name))
    .filter((path) => existsSync(resolve(path, 'Cargo.toml')))
    .map((path) => realpathSync(path));
}

function inside(path, root) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
}

export function auditCrossCratePathIncludes(root = DEFAULT_ROOT) {
  const roots = crateRoots(root);
  const violations = [];
  const pattern = /#\s*\[\s*path\s*=\s*"([^"]+)"\s*\]/g;
  for (const crateRoot of roots) {
    for (const source of walk(crateRoot)) {
      const text = readFileSync(source, 'utf8');
      for (const match of text.matchAll(pattern)) {
        const target = resolve(dirname(source), match[1]);
        if (!inside(target, crateRoot)) {
          const line = text.slice(0, match.index).split('\n').length;
          violations.push({
            source: relative(root, source),
            line,
            target: relative(root, target),
          });
        }
      }
    }
  }
  return violations;
}

const rootIndex = process.argv.indexOf('--root');
const root = rootIndex === -1 ? DEFAULT_ROOT : resolve(process.argv[rootIndex + 1]);
const violations = auditCrossCratePathIncludes(root);
if (violations.length > 0) {
  console.error(`${DIAGNOSTIC}: ${violations.length} cross-crate #[path] include(s)`);
  for (const violation of violations) {
    console.error(
      `  ${violation.source}:${violation.line} resolves outside its crate root: ${violation.target}`,
    );
  }
  process.exit(1);
}
console.log('cross-crate #[path] gate: ok');
