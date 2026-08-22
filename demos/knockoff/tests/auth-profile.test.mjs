import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAuthEntryController,
  resolveProviderEntry,
} from '../src/lib/auth-profile.ts';

const base = Object.freeze({
  appId: 'knockoff',
  provider: 'apple',
  deployment: 'development',
  requested: 'auto',
  platform: 'ios',
  sharedAvailable: true,
  appOwned: Object.freeze({ configReady: false }),
  nativeBuild: Object.freeze({ ready: false }),
});

test('auto selects shared development until config and native build both verify', () => {
  const shared = resolveProviderEntry(base, 1);
  assert.equal(shared.adapter, 'snapback-shared-browser');
  assert.equal(shared.identityRealm, 'rehearsal');

  const awaitingBuild = resolveProviderEntry({
    ...base,
    appOwned: { configReady: true, configGeneration: 'cfg_1' },
  }, 1);
  assert.equal(awaitingBuild.adapter, 'snapback-shared-browser');
  assert.match(awaitingBuild.nextAction, /Rebuild/u);

  const native = resolveProviderEntry({
    ...base,
    appOwned: { configReady: true, configGeneration: 'cfg_1', installationId: 'apple_app_1' },
    nativeBuild: { ready: true, receipt: 'build_1' },
  }, 1);
  assert.equal(native.adapter, 'app-owned-native');
  assert.equal(native.identityRealm, 'application');
  assert.equal(native.providerInstallationId, 'apple_app_1');
});

test('preview requires owner authentication and expiry while production refuses shared credentials', () => {
  const preview = resolveProviderEntry({
    ...base,
    deployment: 'preview',
    preview: { ownerAuthenticated: true, expiresAt: '2030-01-01T00:00:00.000Z' },
  }, Date.parse('2029-01-01T00:00:00.000Z'));
  assert.equal(preview.adapter, 'snapback-shared-browser');

  const expired = resolveProviderEntry({
    ...base,
    deployment: 'preview',
    preview: { ownerAuthenticated: true, expiresAt: '2028-01-01T00:00:00.000Z' },
  }, Date.parse('2029-01-01T00:00:00.000Z'));
  assert.equal(expired.readiness, 'blocked');
  assert.equal(expired.diagnosticCode, 'KNOCKOFF_AUTH_PREVIEW_REHEARSAL_REQUIRED');

  const production = resolveProviderEntry({ ...base, deployment: 'production' }, 1);
  assert.equal(production.readiness, 'blocked');
  assert.equal(production.diagnosticCode, 'KNOCKOFF_AUTH_APP_OWNED_REQUIRED');
});

test('a native runtime failure never calls the shared Adapter', async () => {
  const entry = resolveProviderEntry({
    ...base,
    appOwned: { configReady: true },
    nativeBuild: { ready: true, receipt: 'build_1' },
  }, 1);
  let sharedCalls = 0;
  const controller = createAuthEntryController({ apple: entry, google: entry }, {
    synthetic: async () => null,
    'snapback-shared-browser': async () => { sharedCalls += 1; return null; },
    'app-owned-browser': async () => null,
    'app-owned-native': async () => { throw new Error('invalid_client'); },
  });
  await assert.rejects(controller.signIn('apple'), /invalid_client/u);
  assert.equal(sharedCalls, 0);
});
