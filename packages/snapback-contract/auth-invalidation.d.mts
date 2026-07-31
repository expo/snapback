export const SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION: 1;
export const AUTH_INVALIDATION_REFIRE_MAX_MS: number;

export type SnapbackAuthDisposition = 'retain' | 'quarantine' | 'delete';

export interface SnapbackAuthorizationVersion {
  readonly incarnation: string;
  readonly epoch: number;
}

export interface SnapbackDataWitness {
  readonly versionStream: string;
  readonly minCommitVersion: number;
}

export interface SnapbackCompositeWitness {
  readonly authorization: SnapbackAuthorizationVersion;
  readonly data: SnapbackDataWitness | null;
}

export interface SnapbackIssuerId {
  readonly authorizationIncarnation: string;
  readonly bootSequence: number;
  readonly bootNonce: string;
}

export interface SnapbackAuthenticatedBootIssuer {
  readonly issuerId: SnapbackIssuerId;
  readonly keyId: string;
  readonly mac: string;
}

export interface SnapbackQueryNamespace {
  readonly clientStoreId: string;
  readonly queryKey: string;
  readonly queryInstanceId: number;
}

export type SnapbackScopeId =
  | Readonly<{
      kind: 'subscription';
      issuerId: SnapbackIssuerId;
      namespace: SnapbackQueryNamespace;
      scopeSequence: number;
      connectionGeneration: number;
      subscriptionId: string;
    }>
  | Readonly<{
      kind: 'connection';
      issuerId: SnapbackIssuerId;
      connectionGeneration: number;
    }>
  | Readonly<{
      kind: 'clientQuery';
      namespace: SnapbackQueryNamespace;
    }>;

export interface SnapbackScopeRetirement {
  readonly issuerId: SnapbackIssuerId;
  readonly namespace: SnapbackQueryNamespace;
  readonly retireThroughScopeSequence: number;
  readonly authorizationExpectation: SnapbackAuthorizationVersion;
  readonly mac: string;
}

export interface SnapbackIssuerRetirement {
  readonly currentIssuer: SnapbackAuthenticatedBootIssuer;
  readonly retireThroughBootSequence: number;
  readonly authorizationExpectation: SnapbackAuthorizationVersion;
  readonly mac: string;
}

export interface SnapbackAuthorizationInvalidationConnection {
  readonly protocolVersion: 1;
  readonly issuerId: SnapbackIssuerId;
  readonly connectionGeneration: number;
  readonly authorization: SnapbackAuthorizationVersion;
  readonly versionStream: string;
  readonly issuerRetirement?: SnapbackIssuerRetirement | null;
}

export interface SnapbackResyncObligation {
  readonly protocolVersion: 1;
  readonly scopeId: SnapbackScopeId;
  readonly revision: number;
  readonly maxDisposition: SnapbackAuthDisposition;
  readonly witness: SnapbackCompositeWitness;
  readonly retryEpisodeId: string | null;
  readonly ownerContinuityId?: string;
}

export interface SnapbackResolutionTicket {
  readonly protocolVersion: 1;
  readonly kind: 'snapshot' | 'terminalDelete';
  readonly scopeId: SnapbackScopeId;
  readonly revision: number;
  readonly witness: SnapbackCompositeWitness;
  readonly maxDisposition: SnapbackAuthDisposition;
  readonly ackToken: string;
  readonly ownerContinuityId?: string;
}

export function validateAuthorizationVersion(
  value: unknown,
  path?: string,
): SnapbackAuthorizationVersion;
export function validateDataWitness(value: unknown, path?: string): SnapbackDataWitness | null;
export function validateCompositeWitness(value: unknown, path?: string): SnapbackCompositeWitness;
export function validateIssuerId(value: unknown, path?: string): SnapbackIssuerId;
export function validateAuthenticatedBootIssuer(
  value: unknown,
  path?: string,
): SnapbackAuthenticatedBootIssuer;
export function validateQueryNamespace(value: unknown, path?: string): SnapbackQueryNamespace;
export function validateScopeId(value: unknown, path?: string): SnapbackScopeId;
export function validateScopeRetirement(value: unknown, path?: string): SnapbackScopeRetirement;
export function validateIssuerRetirement(value: unknown, path?: string): SnapbackIssuerRetirement;
export function validateAuthorizationInvalidationConnection(
  value: unknown,
  path?: string,
): SnapbackAuthorizationInvalidationConnection;

/** Canonical JSON key over a validated scope id. */
export function scopeKey(scope: unknown): string;

export function validateResyncObligation(value: unknown, path?: string): SnapbackResyncObligation;

/**
 * Merge a received level-triggered obligation into one exact scope.
 * `obligation` is non-null whenever `status` is `'accepted'` or `'duplicate'`.
 */
export function mergeResyncObligation(
  existingValue: unknown,
  incomingValue: unknown,
  expectationValue: unknown,
): Readonly<{
  status: 'accepted' | 'duplicate' | 'stale-expectation';
  obligation: SnapbackResyncObligation | null;
}>;

export function validateResolutionTicket(value: unknown, path?: string): SnapbackResolutionTicket;

export function resolutionSatisfies(obligationValue: unknown, resolutionValue: unknown): boolean;

export function effectiveDisposition(
  pendingByScope: Readonly<Record<string, unknown>> | null | undefined,
): SnapbackAuthDisposition;

export function nextQueryInstanceId(highWater: number): number;
export function nextInvalidationGeneration(generation: number, field?: string): number;
