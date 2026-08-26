import type {
  AuthBootstrapSnapshot,
  OutboxDrainOptions,
  PreparedReactBinding,
  SnapbackAppClient,
  SnapbackAppClientPlatform,
  SnapbackAppClientDebugEvent,
  SnapbackAppBindingV1,
  SnapbackApplicationDescriptorV1,
  SnapbackClient,
} from '@expo/snapback-client';
import type { RqsResumeStore as RqsStore } from '@expo/snapback-client/rqs-store';
import type {
  SnapbackDiagnostic,
  SnapbackReactProvider,
} from '@expo/snapback-react';

export * from '@expo/snapback-react';
export type { SnapbackAppClientDebugEvent } from '@expo/snapback-client';
export { useSnapbackActivityPresence } from './activity-presence.mjs';
export {
  adaptExpoAssetSource,
  createExpoAssetSourceAdapter,
  expoAssetFetch,
  resolveExpoFetch,
} from './asset-source.mjs';
export type { ExpoFetchResponseLike, ExpoPickerAssetSource } from './asset-source.mjs';

export const APP_BINDING_FORMAT: 'snapback.app-binding.v1';
export const SNAPBACK_EXPO_INTEGRATION_RECEIPT_FORMAT:
  'snapback.expo-integration-receipt.v1';
export const APPLICATION_AUTH_BOOTSTRAP_CAPABILITY:
  'auth.application-bootstrap.v1';

export type CapabilityOffer = string;

export type AppBindingTargetV1 = Readonly<{
  app: string;
  schema: string;
  functions: string;
  origin: string;
  routing: 'loopback' | 'port-forward' | 'declared-dev' | 'https';
}>;

export type SupervisedDevAppBindingV1 = Readonly<{
  format: 'snapback.app-binding.v1';
  source: 'supervised-dev';
  descriptorIdentity: string;
  target: Readonly<{
    app: string;
    schema: string;
    functions: string;
    origin: string;
    routing: 'loopback' | 'port-forward';
  }>;
  capabilities: Readonly<{ offered: readonly CapabilityOffer[] }>;
  provenance: Readonly<{
    supervisorGeneration: string;
    issuedAt: string;
    expiresAt: string;
  }>;
  integrity: Readonly<{ channel: 'local-supervised-ipc' }>;
}>;

export type ReleaseAppBindingV1 = Readonly<{
  format: 'snapback.app-binding.v1';
  source: 'release';
  descriptorIdentity: string;
  target: Readonly<{
    app: string;
    schema: string;
    functions: string;
    origin: string;
    routing: 'https';
  }>;
  capabilities: Readonly<{ offered: readonly CapabilityOffer[] }>;
  provenance: Readonly<{
    environment: string;
    releaseChannel: string;
    buildReceipt: string;
  }>;
  integrity:
    | Readonly<{ channel: 'signed-artifact'; signature: string }>
    | Readonly<{ channel: 'embedded-at-build' }>;
}>;

export type HostedDevelopmentAppBindingV1 = Readonly<{
  format: 'snapback.app-binding.v1';
  source: 'hosted-development';
  descriptorIdentity: string;
  target: Readonly<{
    app: string;
    schema: string;
    functions: string;
    origin: string;
    routing: 'https';
  }>;
  capabilities: Readonly<{ offered: readonly CapabilityOffer[] }>;
  provenance: Readonly<{ hostedTargetReceipt: string }>;
  integrity: Readonly<{ channel: 'hosted-target-admission' }>;
}>;

export type DeclaredDevAppBindingV1 = Readonly<{
  format: 'snapback.app-binding.v1';
  source: 'declared-dev';
  descriptorIdentity: string;
  target: Readonly<{
    app: string;
    schema: string;
    functions: string;
    origin: string;
    routing: 'declared-dev';
  }>;
  capabilities: Readonly<{ offered: readonly CapabilityOffer[] }>;
  provenance: Readonly<{
    deploymentIdentity: Readonly<{
      schemaVersion: string;
      authMode: string;
      appId: string;
      schemaHash: string;
      bundleHash: string;
      inputsHash: string;
    }>;
  }>;
  integrity: Readonly<{ channel: 'generated-declared-dev' }>;
}>;

export type AppBindingV1 =
  | SupervisedDevAppBindingV1
  | HostedDevelopmentAppBindingV1
  | DeclaredDevAppBindingV1
  | ReleaseAppBindingV1;

