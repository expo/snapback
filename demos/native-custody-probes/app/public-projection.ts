import type { SnapbackAuthCustodyRecord } from '@expo/snapback-contract/auth-coordinator';
import { sha256 } from './sha256';

export function diagnosticCode(error: unknown): string {
  const candidate = error as { code?: unknown; diagnostic?: { code?: unknown } } | null;
  const code = candidate?.diagnostic?.code ?? candidate?.code;
  return typeof code === 'string' ? code : 'SNAPBACK_NATIVE_PROBE_FAILED';
}

export function publicError(error: unknown) {
  const code = diagnosticCode(error);
  // Typed diagnostic details are non-secret facts (hostnames, codes,
  // classifications) and are required to triage on-device refusals; bearer
  // material never travels through diagnostic details by contract.
  const candidate = error as {
    details?: unknown;
    diagnostic?: { details?: unknown };
  } | null;
  const rawDetails = candidate?.diagnostic?.details ?? candidate?.details;
  let details: unknown = null;
  try {
    details = rawDetails === undefined ? null : JSON.parse(JSON.stringify(rawDetails));
  } catch {
    details = 'unserializable';
  }
  return Object.freeze({
    code,
    message: `Native custody probe refused with ${code}.`,
    ...(details === null ? {} : { details }),
  });
}

export function publicCustodyFacts(record: SnapbackAuthCustodyRecord | null) {
  if (record === null) {
    return Object.freeze({
      revision: null,
      epoch: null,
      phase: null,
      bearerSha256: null,
      principalId: null,
    });
  }
  return Object.freeze({
    revision: record.revision,
    epoch: record.authorityEpoch,
    phase: record.phase,
    bearerSha256: sha256(record.bearer),
    principalId: record.authority?.kind === 'session' ? record.authority.userId : null,
  });
}
