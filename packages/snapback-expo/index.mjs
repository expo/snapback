export {
  APP_BINDING_FORMAT,
  admitAppBindingV1,
  isAppBindingDiagnostic,
  publicBindingFacts,
  validateAppBindingV1,
} from './app-binding.mjs';
export {
  SnapbackExpoProvider,
  createSnapbackExpoBoot,
  defaultSnapbackExpoEnvironment,
  isSnapbackExpoBootDiagnostic,
  useSnapbackExpoBootState,
} from './provider.mjs';
export {
  SUPERVISED_EXCHANGE_FORMAT,
  SUPERVISED_EXCHANGE_PATH,
  createSupervisedExpoEnvironment,
  resolveSupervisedExpoExchangeOrigin,
} from './supervised-environment.mjs';
export {
  adaptExpoAssetSource,
  createExpoAssetSourceAdapter,
  expoAssetFetch,
  resolveExpoFetch,
} from './asset-source.mjs';

// Expo-safe hooks and the existing low-level provider remain aliases of the
// canonical React owner; this package does not fork their behavior.
export * from '@expo/snapback-react';

export const SNAPBACK_EXPO_INTEGRATION_RECEIPT_FORMAT =
  'snapback.expo-integration-receipt.v1';
