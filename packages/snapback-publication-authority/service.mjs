#!/usr/bin/env node

import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { PublicationLeaseAuthority } from './authority.mjs';
import { normalizeAuthorityOrigin } from './protocol.mjs';
import { createPublicationAuthorityServer } from './server.mjs';
import { SqliteVolumePublicationAuthorityStore } from './store.mjs';

function requiredSecretFile(pathVariable, label) {
  const path = process.env[pathVariable];
  if (!path) throw new Error(`${label} requires ${pathVariable}`);
  const value = readFileSync(path, 'utf8').trim();
  if (!value) throw new Error(`${label} file is empty`);
  return value;
}

const databasePath = process.env.SNAPBACK_PUBLICATION_AUTHORITY_DATABASE
  ?? '/data/publication-authority.sqlite3';
const host = process.env.SNAPBACK_PUBLICATION_AUTHORITY_HOST ?? '0.0.0.0';
const port = Number(process.env.SNAPBACK_PUBLICATION_AUTHORITY_PORT ?? '8080');
const authorityInstallationId =
  process.env.SNAPBACK_PUBLICATION_AUTHORITY_INSTALLATION_ID;
const configuredAuthorityOrigin = process.env.SNAPBACK_PUBLICATION_AUTHORITY_ORIGIN;
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('SNAPBACK_PUBLICATION_AUTHORITY_PORT must be in [1, 65535]');
}
if (!authorityInstallationId) {
  throw new Error('SNAPBACK_PUBLICATION_AUTHORITY_INSTALLATION_ID is required');
}
if (!configuredAuthorityOrigin) {
  throw new Error('SNAPBACK_PUBLICATION_AUTHORITY_ORIGIN is required');
}
const authorityOrigin = normalizeAuthorityOrigin(configuredAuthorityOrigin, {
  allowLoopbackHttp:
    process.env.SNAPBACK_PUBLICATION_AUTHORITY_ALLOW_LOOPBACK_HTTP === 'test-only',
});
const bearerToken = requiredSecretFile(
  'SNAPBACK_PUBLICATION_AUTHORITY_BEARER_TOKEN_FILE',
  'publication authority Bearer token',
);
const privateKey = createPrivateKey(requiredSecretFile(
  'SNAPBACK_PUBLICATION_AUTHORITY_PRIVATE_KEY_FILE',
  'publication authority Ed25519 private key',
));
if (privateKey.asymmetricKeyType !== 'ed25519') {
  throw new Error('publication authority private key must be Ed25519');
}
const publicKey = createPublicKey(privateKey);
const store = new SqliteVolumePublicationAuthorityStore(databasePath, {
  authorityInstallationId,
  authorityOrigin,
  publicKey,
});
const authority = new PublicationLeaseAuthority({
  store,
  privateKey,
  authorityInstallationId,
  authorityOrigin,
});
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
