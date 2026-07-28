import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  validateExistingLatestReceipt,
} from './snapback-github-latest-proof.mjs';

function receipt(platform = 'darwin', architecture = 'arm64') {
  return {
    schemaVersion: 'snapback.package-cold-install.v1',
    ok: true,
    rootSelector: 'latest',
    installSource: 'public',
    machine: {
      platform,
      architecture,
      runnerEnvironment: 'github-hosted',
      separatelyProvisionedCleanMachine: true,
      githubRunId: '123456789',
    },
  };
}

test('admits only the exact GitHub-hosted latest-root platform receipt', () => {
  const value = receipt();
  assert.equal(validateExistingLatestReceipt(value, 'darwin-arm64'), value);
  for (const mutate of [
    (candidate) => { candidate.rootSelector = 'exact'; },
    (candidate) => { candidate.installSource = 'staged'; },
    (candidate) => { candidate.machine.runnerEnvironment = 'local'; },
    (candidate) => { candidate.machine.separatelyProvisionedCleanMachine = false; },
    (candidate) => { candidate.machine.githubRunId = null; },
    (candidate) => { candidate.machine.architecture = 'x64'; },
  ]) {
    const candidate = structuredClone(value);
    mutate(candidate);
    assert.throws(
      () => validateExistingLatestReceipt(candidate, 'darwin-arm64'),
      /fresh GitHub-hosted latest-root proof/u,
    );
  }
});

test('distinguishes the Linux runtime tuple', () => {
  const value = receipt('linux', 'x64');
  assert.equal(validateExistingLatestReceipt(value, 'linux-x64'), value);
  assert.throws(
    () => validateExistingLatestReceipt(value, 'darwin-arm64'),
    /fresh GitHub-hosted latest-root proof/u,
  );
});
