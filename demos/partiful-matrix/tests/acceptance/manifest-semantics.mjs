import { createHash } from 'node:crypto';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function manifestSemanticProjection(manifest) {
  return {
    ...manifest,
    claims: manifest.claims.map(({ artifact: _artifact, status: _status, ...claim }) => claim),
  };
}

export function manifestSemanticSha256(manifest) {
  return sha256(JSON.stringify(manifestSemanticProjection(manifest)));
}
