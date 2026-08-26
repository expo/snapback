// Type declarations for target-onboarding.mjs — one-time credential
// enrollment for the fresh hosted target identity (stages custody only;
// never updates the legacy product Machine, volume, or route).

export const TARGET_ONBOARDING_VERSION: 'snapback.hosted-target-onboarding.v1';

export interface TargetOnboardingConfig {
  readonly organization: string;
  readonly region: string;
  readonly targetApp: string;
  readonly supervisorApp: string;
  readonly targetId: string;
  readonly deploymentId: string;
  readonly publicOrigin: string;
  readonly keychainService: string;
  readonly tigrisBucket: string;
  readonly tigrisPrefix: string;
  readonly refusalBoundaryMicros: number;
}

export const TARGET_DEFAULTS: TargetOnboardingConfig;

export type TargetTigrisRole =
  | 'artifact'
  | 'backup'
  | 'control-state'
  | 'audit'
  | 'logs'
  | 'cleanup';

export const TARGET_TIGRIS_ROLES: Readonly<Record<TargetTigrisRole, readonly string[]>>;
export const TARGET_TIGRIS_PARTIAL_CREDENTIAL_CODES: Readonly<
  Record<TargetTigrisRole, string>
>;

export function assertTargetTigrisCredentialPair(
  role: TargetTigrisRole | string,
  credentials?: Readonly<{
    accessKeyId?: string | null;
    secretAccessKey?: string | null;
  }>,
): void;

/** `[guestSecretFilePath, flySecretName]` projection pairs for the supervisor Machine. */
export const TARGET_SUPERVISOR_SECRET_FILES: ReadonlyArray<readonly [string, string]>;

export interface TargetRoleIamPolicy {
  readonly Version: '2012-10-17';
  readonly Statement: ReadonlyArray<Readonly<{
    Sid: string;
    Effect: 'Allow';
    Action: readonly string[];
    Resource: string;
  }>>;
}

export function targetRolePolicy(
  config: TargetOnboardingConfig,
  role: string,
  actions: readonly string[],
): TargetRoleIamPolicy;

export interface TargetOnboardingPlan {
  readonly schemaVersion: 'snapback.hosted-target-onboarding.v1';
  readonly config: TargetOnboardingConfig;
  readonly ownershipSentinel: string;
  readonly effects: readonly string[];
  readonly forbiddenEffects: readonly string[];
  readonly refusalBoundaryMicros: number;
  readonly providerEnforcedCap: false;
  readonly planSha256: `sha256:${string}`;
}

export function buildTargetOnboardingPlan(
  options?: Partial<TargetOnboardingConfig>,
): TargetOnboardingPlan;

export interface TigrisRoleIsolationObservation {
  role: TargetTigrisRole | string;
  /** true after an own-prefix read-back; null for roles without s3:GetObject. */
  ownPrefixReadBack: boolean | null;
  wrongRole: string;
  wrongRoleDenied: true;
  /** true/false for write-denial probes; null when the probe did not apply. */
  writeDenied: boolean | null;
  crossPrefixDelete?: true;
  targetPrefixInventory?: true;
  listBucketProviderScope?: 'bucket';
  listBucketCustodySeparated?: true;
}

export interface TargetOnboardingReceipt {
  readonly schemaVersion: 'snapback.hosted-target-onboarding-receipt.v1';
  readonly status: 'staged';
  readonly targetId: string;
  readonly deploymentId: string;
  readonly publicOrigin: string;
  readonly ownershipSentinel: string;
  readonly planSha256: `sha256:${string}`;
  readonly supervisorMachineId: string;
  readonly supervisorMachineVersion: string;
  readonly supervisorRestarted: boolean;
  readonly legacyMachineObservedOnly: string;
  readonly legacyMachineUpdated: false;
  readonly admissionPublicKey: string;
  readonly targetClientCertificateSha256: string;
  /** Secret-free retained credential fingerprints. */
  readonly credentials: Readonly<{
    flyControl: `sha256:${string}`;
    flyRegistry: `sha256:${string}`;
    admissionSigning: `sha256:${string}`;
    outboundMtls: string;
    tigris: Readonly<Record<string, `sha256:${string}`>>;
  }>;
  readonly tigrisRoleIsolation: readonly TigrisRoleIsolationObservation[];
  readonly providerLimitations: Readonly<{
    tigrisCleanupListBucket: Readonly<{
      requestedScope: string;
      enforcedScope: string;
      reason: string;
      mitigation: string;
    }>;
  }>;
  readonly created: Readonly<{
    flyControl: boolean;
    flyRegistry: boolean;
    admissionSigning: boolean;
    outboundMtls: boolean;
    tigrisBootstrapExtracted: boolean;
    tigris: Readonly<Record<string, boolean>>;
    tigrisPoliciesRotated: Readonly<Record<string, boolean>>;
  }>;
  readonly capabilityAdvertised: false;
  readonly blockers: readonly string[];
  readonly receiptSha256: `sha256:${string}`;
}

/**
 * Applies the staged enrollment. `confirmationSha256` must equal the plan's
 * `planSha256`. Requires local Fly/Keychain/openssl/Tigris authority.
 */
export function applyTargetOnboarding(
  plan: TargetOnboardingPlan,
  options: Readonly<{ confirmationSha256: string | null }>,
): Promise<TargetOnboardingReceipt>;
