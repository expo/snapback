import assert from 'node:assert/strict';
import {
  canonicalSenderExternalUri,
  createSenderIssuanceProofForCustody,
  createSenderProofForCustody,
  generateSenderConstraintKey,
  isCanonicalSenderNonce,
} from './sender-proof.mjs';

const decode = (value) => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return new Uint8Array(Buffer.from(padded, 'base64'));
};

const custody = await generateSenderConstraintKey();
assert.equal(custody.privateKey.extractable, false);
assert.equal(custody.thumbprint.length, 43);
assert.equal(isCanonicalSenderNonce(custody.thumbprint), true);
assert.equal(isCanonicalSenderNonce(`${custody.thumbprint}=`), false);
assert.equal(isCanonicalSenderNonce(`${'A'.repeat(42)}B`), false);
assert.equal(
  canonicalSenderExternalUri('https://APP.example.test', '/auth/exchange'),
  'https://app.example.test/auth/exchange',
);
for (const path of [
  '//auth/exchange',
  '/auth//exchange',
  '/auth/./exchange',
  '/auth/../exchange',
  '/auth/%2e/exchange',
  String.raw`/auth\exchange`,
  '/auth/exchange?guess=1',
  '/auth/exchange#fragment',
]) {
  assert.throws(
    () => canonicalSenderExternalUri('https://app.example.test', path),
    TypeError,
    `reject ${path}`,
  );
}
const proof = await createSenderProofForCustody({
  ...custody,
  method: 'POST',
  canonicalExternalUri: 'https://app.example.test/query',
  accessToken: 'sbs_test',
  nonce: 'nonce-1',
  issuedAtSeconds: 1_000,
  proofId: new Uint8Array(16).fill(7),
});
const [header, payload, signature] = proof.split('.');
assert.deepEqual(JSON.parse(new TextDecoder().decode(decode(header))), {
  alg: 'ES256',
  jwk: custody.publicJwk,
  typ: 'dpop+jwt',
});
assert.equal(JSON.parse(new TextDecoder().decode(decode(payload))).jti, 'BwcHBwcHBwcHBwcHBwcHBw');
assert.equal(decode(signature).byteLength, 64);
assert.equal(
  await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    custody.publicKey,
    decode(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  ),
  true,
);
await assert.rejects(
  createSenderProofForCustody({
    ...custody,
    method: 'post',
    canonicalExternalUri: 'https://app.example.test/query',
    accessToken: 'sbs_test',
    nonce: 'nonce-1',
    issuedAtSeconds: 1_000,
    proofId: new Uint8Array(16),
  }),
  TypeError,
);

const issuance = await createSenderIssuanceProofForCustody({
  ...custody,
  challengeId: 'challenge-1',
  canonicalExchangeUri: 'https://app.example.test/auth/exchange',
  issuedAtSeconds: 1_000,
  proofId: new Uint8Array(16).fill(8),
});
const [issuanceHeader, issuancePayload, issuanceSignature] = issuance.split('.');
assert.deepEqual(JSON.parse(new TextDecoder().decode(decode(issuancePayload))), {
  challengeId: 'challenge-1',
  htm: 'POST',
  htu: 'https://app.example.test/auth/exchange',
  iat: 1_000,
  jti: 'CAgICAgICAgICAgICAgICA',
  protocol: 'snapback.sender-issuance.v2',
  version: 2,
});
assert.equal(
  await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    custody.publicKey,
    decode(issuanceSignature),
    new TextEncoder().encode(`${issuanceHeader}.${issuancePayload}`),
  ),
  true,
);

console.log('sender-proof.test.mjs: non-extractable ES256 custody and exact proof shape pass');
