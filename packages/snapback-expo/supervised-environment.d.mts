import type {
  AppBindingV1,
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

export type SupervisedAuthorityRefreshResult =
  | Readonly<{ status: 'ready'; publicFacts: PublicAuthorityFacts }>
  | Readonly<{
      status: 'authority-required';
      diagnostic: SnapbackDiagnostic;
      remediations: readonly TypedRemediation[];
    }>;

export interface SupervisedSnapbackExpoEnvironmentV1 extends SnapbackExpoEnvironmentV1 {
  refreshAuthority(input: Readonly<{
    app: AppDescriptorV1Like;
    binding: AppBindingV1;
    signal: AbortSignal;
  }>): Promise<SupervisedAuthorityRefreshResult>;
}

export function createSupervisedExpoEnvironment(options?: Readonly<{
  exchangeOrigin?: string | null;
  fetch?: typeof globalThis.fetch;
  appState?: AppStateSource;
  resolveAppState?: () => AppStateSource | Promise<AppStateSource>;
  developmentSync?: false | Readonly<Record<string, unknown>>;
  clientOptions?: SnapbackClientOptions;
  onDiagnostic?: (diagnostic: SnapbackDiagnostic) => void;
}>): SupervisedSnapbackExpoEnvironmentV1;

export function resolveSupervisedExpoExchangeOrigin(): string | null;
