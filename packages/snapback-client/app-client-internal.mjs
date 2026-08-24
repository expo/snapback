// Framework packages only. This subpath keeps the admitted supervised bearer
// handoff out of the ordinary @expo/snapback-client and client.auth surfaces.
export {
  __applicationDescriptorForAppClient as applicationDescriptorForAppClient,
  __classifyHostedDevelopmentHostname as classifyHostedDevelopmentHostname,
  __adoptSupervisedBootstrapAuthority as adoptSupervisedBootstrapAuthority,
  __authStoragePartitionIdentityHash as authStoragePartitionIdentityHash,
  __createSnapbackAppClientWithBootstrapObserver as createSnapbackAppClientWithBootstrapObserver,
  __createProviderValidatedExpoNativePlatform as createProviderValidatedExpoNativePlatform,
} from './app-client.mjs';
export {
  canonicalDeclaredDevOrigin,
  declaredDevCapabilityFromApp,
  deploymentIdentitiesEqual,
  normalizeDeploymentIdentity,
  stampedDeclaredDevIdentity,
} from './declared-dev-capability.mjs';
