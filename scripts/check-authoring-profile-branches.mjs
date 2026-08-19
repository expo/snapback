#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// @ref LLP 0252#d1-two-source-profiles-one-semantic-and-runtime-pipeline —
// source profile may be read at the adapter/admission boundary, never by the
// canonical runtime to select behavior.
// @ref LLP 0253#s54-the-no-branch-gate — the allowlist is path-exact and
// category-labelled so each sanctioned custody/admission exception remains a
// visible review decision.
export const AUTHORING_PROFILE_READ_ALLOWLIST = Object.freeze([
  Object.freeze({
    path: 'packages/snapback-client/index.d.mts',
    category: 'client-descriptor-custody-type',
  }),
  Object.freeze({
    path: 'packages/snapback-client/rqs-preload.mjs',
    category: 'client-generated-reference-hydration-custody',
  }),
  Object.freeze({
    path: 'packages/snapback-client/reference-kinds.mjs',
    category: 'client-profile-admission',
  }),
  Object.freeze({
    path: 'packages/snapback-react/familiar.d.mts',
    category: 'familiar-type-brand',
  }),
  Object.freeze({ path: 'crates/snapback/src/cli/migration.rs', category: 'migration-tooling' }),
  Object.freeze({ path: 'crates/snapback-kernel/src/diagnostic.rs', category: 'diagnostic-record' }),
  Object.freeze({ path: 'crates/snapback-engine/src/manifest.rs', category: 'custody-record' }),
  Object.freeze({ path: 'crates/snapback-kernel/src/migration.rs', category: 'migration-tooling' }),
]);

export const AUTHORING_PROFILE_SCAN_ROOTS = Object.freeze([
  // @ref LLP 0276#phases — carved production roots remain inside the
  // fail-closed authoring-profile branch inventory.
  'crates/snapback-activation/src',
  'crates/snapback-auth/src',
  'crates/snapback-kernel/src',
  'crates/snapback-runtime/src',
  'crates/snapback-services/src',
  'crates/snapback-engine/src',
  'crates/snapback/src',
  'crates/snapback-sync/src',
  'crates/snapback-types/src',
  'packages/snapback-client',
  'packages/snapback-react',
  'packages/snapback-harness',
]);

const SOURCE_EXTENSION = /\.(?:cjs|js|jsx|mjs|mts|rs|ts|tsx)$/u;
const EXCLUDED_COMPONENTS = new Set([
  'coverage',
  'dist',
  'fixtures',
  'generated',
  'node_modules',
]);
const EXCLUDED_FILE = /(?:\.fixture|\.test)\.(?:cjs|js|jsx|mjs|mts|ts|tsx)$/u;
const PROFILE_READ = /\bauthoring(?:P|_p)rofile\b/gu;

function repositoryPath(root, path) {
  return relative(root, path).split(sep).join('/');
}

function productionFiles(root, scanRoots) {
  const files = [];
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      if (EXCLUDED_COMPONENTS.has(entry.name)) continue;
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (SOURCE_EXTENSION.test(entry.name) && !EXCLUDED_FILE.test(entry.name)) {
        files.push(entryPath);
      }
    }
  };
  for (const scanRoot of scanRoots) walk(resolve(root, scanRoot));
  return files;
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

export function scanAuthoringProfileBranches({
  root = ROOT,
  scanRoots = AUTHORING_PROFILE_SCAN_ROOTS,
  allowlist = AUTHORING_PROFILE_READ_ALLOWLIST,
} = {}) {
  const allowed = new Map(allowlist.map((entry) => [entry.path, entry.category]));
  const files = productionFiles(root, scanRoots);
  if (files.length === 0) {
    throw new Error('SNAPBACK_AUTHORING_PROFILE_BRANCH_SCAN_EMPTY: no production source files found');
  }
  const findings = [];
  let reads = 0;
  for (const file of files) {
    const path = repositoryPath(root, file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(PROFILE_READ)) {
      reads += 1;
      if (!allowed.has(path)) {
        findings.push({ path, line: lineAt(source, match.index), token: match[0] });
      }
    }
  }
  return { files, findings, reads };
}

function main() {
  let result;
  try {
    result = scanAuthoringProfileBranches();
  } catch (error) {
    process.stderr.write(`[authoring-profile-branches] FAIL: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      process.stderr.write(
        `[authoring-profile-branches] ${finding.path}:${finding.line} reads ${finding.token}\n`,
      );
    }
    process.stderr.write(
      '[authoring-profile-branches] FAIL: source-profile branching is confined to the explicit adapter/custody/admission allowlist\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `[authoring-profile-branches] PASS: ${result.files.length} production files; ${result.reads} allowlisted authoring-profile read(s)\n`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
