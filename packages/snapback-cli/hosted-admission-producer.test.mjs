import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  createExternalReplayFloorAdvanceReceipt,
  prepareHostedAdmissionBoot,
  refreshHostedAdmissionProjection,
} from './index.mjs';

const canonicalValue = (value) => Array.isArray(value)
  ? value.map(canonicalValue)
  : (value === null || typeof value !== 'object')
    ? value
    : Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
const canonicalJson = (value) => JSON.stringify(canonicalValue(value));
const contentIdentity = (domain, value) => `sha256:${createHash('sha256')
  .update(`${domain}\0${canonicalJson(value)}`)
  .digest('hex')}`;
const packageRoot = dirname(fileURLToPath(import.meta.url));
const schemasRoot = join(packageRoot, '..', '..', 'schemas');
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
const schemaValidator = (file) => ajv.compile(
  JSON.parse(readFileSync(join(schemasRoot, file), 'utf8')),
);

const root = mkdtempSync(join(tmpdir(), 'snapback-hosted-admission-producer-'));
chmodSync(root, 0o700);

try {
  const projectionRoot = join(root, 'boot-1');
  mkdirSync(projectionRoot, { mode: 0o700 });
  const envelopePath = join(projectionRoot, 'hosted-admission.json');
  const keyPath = join(projectionRoot, 'hosted-admission-key.json');
  const keyMaterial = Buffer.alloc(32, 29);
  const browserArtifactSha256 = `sha256:${'c'.repeat(64)}`;
  const hostedAuth = {
    externalTls: 'enforced',
    effectiveSource: 'trusted',
    authenticationThrottle: 'sharedEnforced',
    sessionInvalidation: 'globallyFenced',
    clientCredentialPosture: 'senderConstrainedV2',
  };
  const authenticationThrottleConfig = {
    retentionMs: 120_000,
    maximumKeyCount: 100_000,
    global: { intervalMs: 10, burst: 1_000, maximumDenialDebtAttempts: 500 },
    source: { intervalMs: 10, burst: 200, maximumDenialDebtAttempts: 100 },
    subject: { intervalMs: 10, burst: 200, maximumDenialDebtAttempts: 100 },
    sourceSubject: { intervalMs: 10, burst: 200, maximumDenialDebtAttempts: 100 },
    family: { intervalMs: 10, burst: 200, maximumDenialDebtAttempts: 100 },
  };
  const supportContent = {
    hostedAuth,
    authenticationThrottleConfig,
    operatorSurface: 'disabled',
    browserDirectBearerSeam: 'excluded',
    browserArtifactSha256,
  };
  const admissionTemplate = {
    version: 1,
    deploymentId: 'deployment-1',
    configurationSha256: 'a'.repeat(64),
    supportSha256: contentIdentity(
      'snapback-hosted-auth-support-v1',
      supportContent,
    ).slice('sha256:'.length),
    admissionEpoch: 7,
    limiterEpoch: 11,
    authenticationThrottleConfig,
    invalidationEpoch: 13,
    handlerProtocolVersion: 1,
    handlerIncarnation: 'handler-1',
    operatorSurface: 'disabled',
    browserDirectBearerSeam: 'excluded',
    hostedAuth,
  };
  let advanceCalls = 0;
  let floorReceipt;
  const projection = await prepareHostedAdmissionBoot({
    operationId: 'boot-operation-1',
    previousSenderReplayEpochFloor: 16,
    advanceExternalReplayFloor: async (request) => {
      advanceCalls += 1;
      assert.deepEqual(request, {
        schemaVersion: 'snapback.external-replay-floor-advance-request.v1',
        operationId: 'boot-operation-1',
        deploymentId: 'deployment-1',
        previousFloor: 16,
      });
      floorReceipt = createExternalReplayFloorAdvanceReceipt({
        operationId: request.operationId,
        deploymentId: request.deploymentId,
        storeIdentitySha256: `sha256:${'d'.repeat(64)}`,
        previousFloor: request.previousFloor,
        senderReplayEpochFloor: 17,
        advancedAtMs: 999,
      });
      return floorReceipt;
    },
    admissionTemplate,
    admissionTtlMs: 120_000,
    browserArtifactSha256,
    publicOrigin: 'https://app.example.test',
    keyId: 'hosted-key-1',
    keyMaterial,
    envelopePath,
    keyPath,
    clock: () => 1_000,
  });
  assert.equal(advanceCalls, 1);
  assert.equal(projection.schemaVersion, 'snapback.hosted-admission-projection.v1');
  assert.equal(projection.senderReplayEpochFloor, 17);
  assert.equal(projection.externalFloorStoreIdentitySha256, `sha256:${'d'.repeat(64)}`);
  assert.equal(projection.remoteEvidence, false);
  assert.match(projection.projectionId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(lstatSync(envelopePath).mode & 0o777, 0o600);
  assert.equal(lstatSync(keyPath).mode & 0o777, 0o600);
  assert.equal(lstatSync(envelopePath).nlink, 1);
  assert.equal(lstatSync(keyPath).nlink, 1);

  const keyFileBytes = readFileSync(keyPath);
  const keyFile = JSON.parse(keyFileBytes);
  const envelope = JSON.parse(readFileSync(envelopePath));
  assert.deepEqual(keyFile, {
    schemaVersion: 'snapback.hosted-admission-key.v1',
    keyId: 'hosted-key-1',
    material: keyMaterial.toString('base64url'),
  });
  assert.equal(envelope.admission.senderReplayEpochFloor, 17);
  assert.equal(envelope.admission.issuedAtMs, 1_000);
  assert.equal(envelope.admission.expiresAtMs, 121_000);
  assert.equal(envelope.admission.handlerIncarnation, 'handler-1');
  assert.match(envelope.mac, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(projection).includes(keyFile.material), false);

  const refresh = refreshHostedAdmissionProjection({
    envelopePath,
    publicOrigin: 'https://app.example.test',
    keyId: 'hosted-key-1',
    keyMaterial,
    admissionEpoch: 8,
    limiterEpoch: 12,
    invalidationEpoch: 14,
    admissionTtlMs: 120_000,
    clock: () => 16_000,
  });
  assert.equal(refresh.schemaVersion, 'snapback.hosted-admission-refresh.v1');
  assert.equal(refresh.senderReplayEpochFloor, 17);
  assert.equal(refresh.handlerIncarnation, 'handler-1');
  assert.equal(refresh.admissionEpoch, 8);
  assert.equal(refresh.expiresAtMs, 136_000);
  assert.equal(refresh.remoteEvidence, false);
  assert.deepEqual(readFileSync(keyPath), keyFileBytes);
  const refreshedEnvelope = JSON.parse(readFileSync(envelopePath));
  assert.equal(refreshedEnvelope.admission.configurationSha256, 'a'.repeat(64));
  assert.equal(refreshedEnvelope.admission.supportSha256, admissionTemplate.supportSha256);
  assert.equal(refreshedEnvelope.admission.senderReplayEpochFloor, 17);
  assert.equal(refreshedEnvelope.admission.handlerIncarnation, 'handler-1');
  assert.notEqual(refreshedEnvelope.mac, envelope.mac);
  for (const [file, value] of [
    ['auth.external-replay-floor-advance.schema.json', floorReceipt],
    ['auth.hosted-admission-projection.schema.json', projection],
    ['auth.hosted-admission-refresh.schema.json', refresh],
  ]) {
    const validate = schemaValidator(file);
    assert.equal(validate(value), true, `${file}: ${JSON.stringify(validate.errors)}`);
  }

  const beforeWrongKey = readFileSync(envelopePath);
  assert.throws(
    () => refreshHostedAdmissionProjection({
      envelopePath,
      publicOrigin: 'https://app.example.test',
      keyId: 'hosted-key-1',
      keyMaterial: Buffer.alloc(32, 31),
      admissionTtlMs: 120_000,
      clock: () => 31_000,
    }),
    (error) => error.code === 'SNAPBACK_HOSTED_ADMISSION_REFRESH_INVALID',
  );
  assert.deepEqual(readFileSync(envelopePath), beforeWrongKey);

  const unknownEnvelopeRoot = join(root, 'unknown-envelope');
  mkdirSync(unknownEnvelopeRoot, { mode: 0o700 });
  const unknownEnvelopePath = join(unknownEnvelopeRoot, 'hosted-admission.json');
  writeFileSync(
    unknownEnvelopePath,
    `${JSON.stringify({ ...refreshedEnvelope, operatorOverride: true })}\n`,
    { mode: 0o600 },
  );
  assert.throws(
    () => refreshHostedAdmissionProjection({
      envelopePath: unknownEnvelopePath,
      publicOrigin: 'https://app.example.test',
      keyId: 'hosted-key-1',
      keyMaterial,
      admissionTtlMs: 120_000,
      clock: () => 31_000,
    }),
    (error) => error.code === 'SNAPBACK_HOSTED_ADMISSION_REFRESH_INVALID',
  );

  let unexpectedAdvance = false;
  await assert.rejects(
    prepareHostedAdmissionBoot({
      operationId: 'boot-operation-existing',
      previousSenderReplayEpochFloor: 17,
      advanceExternalReplayFloor: async () => {
        unexpectedAdvance = true;
        throw new Error('must not run');
      },
      admissionTemplate,
      browserArtifactSha256,
      publicOrigin: 'https://app.example.test',
      keyId: 'hosted-key-1',
      keyMaterial,
      envelopePath,
      keyPath,
      clock: () => 32_000,
    }),
    (error) => error.code === 'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
  );
  assert.equal(unexpectedAdvance, false);

  const invalidStaticRoot = join(root, 'invalid-static');
  mkdirSync(invalidStaticRoot, { mode: 0o700 });
  let invalidStaticAdvance = false;
  await assert.rejects(
    prepareHostedAdmissionBoot({
      operationId: 'boot-operation-invalid-static',
      previousSenderReplayEpochFloor: 17,
      advanceExternalReplayFloor: async () => {
        invalidStaticAdvance = true;
        throw new Error('must not run');
      },
      admissionTemplate,
      browserArtifactSha256,
      publicOrigin: 'http://app.example.test',
      keyId: 'hosted-key-1',
      keyMaterial,
      envelopePath: join(invalidStaticRoot, 'hosted-admission.json'),
      keyPath: join(invalidStaticRoot, 'hosted-admission-key.json'),
      clock: () => 32_000,
    }),
    (error) => error.code === 'SNAPBACK_HOSTED_ADMISSION_INVALID',
  );
  assert.equal(invalidStaticAdvance, false);

  const staleRoot = join(root, 'stale-floor');
  mkdirSync(staleRoot, { mode: 0o700 });
  await assert.rejects(
    prepareHostedAdmissionBoot({
      operationId: 'boot-operation-stale',
      previousSenderReplayEpochFloor: 17,
      advanceExternalReplayFloor: async () => createExternalReplayFloorAdvanceReceipt({
        operationId: 'boot-operation-stale',
        deploymentId: 'deployment-1',
        storeIdentitySha256: `sha256:${'d'.repeat(64)}`,
        previousFloor: 16,
        senderReplayEpochFloor: 17,
        advancedAtMs: 32_000,
      }),
      admissionTemplate,
      browserArtifactSha256,
      publicOrigin: 'https://app.example.test',
      keyId: 'hosted-key-1',
      keyMaterial,
      envelopePath: join(staleRoot, 'hosted-admission.json'),
      keyPath: join(staleRoot, 'hosted-admission-key.json'),
      clock: () => 32_001,
    }),
    (error) => error.code === 'SNAPBACK_EXTERNAL_REPLAY_FLOOR_INVALID',
  );
  assert.equal(lstatSync(staleRoot).mode & 0o777, 0o700);

  const insecureRoot = join(root, 'insecure');
  mkdirSync(insecureRoot, { mode: 0o755 });
  await assert.rejects(
    prepareHostedAdmissionBoot({
      operationId: 'boot-operation-insecure',
      previousSenderReplayEpochFloor: 17,
      advanceExternalReplayFloor: async () => {
        throw new Error('must not run');
      },
      admissionTemplate,
      browserArtifactSha256,
      publicOrigin: 'https://app.example.test',
      keyId: 'hosted-key-1',
      keyMaterial,
      envelopePath: join(insecureRoot, 'hosted-admission.json'),
      keyPath: join(insecureRoot, 'hosted-admission-key.json'),
      clock: () => 32_001,
    }),
    (error) => error.code === 'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
  );

  await assert.rejects(
    prepareHostedAdmissionBoot({
      operationId: 'boot-operation-support-drift',
      previousSenderReplayEpochFloor: 17,
      advanceExternalReplayFloor: async () => {
        throw new Error('must not run');
      },
      admissionTemplate: { ...admissionTemplate, supportSha256: 'e'.repeat(64) },
      browserArtifactSha256,
      publicOrigin: 'https://app.example.test',
      keyId: 'hosted-key-1',
      keyMaterial,
      envelopePath: join(staleRoot, 'support-drift-admission.json'),
      keyPath: join(staleRoot, 'support-drift-key.json'),
      clock: () => 32_001,
    }),
    (error) => error.code === 'SNAPBACK_HOSTED_ADMISSION_PRODUCER_INVALID',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('hosted-admission-producer.test.mjs: external-floor boot and refresh projection pass');
