import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertStagedRuntimeAdminConsole,
  assertStagedRuntimeStoreQualification,
} from './publication-store-qualification-gate.mjs';
import { writeAdminConsoleSnapshotManifest } from '../packages/snapback-cli/admin-snapshot.mjs';

const VERSION = '0.1.17';
const REVISION = 'a'.repeat(40);
const RUNTIME_NAMES = [
  '@expo/snapback-runtime-darwin-arm64',
  '@expo/snapback-runtime-linux-x64',
];

function validReceipt(overrides = {}) {
  return {
    schemaVersion: 'snapback.packaged-store-qualification.v1',
    capabilityId: 'single_table_v1',
    binaryIdentity: {
      gitCommit: REVISION,
      gitDirty: false,
      buildProfile: 'release',
      buildDistribution: 'public-package',
    },
    packageClosure: RUNTIME_NAMES.map((name) => ({ name, version: VERSION })),
    ...overrides,
  };
}

function writeTarball(root, name, receipt, { admin = null } = {}) {
  const slug = name.split('/').at(-1);
  const scratch = join(root, `.scratch-${slug}`);
  const packageRoot = join(scratch, 'package');
  const bin = join(packageRoot, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify({ name, version: VERSION })}\n`);
  writeFileSync(join(bin, 'snapback'), 'fixture runtime\n');
  if (receipt !== undefined) {
    writeFileSync(
      join(bin, 'packaged-store-qualification.receipt.json'),
      `${JSON.stringify(receipt)}\n`,
    );
  }
  if (admin !== null) {
    const adminRoot = join(packageRoot, 'admin');
    mkdirSync(join(adminRoot, '__exact'), { recursive: true });
    writeFileSync(join(adminRoot, 'index.html'), '<title>Snapback Admin Console</title>\n');
    writeFileSync(join(adminRoot, '__exact', 'platform-manifest.json'), '{}\n');
    writeAdminConsoleSnapshotManifest({
      root: adminRoot,
      sourceRevision: admin.sourceRevision ?? REVISION,
      sourceDirty: admin.sourceDirty ?? false,
    });
    if (admin.tamper === true) {
      writeFileSync(join(adminRoot, 'index.html'), '<title>tampered</title>\n');
    }
    writeFileSync(join(packageRoot, 'runtime-readiness.json'), `${JSON.stringify({
      sourceRevision: admin.runtimeRevision ?? REVISION,
    })}\n`);
  }
  const tarball = `${slug}.tgz`;
  const packed = spawnSync('tar', ['czf', join(root, tarball), '-C', scratch, 'package'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.equal(packed.status, 0, packed.stderr);
  rmSync(scratch, { recursive: true, force: true });
  return tarball;
}

function withFixture(operation) {
  const root = mkdtempSync(join(tmpdir(), 'publication-store-gate-test-'));
  try {
    return operation(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function makeLedger(root, receipts, {
  runtimeNames = RUNTIME_NAMES,
  includeNonRuntime = false,
  adminByName = null,
} = {}) {
  const packages = runtimeNames.map((name) => ({
    name,
    version: VERSION,
    tarball: writeTarball(root, name, receipts.get(name), {
      admin: adminByName?.get(name) ?? null,
    }),
  }));
  if (includeNonRuntime) {
    packages.push({
      name: '@expo/snapback-client',
      version: VERSION,
      tarball: 'client-without-receipt.tgz',
    });
  }
  return {
    revision: REVISION,
    version: VERSION,
    runtimePlatforms: ['darwin-arm64', 'linux-x64'],
    packages,
  };
}

function throwsCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

test('runtime tarball missing the receipt is refused', () => {
  withFixture((root) => {
    const receipts = new Map([
      [RUNTIME_NAMES[0], undefined],
      [RUNTIME_NAMES[1], validReceipt()],
    ]);
    throwsCode(
      () => assertStagedRuntimeStoreQualification({ stagedDir: root, ledger: makeLedger(root, receipts) }),
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_MISSING',
    );
  });
});

test('valid receipts on both platforms are admitted and summarized', () => {
  withFixture((root) => {
    const receipt = validReceipt();
    const ledger = makeLedger(root, new Map(RUNTIME_NAMES.map((name) => [name, receipt])), {
      includeNonRuntime: true,
    });
    const summary = assertStagedRuntimeStoreQualification({ stagedDir: root, ledger });
    assert.equal(summary.length, 2);
    assert.deepEqual(summary.map((row) => row.name), RUNTIME_NAMES);
    assert(summary.every((row) => /^[0-9a-f]{64}$/.test(row.receiptSha256)));
    assert(summary.every((row) => row.gitCommit === REVISION));
  });
});

test('clean build-matched admin snapshots on both runtime platforms are admitted', () => {
  withFixture((root) => {
    const receipt = validReceipt();
    const ledger = makeLedger(
      root,
      new Map(RUNTIME_NAMES.map((name) => [name, receipt])),
      { adminByName: new Map(RUNTIME_NAMES.map((name) => [name, {}])) },
    );
    const summary = assertStagedRuntimeAdminConsole({ stagedDir: root, ledger });
    assert.deepEqual(summary.map((row) => row.name), RUNTIME_NAMES);
    assert(summary.every((row) => row.sourceRevision === REVISION));
    assert(summary.every((row) => /^[0-9a-f]{64}$/u.test(row.snapshotSha256)));
  });
});

for (const [label, invalidAdmin, code] of [
  ['missing snapshot', null, 'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID'],
  ['dirty snapshot', { sourceDirty: true }, 'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID'],
  ['tampered snapshot', { tamper: true }, 'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID'],
  [
    'runtime revision drift',
    { runtimeRevision: 'b'.repeat(40) },
    'SNAPBACK_PUBLICATION_STORE_RECEIPT_IDENTITY_DRIFTED',
  ],
]) {
  test(`${label} is refused by admin publication qualification`, () => {
    withFixture((root) => {
      const receipt = validReceipt();
      const adminByName = new Map(RUNTIME_NAMES.map((name) => [name, {}]));
      adminByName.set(RUNTIME_NAMES[0], invalidAdmin);
      const ledger = makeLedger(
        root,
        new Map(RUNTIME_NAMES.map((name) => [name, receipt])),
        { adminByName },
      );
      throwsCode(
        () => assertStagedRuntimeAdminConsole({ stagedDir: root, ledger }),
        code,
      );
    });
  });
}

for (const [label, receipt] of [
  ['wrong schemaVersion', validReceipt({ schemaVersion: 'wrong' })],
  ['wrong capabilityId', validReceipt({ capabilityId: 'bounded_children_v1' })],
]) {
  test(`${label} is invalid`, () => {
    withFixture((root) => {
      const receipts = new Map(RUNTIME_NAMES.map((name, index) => (
        [name, index === 0 ? receipt : validReceipt()]
      )));
      throwsCode(
        () => assertStagedRuntimeStoreQualification({ stagedDir: root, ledger: makeLedger(root, receipts) }),
        'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
      );
    });
  });
}

for (const [label, binaryIdentity] of [
  ['wrong gitCommit', { ...validReceipt().binaryIdentity, gitCommit: 'b'.repeat(40) }],
  ['dirty binary', { ...validReceipt().binaryIdentity, gitDirty: true }],
]) {
  test(`${label} drifts identity`, () => {
    withFixture((root) => {
      const receipts = new Map(RUNTIME_NAMES.map((name, index) => [
        name,
        index === 0 ? validReceipt({ binaryIdentity }) : validReceipt(),
      ]));
      throwsCode(
        () => assertStagedRuntimeStoreQualification({ stagedDir: root, ledger: makeLedger(root, receipts) }),
        'SNAPBACK_PUBLICATION_STORE_RECEIPT_IDENTITY_DRIFTED',
      );
    });
  });
}

test('stale packageClosure version is refused', () => {
  withFixture((root) => {
    const stale = validReceipt({
      packageClosure: [{ name: '@expo/snapback-client', version: '0.1.16' }],
    });
    const receipts = new Map(RUNTIME_NAMES.map((name, index) => [
      name,
      index === 0 ? stale : validReceipt(),
    ]));
    throwsCode(
      () => assertStagedRuntimeStoreQualification({ stagedDir: root, ledger: makeLedger(root, receipts) }),
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_CLOSURE_DRIFTED',
    );
  });
});

test('non-runtime packages without receipts are ignored', () => {
  withFixture((root) => {
    const receipt = validReceipt();
    const ledger = makeLedger(root, new Map(RUNTIME_NAMES.map((name) => [name, receipt])), {
      includeNonRuntime: true,
    });
    assert.doesNotThrow(() => assertStagedRuntimeStoreQualification({ stagedDir: root, ledger }));
  });
});

test('a partial runtime matrix is refused', () => {
  withFixture((root) => {
    const receipts = new Map([[RUNTIME_NAMES[0], validReceipt()]]);
    const ledger = makeLedger(root, receipts, { runtimeNames: [RUNTIME_NAMES[0]] });
    throwsCode(
      () => assertStagedRuntimeStoreQualification({ stagedDir: root, ledger }),
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_PLATFORM_INCOMPLETE',
    );
  });
});
