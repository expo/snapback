import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SnapbackContractBuildError,
  createSnapbackAdminDevApiUnreachableDiagnostic,
  createSnapbackWrongServerShapeDiagnostic,
  resolveRootResolvableDedupe,
  rewriteStaticBasePath,
  resolveSnapbackContractDevServerOptions,
} from './build-preset.mjs';

delete process.env.SNAPBACK_ADMIN_DEV_API;
delete process.env.SNAPBACK_ADMIN_DEV_HOST;
delete process.env.SNAPBACK_ADMIN_DEV_PORT;
delete process.env.SNAPBACK_ADMIN_DEV_ALLOW_NON_LOOPBACK;

const defaults = resolveSnapbackContractDevServerOptions();
assert.equal(defaults.apiTarget, 'http://127.0.0.1:4287');
assert.equal(defaults.apiTargetSource, 'default-pinned-port');
assert.equal(defaults.host, '127.0.0.1');
assert.equal(defaults.hostIsLoopback, true);
assert.equal(defaults.port, 5173);

const explicit = resolveSnapbackContractDevServerOptions({
  apiTarget: 'http://127.0.0.1:4300/',
  host: 'localhost',
  port: '5180',
});
assert.equal(explicit.apiTarget, 'http://127.0.0.1:4300');
assert.equal(explicit.apiTargetSource, 'explicit');
assert.equal(explicit.port, 5180);

assert.throws(
  () => resolveSnapbackContractDevServerOptions({ host: '0.0.0.0' }),
  (error) =>
    error instanceof SnapbackContractBuildError &&
    error.diagnostic.code === 'SNAPBACK_ADMIN_DEV_HOST_EXPOSED',
);

const exposed = resolveSnapbackContractDevServerOptions({
  host: '0.0.0.0',
  allowNonLoopbackHost: true,
});
assert.equal(exposed.hostIsLoopback, false);

const unreachable = createSnapbackAdminDevApiUnreachableDiagnostic({
  apiTarget: 'http://127.0.0.1:4999',
  requestPath: '/_snapback/api/inspect',
  error: new Error('connect ECONNREFUSED'),
});
assert.equal(unreachable.code, 'SNAPBACK_ADMIN_DEV_API_UNREACHABLE');
assert.equal(unreachable.details.api_target, 'http://127.0.0.1:4999');
assert.match(unreachable.details.cause, /ECONNREFUSED/);

const wrongShape = createSnapbackWrongServerShapeDiagnostic({
  requestPath: '/__exact/platform-manifest.json',
});
assert.equal(wrongShape.code, 'SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE');
assert.equal(wrongShape.details.target_surface, 'admin Contract dev server');

// ENG-22600: dedupe entries must drop out when the app root cannot resolve
// the package (otherwise Vite's dep optimizer is silently bypassed and dev
// serve ships raw CJS react to the browser) and re-arm when it can.
{
  const bareRoot = mkdtempSync(join(tmpdir(), 'snapback-dedupe-bare-'));
  const armedRoot = mkdtempSync(join(tmpdir(), 'snapback-dedupe-armed-'));
  try {
    // A root with no node_modules anywhere up its (tmp) tree: dedupe drops out.
    writeFileSync(join(bareRoot, 'package.json'), JSON.stringify({ name: 'bare-fixture' }));
    assert.deepEqual(resolveRootResolvableDedupe(bareRoot, ['react', 'react-dom']), []);

    // A root with stub react + react-dom installed: dedupe re-arms.
    writeFileSync(join(armedRoot, 'package.json'), JSON.stringify({ name: 'armed-fixture' }));
    for (const name of ['react', 'react-dom']) {
      const packageDir = join(armedRoot, 'node_modules', name);
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        join(packageDir, 'package.json'),
        JSON.stringify({ name, version: '0.0.0-fixture', main: 'index.js' }),
      );
      writeFileSync(join(packageDir, 'index.js'), 'module.exports = {};\n');
    }
    assert.deepEqual(
      resolveRootResolvableDedupe(armedRoot, ['react', 'react-dom']),
      ['react', 'react-dom'],
    );
    // Partial installs arm only what resolves.
    assert.deepEqual(
      resolveRootResolvableDedupe(armedRoot, ['react', 'not-installed-fixture-pkg']),
      ['react'],
    );
  } finally {
    rmSync(bareRoot, { recursive: true, force: true });
    rmSync(armedRoot, { recursive: true, force: true });
  }
}

const tempDir = mkdtempSync(join(tmpdir(), 'snapback-build-preset-'));
try {
  const indexPath = join(tempDir, 'index.html');
  writeFileSync(
    indexPath,
    [
      '<link href="/__exact/platform-manifest.json">',
      '<script src="/assets/main.js"></script>',
      '<script type="application/json">{"envelopeUrl":"./__exact/native/mac/exact-native.json"}</script>',
    ].join('\n'),
  );

  rewriteStaticBasePath({ indexPath, basePath: '/_snapback/admin' });

  const rewritten = readFileSync(indexPath, 'utf8');
  assert.match(rewritten, /href="\/_snapback\/admin\/__exact\/platform-manifest\.json"/);
  assert.match(rewritten, /src="\/_snapback\/admin\/assets\/main\.js"/);
  assert.match(rewritten, /"envelopeUrl":"\/_snapback\/admin\/__exact\/native\/mac\/exact-native\.json"/);
  assert.doesNotMatch(rewritten, /href="\/__exact\//);
  assert.doesNotMatch(rewritten, /src="\/assets\//);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('snapback contract build preset tests: ok');
