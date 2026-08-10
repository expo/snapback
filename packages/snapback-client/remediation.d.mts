export type RemediationKindV1 =
  | 'fixTypo'
  | 'replaceIdentifier'
  | 'regenerateArtifacts'
  | 'requestGrant'
  | 'useDifferentPrincipal';

export interface RemediationItemV1 {
  readonly kind: RemediationKindV1;
  readonly riskClass: 'mechanical' | 'authority-widening' | 'authority-sensitive';
  readonly machineApplicable: boolean;
  readonly requiresApproval: boolean;
  readonly authorityEffect: 'none' | 'widens' | 'changes-effective-principal';
  readonly precondition: Readonly<Record<string, unknown>> & { readonly type: string };
  readonly action: Readonly<Record<string, unknown>> & { readonly type: string };
}

export interface RemediationSetV1 {
  readonly schemaVersion: 'snapback.remediation-set.v1';
  readonly registryVersion: 'snapback.remediation-kinds.v1';
  readonly artifactHash?: string;
  readonly items: readonly RemediationItemV1[];
}

export const REMEDIATION_SET_SCHEMA_VERSION: 'snapback.remediation-set.v1';
export const REMEDIATION_KIND_REGISTRY_VERSION: 'snapback.remediation-kinds.v1';
export const REMEDIATION_SET_MAX_ITEMS: 8;

export function decodeRemediationSet(details: unknown): RemediationSetV1 | null;
export function createIdentifierRemediationSet(input: {
  artifactHash: string;
  target: string;
  owner?: string;
  replacements: Iterable<string>;
}): RemediationSetV1;
export const remediationControlCatalogProjection: Readonly<{
  carrier: 'diagnostic.details.remediationSet';
  schemaVersion: 'snapback.remediation-set.v1';
  registryVersion: 'snapback.remediation-kinds.v1';
  decoder: '@expo/snapback-client/remediation';
}>;
