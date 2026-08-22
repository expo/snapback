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
  useSnapbackAuthorityMutation,
  useSnapbackAuthorityMutationStatus,
  useSnapbackAuthorityMyRole,
  useSnapbackAuthorityRoster,
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
  AuthorityMyRoleRow,
  AuthorityProfileReferences,
  AuthorityProfileScopeId,
  AuthorityRosterLoadMoreOutcome,
  AuthorityRosterRow,
  AuthorityRosterState,
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
  SkipOr,
  SkipSentinel,
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
  SnapbackAuthorityMutationDispatchOutcome,
  SnapbackAuthorityMutationDisposition,
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
      now?: never;
      provider?: never;
    }>
  | Readonly<{
      app: SnapbackApplicationDescriptorV1;
      binding: SnapbackAppBindingV1;
      platform: SnapbackAppClientPlatform;
      storagePartition?: string;
      /** Injected binding-admission clock; defaults to Date.now. */
      now?: () => number;
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
      now?: never;
    }>
);

export function SnapbackProvider(props: SnapbackProviderProps): any;
/** Official providers withhold hook consumers until ready. Custom SSR trees
 * that render this hook must provide a deterministic server snapshot equal to
 * the first hydration snapshot. */
export function useSnapbackCurrentPrincipal(): CurrentPrincipalSnapshot;
export function useSnapbackAuth(): SnapbackAuthFacade;
