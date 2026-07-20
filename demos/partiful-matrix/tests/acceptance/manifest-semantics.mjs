import { createHash } from 'node:crypto';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function manifestSemanticProjection(manifest) {
  return {
    ...manifest,
    claims: manifest.claims.map(({ artifact: _artifact, status: _status, ...claim }) => ({
      ...claim,
      // @ref LLP 0063#sequence — the cumulative manifest fills executable
      // evidence after Step 0. A later-step command is evidence metadata, not
      // a workload or comparison-method change; normalize it to the frozen
      // pending value so closing a claim cannot rebaseline the program.
      ...(claim.step > 0 ? { command: null } : {}),
    })),
  };
}

export function manifestSemanticSha256(manifest) {
  return sha256(JSON.stringify(manifestSemanticProjection(manifest)));
}
