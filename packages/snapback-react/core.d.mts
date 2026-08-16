import type {
  AuthBootstrapSnapshot,
  CurrentPrincipalSnapshot,
  PreparedReactBinding,
  PreparedReactQueryGroup,
  SnapbackAppBindingV1,
  SnapbackAppClient,
  SnapbackAppClientPlatform,
  SnapbackApplicationDescriptorV1,
  SnapbackAuthFacade,
} from '@expo/snapback-client';
import type {
  SnapbackDiagnostic,
  SnapbackReactCoreProvider,
} from './index.mjs';

export {
  invokeSnapbackMutation,
  observeSnapbackDiagnostics,
  observeSnapbackOptimisticCreate,
  observeSnapbackOutbox,
  observeSnapbackPresence,
  observeSnapbackQueries,
  projectRecordFields,
  skip,
  useEphemeralRepublisher,
  useSnapbackConnection,
  useSnapbackDiagnostics,
  useSnapbackMutation,
  useSnapbackActivityPresence,
  useSnapbackOptimisticCreate,
  useSnapbackOutbox,
  useSnapbackPresence,
  useSnapbackQueries,
  useSnapbackQuery,
  useSnapbackSettledMutation,
} from './index.mjs';

export type {
  ConnectionEphemeralCollectionReference,
  MutationReference,
  OptimisticCreateEntity,
  OptimisticCreateProvisionalFields,
  PresenceActions,
  ActivityPresenceOptions,
  ActivityPresenceState,
  PresenceEntry,
  PresenceState,
  PublisherState,
  QueryEntry,
  QueryEntryMap,
  QueryGroupState,
  QueryReference,
  QueryState,
  QueryStates,
  SnapbackConnection,
  SnapbackConnectionState,
  SnapbackDiagnostic,
  SnapbackDiagnosticsObserver,
  SnapbackDiagnosticsSnapshot,
  SnapbackFreshness,
  SnapbackOptimisticCreateObserver,
  SnapbackOutboxHandle,
  SnapbackOutboxObserver,
  SnapbackOutboxState,
  SnapbackPresenceObserver,
  SnapbackQueryGroupObserver,
  SnapbackReactCoreProvider as SnapbackReactProvider,
  SnapbackRetention,
} from './index.mjs';

export function createSnapbackReactProvider(
  binding: PreparedReactBinding,
  options?: Readonly<{
    connectionId?: string;
    onDiagnostic?: (diagnostic: SnapbackDiagnostic) => void;
    preparedGroup?: PreparedReactQueryGroup;
    developmentHmr?: Readonly<{
      timeoutMs?: number;
      pollIntervalMs?: number;
      onReloadRequired?: (failure: SnapbackDiagnostic) => void;
    }>;
  }>,
): SnapbackReactCoreProvider;

type SnapbackCoreProviderSharedProps = Readonly<{
  children?: any;
  fallback?: any | ((state: AuthBootstrapSnapshot) => any);
}>;

export type SnapbackProviderProps = SnapbackCoreProviderSharedProps & (
  | Readonly<{
      appClient: SnapbackAppClient;
      app?: never;
      binding?: never;
      platform?: never;
      storagePartition?: never;
      provider?: never;
    }>
  | Readonly<{
      app: SnapbackApplicationDescriptorV1;
      binding: SnapbackAppBindingV1;
      platform: SnapbackAppClientPlatform;
      storagePartition?: string;
      appClient?: never;
      provider?: never;
    }>
  | Readonly<{
      binding?: PreparedReactBinding;
      provider?: SnapbackReactCoreProvider;
      appClient?: never;
      app?: never;
      platform?: never;
      storagePartition?: never;
    }>
);

export function SnapbackProvider(props: SnapbackProviderProps): any;
export function useSnapbackCurrentPrincipal(): CurrentPrincipalSnapshot;
export function useSnapbackAuth(): SnapbackAuthFacade;
