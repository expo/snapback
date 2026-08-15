import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { generate } from '../snapback-codegen/index.mjs';

import {
  admitAppBindingV1,
  publicBindingFacts,
  validateAppBindingV1,
} from './app-binding.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');

const app = Object.freeze({
  format: 'snapback.app.v1',
  authoringProfile: 'snapback-explicit-v1',
  identity: Object.freeze({
    app: 'field-notebook',
    schema: 'sha256:schema',
    functions: 'sha256:functions',
    descriptor: 'sha256:descriptor',
  }),
  api: Object.freeze({
    queries: Object.freeze({}),
    mutations: Object.freeze({}),
    assets: Object.freeze({}),
    ephemeral: Object.freeze({}),
    queryGroups: Object.freeze({}),
  }),
  commands: Object.freeze({}),
  surfaces: Object.freeze({}),
  capabilities: Object.freeze({ required: Object.freeze(['live_subscriptions']) }),
});

const devBinding = Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: app.identity.descriptor,
  target: Object.freeze({
    app: app.identity.app,
    schema: app.identity.schema,
    functions: app.identity.functions,
    origin: 'http://127.0.0.1:4137',
    routing: 'loopback',
  }),
  capabilities: Object.freeze({ offered: Object.freeze(['live_subscriptions']) }),
  provenance: Object.freeze({
    supervisorGeneration: 'supervisor-7',
    issuedAt: '2026-08-05T20:00:00.000Z',
    expiresAt: '2026-08-05T21:00:00.000Z',
  }),
  integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
});

const releaseBinding = Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'release',
  descriptorIdentity: app.identity.descriptor,
  target: Object.freeze({
    app: app.identity.app,
    schema: app.identity.schema,
    functions: app.identity.functions,
    origin: 'https://field-notebook.example.test',
    routing: 'https',
  }),
  capabilities: Object.freeze({ offered: Object.freeze(['live_subscriptions', 'extra']) }),
  provenance: Object.freeze({
    environment: 'production',
    releaseChannel: 'stable',
    buildReceipt: 'sha256:release-receipt',
  }),
  integrity: Object.freeze({
    channel: 'signed-artifact',
    signature: 'public-signature',
  }),
});

assert.deepEqual(validateAppBindingV1(devBinding), []);
assert.deepEqual(validateAppBindingV1(releaseBinding), []);

const schema = JSON.parse(readFileSync(new URL('./app-binding.schema.json', import.meta.url)));
const ajv = new Ajv2020({ strict: false, validateFormats: false });
const validateSchema = ajv.compile(schema);
assert.equal(validateSchema(devBinding), true, JSON.stringify(validateSchema.errors));
assert.equal(validateSchema(releaseBinding), true, JSON.stringify(validateSchema.errors));

const carriedAuthority = structuredClone(devBinding);
carriedAuthority.bearerToken = 'must-not-fit';
assert.equal(validateAppBindingV1(carriedAuthority)[0].code, 'SNAPBACK_APP_BINDING_SCHEMA_INVALID');
assert.equal(validateSchema(carriedAuthority), false);

const crossedSourceProvenance = structuredClone(devBinding);
crossedSourceProvenance.provenance = structuredClone(releaseBinding.provenance);
assert.equal(
  validateAppBindingV1(crossedSourceProvenance)[0].code,
  'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
);
assert.equal(validateSchema(crossedSourceProvenance), false);

const unsignedRelease = structuredClone(releaseBinding);
unsignedRelease.integrity = { channel: 'signed-artifact' };
assert.equal(
  validateAppBindingV1(unsignedRelease)[0].code,
  'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
);
assert.equal(validateSchema(unsignedRelease), false);

const remoteDevelopment = structuredClone(devBinding);
remoteDevelopment.target.origin = 'http://192.0.2.10:4137';
assert.equal(
  validateAppBindingV1(remoteDevelopment)[0].code,
  'SNAPBACK_APP_BINDING_TARGET_INVALID',
);

const androidEmulatorAlias = structuredClone(devBinding);
androidEmulatorAlias.target.origin = 'http://10.0.2.2:4137';
androidEmulatorAlias.target.routing = 'port-forward';
assert.deepEqual(validateAppBindingV1(androidEmulatorAlias), []);
const aliasWithoutPortForward = structuredClone(androidEmulatorAlias);
aliasWithoutPortForward.target.routing = 'loopback';
assert.equal(
  validateAppBindingV1(aliasWithoutPortForward)[0].code,
  'SNAPBACK_APP_BINDING_TARGET_INVALID',
);

