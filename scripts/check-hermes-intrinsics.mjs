#!/usr/bin/env node
// issues/20260803-rn-carrier-bricked-tosorted-registration-ledger.md: the
// LLP 0166 registration-ledger landing used `Array.prototype.toSorted`
// (ES2023), which static Hermes (RN 0.86 / iOS 26.3) does not implement, so
// every subscribe on the RN carrier threw synchronously and bricked the
// shipped React/Expo path. Nothing in CI executed the shipped client graph
// under an engine without the newest array intrinsics — node has them all,
// Hermes does not. This gate closes that gap statically.
//
// What it scans: every shipped runtime `.mjs`/`.js` file (the package.json
// `files` closure — exactly the bytes `npm pack` ships, which excludes the
// node-only tests) of the packages that run on the Hermes carrier:
// `@expo/snapback-client` and `@expo/snapback-react`.
//
// Markers, not a grammar (sibling convention: check-artifact-path-hygiene):
// each pattern is a call-shaped token (`.toSorted(`) that only plausibly
// appears in source as a use of the intrinsic. Prose mentions in comments
// (`toSorted (ES2023)`) do not match because the token requires the paren
// immediately after the name. Kept deliberately narrow: only members Hermes
// verifiably lacks on the RN carrier this repo ships to. `structuredClone`
// and `Array.prototype.at` exist there and are NOT banned.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Packages whose shipped runtime graph executes on the Hermes carrier. */
export const HERMES_CARRIER_PACKAGES = [
  'packages/snapback-client',
  'packages/snapback-react',
];

// ES2023 change-array-by-copy + findLast family and ES2024 grouping/fromAsync,
// all absent from static Hermes.
export const HERMES_UNAVAILABLE_PATTERNS = [
  { id: 'Array.prototype.toSorted', pattern: /\.toSorted\(/ },
  { id: 'Array.prototype.toReversed', pattern: /\.toReversed\(/ },
  { id: 'Array.prototype.toSpliced', pattern: /\.toSpliced\(/ },
  { id: 'Array.prototype.with', pattern: /\.with\(/ },
  { id: 'Array.prototype.findLast', pattern: /\.findLast\(/ },
  { id: 'Array.prototype.findLastIndex', pattern: /\.findLastIndex\(/ },
  { id: 'Object.groupBy', pattern: /\bObject\.groupBy\(/ },
  { id: 'Map.groupBy', pattern: /\bMap\.groupBy\(/ },
  { id: 'Array.fromAsync', pattern: /\bArray\.fromAsync\(/ },
];

function log(msg) {
  process.stdout.write(`[hermes-intrinsics] ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`[hermes-intrinsics] FAIL: ${msg}\n`);
  process.exit(1);
}

/** The shipped runtime source files of one carrier package. */
export function shippedRuntimeFiles(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${packageDir}/package.json has no files[] closure to scan`);
  }
  return manifest.files
    .filter((name) => name.endsWith('.mjs') || name.endsWith('.js'))
    .map((name) => join(packageDir, name));
}

/** Scan one file's source for Hermes-unavailable intrinsic call tokens. */
export function scanSource(content) {
  const findings = [];
  for (const { id, pattern } of HERMES_UNAVAILABLE_PATTERNS) {
    const global = new RegExp(pattern.source, 'g');
    let match;
    while ((match = global.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      findings.push({ id, line });
    }
  }
  return findings;
}

export function auditFiles(files) {
  const results = [];
  for (const file of files) {
    for (const finding of scanSource(readFileSync(file, 'utf8'))) {
      results.push({ file, ...finding });
    }
  }
  return results;
}

function main() {
  // With explicit file arguments, scan exactly those (used to demonstrate a
  // violation against a scratch copy); default is the shipped closure.
  const argFiles = process.argv.slice(2);
  const files = argFiles.length > 0
    ? argFiles.map((f) => resolve(f))
    : HERMES_CARRIER_PACKAGES.flatMap((pkg) => shippedRuntimeFiles(join(ROOT, pkg)));
  if (files.length === 0) fail('no shipped runtime files found — scan inventory is broken');

  const findings = auditFiles(files);
  if (findings.length > 0) {
    for (const { file, id, line } of findings) {
      process.stderr.write(`[hermes-intrinsics] ${file}:${line} uses ${id}, absent from Hermes\n`);
    }
    fail(
      `${findings.length} Hermes-unavailable intrinsic use(s) in shipped carrier code. ` +
      'Static Hermes lacks the ES2023+ array/grouping members; use a Hermes-safe ' +
      'equivalent (e.g. [...xs].sort(...) instead of xs.toSorted(...)).',
    );
  }
  log(`OK: ${files.length} shipped runtime file(s) free of Hermes-unavailable intrinsics`);
  log('HERMES-INTRINSICS PASS');
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main();
}
