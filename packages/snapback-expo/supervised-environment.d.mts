import type {
  AppBindingV1,
  AppBindingAdmissionEvidenceV1,
  AppDescriptorV1Like,
  AppStateSource,
  PublicAuthorityFacts,
  SnapbackDiagnostic,
  SnapbackExpoEnvironmentV1,
  TypedRemediation,
} from './index.mjs';
import type { SnapbackClientOptions } from '@expo/snapback-client';

export const SUPERVISED_EXCHANGE_FORMAT: 'snapback.expo-supervised-exchange.v1';
export const SUPERVISED_EXCHANGE_PATH: '/_snapback/expo/v1/bootstrap';
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH: '/_snapback/expo/v1/dev-identity-checkout';
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER: 'x-snapback-dev-identity-checkout';
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV: 'SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE';

export function resolveSupervisedDevIdentityCheckoutNonce(options?: Readonly<{
  runtimePlatform?: 'native' | 'web';
  /** Protocol-test injection until the first-party native reader lands. */
  nativeLaunchEnvironment?: Readonly<Record<string, string | undefined>> | null;
}>): string | null;

export type SupervisedAuthorityRefreshResult =
  | Readonly<{
      status: 'ready';
      publicFacts: PublicAuthorityFacts;
      binding: AppBindingV1;
      admission: AppBindingAdmissionEvidenceV1;
    }>
  | Readonly<{
      status: 'authority-required';
      diagnostic: SnapbackDiagnostic;
      remediations: readonly TypedRemediation[];
    }>;

export type SupervisedBindingCacheRecord = Readonly<{
  formatVersion: 1;
  binding: AppBindingV1;
  publicFacts: PublicAuthorityFacts;
  savedAt: number;
}>;

export interface SupervisedBindingCache {
  load(): Promise<SupervisedBindingCacheRecord | null>;
  save(record: SupervisedBindingCacheRecord): Promise<void>;
  clear(): Promise<void>;
}

export interface SupervisedSnapbackExpoEnvironmentV1 extends SnapbackExpoEnvironmentV1 {
  resolveSupervisedAuthority(input: Readonly<{
    app: AppDescriptorV1Like;
    binding: AppBindingV1;
    signal: AbortSignal;
    refresh?: boolean;
  }>): Promise<
    | Readonly<{
        status: 'ready';
        bearer: string;
        clientOptions?: Readonly<{ devIdentityCapability: string }>;
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
  resolveDevIdentityCapability(input?: Readonly<{
    signal?: AbortSignal;
  }>): Promise<string | null>;
  refreshAuthority(input: Readonly<{
    app: AppDescriptorV1Like;
    binding: AppBindingV1;
    signal: AbortSignal;
    admitBinding(
      candidate: AppBindingV1,
      admission: AppBindingAdmissionEvidenceV1,
    ): Promise<AppBindingV1>;
  }>): Promise<SupervisedAuthorityRefreshResult>;
}

export function createSupervisedExpoEnvironment(options?: Readonly<{
  exchangeOrigin?: string | null;
  fetch?: typeof globalThis.fetch;
  appState?: AppStateSource;
  resolveAppState?: () => AppStateSource | Promise<AppStateSource>;
  developmentSync?: false | Readonly<Record<string, unknown>>;
  clientOptions?: SnapbackClientOptions;
  runtimePlatform?: 'native' | 'web';
  /** Protocol-test injection until the first-party native reader lands. */
  nativeLaunchEnvironment?: Readonly<Record<string, string | undefined>> | null;
  /** Test/host dependency seams used by the framework-owned SQLite target resolver. */
  resolveExpoSqliteReactNativeModule?: () => unknown | Promise<unknown>;
  resolveExpoDeviceModule?: () => unknown | Promise<unknown>;
  bindingCache?: SupervisedBindingCache | null;
  onDiagnostic?: (diagnostic: SnapbackDiagnostic) => void;
}>): SupervisedSnapbackExpoEnvironmentV1;

export function resolveSupervisedExpoExchangeOrigin(): string | null;
