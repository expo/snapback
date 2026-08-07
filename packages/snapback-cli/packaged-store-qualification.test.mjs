import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  chmodSync,
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

const root = mkdtempSync(join(tmpdir(), 'snapback-packaged-store-loader-'));
try {
  const binary = join(root, 'snapback');
  const receipt = join(root, 'packaged-store-qualification.receipt.json');
  writeFileSync(binary, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ receipt: process.env.SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT ?? null }));
`);
  chmodSync(binary, 0o755);
  writeFileSync(receipt, '{}\n');

  const child = spawnManagedRuntime(binary, [], {
    cwd: root,
    env: { PATH: process.env.PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  const [status] = await once(child, 'close');
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(stdout), { receipt });

  const explicit = runtimeSpawnEnvironment(binary, {
    SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT: '/operator/receipt.json',
  });
  assert.equal(
    explicit.SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT,
    '/operator/receipt.json',
    'an explicit operator path wins over the adjacent package receipt',
  );

  rmSync(receipt);
  const absent = runtimeSpawnEnvironment(binary, {});
  assert.equal(
    Object.hasOwn(absent, 'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT'),
    false,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
