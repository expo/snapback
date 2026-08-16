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
  useSnapbackCommand,
  useSurface,
} from './full-capabilities.mjs';

export {
  ARGUMENT_NORMALIZATION_VERSION,
  SnapbackDiagnosticError,
  bindSnapbackAppLifecycle,
  isSnapbackDiagnosticError,
} from '@expo/snapback-client';

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
} from './implementation.mjs';
