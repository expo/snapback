#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactsRoot = dirname(fileURLToPath(import.meta.url));
const armRoot = resolve(artifactsRoot, '..');
const cli = resolve(armRoot, 'state/cli/spacetime');
const cliRoot = resolve(armRoot, 'state/cli');
const configPath = resolve(armRoot, 'state/config/cli.toml');
const custodyPath = resolve(armRoot, 'state/owner-custody.json');
const server = 'http://127.0.0.1:3320';

const response = await fetch(`${server}/v1/identity`, { method: 'POST' });
if (!response.ok) {
  throw new Error(`local owner identity allocation failed: HTTP ${response.status}`);
}
const value = await response.json();
if (typeof value.identity !== 'string' || typeof value.token !== 'string') {
  throw new Error('local owner identity response had an unexpected shape');
}

const login = spawnSync(
  cli,
  [
    `--root-dir=${cliRoot}`,
    `--config-path=${configPath}`,
    'login',
    '--token',
    value.token,
    '--no-browser',
  ],
  { encoding: 'utf8' },
);
if (login.status !== 0) {
  throw new Error(`worktree-local CLI token custody failed: exit ${login.status}`);
}

await writeFile(
  custodyPath,
  `${JSON.stringify({
    server,
    ownerIdentity: value.identity,
    ownerCredential: value.token,
  }, null, 2)}\n`,
  { mode: 0o600 },
);
await chmod(custodyPath, 0o600);
process.stdout.write(`${JSON.stringify({
  ok: true,
  ownerIdentityHash: createHash('sha256').update(value.identity).digest('hex'),
  credentialPersistedOnlyUnderIgnoredState: true,
})}\n`);
