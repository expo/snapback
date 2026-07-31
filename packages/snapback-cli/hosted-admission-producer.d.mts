// Hand-authored declarations for hosted-admission-producer.mjs — the adapter
// boot path that advances the external sender-replay floor and projects the
// authenticated hosted admission and provider-held key into strict files.

import type { HostedAdmission } from './deployment-control.mjs';

/** Monotone floor-advance receipt bound to one boot operation. */
export interface ExternalReplayFloorAdvanceReceipt {
  readonly schemaVersion: 'snapback.external-replay-floor-advance.v1';
  readonly operationId: string;
  readonly deploymentId: string;
  readonly storeIdentitySha256: string;
  readonly previousFloor: number;
  readonly senderReplayEpochFloor: number;
  readonly advancedAtMs: number;
  readonly receiptId: string;
}

export function createExternalReplayFloorAdvanceReceipt(input: {
  readonly operationId: string;
  readonly deploymentId: string;
  readonly storeIdentitySha256: string;
  readonly previousFloor: number;
  readonly senderReplayEpochFloor: number;
  readonly advancedAtMs: number;
}): ExternalReplayFloorAdvanceReceipt;

/** Request handed to the adapter-owned atomic floor-advance store operation. */
export interface ExternalReplayFloorAdvanceRequest {
  readonly schemaVersion: 'snapback.external-replay-floor-advance-request.v1';
  readonly operationId: string;
  readonly deploymentId: string;
  readonly previousFloor: number;
}

/**
 * The static admission facts, without the producer-owned dynamic facts
 * (`senderReplayEpochFloor`, `issuedAtMs`, `expiresAtMs`).
 */
export type HostedAdmissionTemplate = Omit<
  HostedAdmission,
  'senderReplayEpochFloor' | 'issuedAtMs' | 'expiresAtMs'
>;

export interface HostedAdmissionBootProjection {
  readonly schemaVersion: 'snapback.hosted-admission-projection.v1';
  readonly operationId: string;
  readonly deploymentId: string;
  readonly publicOrigin: string;
  readonly keyId: string;
  readonly browserArtifactSha256: string;
  readonly configurationSha256: string;
  readonly supportSha256: string;
  readonly handlerProtocolVersion: 1;
  readonly handlerIncarnation: string;
  readonly senderReplayEpochFloor: number;
  readonly admissionEpoch: number;
  readonly limiterEpoch: number;
  readonly invalidationEpoch: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly externalFloorStoreIdentitySha256: string;
  readonly externalFloorAdvanceReceiptId: string;
  readonly envelopeSha256: string;
  readonly keyProjectionCreated: true;
  readonly remoteEvidence: false;
  readonly projectionId: string;
}

/**
 * Advance the external replay floor, seal the admission envelope, and create
 * the owner-only key and envelope projection files for one boot.
 */
export function prepareHostedAdmissionBoot(options: {
  readonly operationId?: string;
  readonly previousSenderReplayEpochFloor: number;
  readonly advanceExternalReplayFloor: (
    request: ExternalReplayFloorAdvanceRequest,
  ) => ExternalReplayFloorAdvanceReceipt | Promise<ExternalReplayFloorAdvanceReceipt>;
  readonly admissionTtlMs?: number;
  readonly admissionTemplate: HostedAdmissionTemplate;
  readonly browserArtifactSha256: string;
  readonly envelopePath: string;
  readonly keyPath: string;
  readonly keyMaterial: Uint8Array;
  readonly keyId: string;
  readonly publicOrigin: string;
  readonly clock?: () => number;
}): Promise<HostedAdmissionBootProjection>;

export interface HostedAdmissionRefreshProjection {
  readonly schemaVersion: 'snapback.hosted-admission-refresh.v1';
  readonly deploymentId: string;
  readonly publicOrigin: string;
  readonly keyId: string;
  readonly configurationSha256: string;
  readonly supportSha256: string;
  readonly handlerProtocolVersion: 1;
  readonly handlerIncarnation: string;
  readonly senderReplayEpochFloor: number;
  readonly admissionEpoch: number;
  readonly limiterEpoch: number;
  readonly invalidationEpoch: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly envelopeSha256: string;
  readonly remoteEvidence: false;
  readonly refreshId: string;
}

/**
 * Authenticate the current envelope with the provider key, then replace it
 * atomically with a monotonically newer issued/expiry (and optional epochs).
 */
export function refreshHostedAdmissionProjection(options: {
  readonly admissionTtlMs?: number;
  readonly envelopePath: string;
  readonly keyMaterial: Uint8Array;
  readonly keyId: string;
  readonly publicOrigin: string;
  readonly admissionEpoch?: number;
  readonly limiterEpoch?: number;
  readonly invalidationEpoch?: number;
  readonly clock?: () => number;
}): HostedAdmissionRefreshProjection;
