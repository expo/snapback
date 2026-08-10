#!/usr/bin/env node

// @ref LLP 0110#single-table-public-package-advertisement-amendment--2026-08-06
// — the capability may cross the public-package boundary only when the exact
// serialized runtime package carries its closure-bound qualification receipt.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORE_RECEIPT_ENTRY =
  'package/bin/packaged-store-qualification.receipt.json';
export const RUNTIME_PACKAGE_PREFIX = '@expo/snapback-runtime-';

const RECEIPT_SCHEMA_VERSION = 'snapback.packaged-store-qualification.v1';
const RECEIPT_CAPABILITY_ID = 'single_table_v1';
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function extractReceipt(tarballPath, packageName) {
  const extracted = spawnSync('tar', ['-xzOf', tarballPath, STORE_RECEIPT_ENTRY], {
    encoding: null,
    maxBuffer: MAX_RECEIPT_BYTES,
  });
  if (extracted.error?.code === 'ENOBUFS') {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
      `staged runtime package ${packageName} store qualification receipt exceeds ${MAX_RECEIPT_BYTES} bytes`,
    );
  }
  if (extracted.error || extracted.status !== 0) {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_MISSING',
      `staged runtime package ${packageName} is missing ${STORE_RECEIPT_ENTRY}`,
    );
  }
  return extracted.stdout;
}

function parseReceipt(bytes, packageName) {
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
      `staged runtime package ${packageName} has an invalid JSON store qualification receipt: ${error.message}`,
    );
  }
  if (receipt?.schemaVersion !== RECEIPT_SCHEMA_VERSION
      || receipt?.capabilityId !== RECEIPT_CAPABILITY_ID) {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
      `staged runtime package ${packageName} store qualification receipt must have schemaVersion '${RECEIPT_SCHEMA_VERSION}' and capabilityId '${RECEIPT_CAPABILITY_ID}'`,
    );
  }
  return receipt;
}

export function assertStagedRuntimeStoreQualification({ stagedDir, ledger }) {
  const runtimeRows = Array.isArray(ledger?.packages)
    ? ledger.packages.filter((row) => (
      typeof row?.name === 'string'
      && row.name.startsWith(RUNTIME_PACKAGE_PREFIX)
    ))
    : [];
  if (!Array.isArray(ledger?.runtimePlatforms)
      || runtimeRows.length === 0
      || runtimeRows.length !== ledger.runtimePlatforms.length) {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_PLATFORM_INCOMPLETE',
      `staged publication has ${runtimeRows.length} runtime package rows for ${Array.isArray(ledger?.runtimePlatforms) ? ledger.runtimePlatforms.length : 0} declared runtime platforms`,
    );
  }

  const summary = [];
  for (const row of runtimeRows) {
    if (typeof row.tarball !== 'string' || row.tarball.length === 0) {
      throw codedError(
        'SNAPBACK_PUBLICATION_STORE_RECEIPT_MISSING',
        `staged runtime package ${row.name} has no tarball path`,
      );
    }
    const bytes = extractReceipt(join(resolve(stagedDir), row.tarball), row.name);
    const receipt = parseReceipt(bytes, row.name);
    const identity = receipt.binaryIdentity;
    if (identity?.gitCommit !== ledger.revision
        || identity?.gitDirty !== false
        || identity?.buildProfile !== 'release'
        || identity?.buildDistribution !== 'public-package') {
      throw codedError(
        'SNAPBACK_PUBLICATION_STORE_RECEIPT_IDENTITY_DRIFTED',
        `staged runtime package ${row.name} store qualification receipt does not bind clean release public-package revision ${ledger.revision}`,
      );
    }
    if (!Array.isArray(receipt.packageClosure)
        || receipt.packageClosure.some((entry) => entry?.version !== ledger.version)) {
      throw codedError(
        'SNAPBACK_PUBLICATION_STORE_RECEIPT_CLOSURE_DRIFTED',
        `staged runtime package ${row.name} store qualification receipt does not bind closure version ${ledger.version}`,
      );
    }
    summary.push({
      name: row.name,
      version: row.version,
      receiptSha256: createHash('sha256').update(bytes).digest('hex'),
      gitCommit: identity.gitCommit,
    });
  }
  return summary;
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--staged-dir' || argv[1].startsWith('-')) {
    throw codedError(
      'SNAPBACK_PUBLISH_ARGUMENT_INVALID',
      'usage: node scripts/publication-store-qualification-gate.mjs --staged-dir <dir>',
    );
  }
  return { stagedDir: resolve(argv[1]) };
}

function readBoundedLedger(stagedDir) {
  const path = join(stagedDir, 'publish-ledger.json');
  const size = statSync(path).size;
  if (size > MAX_LEDGER_BYTES) {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
      `publish ledger exceeds ${MAX_LEDGER_BYTES} bytes`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

const invoked = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const { stagedDir } = parseArguments(process.argv.slice(2));
    const ledger = readBoundedLedger(stagedDir);
    const storeQualification = assertStagedRuntimeStoreQualification({ stagedDir, ledger });
    console.log(JSON.stringify({ ok: true, storeQualification }));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      diagnostics: [{
        code: error?.code ?? 'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
        severity: 'error',
        subsystem: 'publish',
        message: error?.message ?? String(error),
      }],
    }));
    process.exitCode = 1;
  }
}
