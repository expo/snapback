export type VerifyPathKind = 'success' | 'failure' | 'action' | 'relational' | 'search' | 'snapshot-bundle';

export interface VerifyIdentityContext {
  readonly target: { readonly kind: string; readonly identity: string | null };
  readonly data: { readonly kind: string; readonly identity: string | null };
  readonly authority: { readonly kind: string; readonly identity: string | null; readonly principalClass: string };
  readonly seed: { readonly kind: string; readonly identity: string | null };
}

export interface VerifyConformanceReport {
  readonly missingReads: readonly string[];
  readonly missingWrites: readonly string[];
  readonly extraReads: readonly string[];
  readonly extraWrites: readonly string[];
  readonly readProvenance: 'complete' | 'incomplete' | 'unsupported';
  readonly writeProvenance: 'complete' | 'incomplete' | 'unsupported';
}

export interface VerifyConfig {
  readonly schemaVersion: 'snapback.verify-config.v1';
  readonly backendDirectory?: string;
  readonly generatedDirectory?: string;
  readonly coverageRequirement?: 'path-observation' | 'complete-operation-provenance';
  readonly servedTarget?: {
    readonly url: string;
    readonly adminTokenEnv?: string;
    readonly authorityMode?: 'admin-token';
    readonly timeoutMs?: number;
  };
  readonly context?: Partial<VerifyIdentityContext>;
  readonly profiles?: readonly {
    readonly id: string;
    readonly title?: string;
    readonly timeoutMs?: number;
    readonly testFiles?: readonly string[];
    readonly requiredCapabilities?: readonly string[];
    readonly paths?: readonly {
      readonly id: string;
      readonly kind: VerifyPathKind;
      readonly targetProfileId: string;
      readonly functionId?: string | null;
    }[];
    readonly coverageCapability?: {
      readonly claim: 'identity-bound-path-observation';
      readonly baselinePathIds: readonly string[];
    };
    run(context: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  }[];
}

export interface StarterVerifyProfileOptions {
  readonly id: string;
  readonly title?: string;
  readonly acceptanceFile: string | URL;
  readonly additionalTestFiles?: readonly (string | URL)[];
  readonly requiredCapabilities?: readonly string[];
  readonly paths?: readonly {
    readonly id: string;
    readonly kind: VerifyPathKind;
    readonly targetProfileId: string;
    readonly functionId?: string | null;
  }[];
  readonly provenanceBaseline?: readonly string[];
  readonly timeoutMs?: number;
}

export interface CloudflareVerifyProfileOptions extends StarterVerifyProfileOptions {
  readonly proofUrl?: string | null;
  readonly adminToken?: string | null;
  readonly expectedCheckCount?: number;
}

export interface RepositoryVerifyProfilesOptions {
  readonly catalogFile: string | URL;
  readonly repositoryRoot?: string;
  readonly include?: readonly string[] | null;
  readonly timeoutMs?: number;
  readonly runCommand?: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>;
}

export const VERIFY_CONFIG_SCHEMA_VERSION: 'snapback.verify-config.v1';
export const VERIFY_RECEIPT_SCHEMA_VERSION: 'snapback.verify-receipt.v1';
export const VERIFY_CONFIG_CONVENTION: 'snapback.verify.config.mjs';
export const DEFAULT_VERIFY_PROFILE_TIMEOUT_MS: 300000;
export const CLOUDFLARE_ACCEPTANCE_SCHEMA_VERSION: 'snapback.cloudflare-acceptance.v1';
export const VERIFY_STAGE_IDS: readonly string[];
export function defineVerifyConfig<T extends VerifyConfig>(config: T): T;
export function defineStarterVerifyProfile(options: StarterVerifyProfileOptions): NonNullable<VerifyConfig['profiles']>[number];
export function defineCloudflareVerifyProfile(options: CloudflareVerifyProfileOptions): NonNullable<VerifyConfig['profiles']>[number];
export function defineRepositoryVerifyProfiles(options: RepositoryVerifyProfilesOptions): readonly NonNullable<VerifyConfig['profiles']>[number][];
export function loadVerifyConfig(path: string, options?: { readonly backendDirectory?: string | null }): Promise<VerifyConfig>;
export function discoverVerifyConfig(directory?: string): string | null;
export function defaultVerifyConfig(options?: { readonly backendDirectory?: string }): VerifyConfig;
export function probeArtifactFreshness(config: VerifyConfig): Promise<Readonly<Record<string, unknown>>>;
export function probeServedTarget(artifact: Readonly<Record<string, unknown>>, config: VerifyConfig, options?: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
export function probeAdmission(artifact: Readonly<Record<string, unknown>>, servedTarget?: Readonly<Record<string, unknown>> | null): Readonly<Record<string, unknown>>;
export function probeCapabilities(artifact: Readonly<Record<string, unknown>>, profiles: readonly unknown[], servedTarget?: Readonly<Record<string, unknown>> | null): Readonly<Record<string, unknown>>;
export function aggregateConformance(profiles: readonly unknown[], results: readonly unknown[]): Readonly<Record<string, unknown>>;
export function runVerify(config: VerifyConfig, options?: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
export function validateVerifyReceipt(receipt: unknown): Readonly<Record<string, unknown>>;
export function writeVerifyReceipt(path: string, receipt: unknown): string;
