import { app as generatedApp } from '@probe/generated-app';

const bootstrapCapability = 'auth.application-bootstrap.v1';

// This codegen revision emits authBootstrap but does not yet accept a source
// declaration for the provider opt-in capability. Apply the opt-in at the
// provider descriptor layer without changing any generated identity.
// @ref LLP 0258#compatibility-and-migration — both the policy fact and the
// required/offered capability must be present before first-party bootstrap.
export const app = Object.freeze({
  ...generatedApp,
  capabilities: Object.freeze({
    ...generatedApp.capabilities,
    required: Object.freeze([
      ...new Set([...generatedApp.capabilities.required, bootstrapCapability]),
    ].sort()),
  }),
});
