import {
  defineAuth,
  defineSchema,
  defineTable,
  v,
} from '../../../packages/snapback-codegen/define.mjs';

// @ref LLP 0258#d1-generate-one-non-secret-bootstrap-policy — this probe is
// deliberately durable-required and password-capable so codegen emits the
// ordinary application-bootstrap policy whose native arm is under test.
const authProgram = defineAuth({
  version: 1,
  custody: 'durable-required',
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});

export default defineSchema({
  probeDocuments: defineTable({
    label: v.string(),
  // Row visibility is intentionally broad; the protected live-query's
  // authenticated function policy is the authority boundary under test.
  }).visibility({ kind: 'public-read' }).sync(),
}, {
  auth: { mode: 'sessions' },
  authProgram,
});
