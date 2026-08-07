import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CODES,
  defaultRunCommand,
  deriveHermesIdentity,
  stageLinuxHermesRelease,
  verifyHermesBundle,
} from './stage-linux-hermes-release.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gitlink = '4c34c831aa087d6783b0d68f281cdb374ed7fc89';
const sourceCommit = 'e639a7bad8bfca844d982afa54fac786c65a8856';
const patchHex = '9a846368e13304659cb6e0d4be78853bad6415de01f68a4191f7cd9b3af2c7d7';
const identityName = 'e639a7bad8bf-9a846368e133';
const cacheKey = 'fixture-linux-cache-key';
const assetName = `hermes-linux-x64-${identityName}-static-v1.tar.gz`;

function ok(stdout = '') {
  return { status: 0, stdout, stderr: '' };
}

function rejected(stderr = 'fixture refusal') {
  return { status: 1, stdout: '', stderr };
}

function write(path, value = 'fixture\n') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function identityRunner({ hasCommit = true, calls = [] } = {}) {
  return (command, args, options = {}) => {
    calls.push({ command, args: [...args], options });
    if (command === 'git' && args.includes('ls-tree')) {
      return ok(`160000 commit ${gitlink}\tvendor/ibex\n`);
    }
    if (command === 'git' && args.includes('rev-parse')) return ok('.git\n');
    if (command === 'git' && args.includes('cat-file')) return hasCommit ? ok() : rejected('missing');
    if (command === 'git' && args.includes('archive')) return ok(Buffer.from('fixture archive'));
    if (command === 'tar' && args[0] === '-x') {
      const destination = args[args.indexOf('-C') + 1];
      write(join(destination, 'scripts', 'hermes-version.sh'), `
IBEX_HERMES_SOURCE_COMMIT="\${IBEX_HERMES_SOURCE_COMMIT:-${sourceCommit}}"
ibex_hermes_patch_digest() { printf '%s\\n' '${patchHex.slice(0, 12)}'; }
ibex_hermes_linux_source_cache_key() { printf '%s\\n' '${cacheKey}'; }
ibex_hermes_patch_stack_digest_hex() { printf '%s\\n' '${patchHex}'; }
`);
      for (const path of [
        'scripts/apply-hermes-patches.sh',
        'scripts/build-hermes.sh',
        'scripts/build-hermes-linux.sh',
        'patches/hermes/0001-fixture.patch',
      ]) write(join(destination, path));
      return ok();
    }
    if (command === 'bash') return defaultRunCommand(command, args, options);
    throw new Error(`unexpected identity command: ${command} ${args.join(' ')}`);
  };
}

function receipt(overrides = {}) {
  const value = {
    schema: 'ibex/hermes-profile-provenance-receipt/2',
    origin: {
      cacheKey,
      reviewedProfileIdentity: {
        sourceCommit,
        patchStackDigest: `sha256-${patchHex}`,
      },
    },
  };
  if (overrides.cacheKey !== undefined) value.origin.cacheKey = overrides.cacheKey;
  if (overrides.sourceCommit !== undefined) {
    value.origin.reviewedProfileIdentity.sourceCommit = overrides.sourceCommit;
  }
  if (overrides.patchStackDigest !== undefined) {
    value.origin.reviewedProfileIdentity.patchStackDigest = overrides.patchStackDigest;
  }
  return value;
}

function createBundleFixture(base, overrides = {}) {
  const bundle = join(base, 'bundle');
  for (const path of [
    'include/jsi/jsi.h',
    'bin/hermesc',
    'bin/hermes',
    'lib/libhermesvm.so',
    'lib/libhermesvm_a.a',
    'lib/libjsi.a',
    'lib/libboost_context.a',
  ]) write(join(bundle, path), `${path}\n`);
  write(
    join(bundle, 'lib', 'hermes-profile-provenance.json'),
    `${JSON.stringify(receipt(overrides), null, 2)}\n`,
  );
  const release = join(base, 'release');
  mkdirSync(release, { recursive: true });
  const tarball = join(release, assetName);
  const packed = defaultRunCommand('tar', ['-czf', tarball, '-C', bundle, '.']);
  assert.equal(packed.status, 0, packed.stderr);
  const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex');
  write(join(release, `${assetName}.sha256`), `${digest}  ${assetName}\n`);
  write(join(release, `${assetName}.sigstore.json`), '{"fixture":true}\n');
  return {
    release,
    paths: {
      tarball,
      checksum: join(release, `${assetName}.sha256`),
      sigstore: join(release, `${assetName}.sigstore.json`),
    },
  };
}

