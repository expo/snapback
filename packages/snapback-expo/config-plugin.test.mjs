import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const withSnapbackExpo = require('./config-plugin.cjs');
const appPlugin = require('./app.plugin.js');
assert.strictEqual(appPlugin, withSnapbackExpo);

const root = mkdtempSync(join(tmpdir(), 'snapback-expo-plugin-'));
const descriptorPath = join(root, 'snapback', 'generated', 'app.descriptor.json');

function packageStub(name, version) {
  const path = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'package.json'), `${JSON.stringify({ name, version })}\n`);
}

try {
  mkdirSync(dirname(descriptorPath), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","private":true}\n');
  const descriptor = {
    format: 'snapback.app.v1',
    authoringProfile: 'snapback-explicit-v1',
    identity: {
      app: 'fixture',
      schema: 'sha256:schema',
      functions: 'sha256:functions',
      descriptor: 'sha256:descriptor',
    },
    api: { queries: {}, mutations: {}, assets: {}, ephemeral: {}, queryGroups: {} },
    commands: {},
    surfaces: {},
    capabilities: { required: ['live_subscriptions'] },
  };
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor)}\n`);
  packageStub('expo', '57.0.10');
  packageStub('react', '19.2.3');
  packageStub('react-native', '0.86.2');
  packageStub('@expo/snapback-client', '0.1.0');
  packageStub('@expo/snapback-react', '0.1.0');

  const input = {
    name: 'Fixture',
    slug: 'fixture',
    sdkVersion: '57.0.0',
    _internal: { projectRoot: root },
    extra: { retained: true },
  };
  const configured = withSnapbackExpo(input);
  const receipt = configured.extra.snapback.integrationReceipt;
  assert.equal(receipt.format, 'snapback.expo-integration-receipt.v1');
  assert.equal(receipt.descriptor.path, 'snapback/generated/app.descriptor.json');
  assert.equal(receipt.descriptor.identity, descriptor.identity.descriptor);
  assert.deepEqual(receipt.native.adapters, [
    'react-native-app-state',
    'expo-picker-uri-to-structural-blob',
    'expo-file-system-picker-cache-fallback',
    'expo-wintercg-fetch',
    'snapback-client-sha256',
    'ordinary-session-custody',
  ]);
  assert.deepEqual(receipt.native.permissions, { ios: [], android: [] });
  assert.equal(receipt.buildInvalidation.inputs.length, 3);
  assert.equal(configured.extra.retained, true);
  assert.deepEqual(withSnapbackExpo(configured), configured, 'plugin must be idempotent');
  const publicReceipt = JSON.stringify(receipt);
  for (const forbidden of ['bearer', 'sessionToken', 'pairingSecret', 'adminCredential', 'target.origin']) {
    assert(!publicReceipt.includes(forbidden), `receipt leaked forbidden material spelling ${forbidden}`);
  }
  assert.equal(input.extra.snapback, undefined, 'plugin does not mutate its input');

  const firstDigest = receipt.descriptor.digest;
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
  assert.notEqual(
    withSnapbackExpo(input).extra.snapback.integrationReceipt.descriptor.digest,
    firstDigest,
    'descriptor bytes participate in build invalidation',
  );

  packageStub('react-native', '0.85.0');
  assert.throws(
    () => withSnapbackExpo(input),
    (error) => error.code === 'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED'
      && error.diagnostic.details.package === 'react-native',
  );
  assert.throws(
    () => withSnapbackExpo(input, { descriptor: '../outside.json' }),
    (error) => error.code === 'SNAPBACK_EXPO_DESCRIPTOR_PATH_INVALID',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

assert.equal(
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).name,
  '@expo/snapback-expo',
);
console.log('config-plugin.test.mjs: descriptor input, tuple, idempotence, receipt, and empty E0 permissions pass');
