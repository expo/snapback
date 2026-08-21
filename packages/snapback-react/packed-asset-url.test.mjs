// LLP 0295 Phase 1 vertical fixture: prove nullable asset-URL behavior at the
// packed public package boundary, not through checkout-local ./index.mjs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-react-packed-assets-')));
const consumer = join(scratch, 'consumer');
const nodeModules = join(consumer, 'node_modules');
const expoModules = join(nodeModules, '@expo');
const packedPackage = join(expoModules, 'snapback-react');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? consumer,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

try {
  mkdirSync(packedPackage, { recursive: true });
  const pack = run('npm', ['pack', '--json', '--pack-destination', scratch], {
    cwd: packageRoot,
  });
  const [{ filename }] = JSON.parse(pack.stdout);
  run('tar', [
    '-xzf', join(scratch, filename),
    '-C', packedPackage,
    '--strip-components=1',
  ], { cwd: scratch });

  symlinkSync(join(repoRoot, 'packages', 'snapback-client'), join(expoModules, 'snapback-client'));
  symlinkSync(join(repoRoot, 'packages', 'snapback-contract'), join(expoModules, 'snapback-contract'));
  symlinkSync(join(repoRoot, 'node_modules', 'react'), join(nodeModules, 'react'));
  symlinkSync(
    join(repoRoot, 'node_modules', 'react-test-renderer'),
    join(nodeModules, 'react-test-renderer'),
  );
  if (existsSync(join(repoRoot, 'node_modules', '@types'))) {
    symlinkSync(join(repoRoot, 'node_modules', '@types'), join(nodeModules, '@types'));
  }

  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`);
  writeFileSync(join(consumer, 'runtime.mjs'), `
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { prepareReactBindingForClient } from '@expo/snapback-client/react-binding';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  useSnapbackAssetUrl,
} from '@expo/snapback-react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const manifest = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'packed-asset-url-fixture',
  bundleHash: 'sha256:packed-asset-url-fixture',
  functions: Object.freeze([]),
});
const client = {
  authProtocols: {},
  liveQuery() {},
  async inspect() {
    return {
      targetProfileId: 'local-dev-sqlite-ibex',
      target: 'local-dev-sqlite-ibex',
      schema: { schemaHash: 'sha256:schema' },
      functions: manifest,
      capabilityManifest: {
        artifactKind: 'capabilityManifest',
        schemaVersion: 'snapback.v0',
        targetProfileId: 'local-dev-sqlite-ibex',
        supportedCapabilities: ['live_subscriptions'],
      },
    };
  },
  async authSession() { return { activeMode: 'dev' }; },
  registerAuthBarrierParticipant() { return async () => {}; },
  async releaseConnection() { return { released: true }; },
};
const binding = await prepareReactBindingForClient(client, { generatedManifest: manifest });
let issuanceCalls = 0;
const assets = {
  issuedUrlStore() {
    issuanceCalls += 1;
    throw new Error('nullable packed hook must not create an issued-URL store');
  },
};
const provider = createSnapbackReactProvider(binding, { assets });
let snapshot = null;
function Probe() {
  snapshot = useSnapbackAssetUrl(null);
  return null;
}
let renderer;
act(() => {
  renderer = TestRenderer.create(
    React.createElement(SnapbackProvider, { provider }, React.createElement(Probe)),
  );
});
assert.equal(snapshot.status, 'empty');
assert.equal(snapshot.url, null);
await act(async () => { await snapshot.refresh(); });
assert.equal(issuanceCalls, 0);
act(() => { renderer.unmount(); });
await provider.dispose();
`);
  writeFileSync(join(consumer, 'types.ts'), `
import {
  useSnapbackAssetUrl,
  type AssetUrlEmptyState,
  type AssetUrlHookState,
} from '@expo/snapback-react';

declare const optionalAssetId: string | null;
const optionalState: AssetUrlHookState = useSnapbackAssetUrl(optionalAssetId);
const emptyState: AssetUrlEmptyState = useSnapbackAssetUrl(null);
if (emptyState.status === 'empty') emptyState.url satisfies null;
void optionalState;
`);

  run(process.execPath, ['runtime.mjs']);
  run(join(repoRoot, 'node_modules', '.bin', 'tsc'), [
    '--noEmit',
    '--strict',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    'types.ts',
  ]);
  console.log('packed-asset-url.test.mjs: packed external runtime and type fixtures pass');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
