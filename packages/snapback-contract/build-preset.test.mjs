import assert from 'node:assert/strict';

import {
  SnapbackContractBuildError,
  createSnapbackAdminDevApiUnreachableDiagnostic,
  createSnapbackWrongServerShapeDiagnostic,
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

console.log('snapback contract build preset tests: ok');
