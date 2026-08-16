// Framework packages only. This subpath keeps the admitted supervised bearer
// handoff out of the ordinary @expo/snapback-client and client.auth surfaces.
export {
  __applicationDescriptorForAppClient as applicationDescriptorForAppClient,
  __classifyHostedDevelopmentHostname as classifyHostedDevelopmentHostname,
  __adoptSupervisedBootstrapAuthority as adoptSupervisedBootstrapAuthority,
  __createSnapbackAppClientWithBootstrapObserver as createSnapbackAppClientWithBootstrapObserver,
} from './app-client.mjs';
