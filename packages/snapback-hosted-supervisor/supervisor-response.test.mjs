import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign,
} from 'node:crypto';

import {
  __operatorAuthorityTest,
  operatorRequestBodySha256,
  operatorRequestSigningBytes,
} from './operator-authority.mjs';
import {
  __supervisorResponseTest,
  createExternalSupervisorResponseSigner,
  createSupervisorResponseSigner,
  verifySupervisorResponse,
} from './supervisor-response.mjs';

const nowMs = 1_800_000_000_000;
const digest = (character) => `sha256:${character.repeat(64)}`;
const rawPublic = (key) => key.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
const { privateKey: rootPrivate, publicKey: rootPublic } = generateKeyPairSync('ed25519');
const { privateKey: responsePrivate, publicKey: responsePublic } = generateKeyPairSync('ed25519');
const { privateKey: devicePrivate } = generateKeyPairSync('ed25519');

const intermediateContent = {
  schemaVersion: __supervisorResponseTest.INTERMEDIATE_VERSION,
  installationId: 'installation-a',
  intermediateKeyId: 'response-key-a',
  publicKeyEd25519: rawPublic(responsePublic),
  purpose: 'supervisor-response',
  serial: 1,
  revocationGeneration: 1,
  issuedAt: new Date(nowMs - 1_000).toISOString(),
  notBefore: new Date(nowMs - 1_000).toISOString(),
  expiresAt: new Date(nowMs + 60_000).toISOString(),
  rootKeyId: 'root-a',
};
const intermediate = {
  ...intermediateContent,
  signature: sign(
    null,
    Buffer.concat([
      __supervisorResponseTest.INTERMEDIATE_DOMAIN,
      Buffer.from(JSON.stringify(intermediateContent, Object.keys(intermediateContent).sort())),
    ]),
    rootPrivate,
  ).toString('base64url'),
};

// JSON.stringify with a replacer does not recursively canonicalize. Re-sign
// using the exact exported authority canonicalizer through the signer helper's
// contract vector.
import { canonicalAuthorityJson } from './operator-authority.mjs';
intermediate.signature = sign(
  null,
  Buffer.concat([
    __supervisorResponseTest.INTERMEDIATE_DOMAIN,
    Buffer.from(canonicalAuthorityJson(intermediateContent)),
  ]),
  rootPrivate,
).toString('base64url');

const requestBody = { schemaVersion: 'fixture.body.v1', value: 'safe' };
const request = {
  schemaVersion: __operatorAuthorityTest.REQUEST_SCHEMA_VERSION,
  installationId: 'installation-a',
  rootKeyId: 'root-a',
  deviceId: 'device-a',
  deviceKeyId: 'device-key-a',
  subject: 'operator@example.test',
  operatorCertificateSha256: digest('a'),
  certificateExpiresAtMs: nowMs + 20_000,
  certificateRevocationGeneration: 1,
  observedRevocationGeneration: 1,
  sequence: 1,
  requestId: 'request-a',
  variant: 'deploy.apply',
  scope: 'deploy.apply',
  targetHeadSha256: digest('b'),
  bodySha256: operatorRequestBodySha256(requestBody),
  body: requestBody,
  credentialBearing: false,
  issuedAtMs: nowMs - 100,
  expiresAtMs: nowMs + 10_000,
  signature: '',
};
request.signature = sign(
  null,
  operatorRequestSigningBytes(request),
  devicePrivate,
).toString('base64url');

const signer = createSupervisorResponseSigner({
  intermediate,
  privateKeyPem: responsePrivate.export({ format: 'pem', type: 'pkcs8' }),
  rootPublicKeyPem: rootPublic.export({ format: 'pem', type: 'spki' }),
  installationId: 'installation-a',
  rootKeyId: 'root-a',
});
assert.equal(signer.assertReady(nowMs), true);
let purposeHead = {
  purpose: 'supervisor-response',
  rootKeyId: intermediate.rootKeyId,
  intermediateKeyId: intermediate.intermediateKeyId,
  serial: intermediate.serial,
  revocationGeneration: intermediate.revocationGeneration,
  expiresAt: intermediate.expiresAt,
};
const custodySigner = createExternalSupervisorResponseSigner({
  intermediate,
  signResponseBytes: (bytes) => sign(null, bytes, responsePrivate),
  rootPublicKeyPem: rootPublic.export({ format: 'pem', type: 'spki' }),
  installationId: 'installation-a',
  rootKeyId: 'root-a',
  readCurrentIntermediateHead: () => purposeHead,
});
assert.equal(custodySigner.assertReady(nowMs), true);
purposeHead = { ...purposeHead, serial: 2 };
assert.throws(
  () => custodySigner.assertReady(nowMs),
  (error) => error.code === 'SNAPBACK_SUPERVISOR_RESPONSE_AUTHORITY_HEAD_DRIFT',
);
purposeHead = { ...purposeHead, serial: intermediate.serial };
assert.throws(
  () => signer.assertReady(Date.parse(intermediate.expiresAt)),
  (error) => error.code === 'SNAPBACK_SUPERVISOR_RESPONSE_INTERMEDIATE_EXPIRED',
);

const response = signer.signResponse({
  request,
  body: {
    schemaVersion: __supervisorResponseTest.RESPONSE_BODY_VERSION,
    ok: true,
    result: { terminal: 'notApplied' },
    diagnostic: null,
  },
  supervisorIncarnation: 'incarnation-a',
  supervisorGeneration: 7,
  supervisorHeadSha256: digest('c'),
  nowMs,
});
assert.deepEqual(
  Object.keys(response).sort(),
  [...__supervisorResponseTest.RESPONSE_KEYS].sort(),
);
assert.equal(verifySupervisorResponse(response, {
  rootPublicKeyPem: rootPublic.export({ format: 'pem', type: 'spki' }),
  expectedInstallationId: 'installation-a',
  expectedRootKeyId: 'root-a',
  expectedRequest: request,
  nowMs,
}).requestId, request.requestId);

assert.throws(
  () => verifySupervisorResponse({
    ...response,
    body: { ...response.body, result: { terminal: 'applied' } },
  }, {
    rootPublicKeyPem: rootPublic.export({ format: 'pem', type: 'spki' }),
    expectedInstallationId: 'installation-a',
    expectedRootKeyId: 'root-a',
    expectedRequest: request,
    nowMs,
  }),
  (error) => error.code === 'SNAPBACK_SUPERVISOR_RESPONSE_BODY_MISMATCH',
);
assert.throws(
  () => createSupervisorResponseSigner({
    intermediate: { ...intermediate, purpose: 'operator-enrollment' },
    privateKeyPem: responsePrivate.export({ format: 'pem', type: 'pkcs8' }),
    rootPublicKeyPem: rootPublic.export({ format: 'pem', type: 'spki' }),
    installationId: 'installation-a',
    rootKeyId: 'root-a',
  }).assertReady(nowMs),
  (error) => error.code === 'SNAPBACK_SUPERVISOR_RESPONSE_INTERMEDIATE_INVALID',
);
assert.equal(verifySupervisorResponse(response, {
  rootPublicKeyPem: rootPublic.export({ format: 'pem', type: 'spki' }),
  expectedInstallationId: 'installation-a',
  expectedRootKeyId: 'root-a',
  expectedRequest: request,
  nowMs: nowMs + 120_000,
  allowHistorical: true,
}).requestId, request.requestId);

console.log('supervisor response signing tests passed');
