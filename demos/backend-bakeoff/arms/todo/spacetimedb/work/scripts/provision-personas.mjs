#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const host = 'http://127.0.0.1:3102';
const database = 'todo-spacetimedb-calibration-02';
const cli = `${process.env.HOME}/.local/bin/spacetime`;
const existing = await readFile('.arm-secrets.json', 'utf8').then(JSON.parse).catch(() => null);
const personas = existing?.personas ?? {};

for (const label of ['alice', 'bob', 'mallory']) {
  if (personas[label]?.identity && personas[label]?.token) continue;
  const response = await fetch(`${host}/v1/identity`, { method: 'POST' });
  if (!response.ok) throw new Error(`identity allocation failed for ${label}: HTTP ${response.status}`);
  const value = await response.json();
  if (typeof value.identity !== 'string' || typeof value.token !== 'string') {
    throw new Error(`identity allocation returned an unexpected shape for ${label}`);
  }
  personas[label] = { identity: value.identity, token: value.token };
}

for (const label of ['alice', 'bob']) {
  const result = spawnSync(
    cli,
    [
      'call',
      '--no-config',
      '--server',
      host,
      database,
      'grant_member',
      personas[label].identity,
      label,
      'member',
    ],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`membership grant failed for ${label} (exit ${result.status})`);
  }
}

await writeFile('.arm-secrets.json', `${JSON.stringify({ host, database, personas }, null, 2)}\n`, {
  mode: 0o600,
});
await chmod('.arm-secrets.json', 0o600);
await writeFile(
  '.env.local',
  [
    `VITE_SPACETIMEDB_HOST=ws://127.0.0.1:3102`,
    `VITE_SPACETIMEDB_DB_NAME=${database}`,
    `VITE_SPACETIMEDB_ALICE_TOKEN=${personas.alice.token}`,
    `VITE_SPACETIMEDB_BOB_TOKEN=${personas.bob.token}`,
    `VITE_SPACETIMEDB_MALLORY_TOKEN=${personas.mallory.token}`,
    '',
  ].join('\n'),
  { mode: 0o600 }
);
await chmod('.env.local', 0o600);

console.log(JSON.stringify({
  ok: true,
  personas: Object.fromEntries(
    Object.entries(personas).map(([label, value]) => [
      label,
      createHash('sha256').update(value.identity).digest('hex'),
    ])
  ),
  containsSecretValues: false,
}));
