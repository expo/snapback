import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as packageEntry from './index.mjs';

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const files = new Set(manifest.files);
const targets = Object.values(manifest.exports)
  .flatMap((target) => (typeof target === 'string' ? [target] : Object.values(target)))
  .filter((target) => typeof target === 'string' && target !== './package.json')
  .map((target) => target.replace(/^\.\//u, ''));
for (const target of targets) {
  assert(files.has(target), `package files must include exported target ${target}`);
}

assert.equal(manifest.name, '@expo/snapback-expo');
assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
  '@expo/snapback-client',
  '@expo/snapback-react',
]);
assert.equal(manifest.publishConfig.access, 'public');
assert.equal(typeof packageEntry.SnapbackExpoProvider, 'function');
assert.equal(typeof packageEntry.createSnapbackExpoBoot, 'function');
assert.equal(typeof packageEntry.useSnapbackQuery, 'function');
assert.equal(typeof packageEntry.useSnapbackMutation, 'function');
assert.equal(packageEntry.APP_BINDING_FORMAT, 'snapback.app-binding.v1');

const productionSources = ['index.mjs', 'provider.mjs', 'app-binding.mjs']
  .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');
for (const forbidden of [
  "from '@expo/snapback-cli'",
  "from '@expo/snapback-admin-client'",
  'snapback-hosted-supervisor',
  '/src/',
  '/admin-ui/',
  'host-ops',
  'impersonation',
]) {
  assert(!productionSources.includes(forbidden), `production graph mentions forbidden closure ${forbidden}`);
}

console.log('package.test.mjs: exports, public-only dependencies, React aliases, and production closure pass');
