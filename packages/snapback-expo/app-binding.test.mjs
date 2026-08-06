import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  admitAppBindingV1,
  publicBindingFacts,
  validateAppBindingV1,
} from './app-binding.mjs';

const app = Object.freeze({
  format: 'snapback.app.v1',
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

const admittedDev = await admitAppBindingV1(devBinding, app, {
  now: Date.parse('2026-08-05T20:30:00.000Z'),
  delivery: { channel: 'local-supervised-ipc' },
});
assert(Object.isFrozen(admittedDev));

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
    now: Date.parse('2026-08-05T19:59:59.999Z'),
    delivery: { channel: 'local-supervised-ipc' },
  }),
  (error) => error.code === 'SNAPBACK_APP_BINDING_NOT_YET_VALID',
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
