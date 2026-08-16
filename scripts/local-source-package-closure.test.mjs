import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// @ref LLP 0176#development-and-packaging — A2 stays closed only if a nested
// consumer can install the complete local client closure without npm fallback.

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const installer = join(root, 'scripts', 'install-local-snapback-packages.mjs');
const fixture = join(root, 'scripts', 'fixtures', 'local-source-expo');

function runInstaller(appRoot, cacheDir, ...options) {
  return spawnSync(process.execPath, [
    installer,
    appRoot,
    '--registry',
    'http://127.0.0.1:1',
    '--cache-dir',
    cacheDir,
    '--no-cache',
    ...options,
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

test('nested Expo fixture cold-installs one all-local Expo/client/React closure', () => {
  mkdirSync(join(root, 'target'), { recursive: true });
  const temporary = mkdtempSync(join(root, 'target', 'local-source-closure-'));
  const appRoot = join(temporary, 'nested', 'expo-app');
  const firstCache = join(temporary, 'bun-cache-first');
  const frozenCache = join(temporary, 'bun-cache-frozen');

  try {
    cpSync(fixture, appRoot, { recursive: true });

    const first = runInstaller(appRoot, firstCache);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const firstReceipt = JSON.parse(first.stdout.trim().split('\n').at(-1));
    assert.deepEqual(firstReceipt.directPackages, [
      '@expo/snapback-client',
      '@expo/snapback-expo',
      '@expo/snapback-react',
    ]);
    assert.deepEqual(firstReceipt.overridePackages, [
      '@expo/snapback-client',
      '@expo/snapback-contract',
      '@expo/snapback-expo',
      '@expo/snapback-expo-custody',
      '@expo/snapback-react',
    ]);
    assert.equal(firstReceipt.installed, true);
    assert.equal(firstReceipt.frozenLockfile, false);
    assert.deepEqual(Object.keys(firstReceipt.artifactDigests), [
      '@expo/snapback-client',
      '@expo/snapback-contract',
      '@expo/snapback-expo',
      '@expo/snapback-expo-custody',
      '@expo/snapback-react',
    ]);
    for (const [name, digest] of Object.entries(firstReceipt.artifactDigests)) {
      assert.match(name, /^@expo\/snapback-/u);
      assert.match(digest, /^[0-9a-f]{64}$/u);
      assert.match(
        firstReceipt.localSpecifiers[name],
        new RegExp(`\\.${digest}\\.tgz$`, 'u'),
        `${name} tarball pathname carries its own packed-content digest`,
      );
    }

    const manifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
    assert.match(manifest.dependencies['@expo/snapback-client'], /^file:/u);
    assert.match(manifest.dependencies['@expo/snapback-react'], /^file:/u);
    assert.match(manifest.dependencies['@expo/snapback-expo'], /^file:/u);
    assert.match(manifest.dependencies['@expo/snapback-client'], /\.tgz$/u);
    assert.match(manifest.dependencies['@expo/snapback-react'], /\.tgz$/u);
    assert.match(manifest.dependencies['@expo/snapback-expo'], /\.tgz$/u);
    assert.equal(manifest.dependencies['@expo/snapback-contract'], undefined);
    assert.match(manifest.overrides['@expo/snapback-contract'], /^file:/u);
    assert.match(manifest.overrides['@expo/snapback-client'], /^file:/u);
    assert.match(manifest.overrides['@expo/snapback-react'], /^file:/u);
    assert.match(manifest.overrides['@expo/snapback-expo'], /^file:/u);
    assert.match(manifest.overrides['@expo/snapback-expo-custody'], /^file:/u);

    const lock = readFileSync(join(appRoot, 'bun.lock'), 'utf8');
    for (const name of [
      '@expo/snapback-client',
      '@expo/snapback-contract',
      '@expo/snapback-expo',
      '@expo/snapback-expo-custody',
      '@expo/snapback-react',
    ]) {
      const escaped = name.replace('/', '\\/');
      assert.match(
        lock,
        new RegExp(`\\["${escaped}@\\.snapback/local-source-packages/`, 'u'),
      );
    }
    assert.doesNotMatch(lock, /@expo\/snapback-(?:client|contract|expo(?:-custody)?|react)@(?:https?:|npm:)/u);
    assert.deepEqual(
      readdirSync(join(appRoot, '.snapback', 'local-source-packages')).sort(),
      Object.values(firstReceipt.localSpecifiers)
        .map((specifier) => specifier.split('/').at(-1))
        .sort(),
      'a successful install removes predecessor/provisional tarballs',
    );
    const unrelatedPackageRecords = lock.split('\n').filter((line) => (
      /^ {4}"[^"]+": \[/u.test(line)
      && !line.startsWith('    "@expo/snapback-')
    ));

    // A tracked fixture does not commit its content-addressed tarballs. Model
    // a fresh clone whose manifest/lock still name a predecessor source pack:
    // the helper must rotate its own lock paths before Bun consults them.
    const predecessorDigest = '0'.repeat(64);
    const predecessorSpecifiers = Object.fromEntries(
      Object.entries(firstReceipt.localSpecifiers).map(([name, specifier]) => [
        name,
        specifier.replace(/\.[0-9a-f]{64}\.tgz$/u, `.${predecessorDigest}.tgz`),
      ]),
    );
    const staleManifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
    for (const [name, predecessor] of Object.entries(predecessorSpecifiers)) {
      if (Object.hasOwn(staleManifest.dependencies, name)) {
        staleManifest.dependencies[name] = predecessor;
      }
      staleManifest.overrides[name] = predecessor;
    }
    writeFileSync(
      join(appRoot, 'package.json'),
      `${JSON.stringify(staleManifest, null, 2)}\n`,
    );
    let staleLock = readFileSync(join(appRoot, 'bun.lock'), 'utf8');
    for (const [name, current] of Object.entries(firstReceipt.localSpecifiers)) {
      const predecessor = predecessorSpecifiers[name];
      staleLock = staleLock
        .split(current.slice('file:'.length))
        .join(predecessor.slice('file:'.length));
    }
    writeFileSync(join(appRoot, 'bun.lock'), staleLock);
    rmSync(join(appRoot, 'node_modules'), { recursive: true, force: true });
    rmSync(join(appRoot, '.snapback', 'local-source-packages'), {
      recursive: true,
      force: true,
    });
    const migrated = runInstaller(appRoot, join(temporary, 'bun-cache-migrated'));
    assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout);
    assert.doesNotMatch(
      `${migrated.stdout}\n${migrated.stderr}`,
      /(?:Ignoring lockfile|failed to parse lockfile|Failed to resolve root)/iu,
      'rotation keeps the existing Bun lock valid',
    );
    const migratedReceipt = JSON.parse(migrated.stdout.trim().split('\n').at(-1));
    assert.deepEqual(migratedReceipt.artifactDigests, firstReceipt.artifactDigests);
    const migratedLock = readFileSync(join(appRoot, 'bun.lock'), 'utf8');
    assert.doesNotMatch(migratedLock, new RegExp(predecessorDigest, 'u'));
    for (const specifier of Object.values(firstReceipt.localSpecifiers)) {
      assert.match(migratedLock, new RegExp(specifier.slice('file:'.length), 'u'));
    }
    for (const [name, specifier] of Object.entries(firstReceipt.localSpecifiers)) {
      const artifact = readFileSync(join(appRoot, specifier.slice('file:'.length)));
      const integrity = `sha512-${createHash('sha512').update(artifact).digest('base64')}`;
      const recordPrefix = `${JSON.stringify(name)}: [${JSON.stringify(
        `${name}@${specifier.slice('file:'.length)}`,
      )}`;
      const record = migratedLock.split('\n').find((line) => line.trimStart().startsWith(recordPrefix));
      assert(record, `${name} lock record was reconstructed`);
      assert.match(record, new RegExp(integrity.replace(/[+]/gu, '\\+'), 'u'));
    }
    assert.deepEqual(
      migratedLock.split('\n').filter((line) => (
        /^ {4}"[^"]+": \[/u.test(line)
        && !line.startsWith('    "@expo/snapback-')
      )),
      unrelatedPackageRecords,
      'rotation leaves every unrelated package record byte-for-byte unchanged',
    );

    const imported = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      "await import('@expo/snapback-client'); await import('@expo/snapback-react'); await import('@expo/snapback-expo'); await import('@expo/snapback-expo-custody');",
    ], { cwd: appRoot, encoding: 'utf8' });
    assert.equal(imported.status, 0, imported.stderr || imported.stdout);

    const expoTarball = join(
      appRoot,
      firstReceipt.localSpecifiers['@expo/snapback-expo'].replace(/^file:/u, ''),
    );
    const archive = spawnSync('tar', ['-tzf', expoTarball], { encoding: 'utf8' });
    assert.equal(archive.status, 0, archive.stderr || archive.stdout);
    assert.match(archive.stdout, /package\/app-binding\.schema\.json/u);
    assert.match(archive.stdout, /package\/app\.plugin\.js/u);
    assert.doesNotMatch(
      archive.stdout,
      /(?:snapback-cli|snapback-admin|hosted-supervisor|admin-ui|\/src\/|\.test\.mjs)/u,
      'Expo package tarball excludes server/admin/contributor-only files',
    );

    rmSync(join(appRoot, 'node_modules'), { recursive: true, force: true });
    const frozen = runInstaller(appRoot, frozenCache, '--frozen-lockfile');
    assert.equal(frozen.status, 0, frozen.stderr || frozen.stdout);
    const frozenReceipt = JSON.parse(frozen.stdout.trim().split('\n').at(-1));
    assert.equal(frozenReceipt.frozenLockfile, true);
    assert.equal(frozenReceipt.installed, true);
    assert.deepEqual(frozenReceipt.artifactDigests, firstReceipt.artifactDigests);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
