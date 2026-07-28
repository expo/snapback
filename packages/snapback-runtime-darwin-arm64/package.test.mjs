import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertPublicPackageBuildIdentity } from '../../scripts/runtime-package-authority.mjs';

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
assert.equal(manifest.name, '@snapback/runtime-darwin-arm64');
assert.deepEqual(manifest.os, ['darwin']);
assert.deepEqual(manifest.cpu, ['arm64']);
assert.deepEqual(manifest.files, ['bin', 'Frameworks']);
const binary = fileURLToPath(new URL('./bin/snapback', import.meta.url));
if (existsSync(binary)) {
  const identity = spawnSync(binary, ['build-identity'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(identity.status, 0, identity.stderr);
  assertPublicPackageBuildIdentity(JSON.parse(identity.stdout));
}
console.log('package.test.mjs: platform package identity and explicit closure pass');