function bundleRunner({ attestationStatus = 0 } = {}) {
  return (command, args, options = {}) => {
    if (command === 'gh') {
      return attestationStatus === 0 ? ok('verified') : rejected('attestation rejected');
    }
    if (command === 'nm') return rejected('file format not recognized');
    return defaultRunCommand(command, args, options);
  };
}

function expectedIdentity() {
  return {
    cacheKey,
    hermesSourceCommit: sourceCommit,
    patchStackDigest: `sha256-${patchHex}`,
  };
}

test('derives identity from the committed Ibex helper closure', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-hermes-identity-test-'));
  const calls = [];
  try {
    const result = deriveHermesIdentity({
      root: scratch,
      temporaryRoot: scratch,
      env: {
        PATH: process.env.PATH,
        IBEX_HERMES_SOURCE_COMMIT: 'f'.repeat(40),
        IBEX_HERMES_VERSION: 'stale-override',
      },
      runCommand: identityRunner({ calls }),
    });
    assert.equal(result.gitlink, gitlink);
    assert.equal(result.hermesSourceCommit, sourceCommit);
    assert.equal(result.identity, identityName);
    assert.equal(result.cacheKey, cacheKey);
    assert.equal(result.patchStackDigest, `sha256-${patchHex}`);
    assert(existsSync(join(repoRoot, 'scripts', 'stage-linux-hermes-release.mjs')));
    const archive = calls.find(({ command, args }) => command === 'git' && args.includes('archive'));
    assert(archive.args.includes(':(glob)patches/hermes/*.patch'));
    const bash = calls.find(({ command }) => command === 'bash');
    assert.equal(bash.options.env.IBEX_HERMES_SOURCE_COMMIT, undefined);
    assert.equal(bash.options.env.IBEX_HERMES_VERSION, undefined);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('refuses identity derivation when no approved object database has the gitlink', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-hermes-no-source-'));
  try {
    assert.throws(
      () => deriveHermesIdentity({
        root: scratch,
        temporaryRoot: scratch,
        env: { PATH: process.env.PATH },
        runCommand: identityRunner({ hasCommit: false }),
      }),
      (error) => error.code === CODES.IDENTITY_SOURCE_UNAVAILABLE,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('refuses a checksum mismatch before unpacking', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-hermes-checksum-'));
  try {
    const fixture = createBundleFixture(scratch);
    write(fixture.paths.checksum, `${'0'.repeat(64)}  ${assetName}\n`);
    assert.throws(
      () => verifyHermesBundle({
        paths: fixture.paths,
        identity: expectedIdentity(),
        runCommand: bundleRunner(),
        temporaryRoot: scratch,
      }),
      (error) => error.code === CODES.CHECKSUM_MISMATCH,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

for (const [name, overrides] of [
  ['cache key', { cacheKey: 'wrong-cache-key' }],
  ['source commit', { sourceCommit: 'f'.repeat(40) }],
  ['patch stack digest', { patchStackDigest: `sha256-${'f'.repeat(64)}` }],
]) {
  test(`refuses a profile receipt ${name} mismatch`, () => {
    const scratch = mkdtempSync(join(tmpdir(), 'snapback-hermes-receipt-'));
    try {
      const fixture = createBundleFixture(scratch, overrides);
      assert.throws(
        () => verifyHermesBundle({
          paths: fixture.paths,
          identity: expectedIdentity(),
          runCommand: bundleRunner(),
          temporaryRoot: scratch,
        }),
        (error) => error.code === CODES.RECEIPT_MISMATCH,
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}

test('cleans and reports stale release assets when staging the current identity', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-hermes-stage-'));
  const messages = [];
  try {
    const fixture = createBundleFixture(scratch);
    const stagingDir = join(scratch, 'staging');
    const stale = 'hermes-linux-x64-old-identity-static-v1.tar.gz';
    for (const suffix of ['', '.sha256', '.sigstore.json']) write(join(stagingDir, `${stale}${suffix}`));
    const identityCommands = identityRunner();
    const runCommand = (command, args, options = {}) => {
      if (command === 'git' || command === 'bash' || (command === 'tar' && args[0] === '-x')) {
        return identityCommands(command, args, options);
      }
      if (command === 'gh' && args[0] === 'auth') return ok();
      if (command === 'gh' && args[0] === 'release') {
        const destination = args[args.indexOf('--dir') + 1];
        for (const name of [assetName, `${assetName}.sha256`, `${assetName}.sigstore.json`]) {
          copyFileSync(join(fixture.release, name), join(destination, name));
        }
        return ok();
      }
      if (command === 'gh' && args[0] === 'attestation') return ok('verified');
      if (command === 'nm') return rejected('not an ELF host');
      return defaultRunCommand(command, args, options);
    };
    const result = stageLinuxHermesRelease({
      root: scratch,
      runCommand,
      env: { PATH: process.env.PATH },
      paths: { stagingDir, temporaryRoot: scratch },
      report: (message) => messages.push(message),
      notice: () => {},
      now: () => new Date('2026-08-07T12:00:00.000Z'),
    });
    assert.deepEqual(result.removed, [stale, `${stale}.sha256`, `${stale}.sigstore.json`]);
    assert(messages.some((message) => message.includes(`Removed stale Hermes carrier ${stale}.`)));
    assert(existsSync(join(stagingDir, assetName)));
    assert(!existsSync(join(stagingDir, stale)));
    const stagedReceipt = JSON.parse(readFileSync(join(stagingDir, 'staging-receipt.json'), 'utf8'));
    assert.equal(stagedReceipt.ibexCommit, gitlink);
    assert(stagedReceipt.prebuiltLib.some(({ file }) => file === 'lib/libhermesvm.so'));

    let attemptedDownload = false;
    let usedOfflineBundle = false;
    const checkIdentityCommands = identityRunner();
    const checkMessages = [];
    const checkResult = stageLinuxHermesRelease({
      root: scratch,
      env: { PATH: process.env.PATH },
      paths: {
        stagingDir,
        prebuiltDir: join(scratch, 'prebuilt'),
        temporaryRoot: scratch,
      },
      check: true,
      prebuiltLib: true,
      report: (message) => checkMessages.push(message),
      notice: () => {},
      runCommand: (command, args, options = {}) => {
        if (command === 'git' || command === 'bash' || (command === 'tar' && args[0] === '-x')) {
          return checkIdentityCommands(command, args, options);
        }
        if (command === 'gh' && args[0] === 'release') {
          attemptedDownload = true;
          return rejected('check mode must not download');
        }
        if (command === 'gh' && args[0] === 'attestation') {
          usedOfflineBundle = args.includes('--bundle');
          return ok('verified');
        }
        if (command === 'nm') return rejected('not an ELF host');
        return defaultRunCommand(command, args, options);
      },
    });
    assert.equal(attemptedDownload, false);
    assert.equal(usedOfflineBundle, true);
    assert.equal(checkResult.receipt.tarballSha256, stagedReceipt.tarballSha256);
    assert(existsSync(join(scratch, 'prebuilt', 'lib', 'libhermesvm.so')));
    assert(checkMessages.includes(`${stagedReceipt.prebuiltLib[0].sha256}  ${stagedReceipt.prebuiltLib[0].file}`));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('--check refuses a staged carrier whose name is stale for the derived identity', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-hermes-stale-check-'));
  try {
    const stagingDir = join(scratch, 'staging');
    write(join(stagingDir, 'hermes-linux-x64-old-static-v1.tar.gz'));
    assert.throws(
      () => stageLinuxHermesRelease({
        root: scratch,
        runCommand: identityRunner(),
        env: { PATH: process.env.PATH },
        paths: { stagingDir, temporaryRoot: scratch },
        check: true,
        report: () => {},
        notice: () => {},
      }),
      (error) => error.code === CODES.STALE_ASSET_PRESENT,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('surfaces GitHub attestation rejection with its stable code', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-hermes-attestation-'));
  try {
    const fixture = createBundleFixture(scratch);
    assert.throws(
      () => verifyHermesBundle({
        paths: fixture.paths,
        identity: expectedIdentity(),
        runCommand: bundleRunner({ attestationStatus: 1 }),
        temporaryRoot: scratch,
      }),
      (error) => error.code === CODES.ATTESTATION_FAILED,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
