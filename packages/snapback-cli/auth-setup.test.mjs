import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUTH_PROVIDER_NATIVE_INTEGRATIONS,
  enableProvidersInDeclaration,
  providerConsoleWalkthrough,
  runAuthConfigure,
  runAuthEnable,
  runAuthStatus,
} from './auth-setup.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const cli = join(packageRoot, 'cli.mjs');
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const DECLARATION = `import { defineAuth, defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

// A comment mentioning defineAuth({ must not be a second candidate.
const authProgram = defineAuth({
  version: 1,
  custody: 'volatile-explicit',
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});

export default defineSchema({
  notes: defineTable({ body: v.string() }).visibility({ kind: 'public-read' }),
}, { auth: { mode: 'sessions' }, authProgram });
`;

// The Expo supervisor's discovery descriptor, as `snapback dev --expo` writes
// it. `auth status` reads this file to learn whether the shared development
// broker is actually being served; the format strings are bound to their
// issuing modules by the drift test at the bottom of this file.
const SUPERVISOR_DESCRIPTOR_FORMAT = 'snapback.expo-supervisor.v1';
const SERVED_PROJECTION = Object.freeze({
  format: 'snapback.shared-development-auth-projection.v1',
  available: true,
  origin: 'http://127.0.0.1:4300',
  identityRealm: 'rehearsal',
  userLimit: 100,
});

// A live supervisor is this test process: a recorded pid alone proves nothing,
// so the observation compares the recorded start time against the running one.
function supervisorIdentity() {
  const result = spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0);
  return { pid: process.pid, startTime: result.stdout.trim() };
}

function writeSupervisorDescriptor(root, { raw, sharedAuth, ...overrides } = {}) {
  mkdirSync(join(root, '.snapback'), { recursive: true });
  const path = join(root, '.snapback', 'expo-supervisor.json');
  if (raw !== undefined) {
    writeFileSync(path, raw);
    return path;
  }
  writeFileSync(path, `${JSON.stringify({
    schemaVersion: SUPERVISOR_DESCRIPTOR_FORMAT,
    formatVersion: 1,
    state: 'ready',
    pid: process.pid,
    supervisor: supervisorIdentity(),
    exchangeOrigin: 'http://127.0.0.1:4300',
    ...(sharedAuth === undefined ? {} : { sharedAuth }),
    ...overrides,
  }, null, 2)}\n`);
  return path;
}

