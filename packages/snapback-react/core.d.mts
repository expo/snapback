import type {
  PreparedReactBinding,
  PreparedReactQueryGroup,
} from '@expo/snapback-client';
import type {
  SnapbackDiagnostic,
  SnapbackReactCoreProvider,
} from './index.mjs';

export {
  SnapbackQueuedMutationError,
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

export function SnapbackProvider(props: Readonly<{
  binding?: PreparedReactBinding;
  provider?: SnapbackReactCoreProvider;
  children?: any;
}>): any;
