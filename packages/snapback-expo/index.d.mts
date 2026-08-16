import type {
  OutboxDrainOptions,
  PreparedReactBinding,
  SnapbackClient,
} from '@expo/snapback-client';
import type {
  SnapbackDiagnostic,
  SnapbackReactProvider,
} from '@expo/snapback-react';

export * from '@expo/snapback-react';
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

export type CapabilityOffer = string;

export type AppBindingTargetV1 = Readonly<{
  app: string;
  schema: string;
  functions: string;
  origin: string;
  routing: 'loopback' | 'port-forward' | 'https';
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

export type AppBindingV1 = SupervisedDevAppBindingV1 | ReleaseAppBindingV1;

export interface AppDescriptorV1Like {
  readonly format: 'snapback.app.v1';
  readonly identity: Readonly<{
    app: string;
    schema: string;
    functions: string;
    descriptor: string;
  }>;
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
  source: 'supervised-dev' | 'release';
  descriptorIdentity: string;
  target: AppBindingTargetV1;
  capabilities: Readonly<{ offered: readonly CapabilityOffer[] }>;
  provenance: AppBindingV1['provenance'];
  integrity: Readonly<{
    channel: 'local-supervised-ipc' | 'signed-artifact' | 'embedded-at-build';
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

export type ExpoBootState =
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
  resolveBinding(input: Readonly<{
    app: AppDescriptorV1Like;
    bindingOverride: AppBindingV1 | null;
    signal: AbortSignal;
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
  }>): Promise<AuthorityAdoptionResult> | AuthorityAdoptionResult;
  refreshAuthority?(input: Readonly<{
    app: AppDescriptorV1Like;
    binding: AppBindingV1;
    signal: AbortSignal;
  }>): Promise<
    | Readonly<{ status: 'ready'; publicFacts: PublicAuthorityFacts }>
    | Readonly<{
        status: 'authority-required';
        diagnostic: SnapbackDiagnostic;
        remediations: readonly TypedRemediation[];
      }>
  >;
  onDiagnostic?(diagnostic: SnapbackDiagnostic): void;
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
  dispose(): Promise<void>;
}

export const defaultSnapbackExpoEnvironment: SnapbackExpoEnvironmentV1;

export function createSnapbackExpoBoot(options: Readonly<{
  app: AppDescriptorV1Like;
  binding?: AppBindingV1 | null;
  environment?: SnapbackExpoEnvironmentV1;
  createProvider?: (
    binding: PreparedReactBinding,
    options: Readonly<{ assetSourceAdapter: import('@expo/snapback-client').CommandAssetSourceAdapter }>,
  ) => SnapbackReactProvider;
  bindLifecycle?: (
    appState: AppStateSource,
    provider: Pick<SnapbackReactProvider, 'pause' | 'resume'>,
    options?: Readonly<{ onError?: (error: unknown) => void }>,
  ) => Readonly<{ dispose(): void; settled(): Promise<void> }>;
  now?: () => number;
}>): SnapbackExpoBootController;

export function SnapbackExpoProvider(props: Readonly<{
  app: AppDescriptorV1Like;
  binding?: AppBindingV1 | null;
  environment?: SnapbackExpoEnvironmentV1;
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
  createSupervisedExpoEnvironment,
  resolveSupervisedExpoExchangeOrigin,
} from './supervised-environment.mjs';
export type {
  SupervisedAuthorityRefreshResult,
  SupervisedBindingCache,
  SupervisedBindingCacheRecord,
  SupervisedSnapbackExpoEnvironmentV1,
} from './supervised-environment.mjs';
