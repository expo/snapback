import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertPublicPackageBuildIdentity } from '../../scripts/runtime-package-authority.mjs';

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
assert.equal(manifest.name, '@snapback/runtime-linux-x64');
assert.deepEqual(manifest.os, ['linux']);
assert.deepEqual(manifest.cpu, ['x64']);
assert.deepEqual(manifest.files, ['bin', 'lib']);

// @ref LLP 0041#runtime-distribution — prepared native payloads are package
// outputs, while the source-side package contract remains reviewable.
const ignoreRules = readFileSync(new URL('./.gitignore', import.meta.url), 'utf8')
  .split(/\r?\n/u)
  .filter(Boolean);
assert.deepEqual(ignoreRules, ['/bin/', '/lib/']);

const binary = fileURLToPath(new URL('./bin/snapback', import.meta.url));
const hermes = fileURLToPath(new URL('./lib/libhermesvm.so', import.meta.url));
if (existsSync(binary) || existsSync(hermes)) {
  assert.equal(existsSync(binary), true, 'prepared package must contain the binary');
  assert.equal(existsSync(hermes), true, 'prepared package must contain libhermesvm.so');
  const environment = { ...process.env };
  delete environment.LD_LIBRARY_PATH;
  const launched = spawnSync(binary, ['--help'], {
    encoding: 'utf8',
    env: environment,
    timeout: 15_000,
  });
  assert.equal(
    launched.status,
    0,
    `packaged Linux binary must launch via its loader-relative rpath: ${launched.stderr}`,
  );
  const identity = spawnSync(binary, ['build-identity'], {
    encoding: 'utf8',
    env: environment,
    timeout: 15_000,
  });
  assert.equal(identity.status, 0, identity.stderr);
  assertPublicPackageBuildIdentity(JSON.parse(identity.stdout));
}
console.log('package.test.mjs: Linux x64 package identity and relocatable closure pass');
