import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertPublicationCapabilityQualificationMatrix,
  assertStagedRuntimeAdminConsole,
  assertStagedRuntimeStoreQualification,
  createPublicationCapabilityQualification,
  publicationCodegenRequiredCapabilities,
} from './publication-store-qualification-gate.mjs';
import { writeAdminConsoleSnapshotManifest } from '../packages/snapback-cli/admin-snapshot.mjs';
import { PUBLIC_PACKAGE_BUILD_RECIPE } from './runtime-package-authority.mjs';

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
      buildRecipe: PUBLIC_PACKAGE_BUILD_RECIPE,
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
  [
    'ordinary release recipe',
    {
      ...validReceipt().binaryIdentity,
      buildRecipe: {
        schemaVersion: 'snapback.cargo-build-recipe.v1',
        cargoProfile: 'release',
        inherits: null,
        incremental: null,
        lto: null,
        codegenUnits: null,
        optLevel: null,
        strip: null,
      },
    },
  ],
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

function capabilityLedger() {
  return {
    revision: REVISION,
    version: VERSION,
    runtimePlatforms: ['darwin-arm64', 'linux-x64'],
    packages: [
      ...RUNTIME_NAMES.map((name, index) => ({
        sourceName: name,
        name,
        version: VERSION,
        runtimeBinarySha256: String(index + 1).repeat(64),
      })),
      {
        sourceName: '@expo/snapback-codegen',
        name: '@expo/snapback-codegen',
        version: VERSION,
      },
    ],
  };
}

function capabilityQualification(platform, overrides = {}) {
  const ledger = capabilityLedger();
  const runtime = ledger.packages.find((row) => row.name.endsWith(platform));
  const required = publicationCodegenRequiredCapabilities();
  return createPublicationCapabilityQualification({
    platform,
    sourceRevision: REVISION,
    runtimePackage: runtime.name,
    runtimeBinarySha256: runtime.runtimeBinarySha256,
    codegenPackage: '@expo/snapback-codegen',
    codegenVersion: VERSION,
    codegenRequiredCapabilities: required,
    runtimeManifest: {
      targetProfileId: 'local-dev-sqlite-ibex',
      supportedCapabilities: required,
      capabilityGaps: ['cloudflare', 'postgres'],
      ...overrides,
    },
  });
}

test('every codegen-required capability is admitted on both platform runtimes', () => {
  const ledger = capabilityLedger();
  const qualifications = ledger.runtimePlatforms.map((platform) => (
    capabilityQualification(platform)
  ));
  const summary = assertPublicationCapabilityQualificationMatrix({ ledger, qualifications });
  assert.deepEqual(summary.map(({ platform }) => platform), ledger.runtimePlatforms);
  assert(summary.every(({ codegenRequiredCapabilities }) => (
    codegenRequiredCapabilities.includes('assets.media-collection.v1')
  )));
  assert(summary.every(({ experimentalPolicy }) => experimentalPolicy === 'included-no-exemption'));
});

test('an experimental codegen requirement missing from Linux names capability, platform, and side', () => {
  const ledger = capabilityLedger();
  const linux = capabilityQualification('linux-x64');
  linux.runtimeSupportedCapabilities = linux.runtimeSupportedCapabilities
    .filter((id) => id !== 'assets.media-collection.v1');
  linux.runtimeCapabilityGaps = [
    ...linux.runtimeCapabilityGaps,
    'assets.media-collection.v1',
  ].sort();
  assert.throws(
    () => assertPublicationCapabilityQualificationMatrix({
      ledger,
      qualifications: [capabilityQualification('darwin-arm64'), linux],
    }),
    (error) => (
      error.code === 'SNAPBACK_PUBLICATION_CAPABILITY_REQUIRED_MISSING'
      && error.message.includes("capability 'assets.media-collection.v1'")
      && error.message.includes('platform linux-x64')
      && error.message.includes('missing side: runtime')
    ),
  );
});

test('missing runtime capability evidence fails closed instead of passing', () => {
  const ledger = capabilityLedger();
  const linux = capabilityQualification('linux-x64');
  delete linux.runtimeSupportedCapabilities;
  assert.throws(
    () => assertPublicationCapabilityQualificationMatrix({
      ledger,
      qualifications: [capabilityQualification('darwin-arm64'), linux],
    }),
    (error) => (
      error.code === 'SNAPBACK_PUBLICATION_CAPABILITY_SET_UNCOMPARABLE'
      && error.message.includes('platform linux-x64')
      && error.message.includes('missing side: comparison evidence')
    ),
  );
});

test('a contradictory runtime advertisement fails closed and names the capability', () => {
  const ledger = capabilityLedger();
  const linux = capabilityQualification('linux-x64');
  linux.runtimeCapabilityGaps = [
    ...linux.runtimeCapabilityGaps,
    'assets.media-collection.v1',
  ].sort();
  assert.throws(
    () => assertPublicationCapabilityQualificationMatrix({
      ledger,
      qualifications: [capabilityQualification('darwin-arm64'), linux],
    }),
    (error) => (
      error.code === 'SNAPBACK_PUBLICATION_CAPABILITY_REQUIRED_MISSING'
      && error.message.includes("capability 'assets.media-collection.v1'")
      && error.message.includes('platform linux-x64')
      && error.message.includes('both supported and a gap')
      && error.message.includes('missing side: runtime')
    ),
  );
});

test('retained codegen evidence may not omit an authoritative requirement', () => {
  const ledger = capabilityLedger();
  const linux = capabilityQualification('linux-x64');
  linux.codegenRequiredCapabilities = linux.codegenRequiredCapabilities
    .filter((id) => id !== 'assets.media-collection.v1');
  assert.throws(
    () => assertPublicationCapabilityQualificationMatrix({
      ledger,
      qualifications: [capabilityQualification('darwin-arm64'), linux],
    }),
    (error) => (
      error.code === 'SNAPBACK_PUBLICATION_CAPABILITY_REQUIRED_MISSING'
      && error.message.includes("capability 'assets.media-collection.v1'")
      && error.message.includes('missing side: codegen qualification evidence')
    ),
  );
});

test('an absent platform qualification fails closed', () => {
  const ledger = capabilityLedger();
  assert.throws(
    () => assertPublicationCapabilityQualificationMatrix({
      ledger,
      qualifications: [capabilityQualification('darwin-arm64')],
    }),
    (error) => (
      error.code === 'SNAPBACK_PUBLICATION_CAPABILITY_SET_UNCOMPARABLE'
      && error.message.includes('platform linux-x64')
      && error.message.includes('missing side: comparison evidence')
    ),
  );
});
