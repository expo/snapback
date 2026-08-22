export {
  SnapbackAssetImage,
  SnapbackProvider,
  bindSnapbackSurface,
  createSnapbackReactProvider,
  invokeSnapbackCommand,
  observeSnapbackSurface,
  placeholderToDataURL,
  rgbaToDataURL,
  thumbHashToApproximateAspectRatio,
  thumbHashToDataURL,
  thumbHashToRGBA,
  useSnapbackAssetImage,
  useSnapbackAssetUpload,
  useSnapbackAssetUrl,
  useSnapbackMedia,
  useSnapbackMediaCollection,
  useSnapbackCommand,
  useSurface,
} from './full-capabilities.mjs';

export {
  ARGUMENT_NORMALIZATION_VERSION,
  SnapbackDiagnosticError,
  bindSnapbackAppLifecycle,
  isSnapbackDiagnosticError,
} from '@expo/snapback-client';
export {
  CLIENT_AUTHORITY_STATES,
  CLIENT_AUTHORITY_STATE_MATRIX,
  CLIENT_AUTHORITY_SURFACES,
  CLIENT_AUTHORITY_TERMINALS,
  authorityTransitionCell,
  classifyClientAuthorityState,
} from '@expo/snapback-client/authority-transition';

// Full compatibility composition. Query/mutation-only applications can select
// @expo/snapback-react/core and omit this file's optional capability module.
// @ref LLP 0145#option-2--static-capability-modules-around-a-shared-kernel —
// the root stays Full while the narrow entry makes capability selection static.
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
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
  useSnapbackOptimisticCreate,
  useSnapbackOutbox,
  useSnapbackPresence,
  useSnapbackQueries,
  useSnapbackQuery,
  useSnapbackSettledMutation,
} from './implementation.mjs';
