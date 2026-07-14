#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0010#ci-and-review-gates — compiler/runtime identities are
// committed proof inputs and are attested before the canonical build.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function exactVersion(value, label) {
  assert.match(value ?? '', /^\d+\.\d+\.\d+$/, `${label} must be an exact semver`);
  return value;
}

function tomlChannel(path) {
  const match = /^channel\s*=\s*"([^"]+)"\s*$/m.exec(readFileSync(path, 'utf8'));
  assert.ok(match, `${path} must declare [toolchain].channel`);
  return match[1];
}

function lockedVersion(lockText, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${escaped}": \\["${escaped}@([^"\\s]+)"`).exec(lockText);
  assert.ok(match, `bun.lock must resolve ${name}`);
  return match[1];
}

// ENG-24513: .node-version is the single exact Node runtime authority. Every
// workflow consumes it via node-version-file, and the canonical proof asserts
// the active runtime matches it, so the same SHA cannot execute proof scripts
// under drifting Node patch releases. Package engines stay compatibility
// ranges, never the CI authority.
const nodeVersion = exactVersion(
  readFileSync(join(ROOT, '.node-version'), 'utf8').trim(),
  '.node-version Node',
);
assert.equal(
  process.version,
  `v${nodeVersion}`,
  `active Node ${process.version} must match .node-version v${nodeVersion}`,
);

const rootPackage = readJson(join(ROOT, 'package.json'));
const bunVersion = exactVersion(/^bun@(.+)$/.exec(rootPackage.packageManager ?? '')?.[1], 'packageManager Bun');
const actualBun = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim();
assert.equal(actualBun, bunVersion, `active Bun ${actualBun} must match packageManager bun@${bunVersion}`);

const rootRust = tomlChannel(join(ROOT, 'rust-toolchain.toml'));
const ibexRust = tomlChannel(join(ROOT, 'vendor/ibex/rust-toolchain.toml'));
assert.equal(rootRust, ibexRust, 'Snapback and vendored Ibex must use one Rust channel');
const actualRust = execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim();
assert.match(actualRust, new RegExp(`^rustc ${rootRust.replaceAll('.', '\\.')}(?:\\s|$)`));
const expectedClippyMinor = rootRust.split('.')[1];
const actualClippy = execFileSync('cargo', ['clippy', '--version'], { encoding: 'utf8' }).trim();
assert.match(
  actualClippy,
  new RegExp(`^clippy 0\\.1\\.${expectedClippyMinor}(?:\\s|$)`),
  `active Clippy must belong to Rust ${rootRust}, found ${actualClippy}`,
);

assert.equal(existsSync(join(ROOT, 'package-lock.json')), false, 'root package-lock.json must not coexist with bun.lock');
const lockText = readFileSync(join(ROOT, 'bun.lock'), 'utf8');
const packageNames = ['miniflare', 'typescript', 'workerd', 'wrangler'];
const resolved = {};
for (const name of packageNames) {
  const locked = lockedVersion(lockText, name);
  const installed = readJson(join(ROOT, 'node_modules', name, 'package.json')).version;
  assert.equal(installed, locked, `${name} install ${installed} must match bun.lock ${locked}`);
  resolved[name] = locked;
}
assert.equal(
  rootPackage.devDependencies.typescript,
  resolved.typescript,
  'TypeScript must be exact in package.json and bun.lock',
);

process.stdout.write(
  `[toolchain-authority] PASS: node ${nodeVersion}; bun ${bunVersion}; ${actualRust}; ${actualClippy}; ` +
  packageNames.map((name) => `${name} ${resolved[name]}`).join('; ') + '\n',
);
