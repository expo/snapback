import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_SHARED_DEVELOPMENT_USER_LIMIT,
  RESOLVED_PROVIDER_ENTRY_FORMAT,
  createProviderEntryDispatch,
  resolveDeclaredProviderEntries,
  resolveProviderEntry,
} from './provider-entry.mjs';

const apple = Object.freeze({ provider: 'apple', kind: 'apple', credentials: 'auto' });
const google = Object.freeze({ provider: 'google', kind: 'oidc', preset: 'google', credentials: 'auto' });

function resolve(overrides = {}, nowMs = Date.parse('2026-08-24T00:00:00.000Z')) {
  return resolveProviderEntry({
    appId: 'app-1',
    declaration: apple,
    deployment: 'development',
    platform: 'ios',
    sharedAvailable: true,
    ...overrides,
  }, nowMs);
}

test('a shared development entry is a rehearsal identity realm', () => {
  const entry = resolve();
  assert.equal(entry.format, RESOLVED_PROVIDER_ENTRY_FORMAT);
  assert.equal(entry.adapter, 'snapback-shared-browser');
  assert.equal(entry.identityRealm, 'rehearsal');
  assert.equal(entry.readiness, 'ready');
  assert.equal(entry.providerInstallationId, 'shared-development:app-1:apple:v1');
  assert.equal(entry.nextAction, undefined);
});

test('the projection never carries a credential, token, identity, or session', () => {
  const entry = resolve({
    appOwned: { configReady: true, configGeneration: 'cfg-7', installationId: 'inst-9' },
    nativeBuild: { ready: true, receipt: 'build-3' },
  });
  const serialized = JSON.stringify(entry);
  for (const forbidden of ['secret', 'clientSecret', 'token', 'session', 'email', '@']) {
    assert.equal(serialized.includes(forbidden), false, `projection leaked ${forbidden}`);
  }
  assert.deepEqual(Object.keys(entry).sort(), [
    'adapter', 'authProfileGeneration', 'clientBuildReceipt', 'configGeneration', 'format',
    'identityRealm', 'providerInstallationId', 'provider', 'readiness',
  ].sort());
});

test('native readiness requires both halves', () => {
  // Configuration alone never selects native auth.
  const configOnly = resolve({ appOwned: { configReady: true, configGeneration: 'cfg-7' } });
  assert.equal(configOnly.adapter, 'snapback-shared-browser');
  assert.equal(configOnly.identityRealm, 'rehearsal');
  assert.equal(configOnly.nextAction, 'Rebuild the client to activate app-owned native auth.');

  // A build receipt alone never selects native auth either.
  const buildOnly = resolve({ nativeBuild: { ready: true, receipt: 'build-3' } });
  assert.equal(buildOnly.adapter, 'snapback-shared-browser');

  // Both halves select app-owned native, in the application identity realm.
  const both = resolve({
    appOwned: { configReady: true, configGeneration: 'cfg-7' },
    nativeBuild: { ready: true, receipt: 'build-3' },
  });
  assert.equal(both.adapter, 'app-owned-native');
  assert.equal(both.identityRealm, 'application');
  assert.equal(both.configGeneration, 'cfg-7');
  assert.equal(both.clientBuildReceipt, 'build-3');
});

test('web selects the app-owned browser Adapter without a native build', () => {
  const web = resolve({
    platform: 'web',
    appOwned: { configReady: true, configGeneration: 'cfg-7' },
  });
  assert.equal(web.adapter, 'app-owned-browser');
  assert.equal(web.identityRealm, 'application');
  const unverifiedCallback = resolve({
    platform: 'web',
    appOwned: { configReady: true, browserReady: false },
  });
  assert.equal(unverifiedCallback.adapter, 'snapback-shared-browser');
});

