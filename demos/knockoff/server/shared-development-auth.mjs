// Knockoff consumes the first-party shared development auth protocol.
//
// This file used to carry its own copy of the transaction state machine. That
// copy is now `@expo/snapback-cli/shared-development-auth`, and the demo's job
// is to be an ordinary consumer of it — which is also the cheapest way to keep
// the demo honest about what the shipped surface actually does.
//
// The import is a checkout-relative path rather than a package dependency:
// `@expo/snapback-cli` carries `workspace:*` dependencies that a demo's own
// install cannot resolve, and this file is only ever run by Node from inside
// this checkout.
//
// @ref LLP 0151#shared-development-browser-adapter — one implementation, in the
// package, exercised by both the package tests and this demo.

export {
  SHARED_DEVELOPMENT_AUTH_PROVIDERS,
  SHARED_DEVELOPMENT_AUTH_ROUTES,
  SHARED_DEVELOPMENT_AUTH_USER_LIMIT,
  createSharedDevelopmentAuth,
  sharedDevelopmentAuthAdmitted,
  sharedDevelopmentIdentityKey,
  sharedDevelopmentRehearsalIdentity,
} from '../../../packages/snapback-cli/shared-development-auth.mjs';
