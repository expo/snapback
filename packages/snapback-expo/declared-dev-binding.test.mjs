import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  mintDeclaredDevCapability,
  unsafeInstallDeclaredDevCapabilityForGeneratedCode,
} from '@expo/snapback-client/internal/declared-dev-mint';
import { SnapbackProvider as SnapbackCoreProvider } from '@expo/snapback-react/core';
import { admitAppBindingV1 } from './app-binding.mjs';
import { createDeclaredDevBindingCandidate } from './declared-dev-binding-internal.mjs';
import { SnapbackExpoProvider, createSnapbackExpoBoot } from './provider.mjs';

const identity = Object.freeze({
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId: 'declared-app',
  schemaHash: 'snapback.v1:sessions:schema:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  bundleHash: 'snapback.v1:sessions:function:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  inputsHash: 'snapback.v1:sessions:inputs:sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
});

const appFor = ({ deploymentIdentity = identity, declared = true } = {}) => {
  const app = {
    format: 'snapback.app.v1',
    authoringProfile: 'snapback-explicit-v1',
    identity: {
      app: identity.appId,
      schema: identity.schemaHash,
      functions: identity.bundleHash,
      descriptor: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    },
    authBootstrap: {
      format: 'snapback.application-auth-bootstrap.v1',
      appId: identity.appId,
      mode: 'sessions',
      custody: 'volatile-explicit',
      entryMechanisms: ['guest-v1', 'password-v1'],
      anonymousPublic: 'allowed',
      lifecycleProtocol: 1,
    },
    api: { queries: {}, mutations: {}, assets: {}, ephemeral: {}, queryGroups: {} },
    commands: {},
    surfaces: {},
    capabilities: { required: ['auth.application-bootstrap.v1'] },
  };
  if (declared) unsafeInstallDeclaredDevCapabilityForGeneratedCode(app, deploymentIdentity);
  else Object.defineProperty(app, 'declaredDev', { value: null, enumerable: false });
  return Object.freeze(app);
};

const app = appFor();
// This adversarial in-process import succeeds by design: an importer has
// application-author standing and is outside the data-borne candidate threat.
const importingAuthorApp = structuredClone(app);
const importingAuthorCapability = unsafeInstallDeclaredDevCapabilityForGeneratedCode(
  importingAuthorApp,
  identity,
);
assert.equal(importingAuthorApp.declaredDev, importingAuthorCapability);
assert.equal(importingAuthorCapability.format, 'snapback.declared-dev-capability.v1');
for (const [input, expected] of [
  ['http://127.0.0.1:4287', 'http://127.0.0.1:4287'],
  ['http://localhost:5173/', 'http://localhost:5173'],
  ['https://[::1]:8443', 'https://[::1]:8443'],
  ['http://127.1:4287', 'http://127.0.0.1:4287'],
  ['HTTP://LOCALHOST:80', 'http://localhost'],
  ['http://10.0.2.2:4287', 'http://10.0.2.2:4287'],
]) {
  const candidate = createDeclaredDevBindingCandidate(app, input);
  assert.equal(candidate.target.origin, expected);
  const admitted = await admitAppBindingV1(candidate, app);
  assert.equal(admitted.source, 'declared-dev');
  assert.equal(admitted.target.origin, expected);
}

for (const [input, rule] of [
  ['ftp://localhost:4287', 'scheme-http-or-https'],
  ['http://localhost:4287/path', 'path-root-only'],
  ['http://localhost.:4287', 'url-surface-host'],
  ['http://user@localhost:4287', 'credentials-forbidden'],
  ['http://localhost:4287/?x=1', 'query-forbidden'],
]) {
  await assert.rejects(
    admitAppBindingV1(createDeclaredDevBindingCandidate(app, input), app),
    (error) => error.code === 'SNAPBACK_APP_BINDING_URL_INVALID'
      && error.diagnostic.details.problems[0].details.rule === rule,
  );
}

