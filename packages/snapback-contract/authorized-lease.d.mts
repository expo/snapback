import type {
  SnapbackAuthorizationVersion,
  SnapbackIssuerId,
} from './auth-invalidation.mjs';

export const SNAPBACK_AUTHORIZED_LEASE_PROTOCOL_VERSION: 1;
export const SNAPBACK_AUTHORIZED_LEASE_DEFAULT_MS: number;
export const SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS: number;

export interface SnapbackAuthorizedLease {
  readonly protocolVersion: 1;
  readonly leaseId: string;
  readonly leaseRequestId: string;
  readonly issuerId: SnapbackIssuerId;
  readonly clientStoreId: string;
  readonly queryKey: string;
  readonly queryInstanceId: number;
  readonly principalId: string;
  readonly sessionIdAtIssue: string | null;
  readonly providerKey: string | null;
  readonly authorization: SnapbackAuthorizationVersion;
  readonly data: Readonly<{ versionStream: string; snapshotCommitVersion: number }>;
  readonly activationHash: string;
  readonly issuedAtServerMs: number;
  readonly authorizedUntilServerMs: number;
  readonly sessionNotAfterMs: number | null;
  readonly providerNotAfterMs: number | null;
  readonly authorityInstanceId: string | null;
  readonly keyId: string;
  readonly mac: string;
}

export interface SnapbackAuthorizedLeaseRequest {
  readonly leaseRequestId: string;
  readonly queryInstanceId: number;
  readonly queryGeneration: number;
  readonly startedClientMs: number;
}

export interface SnapbackAuthorizedLeaseExpectation {
  readonly clientStoreId: string;
  readonly queryKey: string;
  readonly queryInstanceId: number;
  readonly principalId: string;
  readonly authorization: unknown;
  readonly versionStream: string;
  readonly activationHash: string;
  readonly authorityInstanceId: string | null;
}

export interface SnapbackAuthorizedLeaseCapability {
  readonly protocolVersion: 1;
  readonly defaultMs: number;
  readonly hardMaxMs: number;
  readonly configuredMs: number;
  readonly clamps: readonly ['session', 'provider'];
  readonly renewal: 'full-revalidation';
  readonly timeBasis: 'server-absolute+client-request-elapsed';
  readonly clockRollback: 'delete-before-read';
}

/**
 * Cross-language activation identity binding retained bytes to the exact
 * active schema/function pair. Every field must be a non-empty string.
 */
export function authorizedLeaseActivationHash(input: {
  schemaVersion: string;
  authMode: string;
  appId: string;
  schemaHash: string;
  bundleHash: string;
  inputsHash: string;
}): string;

export function validateAuthorizedLease(value: unknown, path?: string): SnapbackAuthorizedLease;

/** Unkeyed custody hash over the exact issued lease bytes (`sha256:<hex>`). */
export function authorizedLeaseHash(value: unknown): string;

export function deriveAuthorizedLeaseCommit(input: {
  lease: unknown;
  request: SnapbackAuthorizedLeaseRequest;
  expected: SnapbackAuthorizedLeaseExpectation;
  clientNowMs: number;
}): Readonly<{
  lease: SnapbackAuthorizedLease;
  leaseHash: string;
  clientDeadlineMs: number;
}>;

export function validateAuthorizedLeaseCapability(
  value: unknown,
  path?: string,
): SnapbackAuthorizedLeaseCapability;
