import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import * as packageEntry from './index.mjs';
import { useSnapbackActivityPresence as reactActivityPresence } from '@expo/snapback-react';

const require = createRequire(import.meta.url);

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const files = new Set(manifest.files);
const targets = Object.values(manifest.exports)
  .flatMap((target) => (typeof target === 'string' ? [target] : Object.values(target)))
  .filter((target) => typeof target === 'string' && target !== './package.json')
  .map((target) => target.replace(/^\.\//u, ''));
for (const target of targets) {
  assert(files.has(target), `package files must include exported target ${target}`);
}

assert.deepEqual(Object.keys(manifest.imports), ['#app-state']);
const appStateImports = manifest.imports?.['#app-state'];
assert.deepEqual(Object.keys(appStateImports), ['browser', 'react-native', 'default']);
assert.deepEqual(appStateImports, {
  browser: './app-state.web.mjs',
  'react-native': './app-state.native.mjs',
  default: './app-state.mjs',
});
for (const target of Object.values(appStateImports)) {
  const file = target.replace(/^\.\//u, '');
  assert(files.has(file), `package files must include imports target ${file}`);
}

assert.equal(manifest.name, '@expo/snapback-expo');
assert.equal(manifest.peerDependencies['expo-file-system'], '>=57.0.0 <58.0.0');
assert.equal(manifest.peerDependencies['react-native-web'], '>=0.21.0 <0.22.0');
assert.equal(manifest.peerDependenciesMeta['react-native-web'].optional, true);
const webAppStateSource = readFileSync(new URL('./app-state.web.mjs', import.meta.url), 'utf8');
assert.match(webAppStateSource, /react-native-web\/dist\/exports\/AppState/u);
assert.doesNotMatch(webAppStateSource, /import\('react-native'\)/u);
assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
  '@expo/snapback-client',
  '@expo/snapback-react',
]);
assert.equal(manifest.publishConfig.access, 'public');
assert.equal(
  require('@expo/snapback-expo'),
  require('./app.plugin.js'),
  'CommonJS package-root resolution returns the Expo config plugin for EAS',
);
assert.equal(typeof packageEntry.SnapbackExpoProvider, 'function');
assert.equal(typeof packageEntry.createSnapbackExpoBoot, 'function');
assert.equal(typeof packageEntry.createSupervisedExpoEnvironment, 'function');
assert.equal(typeof packageEntry.createExpoAssetSourceAdapter, 'function');
assert.equal(typeof packageEntry.adaptExpoAssetSource, 'function');
assert.equal(typeof packageEntry.useSnapbackQuery, 'function');
assert.equal(typeof packageEntry.useSnapbackMutation, 'function');
assert.equal(typeof packageEntry.useSnapbackSettledMutation, 'function');
assert.equal(typeof packageEntry.useSnapbackActivityPresence, 'function');
assert.notEqual(
  packageEntry.useSnapbackActivityPresence,
  reactActivityPresence,
  'the Expo facade installs lifecycle policy around the canonical React hook',
);
assert.equal(packageEntry.APP_BINDING_FORMAT, 'snapback.app-binding.v1');

const providerSource = readFileSync(new URL('./provider.mjs', import.meta.url), 'utf8');
assert.match(
  providerSource,
  /React\.createElement\(SnapbackProvider, \{[\s\S]*?provider: active\.reactProvider,[\s\S]*?outboxDrain,[\s\S]*?outboxDrainOptions,/u,
  'Expo provider forwards the React owner\'s drain mode and options',
);

const productionSources = [
  'index.mjs',
  'provider.mjs',
  'app-binding.mjs',
  'supervised-environment.mjs',
  'asset-source.mjs',
  'activity-presence.mjs',
  'lifecycle-source.mjs',
]
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
