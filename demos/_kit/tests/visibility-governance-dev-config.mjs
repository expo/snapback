// Fresh-prime regression for the shared demo harness. A cold-start carrier
// containing the always-emitted visibility-governance record must bind with a
// real validated repository-local config, never by omitting the carrier.

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { generate } from '../../../packages/snapback-codegen/index.mjs';
import { startServer } from '../server-process.mjs';

const kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(kitRoot, '..', '..');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repositoryRoot, 'target', 'debug', 'snapback');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('freshly primed todo cold-start carrier binds through the demo kit', async () => {
  assert(
    existsSync(runtimeBinary),
    `native snapback binary missing at ${runtimeBinary}; run scripts/bootstrap-ibex-runtime`,
  );
  const backendRoot = join(repositoryRoot, 'demos', 'todo', 'snapback');
  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-governance-kit-'));
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  writeFileSync(startupArtifacts, `${JSON.stringify({
    formatVersion: 1,
    schema: readJson(join(backendRoot, 'generated', 'schema.manifest.json')),
    functions: readJson(join(backendRoot, 'generated', 'functions.manifest.json')),
  })}\n`, { mode: 0o600 });

  let server = null;
  let secondServer = null;
  let firstConfigPath = null;
  let secondConfigPath = null;
  try {
    server = await startServer({
      port: 0,
      db: join(scratch, 'todo.sqlite3'),
      cwd: repositoryRoot,
      env: process.env,
      serverBinary: runtimeBinary,
      startupArtifacts,
    });
    const health = await fetch(`${server.baseUrl}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    firstConfigPath = server.governanceTargetConfigPath;
    assert.match(firstConfigPath, /snapback-server-[^/]+\/visibility-governance-dev-target-config\.json$/u);
    const config = readJson(firstConfigPath);
    assert.equal(config.targetClass, 'repository-local');
    assert.equal(config.verdict.providerProfile, 'repository-local-dev-mint-v1');
    assert.deepEqual(
      config.verdict.deploymentIdentities.map(({ appId }) => appId),
      ['todo'],
      'the demo kit must mint only for the backend carried by this launch',
    );
    secondServer = await startServer({
      port: 0,
      db: join(scratch, 'todo-second.sqlite3'),
      cwd: repositoryRoot,
      env: process.env,
      serverBinary: runtimeBinary,
      startupArtifacts,
    });
    secondConfigPath = secondServer.governanceTargetConfigPath;
    assert.notEqual(secondConfigPath, firstConfigPath);
    assert.equal(existsSync(secondConfigPath), true);
    assert.deepEqual(
      readJson(secondConfigPath).verdict.deploymentIdentities.map(({ appId }) => appId),
      ['todo'],
    );
    console.log(`BOUND demo-kit todo ${server.baseUrl}`);
  } finally {
    await secondServer?.stop?.();
    await server?.stop?.();
    if (secondConfigPath !== null) assert.equal(existsSync(secondConfigPath), false);
    if (firstConfigPath !== null) assert.equal(existsSync(firstConfigPath), false);
    rmSync(scratch, { recursive: true, force: true });
  }
});
