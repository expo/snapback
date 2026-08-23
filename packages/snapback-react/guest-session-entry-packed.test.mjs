import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageDirectory, '../..');
const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'snapback-guest-entry-packed-'));
const packDirectory = resolve(temporaryRoot, 'packs');
const nodeModules = resolve(temporaryRoot, 'node_modules');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  );
  return result;
};

const packages = Object.freeze([
  Object.freeze({ name: '@expo/snapback-contract', directory: 'packages/snapback-contract' }),
  Object.freeze({ name: '@expo/snapback-client', directory: 'packages/snapback-client' }),
  Object.freeze({ name: '@expo/snapback-react', directory: 'packages/snapback-react' }),
  Object.freeze({ name: '@expo/snapback-expo', directory: 'packages/snapback-expo' }),
  Object.freeze({ name: '@expo/snapback-cli', directory: 'packages/snapback-cli' }),
]);

try {
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(resolve(nodeModules, '@expo'), { recursive: true });
  for (const entry of packages) {
    const packed = run('npm', [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      packDirectory,
    ], { cwd: resolve(repositoryRoot, entry.directory) });
    const metadata = JSON.parse(packed.stdout);
    assert.equal(metadata.length, 1, `${entry.name} npm pack returned one tarball`);
    const extraction = resolve(temporaryRoot, `extract-${basename(entry.directory)}`);
    mkdirSync(extraction, { recursive: true });
    run('tar', [
      '-xzf',
      resolve(packDirectory, metadata[0].filename),
      '-C',
      extraction,
    ]);
    renameSync(resolve(extraction, 'package'), resolve(nodeModules, entry.name));
  }
  for (const dependency of ['fake-indexeddb', 'react', 'react-test-renderer']) {
    symlinkSync(
      realpathSync(resolve(repositoryRoot, 'node_modules', dependency)),
      resolve(nodeModules, dependency),
    );
  }
  const proof = run(process.execPath, [
    resolve(repositoryRoot, 'scripts/guest-session-entry-packed-proof.mjs'),
  ], {
    env: {
      ...process.env,
      SNAPBACK_GUEST_ENTRY_MODULE_ROOT: nodeModules,
    },
  });
  process.stdout.write(proof.stdout);
  process.stderr.write(proof.stderr);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
