#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  armRoot,
  cli,
  configPath,
  globalArgs,
  server,
  stateRoot,
} from './constants.mjs';

const response = await fetch(`${server}/v1/identity`, { method: 'POST' });
if (!response.ok) throw new Error(`local owner identity allocation failed: HTTP ${response.status}`);
const value = await response.json();
if (typeof value.identity !== 'string' || typeof value.token !== 'string') {
  throw new Error('local owner identity response had an unexpected shape');
}
const login = spawnSync(
  cli,
  [...globalArgs, 'login', '--token', value.token, '--no-browser'],
  { cwd: armRoot, encoding: 'utf8' },
);
if (login.status !== 0) throw new Error(login.stderr || `CLI login failed: ${login.status}`);
const custodyPath = path.resolve(stateRoot, 'owner-custody.json');
await writeFile(
  custodyPath,
  `${JSON.stringify({
    server,
    ownerIdentity: value.identity,
    ownerCredential: value.token,
    configPath,
  }, null, 2)}\n`,
  { mode: 0o600 },
);
await chmod(custodyPath, 0o600);
process.stdout.write(`${JSON.stringify({
  ok: true,
  ownerIdentityHash: createHash('sha256').update(value.identity).digest('hex'),
  credentialPersistedOnlyUnderIgnoredState: true,
})}\n`);
