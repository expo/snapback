#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import schema from '../snapback/generated/schema.manifest.json' with { type: 'json' };
import { createKnockoffSocialBroker } from '../server/social-broker.mjs';

const readyFile = resolve(process.env.SNAPBACK_KNOCKOFF_READY_FILE ?? '.snapback/dev.ready.json');
const ready = JSON.parse(readFileSync(readyFile, 'utf8'));
const readCarrier = (path, name) => {
  if (typeof path !== 'string') throw new Error(`Snapback readiness descriptor has no ${name}`);
  return readFileSync(path, 'utf8').trim();
};
const realProviderConfigured = Boolean(process.env.KNOCKOFF_APPLE_CLIENT_ID || process.env.KNOCKOFF_GOOGLE_CLIENT_ID);
const identitySecret = process.env.KNOCKOFF_BROKER_IDENTITY_SECRET
  ?? (realProviderConfigured ? null : 'knockoff-local-fixture-identity-secret-v1');
if (!identitySecret || identitySecret.length < 32) {
  throw new Error('KNOCKOFF_BROKER_IDENTITY_SECRET must contain at least 32 characters for real providers');
}

const broker = createKnockoffSocialBroker({
  baseUrl: ready.serverUrl.replace(/\/$/u, ''),
  adminToken: readCarrier(ready.adminTokenFile, 'adminTokenFile'),
  impersonationCapability: readCarrier(ready.impersonationCapabilityFile, 'impersonationCapabilityFile'),
  appId: schema.appId,
  identitySecret,
  allowFixtures: process.env.KNOCKOFF_AUTH_FIXTURES !== '0',
  allowSharedDevelopment: process.env.KNOCKOFF_SHARED_AUTH !== '0',
  deploymentProfile: process.env.KNOCKOFF_DEPLOYMENT_PROFILE ?? 'development',
  previewOwnerAuthenticated: process.env.KNOCKOFF_SHARED_PREVIEW_OWNER_AUTHORIZED === '1',
  previewExpiresAt: process.env.KNOCKOFF_SHARED_PREVIEW_EXPIRES_AT,
  sharedReturnTargets: (process.env.KNOCKOFF_SHARED_RETURN_TARGETS ?? 'knockoff://auth/shared')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  sharedUserLimit: Number(process.env.KNOCKOFF_SHARED_USER_LIMIT ?? 100),
  appleClientId: process.env.KNOCKOFF_APPLE_CLIENT_ID ?? '',
  googleClientId: process.env.KNOCKOFF_GOOGLE_CLIENT_ID ?? '',
});
const listening = await broker.listen({ port: Number(process.env.KNOCKOFF_AUTH_PORT ?? 3777) });
process.stdout.write(`Knockoff auth broker: ${listening.origin}\n`);

const stop = async () => {
  await listening.close();
  process.exit(0);
};
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
