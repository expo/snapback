#!/usr/bin/env node

// Output from this generator must remain accepted by
// validateObservedPriorVector in the publication-authority request module.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateObservedPriorVector,
} from '../packages/snapback-publication-authority/request.mjs';
import {
  PROMOTION_PACKAGE_NAMES,
  PUBLIC_NPM_REGISTRY,
  npmResultIsPackageNotFound,
  promotionNamesForScopePreset,
  readBoundedJsonFile,
  validateCandidateLedger,
} from './snapback-publish-core.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const usage = `usage: node scripts/snapback-observe-prior-vector.mjs
  --out <observed-prior-latest-vector.json>
  [--ledger <candidate-ledger.json>]
  [--tag <dist-tag>] [--registry <url>]

Observes every promotion package through npm view, then calls
validateObservedPriorVector before atomically replacing the output file.`;

function fail(message, code = 1) {
  process.stderr.write(`snapback-observe-prior-vector: ${message}\n`);
  process.exitCode = code;
}

function parseArgs(argv) {
  const options = { registry: PUBLIC_NPM_REGISTRY, tag: 'latest' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    const value = argv[++index];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value\n${usage}`);
    }
    if (argument === '--out') options.out = resolve(value);
    else if (argument === '--ledger') options.ledger = resolve(value);
    else if (argument === '--tag') options.tag = value;
    else if (argument === '--registry') options.registry = value;
    else throw new Error(`unknown argument ${argument}\n${usage}`);
  }
  if (!options.out) throw new Error(`--out is required\n${usage}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(options.tag)) {
    throw new Error('--tag must be a simple npm dist-tag name');
  }
  let registry;
  try {
    registry = new URL(options.registry);
  } catch {
    throw new Error('--registry must be an absolute HTTP(S) URL');
  }
  if (
    !['http:', 'https:'].includes(registry.protocol)
    || registry.username
    || registry.password
    || registry.search
    || registry.hash
  ) {
    throw new Error('--registry must be an HTTP(S) URL without credentials, query, or fragment');
  }
  options.registry = registry.href.replace(/\/$/u, '');
  return options;
}

export function runNpm(args, {
  cacheRoot,
  cwd = repositoryRoot,
  registry = PUBLIC_NPM_REGISTRY,
} = {}) {
  const cacheArgs = cacheRoot ? ['--cache', cacheRoot] : [];
  const result = spawnSync('npm', [
    ...args,
    '--registry', registry,
    ...cacheArgs,
    '--prefer-online',
  ], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (args[0] === 'view' && npmResultIsPackageNotFound(result)) return null;
    throw new Error(`npm ${args[0]} failed with ${result.status ?? result.signal ?? 'unknown'}`);
  }
  return result.stdout;
}

/**
 * Observe the complete vector consumed by validateObservedPriorVector.
 *
 * @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
 * — lease issue is bound to a separately observed complete registry vector.
 */
export function observePriorVector({
  packageNames = PROMOTION_PACKAGE_NAMES,
  runNpm: npmRunner = runNpm,
  tag = 'latest',
}) {
  const vector = {};
  for (const name of packageNames) {
    let output;
    try {
      output = npmRunner(['view', name, 'dist-tags', '--json']);
    } catch (error) {
      throw new Error(`could not observe registry dist-tags for ${name}: ${error.message}`);
    }
    if (output === null) {
      vector[name] = null;
      continue;
    }
    let tags;
    try {
      tags = JSON.parse(output);
    } catch (error) {
      throw new Error(`registry dist-tags for ${name} were not valid JSON: ${error.message}`);
    }
    if (tags === null || typeof tags !== 'object' || Array.isArray(tags)) {
      throw new Error(`registry dist-tags for ${name} were not a JSON object`);
    }
    vector[name] = Object.hasOwn(tags, tag) ? tags[tag] : null;
  }
  return validateObservedPriorVector(vector, { packageNames });
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

export function writeObservedPriorVector({ out, ...inputs }) {
  const vector = observePriorVector(inputs);
  writeJsonAtomic(out, vector);
  return vector;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  let packageNames = PROMOTION_PACKAGE_NAMES;
  if (options.ledger) {
    const ledger = readBoundedJsonFile(options.ledger, 'candidate publication ledger');
    validateCandidateLedger(ledger);
    packageNames = promotionNamesForScopePreset(ledger.scopePreset);
  }

  mkdirSync(dirname(options.out), { recursive: true, mode: 0o700 });
  const temporaryRoot = mkdtempSync(join(dirname(options.out), '.snapback-prior-vector-'));
  try {
    const vector = writeObservedPriorVector({
      out: options.out,
      packageNames,
      tag: options.tag,
      runNpm: (args) => runNpm(args, {
        cacheRoot: join(temporaryRoot, 'npm-cache'),
        cwd: repositoryRoot,
        registry: options.registry,
      }),
    });
    process.stdout.write(`${JSON.stringify({
      out: options.out,
      packages: Object.keys(vector).length,
      registry: options.registry,
      tag: options.tag,
    })}\n`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    fail(error.message);
  }
}
