// Prove the operator-authority implementation and supervisor runtime assets
// are present and importable from the npm tarball without a repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'snapback-supervisor-package-'));

try {
  const packed = spawnSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
    { cwd: here, encoding: 'utf8' },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const [{ filename, files }] = JSON.parse(packed.stdout);
  const paths = new Set(files.map(({ path }) => path));
  for (const required of [
    'operator-authority.mjs',
    'operator-authority-transaction.mjs',
    'operator-service.mjs',
    'provider-credentials.mjs',
    'provider-executor.mjs',
    'supervisor-response.mjs',
    'index.mjs',
    'service.mjs',
    'external-store.mjs',
    'hosted-edge-admission.mjs',
    'internal/target-tigris-credentials.mjs',
    'target-onboarding.mjs',
    'bootstrap.mjs',
    'Dockerfile',
    'fly.supervisor.toml',
  ]) assert(paths.has(required), `${required} is missing from the supervisor tarball`);

  const extracted = spawnSync(
    'tar',
    ['-xzf', join(root, filename), '-C', root],
    { encoding: 'utf8' },
  );
  assert.equal(extracted.status, 0, extracted.stderr);
  const authority = await import(pathToFileURL(join(root, 'package', 'operator-authority.mjs')));
  const transaction = await import(pathToFileURL(
    join(root, 'package', 'operator-authority-transaction.mjs'),
  ));
  const provider = await import(pathToFileURL(join(root, 'package', 'provider-executor.mjs')));
  const credentials = await import(pathToFileURL(
    join(root, 'package', 'provider-credentials.mjs'),
  ));
  const response = await import(pathToFileURL(join(root, 'package', 'supervisor-response.mjs')));
  const service = await import(pathToFileURL(join(root, 'package', 'operator-service.mjs')));
  assert.equal(authority.__operatorAuthorityTest.STATE_SCHEMA_VERSION, 'snapback.supervisor-operator-authority-state.v1');
  assert(authority.SUPERVISOR_REQUEST_REGISTRY['release.upload']);
  assert(authority.SUPERVISOR_REQUEST_REGISTRY['capability.publication.finalize']);
  const state = new authority.SupervisorOperatorAuthority({
    installationId: 'isolated-installation',
    rootKeyId: 'isolated-root',
    nowMs: 1,
  }).snapshot();
  assert.equal(state.installationId, 'isolated-installation');
  assert.equal(state.operatorRevocationGeneration, 1);
  assert.equal(
    transaction.__operatorAuthorityTransactionTest.JOURNAL_SCHEMA_VERSION,
    'snapback.supervisor-operator-journal-entry.v1',
  );
  assert.equal(typeof authority.SupervisorOperatorAuthority.prototype.handleRequestAsync, 'function');
  assert.equal(typeof transaction.executeOperatorAuthorityTransactionAsync, 'function');
  assert.equal(provider.PROVIDER_LIFECYCLE_OPERATIONS.length, 17);
  assert.equal(typeof provider.createFlyTigrisProviderExecutor, 'function');
  assert.equal(typeof credentials.credentialBindingFor, 'function');
  assert.equal(typeof response.createSupervisorResponseSigner, 'function');
  assert.equal(typeof response.createExternalSupervisorResponseSigner, 'function');
  assert.equal(typeof service.createOperatorRequestService, 'function');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('hosted supervisor package test passed');
