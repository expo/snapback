import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runtimeSpawnEnvironment,
  spawnManagedRuntime,
} from './index.mjs';
import { writeAdminConsoleSnapshotManifest } from './admin-snapshot.mjs';

const root = mkdtempSync(join(tmpdir(), 'snapback-packaged-store-loader-'));
try {
  const sourceRevision = 'a'.repeat(40);
  const binary = join(root, 'bin', 'snapback');
  const receipt = join(root, 'bin', 'packaged-store-qualification.receipt.json');
  const adminRoot = join(root, 'admin');
  mkdirSync(join(root, 'bin'), { recursive: true });
  mkdirSync(join(adminRoot, '__exact'), { recursive: true });
  writeFileSync(binary, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  receipt: process.env.SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT ?? null,
  adminDist: process.env.SNAPBACK_ADMIN_DIST ?? null,
}));
`);
  chmodSync(binary, 0o755);
  writeFileSync(receipt, '{}\n');
  writeFileSync(join(adminRoot, 'index.html'), '<title>Snapback Admin Console</title>');
  writeFileSync(join(adminRoot, '__exact', 'platform-manifest.json'), '{}\n');
  writeAdminConsoleSnapshotManifest({
    root: adminRoot,
    sourceRevision,
    sourceDirty: false,
  });
  writeFileSync(join(root, 'runtime-readiness.json'), `${JSON.stringify({ sourceRevision })}\n`);

  const child = spawnManagedRuntime(binary, [], {
    cwd: root,
    env: { PATH: process.env.PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  const [status] = await once(child, 'close');
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(stdout), { receipt, adminDist: adminRoot });

  const explicit = runtimeSpawnEnvironment(binary, {
    SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT: '/operator/receipt.json',
  });
  assert.equal(
    explicit.SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT,
    '/operator/receipt.json',
    'an explicit operator path wins over the adjacent package receipt',
  );
  assert.equal(explicit.SNAPBACK_ADMIN_DIST, adminRoot);

  const explicitAdmin = runtimeSpawnEnvironment(binary, {
    SNAPBACK_ADMIN_DIST: '/operator/admin-dist',
  });
  assert.equal(explicitAdmin.SNAPBACK_ADMIN_DIST, '/operator/admin-dist');

  writeFileSync(join(adminRoot, 'index.html'), '<title>tampered</title>');
  const invalidAdmin = runtimeSpawnEnvironment(binary, {});
  assert.equal(Object.hasOwn(invalidAdmin, 'SNAPBACK_ADMIN_DIST'), false);

  rmSync(receipt);
  const absent = runtimeSpawnEnvironment(binary, {});
  assert.equal(
    Object.hasOwn(absent, 'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT'),
    false,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