test('switching credential ownership produces a different auth-profile generation', () => {
  const shared = resolve();
  const owned = resolve({
    appOwned: { configReady: true, configGeneration: 'cfg-7' },
    nativeBuild: { ready: true, receipt: 'build-3' },
  });
  assert.notEqual(shared.authProfileGeneration, owned.authProfileGeneration);
  assert.notEqual(shared.providerInstallationId, owned.providerInstallationId);
  // Rotating configuration alone also rotates the generation, so custody that
  // belonged to the predecessor cannot be reinterpreted as the successor's.
  const rotated = resolve({
    appOwned: { configReady: true, configGeneration: 'cfg-8' },
    nativeBuild: { ready: true, receipt: 'build-3' },
  });
  assert.notEqual(owned.authProfileGeneration, rotated.authProfileGeneration);
});

test('staging and production refuse shared credentials', () => {
  for (const deployment of ['staging', 'production']) {
    const blocked = resolve({ deployment });
    assert.equal(blocked.readiness, 'blocked');
    assert.equal(blocked.diagnosticCode, 'SNAPBACK_AUTH_PROVIDER_APP_OWNED_REQUIRED');
    assert.equal(blocked.nextAction, 'Run snapback auth configure apple.');

    // An explicit shared request is refused even with app-owned readiness.
    const explicitShared = resolve({
      deployment,
      declaration: { ...apple, credentials: 'shared' },
      appOwned: { configReady: true },
      nativeBuild: { ready: true },
    });
    assert.equal(explicitShared.readiness, 'blocked');
    assert.equal(explicitShared.diagnosticCode, 'SNAPBACK_AUTH_PROVIDER_APP_OWNED_REQUIRED');

    const ready = resolve({
      deployment,
      appOwned: { configReady: true, configGeneration: 'cfg-7' },
      nativeBuild: { ready: true, receipt: 'build-3' },
    });
    assert.equal(ready.readiness, 'ready');
    assert.equal(ready.adapter, 'app-owned-native');
    assert.equal(ready.identityRealm, 'application');
  }
});

test('a preview needs owner authorization and an unexpired window', () => {
  const nowMs = Date.parse('2026-08-24T00:00:00.000Z');
  const unauthorized = resolve({ deployment: 'preview' }, nowMs);
  assert.equal(unauthorized.diagnosticCode, 'SNAPBACK_AUTH_PROVIDER_PREVIEW_UNAUTHORIZED');

  const expired = resolve({
    deployment: 'preview',
    preview: { ownerAuthenticated: true, expiresAt: '2026-08-23T23:59:59.000Z' },
  }, nowMs);
  assert.equal(expired.diagnosticCode, 'SNAPBACK_AUTH_PROVIDER_PREVIEW_UNAUTHORIZED');

  const open = resolve({
    deployment: 'preview',
    preview: { ownerAuthenticated: true, expiresAt: '2026-08-24T01:00:00.000Z' },
  }, nowMs);
  assert.equal(open.readiness, 'ready');
  assert.equal(open.adapter, 'snapback-shared-browser');
  assert.equal(open.identityRealm, 'rehearsal');
  assert.equal(AUTH_SHARED_DEVELOPMENT_USER_LIMIT, 100);
});

test('an explicit app-owned request never degrades to shared', () => {
  const blocked = resolve({ declaration: { ...apple, credentials: 'app-owned' } });
  assert.equal(blocked.readiness, 'blocked');
  assert.equal(blocked.diagnosticCode, 'SNAPBACK_AUTH_PROVIDER_APP_OWNED_NOT_READY');
  assert.equal(blocked.nextAction, 'Run snapback auth configure apple.');
});

test('an unreachable broker blocks instead of pretending to be ready', () => {
  const blocked = resolve({ sharedAvailable: false });
  assert.equal(blocked.readiness, 'blocked');
  assert.equal(blocked.diagnosticCode, 'SNAPBACK_AUTH_PROVIDER_SHARED_UNAVAILABLE');
});

test('the test deployment uses the synthetic conformance Adapter', () => {
  const entry = resolve({ deployment: 'test', sharedAvailable: false });
  assert.equal(entry.adapter, 'synthetic');
  assert.equal(entry.identityRealm, 'rehearsal');
  assert.equal(entry.readiness, 'ready');
});

