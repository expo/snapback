import { requireNativeModule } from 'expo-modules-core';

import { installSupervisedDevIdentityCheckoutNonce } from './install-core.mjs';

if (process.env.NODE_ENV !== 'production') {
  const nativeReader = requireNativeModule('SnapbackExpoDevIdentity');
  installSupervisedDevIdentityCheckoutNonce(nativeReader.takeCheckoutNonce());
}