export interface AppDescriptorV1Like {
  readonly format: 'snapback.app.v1';
  readonly identity: Readonly<{
    app: string;
    schema: string;
    functions: string;
    descriptor: string;
  }>;
  /** The exact fact plus the bootstrap capability opts into first-party bootstrap. */
  readonly authBootstrap?: SnapbackApplicationDescriptorV1['authBootstrap'];
  readonly api: Readonly<{
    queries: object;
    mutations: object;
    assets: object;
    ephemeral: object;
    queryGroups: object;
  }>;
  readonly commands: Readonly<Record<string, unknown>>;
  readonly surfaces: Readonly<Record<string, unknown>>;
  readonly capabilities: Readonly<{ required: readonly string[] }>;
  readonly declaredDev?: unknown;
}

export interface AppBindingValidationProblem {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type TypedRemediation = Readonly<{
  kind: string;
  riskClass: string;
  machineApplicable: boolean;
  requiresApproval: boolean;
  authorityEffect: string;
  precondition: Readonly<Record<string, unknown>>;
  description: string;
}>;

export type PublicBindingFacts = Readonly<{
  format: 'snapback.app-binding.v1';
  source: 'supervised-dev' | 'hosted-development' | 'declared-dev' | 'release';
  descriptorIdentity: string;
  target: AppBindingTargetV1;
  capabilities: Readonly<{ offered: readonly CapabilityOffer[] }>;
  provenance: AppBindingV1['provenance'];
  integrity: Readonly<{
    channel:
      | 'local-supervised-ipc'
      | 'hosted-target-admission'
      | 'generated-declared-dev'
      | 'signed-artifact'
      | 'embedded-at-build';
  }>;
}>;

export type PublicAuthorityFacts = Readonly<{
  kind: 'session';
  authMode: string;
  sessionId: string | null;
  userId: string | null;
  authorizationStreamIncarnation: string | null;
  authorityInstanceId: string | null;
  sessionGeneration: number | null;
}>;

export type LegacyExpoBootState =
  | Readonly<{ status: 'starting'; stage: 'binding' | 'authority' | 'client' }>
  | Readonly<{
      status: 'ready';
      binding: PublicBindingFacts;
      authority: PublicAuthorityFacts;
      preparation: Readonly<{ source: 'deployment' | 'persisted-receipt' }>;
    }>
  | Readonly<{
      status: 'authority-required';
      diagnostic: SnapbackDiagnostic;
      remediations: readonly TypedRemediation[];
    }>
  | Readonly<{
      status: 'unsupported' | 'error';
      diagnostic: SnapbackDiagnostic;
      remediations: readonly TypedRemediation[];
    }>;

export type FirstPartyExpoBootState =
  | Exclude<AuthBootstrapSnapshot, Readonly<{ status: 'ready' }>>
  | (Extract<AuthBootstrapSnapshot, Readonly<{ status: 'ready' }>> & Readonly<{
      binding: PublicBindingFacts;
      preparation: Readonly<{ source: 'deployment' | 'persisted-receipt' }>;
    }>);

export type ExpoBootState = LegacyExpoBootState | FirstPartyExpoBootState;

export type AppBindingAdmissionEvidenceV1 = Readonly<{
  productionCondition?: boolean;
  delivery?: Readonly<{ channel: 'local-supervised-ipc' | 'release-artifact' }>;
  generatedReleaseTargets?: readonly AppBindingTargetV1[];
  confirmSupervisedIssuance?: (binding: SupervisedDevAppBindingV1) => boolean | Promise<boolean>;
  verifySignedArtifact?: (binding: ReleaseAppBindingV1) => boolean | Promise<boolean>;
  verifyBuildReceipt?: (
    buildReceipt: string,
    binding: ReleaseAppBindingV1,
  ) => boolean | Promise<boolean>;
}>;

export type AuthorityAdoptionResult =
  | Readonly<{
      status: 'ready';
      client: SnapbackClient;
      publicFacts: Readonly<{
        kind: 'session';
        authMode: string;
        sessionId?: string | null;
        userId?: string | null;
        authorizationStreamIncarnation?: string | null;
        authorityInstanceId?: string | null;
        sessionGeneration?: number | null;
      }>;
      dispose?: () => void | Promise<void>;
    }>
  | Readonly<{
      status: 'authority-required';
      diagnostic: SnapbackDiagnostic;
      remediations: readonly TypedRemediation[];
    }>;

export interface AppStateSource {
  readonly currentState?: string | null;
  addEventListener(
    event: 'change',
    listener: (state: string) => void,
  ): { remove(): void } | (() => void);
}

export interface SnapbackExpoEnvironmentV1 {
  readonly format: 'snapback.expo-environment.v1';
  readonly appState?: AppStateSource;
  readonly developmentSync?: false | Readonly<Record<string, unknown>>;
  resolveAppState?(): AppStateSource | Promise<AppStateSource>;
  /** Framework-owned platform resolution for the LLP 0258 opt-in branch. */
  resolveAppClientPlatform?(input: Readonly<{
    app: AppDescriptorV1Like;
  }>): SnapbackAppClientPlatform | Promise<SnapbackAppClientPlatform>;
  /** Narrow host-OS seam used before the evidence-gated native custody load. */
  resolveNativeAuthCustodyOperatingSystem?(): string | Promise<string>;
  /** Test/host seam for the provider-owned hashing-only expo-crypto adapter. */
  resolveNativeAuthDigestModule?(): unknown | Promise<unknown>;
  /** Test/host seams for exact Expo SQLite target-cell resolution. */
  resolveExpoSqliteOperatingSystem?(): string | Promise<string>;
  resolveExpoSqliteRuntimeKind?(): string | Promise<string>;
  resolveExpoSqliteTarget?(): Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>;
  resolveExpoSqliteReactNativeModule?(): unknown | Promise<unknown>;
  resolveExpoDeviceModule?(): unknown | Promise<unknown>;
  resolveExpoSqliteModule?(): unknown | Promise<unknown>;
  resolveExpoFileSystemModule?(): unknown | Promise<unknown>;
  resolveExpoLegacyRqsFiles?(): Readonly<{
    directory: string;
    files: import('@expo/snapback-client/rqs-store-file').RqsFilesAdapter;
    randomBytes?: (length: number) => Uint8Array;
  }> | null | Promise<Readonly<{
    directory: string;
    files: import('@expo/snapback-client/rqs-store-file').RqsFilesAdapter;
    randomBytes?: (length: number) => Uint8Array;
  }> | null>;
  resolveBinding(input: Readonly<{
    app: AppDescriptorV1Like;
    bindingOverride: AppBindingV1 | null;
    signal: AbortSignal;
    url?: string;
  }>): Promise<Readonly<{
    binding: AppBindingV1;
    admission: AppBindingAdmissionEvidenceV1;
  }>> | Readonly<{
    binding: AppBindingV1;
    admission: AppBindingAdmissionEvidenceV1;
  }>;
  adoptAuthority(input: Readonly<{
    app: AppDescriptorV1Like;
    binding: AppBindingV1;
    signal: AbortSignal;
    rqsStore?: unknown;
    adoptSupervisedSession?: boolean;
  }>): Promise<AuthorityAdoptionResult> | AuthorityAdoptionResult;
  /** Supervised carrier handoff used only by the first-party app owner. */
  resolveSupervisedAuthority?(input: Readonly<{
    app: AppDescriptorV1Like;
    binding: AppBindingV1;
    signal: AbortSignal;
    refresh?: boolean;
  }>): Promise<
    | Readonly<{
        status: 'ready';
        bearer: string;
        refreshAfterMs: number;
        binding: AppBindingV1;
        admission: AppBindingAdmissionEvidenceV1;
      }>
    | Readonly<{ status: 'unavailable' }>
    | Readonly<{
        status: 'authority-required';
        diagnostic: SnapbackDiagnostic;
        remediations: readonly TypedRemediation[];
        binding: AppBindingV1;
        admission: AppBindingAdmissionEvidenceV1;
      }>
  >;
  refreshAuthority?(input: Readonly<{
    app: AppDescriptorV1Like;
    binding: AppBindingV1;
    signal: AbortSignal;
    admitBinding(
      candidate: AppBindingV1,
      admission: AppBindingAdmissionEvidenceV1,
    ): Promise<AppBindingV1>;
  }>): Promise<
    | Readonly<{
        status: 'ready';
        publicFacts: PublicAuthorityFacts;
        binding?: AppBindingV1;
        admission?: AppBindingAdmissionEvidenceV1;
      }>
    | Readonly<{
        status: 'authority-required';
        diagnostic: SnapbackDiagnostic;
        remediations: readonly TypedRemediation[];
      }>
  >;
  onDiagnostic?(diagnostic: SnapbackDiagnostic | SnapbackAppClientDebugEvent): void;
}

export function validateAppBindingV1(candidate: unknown): readonly AppBindingValidationProblem[];
export function admitAppBindingV1(
  candidate: unknown,
  app: AppDescriptorV1Like,
  options?: AppBindingAdmissionEvidenceV1 & Readonly<{
    mode?: 'resolved' | 'override';
    now?: number;
  }>,
): Promise<AppBindingV1>;
export function publicBindingFacts(binding: AppBindingV1): PublicBindingFacts;
export function isAppBindingDiagnostic(error: unknown): boolean;

export interface SnapbackExpoBootController {
  getSnapshot(): ExpoBootState;
  subscribe(listener: () => void): () => void;
  start(): Promise<ExpoBootState>;
  refreshAuthority(): Promise<ExpoBootState>;
  reactProvider(): SnapbackReactProvider | null;
  appClient(): SnapbackAppClient | null;
  dispose(): Promise<void>;
}

export const defaultSnapbackExpoEnvironment: SnapbackExpoEnvironmentV1;

export function resolveDefaultExpoSqliteOperatingSystem(options?: Readonly<{
  resolveReactNativeModule?: () => unknown | Promise<unknown>;
}>): Promise<string>;

export function resolveDefaultExpoSqliteTarget(options?: Readonly<{
  operatingSystem?: string | null;
  resolveReactNativeModule?: () => unknown | Promise<unknown>;
  resolveExpoDeviceModule?: () => unknown | Promise<unknown>;
}>): Promise<Readonly<{
  operatingSystem?: string;
  osVersion?: string;
  architecture?: string;
  distribution: 'development' | 'release';
  deviceClass?: 'real-device' | 'emulator' | 'simulator';
  }>>;

export function createSnapbackExpoBoot(options: Readonly<{
  app: AppDescriptorV1Like;
  binding?: AppBindingV1 | null;
  url?: string;
  environment?: SnapbackExpoEnvironmentV1;
  /** Explicit store or null opt-out. Omission requests the evidence-gated
   * default; pending/unqualified target rows resolve to the reported volatile
   * fallback rather than a durable carrier. */
  rqsStore?: RqsStore | null;
  /** Supervised session adoption defaults to `false` on web and `true` on
   * native; an explicit `true` or `false` overrides the platform default. */
  adoptSupervisedSession?: boolean;
  createProvider?: (
    binding: PreparedReactBinding,
    options: Readonly<{ assetSourceAdapter: import('@expo/snapback-client').CommandAssetSourceAdapter }>,
  ) => SnapbackReactProvider;
  bindLifecycle?: (
    appState: AppStateSource,
    provider: Pick<SnapbackReactProvider, 'pause' | 'resume'>,
    options?: Readonly<{ onError?: (error: unknown) => void }>,
  ) => Readonly<{ dispose(): void; settled(): Promise<void> }>;
  createApplicationClient?: (input: Readonly<{
    app: SnapbackApplicationDescriptorV1;
    binding?: SnapbackAppBindingV1;
    url?: string;
    platform: SnapbackAppClientPlatform;
    now?: () => number;
    signal?: AbortSignal;
    rqsStore?: unknown;
  }>, observer: (snapshot: AuthBootstrapSnapshot) => void) => Promise<SnapbackAppClient>;
  adoptSupervisedAuthority?: (
    appClient: SnapbackAppClient,
    input: Readonly<{
      bearer: string;
      binding: SnapbackAppBindingV1;
      refreshAfterMs: number;
      clientOptions?: Readonly<{ devIdentityCapability: string }>;
    }>,
  ) => Promise<Readonly<{ status: 'adopted' | 'rebound' | 'conflict' | 'dropped' }>>;
  now?: () => number;
}>): SnapbackExpoBootController;

export function SnapbackExpoProvider(props: Readonly<{
  app: AppDescriptorV1Like;
  binding?: AppBindingV1 | null;
  url?: string;
  environment?: SnapbackExpoEnvironmentV1;
  /** Explicit store or null opt-out. Omission requests the evidence-gated
   * default; pending/unqualified target rows resolve to the reported volatile
   * fallback rather than a durable carrier. */
  rqsStore?: RqsStore | null;
  /** Supervised session adoption defaults to `false` on web and `true` on
   * native; an explicit `true` or `false` overrides the platform default. */
  adoptSupervisedSession?: boolean;
  fallback?: any | ((state: ExpoBootState) => any);
  children?: any;
  outboxDrain?: 'auto' | 'manual';
  outboxDrainOptions?: Omit<OutboxDrainOptions, 'automatic'>;
}>): any;

export function useSnapbackExpoBootState(): ExpoBootState;
export function isSnapbackExpoBootDiagnostic(error: unknown): boolean;

export {
  SUPERVISED_EXCHANGE_FORMAT,
  SUPERVISED_EXCHANGE_PATH,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH,
  createSupervisedExpoEnvironment,
  resolveSupervisedDevIdentityCheckoutNonce,
  resolveSupervisedExpoExchangeOrigin,
} from './supervised-environment.mjs';
export type {
  SupervisedAuthorityRefreshResult,
  SupervisedBindingCache,
  SupervisedBindingCacheRecord,
  SupervisedSnapbackExpoEnvironmentV1,
} from './supervised-environment.mjs';
