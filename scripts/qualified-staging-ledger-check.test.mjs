import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkQualifiedStagingLedger } from './qualified-staging-ledger-check.mjs';
import { PACKAGE_INVENTORY } from './snapback-publish-core.mjs';
import { PUBLIC_PACKAGE_BUILD_RECIPE } from './runtime-package-authority.mjs';

const SOURCE_REVISION = 'a'.repeat(40);
const CANDIDATE_TAG = `bakeoff-0-1-99-${SOURCE_REVISION.slice(0, 12)}`;
const VALID_RECEIPT = Object.freeze({
  schemaVersion: 'snapback.packaged-store-qualification.v1',
  capabilityId: 'single_table_v1',
  binaryIdentity: Object.freeze({
    buildRecipe: PUBLIC_PACKAGE_BUILD_RECIPE,
  }),
});

function writeRuntimeTarball(packageOut, packageName, receipt) {
  const slug = packageName.split('/').at(-1);
  const scratch = join(packageOut, `.scratch-${slug}`);
  const packageRoot = join(scratch, 'package');
  const bin = join(packageRoot, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify({ name: packageName })}\n`);
  writeFileSync(join(bin, 'snapback'), 'fixture runtime\n');
  if (receipt !== undefined) {
    writeFileSync(
      join(bin, 'packaged-store-qualification.receipt.json'),
      `${JSON.stringify(receipt)}\n`,
    );
  }
  const tarball = `${slug}.tgz`;
  const packed = spawnSync('tar', ['-czf', join(packageOut, tarball), '-C', scratch, 'package'], {
    encoding: 'utf8',
  });
  assert.equal(packed.status, 0, packed.stderr);
  rmSync(scratch, { recursive: true, force: true });
  return tarball;
}

function makeLedger(packageOut, { runtimeReceipts = new Map(), nonRuntimeOnly = false } = {}) {
  const packages = nonRuntimeOnly
    ? PACKAGE_INVENTORY.map((_, index) => ({
      name: `fixture-package-${index}`,
      tarball: `fixture-package-${index}.tgz`,
    }))
    : PACKAGE_INVENTORY.map(([, name]) => ({
      name,
      tarball: name.startsWith('@expo/snapback-runtime-')
        ? writeRuntimeTarball(packageOut, name, runtimeReceipts.get(name))
        : `${name.split('/').at(-1)}.tgz`,
    }));
  const ledger = {
    schemaVersion: 'snapback.package-qualified-staging-ledger.v1',
    mode: 'dry-run',
    sourceDirty: false,
    revision: SOURCE_REVISION,
    tag: CANDIDATE_TAG,
    packages,
  };
  writeFileSync(
    join(packageOut, 'publish-ledger.json'),
    `${JSON.stringify(ledger, null, 2)}\n`,
  );
  return ledger;
}

function withFixture(operation) {
  const packageOut = mkdtempSync(join(tmpdir(), 'qualified-staging-ledger-test-'));
  try {
    return operation(packageOut);
  } finally {
    rmSync(packageOut, { recursive: true, force: true });
  }
}

function check(packageOut, options = {}) {
  return checkQualifiedStagingLedger({
    packageOut,
    sourceRevision: SOURCE_REVISION,
    candidateTag: CANDIDATE_TAG,
    ...options,
  });
}

test('runtime tarball without a store receipt is refused by default', () => {
  withFixture((packageOut) => {
    makeLedger(packageOut);
    assert.throws(
      () => check(packageOut),
      /runtime package @expo\/snapback-runtime-darwin-arm64 is missing/u,
    );
  });
});

test('the explicit qualification-pass opt-out permits missing store receipts', () => {
  withFixture((packageOut) => {
    makeLedger(packageOut);
    assert.doesNotThrow(() => check(packageOut, { allowMissingStoreReceipts: true }));
  });
});

test('valid store receipts in every runtime tarball close the ledger', () => {
  withFixture((packageOut) => {
    makeLedger(packageOut, {
      runtimeReceipts: new Map(PACKAGE_INVENTORY
        .map(([, name]) => name)
        .filter((name) => name.startsWith('@expo/snapback-runtime-'))
        .map((name) => [name, VALID_RECEIPT])),
    });
    assert.doesNotThrow(() => check(packageOut));
  });
});

for (const [label, receipt] of [
  ['wrong schemaVersion', { ...VALID_RECEIPT, schemaVersion: 'snapback.packaged-store-qualification.v2' }],
  ['wrong capabilityId', { ...VALID_RECEIPT, capabilityId: 'bounded_children_v1' }],
  [
    'ordinary release recipe',
    {
      ...VALID_RECEIPT,
      binaryIdentity: {
        buildRecipe: {
          ...PUBLIC_PACKAGE_BUILD_RECIPE,
          cargoProfile: 'release',
        },
      },
    },
  ],
]) {
  test(`${label} is refused`, () => {
    withFixture((packageOut) => {
      const runtimeNames = PACKAGE_INVENTORY
        .map(([, name]) => name)
        .filter((name) => name.startsWith('@expo/snapback-runtime-'));
      makeLedger(packageOut, {
        runtimeReceipts: new Map([
          [runtimeNames[0], receipt],
          [runtimeNames[1], VALID_RECEIPT],
        ]),
      });
      assert.throws(
        () => check(packageOut),
        /store qualification receipt (?:must have|does not carry)/u,
      );
    });
  });
}

test('non-runtime packages do not require store receipts', () => {
  withFixture((packageOut) => {
    makeLedger(packageOut, { nonRuntimeOnly: true });
    assert.doesNotThrow(() => check(packageOut));
  });
});

test('pre-existing qualified closure checks remain fail-closed', async (t) => {
  for (const [label, mutate] of [
    ['bad revision', (ledger) => { ledger.revision = 'b'.repeat(40); }],
    ['bad tag', (ledger) => { ledger.tag = 'latest'; }],
    ['bad mode', (ledger) => { ledger.mode = 'publish'; }],
    ['bad package count', (ledger) => { ledger.packages.pop(); }],
    ['dirty source', (ledger) => { ledger.sourceDirty = true; }],
  ]) {
    await t.test(label, () => {
      withFixture((packageOut) => {
        const ledger = makeLedger(packageOut, { nonRuntimeOnly: true });
        mutate(ledger);
        writeFileSync(
          join(packageOut, 'publish-ledger.json'),
          `${JSON.stringify(ledger, null, 2)}\n`,
        );
        assert.throws(
          () => check(packageOut, { allowMissingStoreReceipts: true }),
          /qualified staging ledger did not close/u,
        );
      });
    });
  }
});
