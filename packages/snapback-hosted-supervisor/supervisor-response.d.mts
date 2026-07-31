// Type declarations for supervisor-response.mjs — closed, purpose-bound
// SupervisorResponseV1 signing and verification through the exact
// `supervisor-response` service-intermediate chain.

import type { SupervisorRequestV1 } from './operator-authority.mjs';

export class SupervisorResponseRefusal extends Error {
  constructor(code: string, message: string, status?: number);
  name: 'SupervisorResponseRefusal';
  code: string;
  status: number;
}

/** The closed `snapback.supervisor-service-intermediate.v1` shape. */
export interface SupervisorServiceIntermediateV1 {
  readonly schemaVersion: 'snapback.supervisor-service-intermediate.v1';
  readonly installationId: string;
  readonly rootKeyId: string;
  readonly purpose: 'supervisor-response';
  readonly intermediateKeyId: string;
  readonly serial: number;
  readonly revocationGeneration: number;
  readonly issuedAt: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly publicKeyEd25519: string;
  readonly signature: string;
}

export type SupervisorResponseBodyV1 =
  | Readonly<{
      schemaVersion: 'snapback.supervisor-response-body.v1';
      ok: true;
      result: unknown;
      diagnostic: null;
    }>
  | Readonly<{
      schemaVersion: 'snapback.supervisor-response-body.v1';
      ok: false;
      result: unknown;
      diagnostic: Readonly<{ code: string; message: string; status: number }>;
    }>;

/** The closed `snapback.supervisor-response.v1` shape (exact field set). */
export interface SupervisorResponseV1 {
  readonly schemaVersion: 'snapback.supervisor-response.v1';
  readonly audience: 'snapback-operator';
  readonly installationId: string;
  readonly supervisorIncarnation: string;
  readonly supervisorGeneration: number;
  readonly supervisorHeadSha256: string;
  readonly requestId: string;
  readonly requestSha256: string;
  readonly operatorCertificateSha256: string;
  readonly targetHeadSha256: string | null;
  readonly bodySha256: string;
  readonly body: SupervisorResponseBodyV1;
  readonly issuedAt: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly keyId: string;
  readonly serviceIntermediate: SupervisorServiceIntermediateV1;
  readonly signature: string;
}

/** The current purpose head the signer must exactly match before signing. */
export interface SupervisorResponseIntermediateHead {
  readonly purpose: 'supervisor-response';
  readonly rootKeyId: string;
  readonly intermediateKeyId: string;
  readonly serial: number;
  readonly revocationGeneration: number;
  readonly expiresAt: string;
}

export interface SupervisorResponseSigner {
  assertReady(nowMs?: number): true;
  signResponse(input: {
    request: SupervisorRequestV1;
    body: SupervisorResponseBodyV1;
    supervisorIncarnation: string;
    supervisorGeneration: number;
    supervisorHeadSha256: string;
    nowMs?: number;
  }): SupervisorResponseV1;
}

/**
 * Production signer: the Ed25519 private key stays behind the native custody
 * callback and never enters JS.
 */
export function createExternalSupervisorResponseSigner(options: {
  intermediate: SupervisorServiceIntermediateV1;
  signResponseBytes: (bytes: Uint8Array) => Uint8Array | string;
  rootPublicKeyPem: string | Uint8Array;
  installationId: string;
  rootKeyId: string;
  readCurrentIntermediateHead: () => SupervisorResponseIntermediateHead;
}): SupervisorResponseSigner;

/** Fixture/offline helper that holds the intermediate private key in-process. */
export function createSupervisorResponseSigner(options: {
  intermediate: SupervisorServiceIntermediateV1;
  privateKeyPem: string | Uint8Array;
  rootPublicKeyPem: string | Uint8Array;
  installationId: string;
  rootKeyId: string;
  readCurrentIntermediateHead?: () => SupervisorResponseIntermediateHead;
}): SupervisorResponseSigner;

/**
 * Verifies an untrusted response against the root, intermediate chain, body
 * digest, validity windows, and (optionally) the exact originating request;
 * returns a structured clone of the verified response.
 */
export function verifySupervisorResponse(response: unknown, options: {
  rootPublicKeyPem: string | Uint8Array;
  expectedInstallationId: string;
  expectedRootKeyId: string;
  expectedRequest?: SupervisorRequestV1;
  nowMs?: number;
  allowHistorical?: boolean;
}): SupervisorResponseV1;

export const __supervisorResponseTest: Readonly<{
  INTERMEDIATE_DOMAIN: Uint8Array;
  INTERMEDIATE_KEYS: readonly string[];
  INTERMEDIATE_VERSION: 'snapback.supervisor-service-intermediate.v1';
  MAX_RESPONSE_MS: number;
  RESPONSE_BODY_KEYS: readonly string[];
  RESPONSE_BODY_VERSION: 'snapback.supervisor-response-body.v1';
  RESPONSE_DOMAIN: Uint8Array;
  RESPONSE_KEYS: readonly string[];
  RESPONSE_VERSION: 'snapback.supervisor-response.v1';
}>;
