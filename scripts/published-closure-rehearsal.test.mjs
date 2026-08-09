import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

// @ref LLP 0176#development-and-packaging — the registry half of A2 must
// prove the same nested Expo consumer shape as the all-local closure proof.

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const fixture = join(root, 'scripts', 'fixtures', 'local-source-expo');
const registry = 'https://registry.npmjs.org';
const publishedVersion = process.env.SNAPBACK_PUBLISHED_CLOSURE_VERSION ?? '0.1.15';
const snapbackPackages = [
  '@expo/snapback-client',
  '@expo/snapback-contract',
  '@expo/snapback-react',
];

function assertExactVersion(version, label) {
  assert.match(
    version,
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u,
    `${label} must be one exact npm version`,
  );
}

function rootBunVersion() {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const match = /^bun@([^\s]+)$/u.exec(manifest.packageManager ?? '');
  assert(match, 'checkout package.json must pin packageManager as bun@<version>');
  return match[1];
}

function registryRecord(lock, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matches = [...lock.matchAll(new RegExp(
    `^ {4}"${escaped}": \\["([^"]+)", "", .*"sha512-[^"]+"\\],?$`,
    'gmu',
  ))];
  assert.equal(matches.length, 1, `${name} must have exactly one registry package record`);
  return matches[0][1];
}

test('nested Expo fixture cold-installs one coherent public client/React closure', () => {
  assertExactVersion(publishedVersion, 'SNAPBACK_PUBLISHED_CLOSURE_VERSION');
  mkdirSync(join(root, 'target'), { recursive: true });
  const temporary = mkdtempSync(join(root, 'target', 'published-closure-'));
  const appRoot = join(temporary, 'nested', 'expo-app');
  const cacheDir = join(temporary, 'bun-cache-empty');

  try {
    cpSync(fixture, appRoot, { recursive: true });
    for (const stub of [
      'expo-file-system-stub',
      'expo-stub',
      'react-native-stub',
      'react-stub',
    ]) {
      rmSync(join(appRoot, stub), { recursive: true, force: true });
    }

    const manifest = {
      name: 'snapback-published-closure-expo-fixture',
      version: '1.0.0',
      private: true,
      packageManager: `bun@${rootBunVersion()}`,
      dependencies: {
        '@expo/snapback-client': publishedVersion,
        '@expo/snapback-react': publishedVersion,
        expo: '57.0.10',
        'expo-file-system': '57.0.1',
        react: '19.0.0',
        'react-native': '0.86.2',
      },
    };
    assert.equal(manifest.dependencies['@expo/snapback-contract'], undefined);
    assert.equal(manifest.overrides, undefined);
    assert.doesNotMatch(JSON.stringify(manifest), /file:/u);
    writeFileSync(join(appRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    mkdirSync(cacheDir);
    assert.deepEqual(readdirSync(cacheDir), [], 'the isolated Bun cache starts empty');
    assert.equal(
      readFileSync(join(appRoot, 'app.json'), 'utf8'),
      readFileSync(join(fixture, 'app.json'), 'utf8'),
      'the rehearsal retains the source regression nested-Expo app fixture',
    );
    assert.equal(readdirSync(appRoot).includes('node_modules'), false);
    assert.equal(readdirSync(appRoot).includes('bun.lock'), false);

    const expectedBun = rootBunVersion();
    const bunVersion = spawnSync('bun', ['--version'], { encoding: 'utf8' });
    assert.equal(bunVersion.status, 0, bunVersion.stderr || bunVersion.stdout);
    assert.equal(bunVersion.stdout.trim(), expectedBun, 'install uses the checkout-pinned Bun');

    const installed = spawnSync('bun', [
      'install',
      '--registry',
      registry,
      '--cache-dir',
      cacheDir,
      '--no-cache',
      '--ignore-scripts',
    ], {
      cwd: appRoot,
      encoding: 'utf8',
      timeout: 180_000,
      env: {
        ...process.env,
        BUN_CONFIG_REGISTRY: registry,
        BUN_INSTALL_CACHE_DIR: cacheDir,
      },
    });
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);

    const installedManifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
    assert.equal(installedManifest.dependencies['@expo/snapback-contract'], undefined);
    assert.equal(installedManifest.overrides, undefined);
    assert.doesNotMatch(JSON.stringify(installedManifest), /file:/u);

    const lock = readFileSync(join(appRoot, 'bun.lock'), 'utf8');
    assert.doesNotMatch(lock, /(?:file:|workspace:|link:)/u);
    for (const name of snapbackPackages) {
      assert.equal(
        registryRecord(lock, name),
        `${name}@${publishedVersion}`,
        `${name} resolves from the public registry at the coherent published version`,
      );
      const installedPackage = JSON.parse(readFileSync(
        join(appRoot, 'node_modules', ...name.split('/'), 'package.json'),
        'utf8',
      ));
      assert.equal(installedPackage.name, name);
      assert.equal(installedPackage.version, publishedVersion);
    }

    const imported = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      "await import('@expo/snapback-client'); await import('@expo/snapback-react');",
    ], { cwd: appRoot, encoding: 'utf8' });
    assert.equal(imported.status, 0, imported.stderr || imported.stdout);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
