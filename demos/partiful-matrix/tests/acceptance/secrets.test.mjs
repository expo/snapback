import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { loadLocalSecrets } from '../../backends/gateway/secrets.mjs';

test('clean measurement worktrees can read the operator credential root without copying it', () => {
  const credentialRoot = mkdtempSync(resolve(tmpdir(), 'partitime-credential-root-'));
  const prior = process.env.PARTITIME_LOCAL_SECRETS_ROOT;
  try {
    writeFileSync(resolve(credentialRoot, '.agent-local-secrets.md'), 'TEST_PARTITIME_TOKEN="fixture-only"\n');
    process.env.PARTITIME_LOCAL_SECRETS_ROOT = credentialRoot;
    assert.deepEqual(loadLocalSecrets('/path/that/does/not/exist'), { TEST_PARTITIME_TOKEN: 'fixture-only' });
  } finally {
    if (prior === undefined) delete process.env.PARTITIME_LOCAL_SECRETS_ROOT;
    else process.env.PARTITIME_LOCAL_SECRETS_ROOT = prior;
    rmSync(credentialRoot, { recursive: true, force: true });
  }
});
