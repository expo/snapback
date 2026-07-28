#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { PublicationLeaseAuthority } from './authority.mjs';
import { createPublicationAuthorityServer } from './server.mjs';
import { SqliteVolumePublicationAuthorityStore } from './store.mjs';

function requiredSecret(pathVariable, valueVariable, label) {
  const path = process.env[pathVariable];
  if (path) {
    const value = readFileSync(path, 'utf8').trim();
    if (!value) throw new Error(`${label} file is empty`);
    return value;
  }
  const value = process.env[valueVariable];
  if (!value) {
    throw new Error(`${label} requires ${pathVariable} (preferred) or ${valueVariable}`);
  }
  return value;
}

const databasePath = process.env.SNAPBACK_PUBLICATION_AUTHORITY_DATABASE
  ?? '/data/publication-authority.sqlite3';
const host = process.env.SNAPBACK_PUBLICATION_AUTHORITY_HOST ?? '0.0.0.0';
const port = Number(process.env.SNAPBACK_PUBLICATION_AUTHORITY_PORT ?? '8080');
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('SNAPBACK_PUBLICATION_AUTHORITY_PORT must be in [1, 65535]');
}
const bearerToken = requiredSecret(
  'SNAPBACK_PUBLICATION_AUTHORITY_BEARER_TOKEN_FILE',
  'SNAPBACK_PUBLICATION_AUTHORITY_BEARER_TOKEN',
  'publication authority Bearer token',
);
const privateKey = requiredSecret(
  'SNAPBACK_PUBLICATION_AUTHORITY_PRIVATE_KEY_FILE',
  'SNAPBACK_PUBLICATION_AUTHORITY_PRIVATE_KEY',
  'publication authority Ed25519 private key',
);
const store = new SqliteVolumePublicationAuthorityStore(databasePath);
const authority = new PublicationLeaseAuthority({ store, privateKey });
const server = createPublicationAuthorityServer({ authority, bearerToken });

server.listen(port, host, () => {
  process.stdout.write(`publication authority listening on ${host}:${port}\n`);
});

function close() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
