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
    'index.mjs',
    'service.mjs',
    'external-store.mjs',
    'hosted-edge-admission.mjs',
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
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('hosted supervisor package test passed');