function project({
  declaration = DECLARATION, manifest = {}, appConfig = null, appConfigModule = null, descriptor = null,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-auth-setup-'));
  roots.push(root);
  mkdirSync(join(root, 'snapback', 'generated'), { recursive: true });
  writeFileSync(join(root, 'snapback', 'schema.mjs'), declaration);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: 'auth-setup-fixture',
    private: true,
    dependencies: { expo: '~57.0.7', 'react-native': '0.86.2' },
    ...manifest,
  }, null, 2)}\n`);
  if (appConfig !== null) {
    writeFileSync(join(root, 'app.json'), `${JSON.stringify(appConfig, null, 2)}\n`);
  }
  if (appConfigModule !== null) {
    writeFileSync(join(root, appConfigModule), 'export default { expo: { name: \'x\', slug: \'x\' } };\n');
  }
  if (descriptor !== null) {
    writeFileSync(
      join(root, 'snapback', 'generated', 'app.descriptor.json'),
      `${JSON.stringify(descriptor, null, 2)}\n`,
    );
  }
  return root;
}

function descriptorWith(providers) {
  return {
    format: 'snapback.app.v1',
    identity: {
      app: 'app-fixture', schema: 'sha256:s', functions: 'sha256:f', descriptor: 'sha256:d',
    },
    authBootstrap: {
      format: 'snapback.application-auth-bootstrap.v1',
      appId: 'app-fixture',
      mode: 'sessions',
      custody: 'volatile-explicit',
      entryMechanisms: ['password-v1', 'external-session-explicit-v1'],
      ...(providers === null ? {} : { providers }),
      anonymousPublic: 'refused',
      lifecycleProtocol: 1,
    },
  };
}

test('enable authors the declared providers and the external-session seam', () => {
  const next = enableProvidersInDeclaration(DECLARATION, ['apple', 'google']);
  assert.match(next, /providers: \{\n {4}apple: \{ kind: 'apple', credentials: 'auto' \},\n {4}google: \{ kind: 'oidc', preset: 'google', credentials: 'auto' \},\n {2}\},/u);
  // @ref LLP 0151#shared-development-browser-adapter — redemption goes through
  // the common completion path, so the seam is part of enabling a provider.
  assert.match(next, /externalSessionEntry: true,/u);
  // Nothing else moved: removing exactly the two authored insertions restores
  // the original bytes.
  const restored = next
    .replace(`  providers: {\n    apple: { kind: 'apple', credentials: 'auto' },\n    google: { kind: 'oidc', preset: 'google', credentials: 'auto' },\n  },\n`, '')
    .replace('  externalSessionEntry: true,\n', '');
  assert.equal(restored, DECLARATION);
});

test('enable refuses an unrecognized or ambiguous declaration instead of guessing', () => {
  assert.throws(
    () => enableProvidersInDeclaration('export const nothing = 1;\n', ['apple']),
    (error) => error.code === 'SNAPBACK_AUTH_DECLARATION_UNRECOGNIZED',
  );
  assert.throws(
    () => enableProvidersInDeclaration(`${DECLARATION}\nconst second = defineAuth({ version: 1 });\n`, ['apple']),
    (error) => error.code === 'SNAPBACK_AUTH_DECLARATION_UNRECOGNIZED' && error.diagnostic.details.calls === 2,
  );
  assert.throws(
    () => enableProvidersInDeclaration(DECLARATION, ['github']),
    (error) => error.code === 'SNAPBACK_AUTH_PROVIDER_UNSUPPORTED',
  );
});

test('enable leaves a hand-written providers block alone and names the exact edit', () => {
  const authored = DECLARATION.replace(
    '  assuranceRequirements: {},',
    "  providers: { apple: { kind: 'apple', credentials: 'app-owned' } },\n  assuranceRequirements: {},",
  );
  assert.throws(
    () => enableProvidersInDeclaration(authored, ['google']),
    (error) => error.code === 'SNAPBACK_AUTH_DECLARATION_PROVIDERS_PRESENT'
      && error.diagnostic.details.manualSeam.some((line) => line.includes("preset: 'google'")),
  );
});

test('enable refuses a declaration that disables the external-session seam', () => {
  const authored = DECLARATION.replace(
    '  assuranceRequirements: {},',
    '  externalSessionEntry: false,\n  assuranceRequirements: {},',
  );
  assert.throws(
    () => enableProvidersInDeclaration(authored, ['apple']),
    (error) => error.code === 'SNAPBACK_AUTH_DECLARATION_EXTERNAL_SESSION_CONFLICT',
  );
});

test('enable writes the app declaration and reports its digests', () => {
  const root = project();
  const result = runAuthEnable({ providers: ['google', 'apple', 'apple'], cwd: root });
  assert.equal(result.ok, true);
  assert.deepEqual(result.providers, ['apple', 'google']);
  assert.equal(result.declaration, join('snapback', 'schema.mjs'));
  assert.match(result.beforeDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(result.beforeDigest, result.afterDigest);
  const written = readFileSync(join(root, 'snapback', 'schema.mjs'), 'utf8');
  assert.match(written, /providers: \{/u);
  // The generated declaration stays credential-free.
  assert.equal(/secret|clientSecret|privateKey/iu.test(written.match(/providers: \{[\s\S]*?\},/u)[0]), false);
  assert.deepEqual(result.next, ['snapback generate', 'snapback dev --expo', 'snapback auth status']);
  assert.equal(result.nonclaims.some((note) => note.includes('rehearsal')), true);
});

test('enable requires at least one provider', () => {
  const root = project();
  assert.throws(
    () => runAuthEnable({ providers: [], cwd: root }),
    (error) => error.code === 'SNAPBACK_AUTH_PROVIDER_UNSUPPORTED',
  );
});

test('configure with no identifiers emits the console walkthrough and writes nothing', () => {
  const root = project();
  const result = runAuthConfigure({
    provider: 'apple',
    cwd: root,
    appScheme: 'myapp',
    bundleIdentifier: 'com.example.myapp',
    returnUrl: 'https://auth.example/callback',
  });
  assert.equal(result.operation, 'walkthrough');
  assert.deepEqual(result.walkthrough.automatable, []);
  assert.equal(result.walkthrough.steps.some((step) => step.includes('com.example.myapp')), true);
  assert.equal(result.walkthrough.steps.some((step) => step.includes('https://auth.example/callback')), true);
  assert.deepEqual(result.secretCommands, ['snapback config set --entry auth.apple.privateKey --value-stdin']);
  assert.throws(
    () => readFileSync(join(root, 'snapback', 'auth-providers.json'), 'utf8'),
    (error) => error.code === 'ENOENT',
  );
});

test('configure records public identifiers and secret references only', () => {
  const root = project();
  const result = runAuthConfigure({
    provider: 'google',
    identifiers: { iosClientId: 'ios-1.apps.googleusercontent.com', webClientId: 'web-1.apps.googleusercontent.com' },
    cwd: root,
  });
  assert.equal(result.operation, 'record');
  assert.deepEqual(result.recorded, ['iosClientId', 'webClientId']);
  assert.deepEqual(result.missing, ['androidClientId']);
  assert.deepEqual(result.nativeIntegration, {
    ...AUTH_PROVIDER_NATIVE_INTEGRATIONS.google,
    pluginConfigured: false,
    reason: 'configuration-incomplete',
  });
  const written = readFileSync(join(root, 'snapback', 'auth-providers.json'), 'utf8');
  assert.equal(JSON.parse(written).format, 'snapback.app-owned-auth-providers.v1');
  assert.deepEqual(
    JSON.parse(written).providers.google.secretReferences,
    ['auth.google.clientSecret'],
  );
  // The recorded file holds no secret value, and the result names how to set one.
  assert.equal(/"[^"]*[Ss]ecret[^"]*":\s*"[^"]+"/u.test(written.replace(/"secretReferences":[\s\S]*?\]/u, '')), false);
  assert.equal(result.secretCommands[0].includes('--value-stdin'), true);
  assert.equal(result.nonclaims.some((note) => note.includes('not provider readiness')), true);
});

// @ref LLP 0151#native-readiness-requires-both-halves — the native integration
// is installed only once app-owned configuration exists.
test('configure adds the config plugin only when configuration is complete', () => {
  const root = project({ appConfig: { expo: { name: 'x', slug: 'x' } } });
  const partial = runAuthConfigure({
    provider: 'apple',
    identifiers: { servicesId: 'com.example.service' },
    cwd: root,
  });
  assert.equal(partial.nativeIntegration.pluginConfigured, false);
  assert.equal(partial.nativeIntegration.reason, 'configuration-incomplete');
  assert.equal(
    JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.plugins,
    undefined,
  );

  const complete = runAuthConfigure({
    provider: 'apple',
    identifiers: { teamId: 'TEAM1', keyId: 'KEY1', bundleIdentifier: 'com.example.myapp' },
    cwd: root,
  });
  assert.deepEqual(complete.missing, []);
  assert.equal(complete.nativeIntegration.pluginConfigured, true);
  assert.equal(complete.nativeIntegration.reason, 'added');
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.plugins,
    ['expo-apple-authentication'],
  );
  assert.equal(complete.next.includes('npx expo install expo-apple-authentication'), true);
  assert.equal(
    complete.next.includes('Rebuild the client so it carries the native integration.'),
    true,
  );

  // Rerunning is idempotent, not a second plugin entry.
  const again = runAuthConfigure({
    provider: 'apple',
    identifiers: { keyId: 'KEY1' },
    cwd: root,
  });
  assert.equal(again.nativeIntegration.reason, 'already-present');
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.plugins,
    ['expo-apple-authentication'],
  );
});

test('configure refuses an app.json shape it did not write', () => {
  for (const [appConfig, code] of [
    [{ name: 'no-expo-object' }, 'SNAPBACK_AUTH_APP_CONFIG_INVALID'],
    [{ expo: { name: 'x', plugins: 'not-an-array' } }, 'SNAPBACK_AUTH_APP_CONFIG_INVALID'],
    [{ expo: { name: 'x', plugins: [{ shape: 'unknown' }] } }, 'SNAPBACK_AUTH_APP_CONFIG_INVALID'],
  ]) {
    const root = project({ appConfig });
    assert.throws(
      () => runAuthConfigure({
        provider: 'google',
        identifiers: { iosClientId: 'i', androidClientId: 'a', webClientId: 'w' },
        cwd: root,
      }),
      (error) => error.code === code,
      JSON.stringify(appConfig),
    );
  }
});

test('an app with no app.json records configuration without inventing one', () => {
  const root = project();
  const result = runAuthConfigure({
    provider: 'google',
    identifiers: { iosClientId: 'i', androidClientId: 'a', webClientId: 'w' },
    cwd: root,
  });
  assert.equal(result.nativeIntegration.pluginConfigured, false);
  assert.equal(result.nativeIntegration.reason, 'no-app-json');
  // Nothing was written, so the edit is named. Dropping it from `next` would
  // read as nothing left to do and produce a rebuild without the integration.
  assert.equal(
    result.next.includes(
      'Add @react-native-google-signin/google-signin to expo.plugins in your Expo app config.',
    ),
    true,
  );
  assert.equal(
    result.next.includes('npx expo install @react-native-google-signin/google-signin'),
    true,
  );
});

// An Expo app config module is code, not data. Rewriting it is not on the
// table, so the command names the exact edit against the file it found.
test('a module app config is named for a hand edit, not rewritten', () => {
  for (const spelling of ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs']) {
    const root = project({ appConfigModule: spelling });
    const result = runAuthConfigure({
      provider: 'apple',
      identifiers: { servicesId: 's', teamId: 't', keyId: 'k', bundleIdentifier: 'b' },
      cwd: root,
    });
    assert.deepEqual(result.missing, [], spelling);
    assert.equal(result.nativeIntegration.pluginConfigured, false, spelling);
    assert.equal(result.nativeIntegration.reason, 'app-config-not-json', spelling);
    assert.equal(
      result.next.includes(`Add expo-apple-authentication to expo.plugins in ${spelling}.`),
      true,
      spelling,
    );
    assert.equal(
      result.next.includes('Rebuild the client so it carries the native integration.'),
      true,
      spelling,
    );
    // The module was left exactly as authored.
    assert.equal(
      readFileSync(join(root, spelling), 'utf8').includes('expo-apple-authentication'),
      false,
      spelling,
    );
  }
});

test('configure rotates the configuration generation when an identifier changes', () => {
  const root = project();
  const first = runAuthConfigure({
    provider: 'google',
    identifiers: { iosClientId: 'ios-1', androidClientId: 'android-1', webClientId: 'web-1' },
    cwd: root,
  });
  assert.deepEqual(first.missing, []);
  const second = runAuthConfigure({
    provider: 'google',
    identifiers: { webClientId: 'web-2' },
    cwd: root,
  });
  assert.notEqual(first.configGeneration, second.configGeneration);
});

test('configure refuses a secret value and an unknown identifier', () => {
  const root = project();
  for (const identifiers of [
    { clientSecret: 'must-not-be-accepted' },
    { unknownField: 'x' },
  ]) {
    assert.throws(
      () => runAuthConfigure({ provider: 'google', identifiers, cwd: root }),
      (error) => error.code === 'SNAPBACK_AUTH_PROVIDER_IDENTIFIER_UNKNOWN',
      JSON.stringify(identifiers),
    );
  }
  assert.throws(
    () => runAuthConfigure({ provider: 'github', cwd: root }),
    (error) => error.code === 'SNAPBACK_AUTH_PROVIDER_UNSUPPORTED',
  );
});

test('a literal secret already in the config file is refused rather than read past', () => {
  const root = project({
    descriptor: descriptorWith([{ provider: 'google', kind: 'oidc', preset: 'google', credentials: 'auto' }]),
  });
  runAuthConfigure({ provider: 'google', identifiers: { webClientId: 'web-1' }, cwd: root });
  const path = join(root, 'snapback', 'auth-providers.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.providers.google.clientSecret = 'leaked-value';
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  assert.throws(
    () => runAuthStatus({ cwd: root }),
    (error) => error.code === 'SNAPBACK_AUTH_PROVIDER_CONFIG_SECRET_PRESENT',
  );
});

test('status resolves the shared development profile and never claims native readiness', () => {
  const root = project({
    descriptor: descriptorWith([
      { provider: 'apple', kind: 'apple', credentials: 'auto' },
      { provider: 'google', kind: 'oidc', preset: 'google', credentials: 'auto' },
    ]),
  });
  const result = runAuthStatus({ cwd: root, sharedAvailable: true });
  assert.equal(result.providers.length, 2);
  for (const provider of result.providers) {
    assert.equal(provider.resolvedAdapter, 'snapback-shared-browser');
    assert.equal(provider.identityRealm, 'rehearsal');
    assert.equal(provider.readiness, 'ready');
    assert.equal(provider.nativeBuild.observedHere, false);
    assert.equal(provider.configuration.ready, false);
  }
  assert.equal(result.nonclaims.some((note) => note.includes('rehearsal identities')), true);
  // Secret *references* are entry names, and no secret value appears anywhere.
  assert.deepEqual(
    result.providers.flatMap(({ configuration }) => [...configuration.secretReferences]),
    ['auth.apple.privateKey', 'auth.google.clientSecret'],
  );
  assert.equal(/"[^"]*[Ss]ecret[^"]*":\s*"(?!auth\.)/u.test(JSON.stringify(result)), false);
});

test('a cold status is blocked on the broker, not on configuration', () => {
  const root = project({
    descriptor: descriptorWith([
      { provider: 'apple', kind: 'apple', credentials: 'auto' },
      { provider: 'google', kind: 'oidc', preset: 'google', credentials: 'auto' },
    ]),
  });
  // Nothing is configured and no supervisor is running, so the block is the
  // broker's absence and the named command is the one that serves it.
  const result = runAuthStatus({ cwd: root });
  assert.equal(result.sharedAvailable, false);
  assert.equal(result.sharedDevelopment.observed, 'no-supervisor');
  assert.equal(result.sharedDevelopment.asserted, false);
  for (const provider of result.providers) {
    assert.equal(provider.readiness, 'blocked');
    assert.equal(
      provider.nextAction,
      `Start snapback dev --expo, or run snapback auth configure ${provider.provider}.`,
    );
  }
});

test('status observes a live supervisor that is serving the broker', () => {
  const root = project({
    descriptor: descriptorWith([
      { provider: 'apple', kind: 'apple', credentials: 'auto' },
      { provider: 'google', kind: 'oidc', preset: 'google', credentials: 'auto' },
    ]),
  });
  writeSupervisorDescriptor(root, { sharedAuth: SERVED_PROJECTION });
  const result = runAuthStatus({ cwd: root });
  assert.equal(result.sharedAvailable, true);
  assert.equal(result.sharedDevelopment.observed, 'supervised');
  assert.equal(result.sharedDevelopment.asserted, false);
  assert.equal(result.sharedDevelopment.origin, 'http://127.0.0.1:4300');
  // The next action cleared without anyone asserting anything.
  assert.deepEqual(result.next, []);
  for (const provider of result.providers) {
    assert.equal(provider.resolvedAdapter, 'snapback-shared-browser');
    assert.equal(provider.identityRealm, 'rehearsal');
    assert.equal(provider.readiness, 'ready');
  }
});

test('every uncertain supervisor observation reports the broker as unavailable', () => {
  const descriptor = descriptorWith([{ provider: 'apple', kind: 'apple', credentials: 'auto' }]);
  const cases = [
    // A descriptor a crashed supervisor left behind: the pid may even be live
    // again as something else, so the recorded start time settles it.
    ['supervisor-not-running', {
      sharedAuth: SERVED_PROJECTION,
      supervisor: { pid: process.pid, startTime: 'Mon Jan  1 00:00:00 2001' },
    }],
    // A supervisor predating the recorded projection says nothing, and
    // silence is not availability.
    ['projection-unrecorded', { sharedAuth: undefined }],
    // Deployment state refused the shared profile even though the supervisor
    // is up and has a broker object.
    ['not-admitted', {
      sharedAuth: {
        format: 'snapback.shared-development-auth-projection.v1',
        available: false,
        reason: 'deployment-not-admitted:staging',
      },
    }],
    ['descriptor-unrecognized', { schemaVersion: 'snapback.expo-supervisor.v0' }],
    ['descriptor-unreadable', { raw: 'not json' }],
  ];
  for (const [observed, overrides] of cases) {
    const root = project({ descriptor });
    writeSupervisorDescriptor(root, overrides);
    const result = runAuthStatus({ cwd: root });
    assert.equal(result.sharedDevelopment.observed, observed, observed);
    assert.equal(result.sharedAvailable, false, observed);
    assert.equal(result.providers[0].readiness, 'blocked', observed);
  }
});

test('the assertion flag overrides the observation without erasing it', () => {
  const root = project({
    descriptor: descriptorWith([{ provider: 'apple', kind: 'apple', credentials: 'auto' }]),
  });
  const result = runAuthStatus({ cwd: root, sharedAvailable: true });
  assert.equal(result.sharedAvailable, true);
  assert.equal(result.sharedDevelopment.asserted, true);
  // What this process could actually see is still reported next to the claim.
  assert.equal(result.sharedDevelopment.available, false);
  assert.equal(result.sharedDevelopment.observed, 'no-supervisor');
  assert.equal(result.providers[0].readiness, 'ready');
});

test('the observed descriptor format is the one the supervisor writes', async () => {
  const { EXPO_SUPERVISOR_DESCRIPTOR_FORMAT } = await import('./expo-dev.mjs');
  const { sharedDevelopmentAuthProjection } = await import('./shared-development-broker.mjs');
  assert.equal(EXPO_SUPERVISOR_DESCRIPTOR_FORMAT, SUPERVISOR_DESCRIPTOR_FORMAT);
  assert.equal(sharedDevelopmentAuthProjection(null, null).format, SERVED_PROJECTION.format);
});

test('status reports the rebuild next action when configuration is complete but the build is not', () => {
  const root = project({
    descriptor: descriptorWith([{ provider: 'google', kind: 'oidc', preset: 'google', credentials: 'auto' }]),
  });
  runAuthConfigure({
    provider: 'google',
    identifiers: { iosClientId: 'ios-1', androidClientId: 'android-1', webClientId: 'web-1' },
    cwd: root,
  });
  const result = runAuthStatus({ cwd: root, sharedAvailable: true });
  const [google] = result.providers;
  assert.equal(google.configuration.ready, true);
  // Configuration alone does not select native auth.
  assert.equal(google.resolvedAdapter, 'snapback-shared-browser');
  assert.equal(google.nextAction, 'Rebuild the client to activate app-owned native auth.');
  assert.equal(google.nativeBuild.dependencyInstalled, false);
  assert.equal(google.nativeBuild.pluginConfigured, false);
});

test('status observes the declared native integration without claiming a build', () => {
  const root = project({
    descriptor: descriptorWith([{ provider: 'apple', kind: 'apple', credentials: 'auto' }]),
    manifest: { dependencies: { expo: '~57.0.7', 'expo-apple-authentication': '~8.0.0' } },
    appConfig: { expo: { name: 'x', slug: 'x', plugins: ['expo-apple-authentication'] } },
  });
  const result = runAuthStatus({ cwd: root, sharedAvailable: true });
  const [apple] = result.providers;
  assert.equal(apple.nativeBuild.dependencyInstalled, true);
  assert.equal(apple.nativeBuild.pluginConfigured, true);
  // Still no native claim: the installed build is not observable from here.
  assert.equal(apple.nativeBuild.observedHere, false);
  assert.equal(apple.resolvedAdapter, 'snapback-shared-browser');
});

test('status refuses staging and production without app-owned readiness', () => {
  const root = project({
    descriptor: descriptorWith([{ provider: 'apple', kind: 'apple', credentials: 'auto' }]),
  });
  for (const deployment of ['staging', 'production']) {
    const result = runAuthStatus({ cwd: root, deployment, sharedAvailable: true });
    const [apple] = result.providers;
    assert.equal(apple.readiness, 'blocked');
    assert.equal(apple.nextAction, 'Run snapback auth configure apple.');
  }
});

test('status reports an empty declaration and an ungenerated app distinctly', () => {
  const declaredNone = project({ descriptor: descriptorWith(null) });
  assert.deepEqual(runAuthStatus({ cwd: declaredNone }).providers, []);
  const ungenerated = project();
  assert.throws(
    () => runAuthStatus({ cwd: ungenerated }),
    (error) => error.code === 'SNAPBACK_AUTH_STATUS_UNGENERATED',
  );
});

test('the walkthrough names no automatable step for either provider', () => {
  for (const provider of ['apple', 'google']) {
    const walkthrough = providerConsoleWalkthrough(provider, {});
    assert.deepEqual(walkthrough.automatable, [], provider);
    assert.equal(walkthrough.steps.length > 0, true, provider);
  }
});

test('the CLI routes enable, configure, and status and delegates every other auth verb', () => {
  const root = project({
    descriptor: descriptorWith([{ provider: 'apple', kind: 'apple', credentials: 'auto' }]),
  });
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });

  const enabled = run(['auth', 'enable', 'apple', 'google', '--json']);
  assert.equal(enabled.status, 0, enabled.stderr);
  assert.deepEqual(JSON.parse(enabled.stdout).providers, ['apple', 'google']);

  const status = run(['auth', 'status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).schemaVersion, 'snapback.auth-status.v1');

  const configured = run(['auth', 'configure', 'google', '--webClientId', 'web-1', '--json']);
  assert.equal(configured.status, 0, configured.stderr);
  assert.equal(JSON.parse(configured.stdout).recorded[0], 'webClientId');

  const invalid = run(['auth', 'enable', 'apple', '--unknown-flag', 'x', '--json']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stdout + invalid.stderr, /SNAPBACK_CLI_ARGUMENT_INVALID/u);

  // A native verb must not be intercepted, help included. The runtime binary is
  // not reachable in this fixture, so the delegation itself reports that — but
  // it must never answer with the packaged group's usage.
  const delegated = run(['auth', 'rehearse', '--help']);
  const delegatedOutput = delegated.stdout + delegated.stderr;
  assert.equal(/snapback auth (?:enable|configure|status)/u.test(delegatedOutput), false, delegatedOutput);
  assert.match(delegatedOutput, /native help unavailable|Usage: snapback auth/u);

  // The package-owned verbs do answer with their own help.
  const enableHelp = run(['auth', 'enable', '--help']);
  assert.equal(enableHelp.status, 0, enableHelp.stderr);
  assert.match(enableHelp.stdout, /^Usage: snapback auth enable/u);
});