const admittedDev = await admitAppBindingV1(devBinding, app, {
  now: Date.parse('2026-08-05T20:30:00.000Z'),
  delivery: { channel: 'local-supervised-ipc' },
});
assert(Object.isFrozen(admittedDev));

const legacyAppWithoutProfile = structuredClone(app);
delete legacyAppWithoutProfile.authoringProfile;
await assert.doesNotReject(admitAppBindingV1(devBinding, legacyAppWithoutProfile, {
  now: Date.parse('2026-08-05T20:30:00.000Z'),
  delivery: { channel: 'local-supervised-ipc' },
}));
const unknownProfileApp = structuredClone(app);
unknownProfileApp.authoringProfile = 'snapback-future-v2';
await assert.rejects(
  admitAppBindingV1(devBinding, unknownProfileApp, {
    now: Date.parse('2026-08-05T20:30:00.000Z'),
    delivery: { channel: 'local-supervised-ipc' },
  }),
  (error) => error.code === 'SNAPBACK_APP_DESCRIPTOR_INVALID',
);

// Cross-package closure gate: admission must consume the descriptor emitted by the
// codegen package at this exact workspace version for both authoring profiles.
const codegenVersion = JSON.parse(readFileSync(
  join(repoRoot, 'packages', 'snapback-codegen', 'package.json'),
  'utf8',
)).version;
const expoVersion = JSON.parse(readFileSync(
  join(repoRoot, 'packages', 'snapback-expo', 'package.json'),
  'utf8',
)).version;
assert.equal(expoVersion, codegenVersion);
const generatedDescriptorRoot = mkdtempSync(join(tmpdir(), 'snapback-expo-descriptor-contract-'));
try {
  for (const [fixtureName, expectedProfile] of [
    ['familiar-todo-explicit', 'snapback-explicit-v1'],
    ['familiar-todo', 'snapback-familiar-ts-v1'],
  ]) {
    const backendRoot = join(generatedDescriptorRoot, fixtureName);
    cpSync(join(repoRoot, 'tests', 'fixtures', fixtureName), backendRoot, { recursive: true });
    rmSync(join(backendRoot, 'generated'), { recursive: true, force: true });
    if (expectedProfile === 'snapback-explicit-v1') {
      const defineUrl = pathToFileURL(
        join(repoRoot, 'packages', 'snapback-codegen', 'define.mjs'),
      ).href;
      for (const name of ['schema.mjs', 'functions.mjs']) {
        const path = join(backendRoot, name);
        writeFileSync(
          path,
          readFileSync(path, 'utf8').replace(
            '../../../packages/snapback-codegen/define.mjs',
            defineUrl,
          ),
        );
      }
    }
    const generated = await generate(backendRoot);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const descriptor = JSON.parse(readFileSync(
      join(backendRoot, 'generated', 'app.descriptor.json'),
      'utf8',
    ));
    assert.equal(descriptor.authoringProfile, expectedProfile);
    const candidate = structuredClone(devBinding);
    candidate.descriptorIdentity = descriptor.identity.descriptor;
    candidate.target.app = descriptor.identity.app;
    candidate.target.schema = descriptor.identity.schema;
    candidate.target.functions = descriptor.identity.functions;
    candidate.capabilities.offered = [...descriptor.capabilities.required];
    const admitted = await admitAppBindingV1(candidate, descriptor, {
      now: Date.parse('2026-08-05T20:30:00.000Z'),
      delivery: { channel: 'local-supervised-ipc' },
    });
    assert.equal(admitted.descriptorIdentity, descriptor.identity.descriptor);
  }
} finally {
  rmSync(generatedDescriptorRoot, { recursive: true, force: true });
}

await assert.rejects(
  admitAppBindingV1(devBinding, app, {
    mode: 'override',
    now: Date.parse('2026-08-05T20:30:00.000Z'),
    delivery: { channel: 'local-supervised-ipc' },
  }),
  (error) => error.code === 'SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED',
);
assert.equal(
  (await admitAppBindingV1(devBinding, app, {
    mode: 'override',
    now: Date.parse('2026-08-05T20:30:00.000Z'),
    delivery: { channel: 'local-supervised-ipc' },
    confirmSupervisedIssuance: (candidate) => candidate === devBinding,
  })).source,
  'supervised-dev',
);

