#!/usr/bin/env node

// @ref LLP 0061#3-verification-snippets-that-ran — the local published-closure
// fence is network-free; this canary is the join that fails when the git
// record lags npm latest.
// @ref LLP 0041#0128--0129-2026-08-27--published-without-advancing-the-git-record
// — 0.1.28/0.1.29 reached latest without a post-publish record commit.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compareVersions } from './guide-lib.mjs';
import {
  PACKAGE_INVENTORY,
  PUBLIC_NPM_REGISTRY,
} from './snapback-publish-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD_PATH = 'guide/published-closure.json';
const THREE_COMPONENT_VERSION = /^\d+\.\d+\.\d+$/;
const FETCH_TIMEOUT_MS = 15_000;

export const CLOSURE_PACKAGE_NAMES = Object.freeze(
  PACKAGE_INVENTORY.map(([, publishedName]) => publishedName),
);

export function packumentUrl(registry, name) {
  const encoded = name.includes('/') ? name.replace('/', '%2f') : encodeURIComponent(name);
  return `${String(registry).replace(/\/$/u, '')}/${encoded}`;
}

function codedError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function loadRecord(root) {
  const path = join(root, RECORD_PATH);
  let record;
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw codedError(
      'SNAPBACK_PUBLISHED_CLOSURE_RECORD_INVALID',
      `${RECORD_PATH} is missing or not JSON (${error.message})`,
    );
  }
  if (record?.schemaVersion !== 'snapback-published-closure.v1') {
    throw codedError(
      'SNAPBACK_PUBLISHED_CLOSURE_RECORD_INVALID',
      `${RECORD_PATH}: schemaVersion must be 'snapback-published-closure.v1'`,
    );
  }
  if (!THREE_COMPONENT_VERSION.test(record?.newestPublished ?? '')) {
    throw codedError(
      'SNAPBACK_PUBLISHED_CLOSURE_RECORD_INVALID',
      `${RECORD_PATH}: newestPublished must be a three-component version (X.Y.Z)`,
    );
  }
  return record;
}

async function readLatest(name, { registry, fetchImpl }) {
  const url = packumentUrl(registry, name);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw codedError(
      'SNAPBACK_PUBLISHED_CLOSURE_REGISTRY_UNAVAILABLE',
      `could not fetch ${name} from ${registry}: ${error.message}`,
      { name, registry, url },
    );
  }
  if (!response.ok) {
    throw codedError(
      'SNAPBACK_PUBLISHED_CLOSURE_REGISTRY_UNAVAILABLE',
      `registry returned HTTP ${response.status} for ${name}`,
      { name, registry, url, status: response.status },
    );
  }
  let packument;
  try {
    packument = await response.json();
  } catch (error) {
    throw codedError(
      'SNAPBACK_PUBLISHED_CLOSURE_REGISTRY_UNAVAILABLE',
      `registry packument for ${name} is not JSON (${error.message})`,
      { name, registry, url },
    );
  }
  const latest = packument?.['dist-tags']?.latest;
  if (!THREE_COMPONENT_VERSION.test(latest ?? '')) {
    throw codedError(
      'SNAPBACK_PUBLISHED_CLOSURE_REGISTRY_UNAVAILABLE',
      `registry packument for ${name} does not carry a three-component dist-tags.latest`,
      { name, registry, url, latest },
    );
  }
  return { name, latest };
}

export async function checkPublishedClosureRegistry({
  root = ROOT,
  registry,
  fetchImpl = globalThis.fetch,
  packageNames = CLOSURE_PACKAGE_NAMES,
} = {}) {
  const record = loadRecord(root);
  const resolvedRegistry = registry ?? record.registry ?? PUBLIC_NPM_REGISTRY;
  if (typeof fetchImpl !== 'function') {
    throw codedError(
      'SNAPBACK_PUBLISHED_CLOSURE_REGISTRY_UNAVAILABLE',
      'fetch is not available',
    );
  }

  const packages = [];
  for (const name of packageNames) {
    packages.push(await readLatest(name, { registry: resolvedRegistry, fetchImpl }));
  }

  const latestVersions = [...new Set(packages.map((entry) => entry.latest))].sort();
  if (latestVersions.length !== 1) {
    throw codedError(
      'SNAPBACK_PUBLISHED_CLOSURE_INCOHERENT_REGISTRY',
      `identity-preset latest tags disagree: ${
        packages.map((entry) => `${entry.name}@${entry.latest}`).join(', ')
      }`,
      { recorded: record.newestPublished, packages },
    );
  }

  const registryLatest = latestVersions[0];
  const comparison = compareVersions(record.newestPublished, registryLatest);
  if (comparison < 0) {
    throw codedError(
      'SNAPBACK_PUBLISHED_CLOSURE_BEHIND_REGISTRY',
      `${RECORD_PATH} newestPublished ${record.newestPublished} is behind registry latest ${registryLatest}`,
      { recorded: record.newestPublished, registryLatest, packages },
    );
  }
  if (comparison > 0) {
    throw codedError(
      'SNAPBACK_PUBLISHED_CLOSURE_AHEAD_OF_REGISTRY',
      `${RECORD_PATH} newestPublished ${record.newestPublished} is ahead of registry latest ${registryLatest}`,
      { recorded: record.newestPublished, registryLatest, packages },
    );
  }

  return {
    ok: true,
    recorded: record.newestPublished,
    registryLatest,
    registry: resolvedRegistry,
    packages,
  };
}

function usage() {
  return 'usage: node scripts/check-published-closure-registry.mjs [--registry <url>] [--json]\n';
}

async function main(argv = process.argv.slice(2)) {
  const parsed = { registry: undefined, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      parsed.json = true;
      continue;
    }
    if (argument === '--registry') {
      const value = argv[++index];
      if (!value || value.startsWith('-')) {
        throw codedError('SNAPBACK_PUBLISHED_CLOSURE_ARGUMENT_INVALID', usage().trim());
      }
      parsed.registry = value;
      continue;
    }
    throw codedError('SNAPBACK_PUBLISHED_CLOSURE_ARGUMENT_INVALID', `unrecognized argument ${argument}\n${usage()}`);
  }

  const result = await checkPublishedClosureRegistry({
    root: ROOT,
    registry: parsed.registry,
  });
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[published-closure-registry] PASS: newestPublished ${result.recorded} matches registry latest `
        + `(${result.packages.length} packages at ${result.registry})\n`,
    );
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const code = error?.code ?? 'SNAPBACK_PUBLISHED_CLOSURE_REGISTRY_UNAVAILABLE';
    process.stderr.write(`[published-closure-registry] FAIL ${code}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
