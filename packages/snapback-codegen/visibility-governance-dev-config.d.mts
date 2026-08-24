import type {
  GovernanceDeploymentIdentity,
} from './visibility-governance.mjs';

export const VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV: 'SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG';
export const VISIBILITY_GOVERNANCE_DEV_TARGET_CLASS: 'repository-local';
export const VISIBILITY_GOVERNANCE_DEV_PROVIDER_PROFILE: 'repository-local-dev-mint-v1';
export const VISIBILITY_GOVERNANCE_DEV_REGISTRATION_FILE: 'visibility-governance-dev.json';
export const VISIBILITY_GOVERNANCE_DEV_REGISTRATION_SCHEMA: 'snapback.visibility-governance-dev-registration.v1';
export const VISIBILITY_GOVERNANCE_DEV_REGISTRY_SCHEMA: 'snapback.visibility-governance-dev-app-registry.v1';

export type VisibilityGovernanceServerProfile = 'dev' | 'demo' | 'test' | 'prod';
export type VisibilityGovernanceEnvironment = Record<string, string | undefined>;

export interface VisibilityGovernanceDevFixtureProfile {
  readonly id: string;
  readonly digest: string;
  readonly targetClassCeiling: 'repository-local';
  readonly principalClass: 'synthetic';
  readonly dataClassification: 'fixture-owned';
}

export interface VisibilityGovernanceDevRegistryEntry {
  readonly appId: string;
  readonly backend: string;
  readonly fixtureProfiles: readonly VisibilityGovernanceDevFixtureProfile[];
}

export interface VisibilityGovernanceDevRegistry {
  readonly root: string;
  readonly path: string;
  readonly apps: readonly VisibilityGovernanceDevRegistryEntry[];
}

export function loadVisibilityGovernanceDevRegistry(repositoryRoot: string): VisibilityGovernanceDevRegistry;
export function resolveRegisteredVisibilityGovernanceDevBackendRoot(input: Readonly<{
  repositoryRoot: string;
  appId: string;
  schemaHash: string;
  functionBundleHash: string;
  generationInputsHash: string;
}>): string;

export interface VisibilityGovernanceDevDeploymentIdentity extends GovernanceDeploymentIdentity {
  readonly backend: string;
  readonly appId: string;
  readonly quarantineHeadDigest: string;
}

export interface VisibilityGovernanceDevVerdict {
  readonly schemaVersion: 'snapback.visibility-governance-update-verdict.v1';
  readonly verdictKind: 'governedUpdateVerdict';
  readonly disposition: 'green';
  readonly providerProfile: 'repository-local-dev-mint-v1';
  readonly eventId: string;
  readonly eventInputDigest: string;
  readonly governedRef: 'refs/snapback/repository-local-dev';
  readonly beforeOid: string;
  readonly afterOid: string;
  readonly observedAt: string;
  readonly comparatorVersion: 'snapback.visibility-governance-comparator.v2';
  readonly deploymentIdentities: readonly VisibilityGovernanceDevDeploymentIdentity[];
  readonly quarantineHeadDigest: string;
  readonly violation: null;
  readonly observerKeyEpoch: string;
  readonly observerKeyDigest: string;
  readonly signature: string;
}

export interface VisibilityGovernanceDevConfig {
  readonly schemaVersion: 'snapback.visibility-governance-target-config.v1';
  readonly sourceOid: string;
  readonly observerKeyEpoch: string;
  readonly observerKeyDigest: string;
  readonly observerPublicKeyBase64: string;
  readonly revokedObserverKeyEpochs: readonly string[];
  readonly quarantineCheckpoint: string;
  readonly targetClass: 'repository-local';
  readonly fixtureProfile?: Readonly<{
    id: string;
    digest: string;
    targetClass: 'repository-local';
    principalClass: 'synthetic';
    dataClassification: 'fixture-owned';
  }>;
  readonly verdict: VisibilityGovernanceDevVerdict;
}

export interface MintedVisibilityGovernanceDevConfig {
  readonly path: string;
  readonly config: VisibilityGovernanceDevConfig;
  readonly backends: readonly string[];
}

export interface MintVisibilityGovernanceDevConfigOptions {
  readonly backendRoot?: string;
  readonly backendRoots?: readonly string[];
  readonly outputPath?: string | null;
  readonly repositoryRoot?: string | null;
  readonly targetClass?: 'repository-local' | string;
  readonly observedAt?: Date;
  readonly skipMissing?: boolean;
}

export function mintVisibilityGovernanceDevConfig(
  options?: MintVisibilityGovernanceDevConfigOptions,
): MintedVisibilityGovernanceDevConfig | null;
export function mintRegisteredVisibilityGovernanceDevConfig(options: Readonly<{
  repositoryRoot: string;
  outputPath?: string | null;
  targetClass?: 'repository-local' | string;
  observedAt?: Date;
}>): MintedVisibilityGovernanceDevConfig | null;

export function resolveVisibilityGovernanceServerProfile(
  environment: Readonly<Record<string, string | undefined>> | null | undefined,
  options?: Readonly<{ loopback?: boolean }>,
): VisibilityGovernanceServerProfile;

export interface VisibilityGovernanceDevEnvironmentResult {
  readonly environment: VisibilityGovernanceEnvironment;
  readonly path: string | null;
  readonly minted: boolean;
  readonly serverProfile: VisibilityGovernanceServerProfile;
}

export function visibilityGovernanceDevEnvironment(options?: Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
  callerEnvironment?: Readonly<Record<string, string | undefined>>;
  backendRoot?: string | null;
  repositoryRoot?: string | null;
  outputPath?: string | null;
  loopback?: boolean;
}>): VisibilityGovernanceDevEnvironmentResult;
