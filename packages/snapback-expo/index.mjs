export {
  APP_BINDING_FORMAT,
  admitAppBindingV1,
  isAppBindingDiagnostic,
  publicBindingFacts,
  validateAppBindingV1,
} from './app-binding.mjs';
export {
  APPLICATION_AUTH_BOOTSTRAP_CAPABILITY,
  SnapbackExpoProvider,
  createSnapbackExpoBoot,
  defaultSnapbackExpoEnvironment,
  isSnapbackExpoBootDiagnostic,
  useSnapbackExpoBootState,
} from './provider.mjs';
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
export {
  adaptExpoAssetSource,
  createExpoAssetSourceAdapter,
  expoAssetFetch,
  resolveExpoFetch,
} from './asset-source.mjs';
export { useSnapbackActivityPresence } from './activity-presence.mjs';

// Expo-safe hooks and the existing low-level provider remain aliases of the
// canonical React owner except for activity presence, whose explicit facade
// wrapper adds application-lifecycle policy.
export * from '@expo/snapback-react';

export const SNAPBACK_EXPO_INTEGRATION_RECEIPT_FORMAT =
  'snapback.expo-integration-receipt.v1';
