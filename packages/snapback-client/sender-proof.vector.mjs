import {
  createSenderProofForCustody,
  generateSenderConstraintKey,
} from './sender-proof.mjs';

const custody = await generateSenderConstraintKey();
const method = 'POST';
const canonicalExternalUri = 'https://app.example.test/query';
const accessToken = 'sbs_cross_language_fixture';
const nonce = 'nonce-cross-language';
const issuedAtSeconds = 1_750_000_000;
const proof = await createSenderProofForCustody({
  ...custody,
  method,
  canonicalExternalUri,
  accessToken,
  nonce,
  issuedAtSeconds,
  proofId: new Uint8Array(16).fill(23),
});
process.stdout.write(`${JSON.stringify({
  proof,
  method,
  canonicalExternalUri,
  accessToken,
  nonce,
  issuedAtSeconds,
  thumbprint: custody.thumbprint,
})}\n`);