await assert.rejects(
  admitAppBindingV1(devBinding, app, {
    now: Date.parse('2026-08-05T19:58:59.999Z'),
    delivery: { channel: 'local-supervised-ipc' },
  }),
  (error) => error.code === 'SNAPBACK_APP_BINDING_NOT_YET_VALID'
    && error.diagnostic.details.allowedClockSkewMs === 60_000,
);
assert.equal(
  (await admitAppBindingV1(devBinding, app, {
    now: Date.parse('2026-08-05T19:59:00.000Z'),
    delivery: { channel: 'local-supervised-ipc' },
  })).source,
  'supervised-dev',
  'local supervised IPC admits exactly one minute of host/emulator clock skew',
);
await assert.rejects(
  admitAppBindingV1(devBinding, app, {
    now: Date.parse('2026-08-05T21:00:00.000Z'),
    delivery: { channel: 'local-supervised-ipc' },
  }),
  (error) => error.code === 'SNAPBACK_APP_BINDING_EXPIRED',
);
await assert.rejects(
  admitAppBindingV1(devBinding, app, {
    now: Date.parse('2026-08-05T20:30:00.000Z'),
    productionCondition: true,
    delivery: { channel: 'local-supervised-ipc' },
  }),
  (error) => error.code === 'SNAPBACK_APP_BINDING_SOURCE_MISMATCH',
);

const wrongDescriptor = structuredClone(devBinding);
wrongDescriptor.descriptorIdentity = 'sha256:wrong';
await assert.rejects(
  admitAppBindingV1(wrongDescriptor, app, {
    now: Date.parse('2026-08-05T20:30:00.000Z'),
    delivery: { channel: 'local-supervised-ipc' },
  }),
  (error) => {
    assert.equal(error.code, 'SNAPBACK_APP_BINDING_IDENTITY_MISMATCH');
    assert.deepEqual(error.diagnostic.details.mismatches.map(({ field }) => field), ['descriptor']);
    return true;
  },
);

const wrongTarget = structuredClone(devBinding);
wrongTarget.target.schema = 'sha256:other-schema';
wrongTarget.target.functions = 'sha256:other-functions';
await assert.rejects(
  admitAppBindingV1(wrongTarget, app, {
    now: Date.parse('2026-08-05T20:30:00.000Z'),
    delivery: { channel: 'local-supervised-ipc' },
  }),
  (error) => {
    assert.equal(error.code, 'SNAPBACK_APP_BINDING_IDENTITY_MISMATCH');
    assert.deepEqual(
      error.diagnostic.details.mismatches.map(({ field }) => field),
      ['schema', 'functions'],
    );
    return true;
  },
);

const missingCapability = structuredClone(devBinding);
missingCapability.capabilities.offered = [];
await assert.rejects(
  admitAppBindingV1(missingCapability, app, {
    now: Date.parse('2026-08-05T20:30:00.000Z'),
    delivery: { channel: 'local-supervised-ipc' },
  }),
  (error) => error.code === 'SNAPBACK_APP_BINDING_CAPABILITY_MISMATCH'
    && error.diagnostic.details.missingCapabilities[0] === 'live_subscriptions',
);

let signatureChecks = 0;
const admittedRelease = await admitAppBindingV1(releaseBinding, app, {
  generatedReleaseTargets: [releaseBinding.target],
  verifySignedArtifact(candidate) {
    signatureChecks += 1;
    return candidate.integrity.signature === 'public-signature';
  },
});
assert.equal(signatureChecks, 1);
assert.equal(admittedRelease.source, 'release');
assert.equal(publicBindingFacts(admittedRelease).integrity.signature, undefined);

await assert.rejects(
  admitAppBindingV1(releaseBinding, app, {
    generatedReleaseTargets: [{ ...releaseBinding.target, origin: 'https://other.example.test' }],
    verifySignedArtifact: () => true,
  }),
  (error) => error.code === 'SNAPBACK_APP_BINDING_TARGET_UNADMITTED',
);
await assert.rejects(
  admitAppBindingV1(releaseBinding, app, {
    generatedReleaseTargets: [releaseBinding.target],
    verifySignedArtifact: () => false,
  }),
  (error) => error.code === 'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
);

const embedded = structuredClone(releaseBinding);
embedded.integrity = { channel: 'embedded-at-build' };
assert.equal(
  (await admitAppBindingV1(embedded, app, {
    generatedReleaseTargets: [embedded.target],
    verifyBuildReceipt: (receipt) => receipt === embedded.provenance.buildReceipt,
  })).integrity.channel,
  'embedded-at-build',
);

console.log('app-binding.test.mjs: closed union, identity/capability, expiry, override, and release integrity pass');
