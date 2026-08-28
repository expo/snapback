#!/usr/bin/env node

// Closure check for the qualified-staging assemble job. Lives as a file so
// the EAS workflow YAML stays under the 16 KiB revision cap; the workflow
// calls it with SNAPBACK_PACKAGE_OUT, SOURCE_REVISION, and CANDIDATE_TAG set.
// @ref LLP 0166#public-package-advertisement-amendment--2026-08-06 — a
// qualified public runtime must ship the receipt whose startup validation
// authorizes single_table_v1 advertisement.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PACKAGE_INVENTORY } from './snapback-publish-core.mjs';
import { assertPublicPackageBuildRecipe } from './runtime-package-authority.mjs';

const RECEIPT_ENTRY = 'package/bin/packaged-store-qualification.receipt.json';
const RECEIPT_SCHEMA_VERSION = 'snapback.packaged-store-qualification.v1';
const RECEIPT_CAPABILITY_ID = 'single_table_v1';
const RUNTIME_PACKAGE_PREFIX = '@expo/snapback-runtime-';

function assertRuntimeReceipt({ packageOut, packageRow }) {
  const packageName = packageRow.name;
  if (typeof packageRow.tarball !== 'string' || packageRow.tarball.length === 0) {
    throw new Error(`qualified staging runtime package ${packageName} has no tarball`);
  }
  const tarballPath = join(packageOut, packageRow.tarball);
  const extracted = spawnSync('tar', ['-xzOf', tarballPath, RECEIPT_ENTRY], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (extracted.error || extracted.status !== 0) {
    throw new Error(
      `qualified staging runtime package ${packageName} is missing ${RECEIPT_ENTRY}`,
    );
  }

  let receipt;
  try {
    receipt = JSON.parse(extracted.stdout);
  } catch (error) {
    throw new Error(
      `qualified staging runtime package ${packageName} has an invalid JSON store qualification receipt: ${error.message}`,
    );
  }
  if (receipt?.schemaVersion !== RECEIPT_SCHEMA_VERSION
      || receipt?.capabilityId !== RECEIPT_CAPABILITY_ID) {
    throw new Error(
      `qualified staging runtime package ${packageName} store qualification receipt must have schemaVersion '${RECEIPT_SCHEMA_VERSION}' and capabilityId '${RECEIPT_CAPABILITY_ID}'`,
    );
  }
  try {
    assertPublicPackageBuildRecipe(receipt?.binaryIdentity?.buildRecipe);
  } catch (error) {
    throw new Error(
      `qualified staging runtime package ${packageName} store qualification receipt does not carry the production build recipe: ${error.message}`,
    );
  }
}

export function checkQualifiedStagingLedger({
  packageOut,
  sourceRevision,
  candidateTag,
  allowMissingStoreReceipts = false,
}) {
  const resolvedPackageOut = resolve(packageOut);
  const ledger = JSON.parse(readFileSync(
    join(resolvedPackageOut, 'publish-ledger.json'),
    'utf8',
  ));
  if (ledger.schemaVersion !== 'snapback.package-qualified-staging-ledger.v1'
      || ledger.mode !== 'dry-run'
      || ledger.sourceDirty !== false
      || ledger.revision !== sourceRevision
      || ledger.tag !== candidateTag
      || !Array.isArray(ledger.packages)
      || ledger.packages.length !== PACKAGE_INVENTORY.length) {
    throw new Error('qualified staging ledger did not close');
  }

  if (!allowMissingStoreReceipts) {
    for (const packageRow of ledger.packages) {
      if (typeof packageRow?.name === 'string'
          && packageRow.name.startsWith(RUNTIME_PACKAGE_PREFIX)) {
        assertRuntimeReceipt({ packageOut: resolvedPackageOut, packageRow });
      }
    }
  }
  return ledger;
}

const invoked = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  checkQualifiedStagingLedger({
    packageOut: process.env.SNAPBACK_PACKAGE_OUT,
    sourceRevision: process.env.SOURCE_REVISION,
    candidateTag: process.env.CANDIDATE_TAG,
    allowMissingStoreReceipts:
      process.env.SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS === '1',
  });
}