const genuine = createDeclaredDevBindingCandidate(app, 'http://localhost:4287');
const bindingSchema = JSON.parse(readFileSync(new URL('./app-binding.schema.json', import.meta.url)));
const validateBindingSchema = new Ajv2020({ strict: false, validateFormats: false }).compile(bindingSchema);
assert.equal(validateBindingSchema(genuine), true, JSON.stringify(validateBindingSchema.errors));
await assert.rejects(
  admitAppBindingV1(structuredClone(genuine), app),
  (error) => error.code === 'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED'
    && error.diagnostic.details.branded === false,
);
const differentGeneration = appFor({
  deploymentIdentity: { ...identity, inputsHash: identity.inputsHash.replace(/c+$/u, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') },
});
await assert.rejects(
  admitAppBindingV1(genuine, differentGeneration),
  (error) => error.code === 'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED'
    && error.diagnostic.details.branded === true,
);

assert.throws(
  () => createSnapbackExpoBoot({
    app,
    declaredDevCapability: mintDeclaredDevCapability(identity),
  }),
  (error) => error.code === 'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED',
);
for (const provider of [SnapbackCoreProvider, SnapbackExpoProvider]) {
  assert.throws(
    () => provider({ declaredDevCapability: mintDeclaredDevCapability(identity) }),
    (error) => error.code === 'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED',
  );
}
const handBuiltApp = { ...app };
Object.defineProperty(handBuiltApp, 'declaredDev', {
  value: mintDeclaredDevCapability({
    ...identity,
    inputsHash: identity.inputsHash.replace(/c+$/u, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
  }),
  enumerable: false,
});
Object.freeze(handBuiltApp);

const supervisedBinding = Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: app.identity.descriptor,
  target: Object.freeze({
    app: app.identity.app,
    schema: app.identity.schema,
    functions: app.identity.functions,
    origin: 'http://127.0.0.1:4399',
    routing: 'loopback',
  }),
  capabilities: Object.freeze({ offered: Object.freeze([
    'auth.application-bootstrap.v1',
    'auth.guest-sessions',
    'auth.passwords',
  ]) }),
  provenance: Object.freeze({
    supervisorGeneration: 'supervisor-generation',
    issuedAt: '2026-08-24T12:00:00.000Z',
    expiresAt: '2026-08-24T14:00:00.000Z',
  }),
  integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
});

const runBoot = async ({
  configured,
  url,
  resolution,
  resolutionError = null,
  selectedApp = app,
  nodeEnvironment = undefined,
}) => {
  const diagnostics = [];
  const seen = { resolveCalls: 0, applicationInput: null };
  const environment = {
    format: 'snapback.expo-environment.v1',
    resolveBinding() {
      seen.resolveCalls += 1;
      if (resolutionError !== null) throw resolutionError;
      return resolution;
    },
    adoptAuthority() { throw new Error('first-party boot must not use legacy authority adoption'); },
    resolveAppClientPlatform: () => 'memory',
    appState: { addEventListener: () => ({ remove() {} }) },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  };
  const previousOrigin = globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__;
  const previousEnvironmentOrigin = process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN;
  const previousNodeEnvironment = process.env.NODE_ENV;
  delete process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN;
  if (configured === 'environment') {
    delete globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__;
    process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN = 'http://127.0.0.1:4399';
  } else if (configured) globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__ = 'http://127.0.0.1:4399';
  else delete globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__;
  if (nodeEnvironment !== undefined) process.env.NODE_ENV = nodeEnvironment;
  let boot;
  try {
    boot = createSnapbackExpoBoot({
      app: selectedApp,
      url,
      environment,
      rqsStore: null,
      now: () => Date.parse('2026-08-24T13:00:00.000Z'),
      createApplicationClient: async (input) => {
        seen.applicationInput = input;
        return {
          client: { prepareReactBinding: async () => ({ source: 'deployment' }) },
          auth: {},
          bootstrapState: () => ({ status: 'ready', custody: {}, authoritySource: 'fresh-anonymous', advisories: [] }),
          subscribeBootstrap: () => () => {},
          dispose: async () => {},
        };
      },
      createProvider: () => ({ start() {}, pause() {}, resume() {}, dispose: async () => {} }),
      bindLifecycle: () => ({ dispose() {}, settled: async () => {} }),
    });
    const state = await boot.start();
    return { state, diagnostics, seen };
  } finally {
    await boot?.dispose();
    if (previousOrigin === undefined) delete globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__;
    else globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__ = previousOrigin;
    if (previousEnvironmentOrigin === undefined) delete process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN;
    else process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN = previousEnvironmentOrigin;
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
  }
};

const absent = await runBoot({ configured: false, url: 'http://localhost:4287' });
assert.equal(absent.state.status, 'ready');
assert.equal(absent.seen.resolveCalls, 0);
assert.equal(absent.state.binding.source, 'declared-dev');
assert.equal(absent.seen.applicationInput.url, 'http://localhost:4287');
assert.equal(Object.hasOwn(absent.seen.applicationInput, 'binding'), false);

const spliced = await runBoot({
  configured: false,
  selectedApp: handBuiltApp,
  url: 'http://localhost:4287',
});
assert.equal(spliced.state.status, 'error');
assert.equal(spliced.state.diagnostic.code, 'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED');
assert.equal(spliced.seen.resolveCalls, 0);

const completed = await runBoot({
  configured: true,
  url: 'http://localhost:4287',
  resolution: {
    binding: supervisedBinding,
    admission: { productionCondition: false, delivery: { channel: 'local-supervised-ipc' } },
  },
});
assert.equal(completed.state.status, 'ready');
assert.equal(completed.seen.applicationInput.binding.source, 'supervised-dev');
assert(completed.diagnostics.some((entry) => (
  entry.severity === 'debug'
  && entry.details.selectedSource === 'supervised-dev'
  && entry.details.ignoredUrl === 'http://localhost:4287'
)));

const productionConfigured = await runBoot({
  configured: 'environment',
  nodeEnvironment: 'production',
  url: 'http://localhost:4287',
  resolution: {
    binding: supervisedBinding,
    admission: { productionCondition: false, delivery: { channel: 'local-supervised-ipc' } },
  },
});
assert.equal(productionConfigured.state.status, 'ready');
assert.equal(productionConfigured.seen.resolveCalls, 1);
assert.equal(productionConfigured.seen.applicationInput.binding.source, 'supervised-dev');

const productionAbsent = await runBoot({
  configured: false,
  nodeEnvironment: 'production',
  url: 'http://localhost:4287',
});
assert.equal(productionAbsent.state.status, 'ready');
assert.equal(productionAbsent.seen.resolveCalls, 0);
assert.equal(productionAbsent.state.binding.source, 'declared-dev');

const configuredFailure = Object.assign(new Error('configured rendezvous failed'), {
  code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
});
const failed = await runBoot({
  configured: true,
  url: 'http://localhost:4287',
  resolutionError: configuredFailure,
});
assert.equal(failed.state.status, 'error');
assert.equal(failed.seen.applicationInput, null);
assert.equal(failed.seen.resolveCalls, 1);

const releaseApp = appFor({ declared: false });
const releaseBinding = Object.freeze({
  ...supervisedBinding,
  source: 'release',
  target: Object.freeze({ ...supervisedBinding.target, origin: 'https://release.example', routing: 'https' }),
  provenance: Object.freeze({ environment: 'production', releaseChannel: 'stable', buildReceipt: 'release-receipt' }),
  integrity: Object.freeze({ channel: 'embedded-at-build' }),
});
const release = await runBoot({
  configured: false,
  url: 'http://localhost:4287',
  selectedApp: releaseApp,
  resolution: {
    binding: releaseBinding,
    admission: {
      generatedReleaseTargets: [releaseBinding.target],
      verifyBuildReceipt: () => true,
    },
  },
});
assert.equal(release.state.status, 'ready');
assert.equal(release.seen.resolveCalls, 1);
assert.deepEqual(release.state.binding, releaseBinding);
assert.equal(release.seen.applicationInput.binding.source, 'release');
assert(release.diagnostics.some((entry) => (
  entry.severity === 'debug'
  && !Object.hasOwn(entry, 'code')
  && entry.details.selectedSource === 'existing-binding-resolution'
  && entry.details.ignoredUrl === 'http://localhost:4287'
)));

const repoRoot = resolve(import.meta.dirname, '..', '..');
const templateSource = (path) => readFileSync(resolve(repoRoot, path), 'utf8');
for (const path of [
  'packages/snapback-cli/templates/expo-chat/App.tsx',
  'packages/snapback-cli/templates/media-feed/App.tsx',
]) {
  assert.match(
    templateSource(path),
    /url=\{process\.env\.EXPO_PUBLIC_SNAPBACK_URL\}/u,
    `${path} carries the Expo URL one-liner`,
  );
}
const viteSource = templateSource('packages/snapback-cli/templates/react/src/main.tsx');
assert.match(viteSource, /url:\s*import\.meta\.env\.VITE_SNAPBACK_URL/u);
assert.doesNotMatch(viteSource, /createSnapbackDevAppBinding/u);
const todoAcceptanceSource = templateSource(
  'packages/snapback-cli/templates/todo-contract/acceptance.mjs',
);
assert.match(todoAcceptanceSource, /async journey\(\{[\s\S]*?\bbindingFor\b/u);
assert.match(todoAcceptanceSource, /const binding = bindingFor\(app,\s*\{/u);
assert.match(
  todoAcceptanceSource,
  /createSnapbackAppClient\s*\(\s*\{[\s\S]*?app,[\s\S]*?binding,[\s\S]*?streamless:\s*true,/u,
);
const reactImplementation = templateSource('packages/snapback-react/implementation.mjs');
assert.match(reactImplementation, /appClient,[\s\S]*?app,[\s\S]*?binding,[\s\S]*?url,[\s\S]*?platform,/u);
assert.match(reactImplementation, /\{ url \}/u);

console.log('declared-dev-binding.test.mjs: URL vectors, data-borne stamp refusals, unsafe importer success, NODE_ENV-independent precedence, provider threading, template one-liners, and release URL-ignore pass');