test('resolution refuses unknown providers, deployments, and platforms', () => {
  for (const overrides of [
    { declaration: { provider: 'github', kind: 'oidc', preset: 'github' } },
    { deployment: 'canary' },
    { platform: 'tvos' },
    { appId: '' },
  ]) {
    assert.throws(
      () => resolve(overrides),
      (error) => error.code === 'SNAPBACK_AUTH_PROVIDER_RESOLUTION_INPUT_INVALID',
      JSON.stringify(overrides),
    );
  }
});

test('every declared provider resolves once under one context', () => {
  const entries = resolveDeclaredProviderEntries([apple, google], {
    appId: 'app-1',
    deployment: 'development',
    platform: 'android',
    sharedAvailable: true,
  });
  assert.deepEqual(Object.keys(entries).sort(), ['apple', 'google']);
  assert.equal(entries.google.adapter, 'snapback-shared-browser');
});

test('dispatch runs exactly the resolved Adapter, exactly once', async () => {
  const calls = [];
  const entries = resolveDeclaredProviderEntries([apple, google], {
    appId: 'app-1',
    deployment: 'development',
    platform: 'ios',
    sharedAvailable: true,
    appOwned: { configReady: true, configGeneration: 'cfg-7' },
    nativeBuild: { ready: true, receipt: 'build-3' },
  });
  const dispatch = createProviderEntryDispatch(entries, {
    'app-owned-native': (entry) => {
      calls.push(entry.adapter);
      return Promise.resolve('native');
    },
    'snapback-shared-browser': () => {
      calls.push('snapback-shared-browser');
      return Promise.resolve('shared');
    },
  });
  assert.equal(await dispatch.signIn('apple'), 'native');
  assert.deepEqual(calls, ['app-owned-native']);
  assert.deepEqual(dispatch.providers(), ['apple', 'google']);
});

test('a native Adapter failure is the operation result, never a shared retry', async () => {
  const calls = [];
  const entries = resolveDeclaredProviderEntries([apple], {
    appId: 'app-1',
    deployment: 'development',
    platform: 'ios',
    sharedAvailable: true,
    appOwned: { configReady: true },
    nativeBuild: { ready: true },
  });
  const dispatch = createProviderEntryDispatch(entries, {
    'app-owned-native': () => {
      calls.push('app-owned-native');
      const error = new Error('invalid_client');
      error.code = 'PROVIDER_INVALID_CLIENT';
      return Promise.reject(error);
    },
    'snapback-shared-browser': () => {
      calls.push('snapback-shared-browser');
      return Promise.resolve('shared');
    },
  });
  await assert.rejects(dispatch.signIn('apple'), (error) => error.code === 'PROVIDER_INVALID_CLIENT');
  assert.deepEqual(calls, ['app-owned-native'], 'the shared Adapter must never run after a native failure');
});

test('dispatch refuses undeclared providers and blocked entries', async () => {
  const entries = resolveDeclaredProviderEntries([apple], {
    appId: 'app-1',
    deployment: 'development',
    platform: 'ios',
    sharedAvailable: false,
  });
  const dispatch = createProviderEntryDispatch(entries, {
    'snapback-shared-browser': () => Promise.resolve('shared'),
  });
  await assert.rejects(
    dispatch.signIn('google'),
    (error) => error.code === 'SNAPBACK_AUTH_PROVIDER_UNDECLARED',
  );
  await assert.rejects(
    dispatch.signIn('apple'),
    (error) => error.code === 'SNAPBACK_AUTH_PROVIDER_SHARED_UNAVAILABLE',
  );
  assert.equal(dispatch.entry('google'), null);
});

test('a missing Adapter implementation refuses instead of substituting another', async () => {
  const entries = resolveDeclaredProviderEntries([apple], {
    appId: 'app-1',
    deployment: 'development',
    platform: 'ios',
    sharedAvailable: true,
    appOwned: { configReady: true },
    nativeBuild: { ready: true },
  });
  const dispatch = createProviderEntryDispatch(entries, {
    'snapback-shared-browser': () => Promise.resolve('shared'),
  });
  await assert.rejects(
    dispatch.signIn('apple'),
    (error) => error.code === 'SNAPBACK_AUTH_PROVIDER_ADAPTER_UNAVAILABLE',
  );
});
